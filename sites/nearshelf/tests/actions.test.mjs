// The website tools NearShelf gives its agents, through the real action registry.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ActionRegistry } from "../runtime/actions.js";
import { StubDocument } from "./stub_document.mjs";
import { StubOption } from "./stub_option.mjs";

const BASE = "http://127.0.0.1:8080";
const SCOPE = { base: BASE, network: "nearshelf" };

globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), `${BASE}/`);
globalThis.Option = StubOption;
const { App } = await import("../js/app.js");
const { registerActions } = await import("../site-actions.js");
App.clock = () => new Date("2026-11-20T17:15:00Z");
App.page.refresh();

/**
 * A registry with NearShelf's actions registered.
 *
 * :return: The registry.
 */
async function registry() {
  const actions = new ActionRegistry();
  await registerActions({ register: actions.register.bind(actions, SCOPE) });
  return actions;
}

/**
 * Find an action's reference by name.
 *
 * :param actions: The registry.
 * :param name: The action name.
 * :return: The reference.
 */
function ref(actions, name) {
  const entry = actions.catalog(SCOPE).find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`Action ${name} is not registered.`);
  }
  return entry.ref;
}

/**
 * Run one action as the runtime would, approving any confirmation.
 *
 * :param actions: The registry.
 * :param name: The action name.
 * :param args: Its arguments.
 * :return: The receipt.
 */
async function run(actions, name, args) {
  const plan = actions.prepare({ kind: "action", action: ref(actions, name), arguments: args });
  const receipts = await actions.execute(plan, async () => true, `test-${name}`);
  return receipts[0];
}

test("exactly five website tools are registered, all local-only, with the planned effects", async () => {
  const actions = await registry();
  const effects = Object.fromEntries(actions.catalog(SCOPE).map((entry) => [entry.name, [entry.effect, entry.availability]]));
  assert.deepEqual(effects, {
    get_shopper_state: ["read", "local-only"],
    find_shops: ["read", "local-only"],
    plan_fewest_stops: ["read", "local-only"],
    show_results: ["write", "local-only"],
    save_hold: ["write", "local-only"],
  });
});

test("no description or schema is left as a TODO, and writes run only when the visitor asks", async () => {
  const actions = await registry();
  for (const entry of actions.catalog(SCOPE)) {
    assert.ok(!JSON.stringify([entry.description, entry.inputSchema]).includes("TODO"), entry.name);
    if (entry.effect === "write") {
      assert.ok(entry.description.includes("only when the visitor asks"), entry.name);
    }
  }
});

test("find_shops gives the partner tool to ask for each open pharmacy", async () => {
  const receipt = await run(await registry(), "find_shops", { category: "pharmacy" });
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual(receipt.result.shops.map((shop) => shop.askWith), ["shanti_medical", "night_owl_pharmacy"]);
  assert.equal(receipt.result.now.time, "10:45 pm");
});

test("find_shops never asks for more than four shops", async () => {
  const actions = await registry();
  assert.throws(() => actions.prepare({ kind: "action", action: ref(actions, "find_shops"), arguments: { category: "pharmacy", limit: 5 } }), /Invalid arguments\.limit/);
});

test("show_results refuses a shop that is not in the directory", async () => {
  const actions = await registry();
  const args = { need: "ORS sachets", rows: [{ shopId: "nowhere", availability: "in_stock" }] };
  assert.throws(() => actions.prepare({ kind: "action", action: ref(actions, "show_results"), arguments: args }), /Invalid arguments\.rows\[0\]\.shopId/);
});

test("show_results puts the answers on the board", async () => {
  const receipt = await run(await registry(), "show_results", {
    need: "ORS sachets",
    rows: [{ shopId: "night_owl_pharmacy", availability: "in_stock", item: "ORS sachets 21 g", price: "₹20", asOf: "10:44 pm" }],
  });
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual(receipt.result, { ok: true, need: "ORS sachets", shown: 1 });
  assert.equal(document.getElementById("results").children.length, 1);
});

test("save_hold keeps the shop's hold code in My holds", async () => {
  const receipt = await run(await registry(), "save_hold", { shopId: "night_owl_pharmacy", item: "ORS sachets 21 g", code: "H-7310", until: "8:00 am" });
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.result.ok, true);
  assert.ok(App.page.getState().holds.some((hold) => hold.code === "H-7310" && hold.shop === "Night Owl Pharmacy"));
});

test("plan_fewest_stops plans from the shops' answers", async () => {
  const receipt = await run(await registry(), "plan_fewest_stops", {
    items: ["ORS sachets", "Paracetamol syrup"],
    offers: [
      { shopId: "shanti_medical", has: ["Paracetamol syrup"] },
      { shopId: "night_owl_pharmacy", has: ["ORS sachets"] },
    ],
  });
  assert.equal(receipt.result.summary, "2 stops cover all 2 items.");
  assert.deepEqual(receipt.result.stops.map((stop) => [stop.shopId, stop.distance]), [["shanti_medical", "210 m"], ["night_owl_pharmacy", "390 m"]]);
});

test("get_shopper_state reads Neem Chowk time and the saved details", async () => {
  const receipt = await run(await registry(), "get_shopper_state", {});
  assert.equal(receipt.result.now.date, "2026-11-20");
  assert.equal(receipt.result.from.name, "Neem Chowk Metro, Gate 2");
  assert.ok(Array.isArray(receipt.result.vehicles));
});
