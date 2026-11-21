// The shopkeeper's pages: the billing counter and the dashboard, against the shop API
// running in this process.
// Run: node --test "sites/*/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import shop from "../shop.json" with { type: "json" };
import { MemoryStore } from "../../../shop-kit/api/memory-store.mjs";
import { createShopApi, initialState } from "../../../shop-kit/api/shop-api.mjs";
import { parseBillingCsv } from "../../../shop-kit/api/stock.mjs";
import { ApiClient } from "../js/api-client.js";
import { CounterPage } from "../js/counter-page.js";
import { DashboardPage } from "../js/dashboard-page.js";
import { StubDocument } from "./stub_document.mjs";

const BASE = new URL(shop.page).origin;
// Friday, Nov 20, 2026 at noon in Neem Chowk: every shop is open.
const FRIDAY_NOON = new Date("2026-11-20T06:30:00Z");
const items = parseBillingCsv(await readFile(new URL(`../../../shop-kit/samples/${shop.id}.csv`, import.meta.url), "utf8"), shop.kind).items;

/**
 * A client for a fresh in-process shop API.
 *
 * :return: The client.
 */
function client() {
  const api = createShopApi({
    profile: { id: shop.id, name: shop.name, kind: shop.kind, timezone: shop.timezone, hours: shop.hours },
    items,
    store: new MemoryStore(initialState(items)),
    clock: () => FRIDAY_NOON,
  });
  return new ApiClient(async (method, path, query, body) => (await api.handle({ method, path, query: query || {}, body: body ?? null })).body);
}

/**
 * All text in a stand-in element and its children.
 *
 * :param node: A StubElement or a text child.
 * :return: The joined text.
 */
function textOf(node) {
  return typeof node === "string" ? node : [node.textContent || "", ...(node.children || []).map(textOf)].join(" ");
}

test("the counter lists every item and billing one updates its stock", async () => {
  const document = StubDocument.fromHtml(await readFile(new URL("../counter.html", import.meta.url), "utf8"), `${BASE}/counter.html`);
  const page = new CounterPage({ document, api: client() });
  await page.mount();
  assert.equal(document.getElementById("counter-rows").children.length, items.length);
  const target = items.find((item) => item.qty > 0);
  const answer = await page.bill(target.id);
  assert.equal(answer.ok, true);
  assert.equal(answer.item.qty, target.qty - 1);
  assert.match(document.getElementById("counter-status").textContent, /^Billed 1 × /);
});

test("the dashboard shows holds masked, missed demand and low stock", async () => {
  const api = client();
  const target = items.find((item) => item.qty > 0 && !["H", "H1", "X"].includes(item.schedule));
  await api.createHold({ itemId: target.id, qty: 1, name: "Asha Verma", phone: "9876543221" });
  await api.stock("unicorn tears");
  const document = StubDocument.fromHtml(await readFile(new URL("../dashboard.html", import.meta.url), "utf8"), `${BASE}/dashboard.html`);
  const page = new DashboardPage({ document, api });
  await page.mount();
  const holds = textOf(document.getElementById("dash-holds"));
  assert.match(holds, /Asha · ••••••••21/);
  assert.ok(!holds.includes("Verma") && !holds.includes("98765"));
  assert.match(textOf(document.getElementById("dash-missed")), /unicorn tears/);
  assert.equal(document.getElementById("dash-holds-empty").hidden, true);
});
