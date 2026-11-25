// The scan panel on the NearShelf page, with a scripted photo reader.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { StubDocument } from "./stub_document.mjs";
import { StubOption } from "./stub_option.mjs";
import { PrescriptionError } from "../js/prescription.js";

globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), "http://127.0.0.1:8080/");
globalThis.Option = StubOption;
const { App } = await import("../js/app.js");
const page = App.page;
const { scan } = page;
const get = (id) => document.getElementById(id);
const SURE = { name: "Azithromycin", strength: "500 mg", form: "tablet", amount: "3", unsure: false };
const UNSURE = { name: "Dolo", strength: "650 mg", form: "", amount: "", unsure: true };

/**
 * Open a fresh panel and read a photo.
 *
 * :param read: The scripted reader's read method.
 */
async function pick(read) {
  scan.reader = { setup: () => ({ host: "ai.example" }), read };
  get("scan-panel").hidden = true;
  get("scan-open").dispatch("click");
  get("scan-file").files = [{ name: "photo" }];
  page.dropScanned();
  await scan.pick();
}

test("the panel names who gets the photo, and without a provider shows how to add one", () => {
  scan.reader = { setup: () => { throw new PrescriptionError("Add an AI provider key."); } };
  get("scan-open").dispatch("click");
  assert.equal(get("scan-panel").hidden, false);
  assert.equal(get("scan-file").disabled, true);
  assert.equal(get("scan-settings").hidden, false);
  assert.match(get("scan-note").textContent, /Add an AI provider key/);
  scan.reader = { setup: () => ({ host: "ai.example" }) };
  scan.showSetup();
  assert.equal(get("scan-file").disabled, false);
  assert.equal(get("scan-settings").hidden, true);
  assert.match(get("scan-note").textContent, /ai\.example, and to no shop/);
});

test("a hard-to-read line must be checked before the list can be saved", async () => {
  await pick(async () => [SURE, UNSURE]);
  assert.equal(get("scan-lines").children.length, 2);
  assert.equal(get("scan-use").disabled, true);
  await scan.use();
  assert.equal(page.store.profile.list.length, 0);
  const box = get("scan-lines").children[1].querySelectorAll("input")[4];
  box.checked = true;
  box.dispatch("change");
  assert.equal(get("scan-use").disabled, false);
  const name = get("scan-lines").children[1].querySelectorAll("input")[0];
  name.value = "Dolo 650";
  name.dispatch("input");
  await scan.use();
  assert.deepEqual(page.store.profile.list.map((entry) => entry.label), ["Azithromycin 500 mg tablet × 3", "Dolo 650 650 mg"]);
  assert.equal(get("scan-review").hidden, true);
  assert.equal(get("scan-ask").hidden, false);
});

test("the checked list goes to the chat once, and only when it can take it", () => {
  const sent = [];
  page.onAsk = () => false;
  assert.equal(page.askScanned(), false);
  assert.equal(get("scan-ask").hidden, false);
  page.onAsk = (text) => Boolean(sent.push(text));
  assert.equal(page.askScanned(), true);
  assert.equal(page.askScanned(), false);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^I need these medicines: Azithromycin 500 mg tablet × 3; Dolo 650 650 mg/);
});

test("a full list is refused whole and the lines stay for another try", async () => {
  const before = page.store.profile.list.length;
  await pick(async () => Array.from({ length: 11 }, (_, index) => ({ ...SURE, name: `Item ${index}` })));
  await scan.use();
  assert.match(get("scan-status").textContent, /room for 10 more/);
  assert.equal(page.store.profile.list.length, before);
  assert.equal(scan.lines.length, 11);
  assert.equal(get("scan-use").disabled, false);
});

test("a line can be removed, and saving the same list again adds nothing", async () => {
  await pick(async () => [SURE, UNSURE]);
  get("scan-lines").children[1].querySelector("button").dispatch("click");
  assert.equal(scan.lines.length, 1);
  await scan.use();
  assert.match(get("scan-status").textContent, /already on My list/);
  assert.equal(page.store.profile.list.length, 2);
});

test("an answer that arrives after Discard is dropped", async () => {
  let finish;
  const waiting = pick(() => new Promise((resolve) => { finish = resolve; }));
  get("scan-clear").dispatch("click");
  finish([SURE]);
  await waiting;
  assert.equal(scan.lines.length, 0);
  assert.equal(get("scan-review").hidden, true);
  assert.equal(get("scan-file").disabled, false);
});

test("a reading problem is shown and another photo can be chosen", async () => {
  await pick(async () => { throw new PrescriptionError("The AI provider is busy."); });
  assert.equal(get("scan-status").textContent, "The AI provider is busy.");
  assert.equal(get("scan-file").disabled, false);
});
