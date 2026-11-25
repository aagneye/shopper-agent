// The pharmacy page's medicine list, against the shop API running in this process.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import shop from "../shop.json" with { type: "json" };
import { MemoryStore } from "../../../shop-kit/api/memory-store.mjs";
import { createShopApi, initialState } from "../../../shop-kit/api/shop-api.mjs";
import { parseBillingCsv } from "../../../shop-kit/api/stock.mjs";
import { ApiClient } from "../js/api-client.js";
import { MedicineList, strengthDiffers } from "../js/medicine-list.js";
import { ShopPage } from "../js/shop-page.js";
import { StubDocument } from "./stub_document.mjs";

const HTML = await readFile(new URL("../index.html", import.meta.url), "utf8");
const HEADER = "code,name,composition,strength,pack,schedule,mrp,qty";
const ITEMS = parseBillingCsv([
  HEADER,
  "T-1,Paracetamol Tablets,Paracetamol,500 mg,strip of 10,OTC,15,40",
  "T-2,Paracetamol Tablets,Paracetamol,650 mg,strip of 15,OTC,30.5,2",
  "T-3,Azithromycin Tablets,Azithromycin,500 mg,strip of 3,H,72,6",
  "T-4,Cetirizine Tablets,Cetirizine,10 mg,strip of 10,OTC,18,0",
].join("\n"), "pharmacy").items;

/**
 * A mounted medicine list on a fresh shop.
 *
 * :return: {list, document, api}.
 */
function mounted() {
  const document = StubDocument.fromHtml(HTML, `${new URL(shop.page).origin}/`);
  const handler = createShopApi({
    profile: { id: shop.id, name: shop.name, kind: shop.kind, timezone: shop.timezone, hours: shop.hours },
    items: ITEMS,
    store: new MemoryStore(initialState(ITEMS)),
    clock: () => new Date("2026-11-20T06:30:00Z"),
  });
  const api = new ApiClient(async (method, path, query, body) => (await handler.handle({ method, path, query: query || {}, body: body ?? null })).body);
  const list = new MedicineList({ document, api });
  list.mount();
  return { list, document, api };
}

const textOf = (node) => (typeof node === "string" ? node : [node.textContent || "", ...(node.children || []).map(textOf)].join(" "));
const written = (name, strength = "", amount = "") => ({ name, strength, form: "tablet", amount });

test("a scanned line is never matched to an item or a number of packs by itself", async () => {
  const { list, document } = mounted();
  const answer = await list.addWritten([written("Paracetamol", "650 mg", "10")]);
  assert.equal(answer.ok, true);
  assert.deepEqual([list.rows[0].itemId, list.rows[0].qty], ["", 0]);
  assert.deepEqual(list.rows[0].options.map((option) => option.id).sort(), ["T-1", "T-2"]);
  assert.equal(list.quote, null);
  assert.match(document.getElementById("list-total").textContent, /1 still to choose/);
});

test("a shared strength or form never offers a different medicine", async () => {
  const { list, document } = mounted();
  await list.addWritten([written("Warfarin", "500 mg"), written("Dolo 650"), written("Warfarin 500 mg tablets")]);
  assert.deepEqual(list.rows.map((row) => row.options.length), [0, 0, 0]);
  assert.match(textOf(document.getElementById("list-rows")), /no item with this name/);
});

test("chosen items are priced live, and only what is available counts", async () => {
  const { list, document } = mounted();
  await list.addWritten([written("Paracetamol", "650 mg"), written("Azithromycin", "500 mg"), written("Cetirizine"), written("Dolo")]);
  const [first, second, third] = list.rows;
  await list.choose(first, "T-2");
  await list.setPacks(first, "2");
  await list.choose(second, "T-3");
  await list.setPacks(second, "1");
  await list.choose(third, "T-4");
  await list.setPacks(third, "1");
  assert.equal(list.quote.total, "₹133");
  assert.match(document.getElementById("list-total").textContent, /Estimated total for 2 of 4 items: ₹133\. .*2 not included/);
  const text = textOf(document.getElementById("list-rows"));
  assert.match(text, /₹61/);
  assert.match(text, /Bring the prescription/);
  assert.match(text, /Out of stock/);
  await list.setPacks(first, "3");
  assert.equal(list.quote.total, "₹72");
  assert.match(textOf(document.getElementById("list-rows")), /Not enough for this many/);
});

test("a different strength is pointed out", async () => {
  const { list, document } = mounted();
  await list.addWritten([written("Paracetamol", "650mg")]);
  await list.choose(list.rows[0], "T-1");
  assert.match(textOf(document.getElementById("list-rows")), /Your list says 650mg/);
  await list.choose(list.rows[0], "T-2");
  assert.doesNotMatch(textOf(document.getElementById("list-rows")), /Your list says/);
  assert.equal(strengthDiffers("5 mg", "15 mg · strip"), true);
  assert.equal(strengthDiffers("", "15 mg"), false);
});

test("the same item is on the list once, and packs stay from 1 to 5", async () => {
  const { list, document } = mounted();
  for (let count = 0; count < 7; count += 1) {
    await list.addItem(ITEMS[0]);
  }
  assert.deepEqual(list.rows.map((row) => row.qty), [5]);
  await list.addWritten([written("Paracetamol")]);
  await list.choose(list.rows[1], "T-1");
  assert.equal(list.rows[1].itemId, "");
  assert.match(document.getElementById("list-status").textContent, /already on your list/);
  for (const bad of ["0", "6", "1.5", "x"]) {
    await list.setPacks(list.rows[0], bad);
    assert.equal(list.rows[0].qty, 0);
  }
});

test("a full list refuses more, and Clear empties it", async () => {
  const { list } = mounted();
  assert.equal((await list.addWritten(Array.from({ length: 13 }, () => written("Dolo")))).ok, false);
  assert.equal(list.rows.length, 0);
  await list.addWritten(Array.from({ length: 12 }, () => written("Dolo")));
  await list.addItem(ITEMS[0]);
  assert.equal(list.rows.length, 12);
  await list.remove(list.rows[0]);
  assert.equal(list.rows.length, 11);
  list.clear();
  assert.equal(list.rows.length, 0);
});

test("a late or failed price answer never shows an old total", async () => {
  const { list, document, api } = mounted();
  await list.addItem(ITEMS[0]);
  let finish;
  const real = api.quote.bind(api);
  api.quote = () => new Promise((resolve) => { finish = resolve; });
  const late = list.setPacks(list.rows[0], "2");
  api.quote = real;
  await list.setPacks(list.rows[0], "3");
  finish({ ok: true, lines: [], total: "₹999", asOf: "now" });
  await late;
  assert.equal(list.quote.total, "₹45");
  api.quote = async () => { throw new Error("down"); };
  await list.price();
  assert.equal(list.quote, null);
  assert.equal(document.getElementById("list-total").textContent, "");
  assert.match(document.getElementById("list-status").textContent, /did not answer/);
});

test("the stock search offers Add to list", async () => {
  const { document, api } = mounted();
  const page = new ShopPage({ document, shop, catalog: [], api, clock: () => new Date("2026-11-20T06:30:00Z") });
  page.mount();
  const added = [];
  page.onAdd = (match) => added.push(match.id);
  page.showResults(await api.stock("azithromycin"));
  const card = document.getElementById("stock-results").children[0];
  card.querySelectorAll("button").find((button) => button.textContent === "Add to list").dispatch("click");
  assert.deepEqual(added, ["T-3"]);
});
