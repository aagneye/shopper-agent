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
import { CounterPage, unitPrice } from "../js/counter-page.js";
import { DashboardPage, describeChange } from "../js/dashboard-page.js";
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

/**
 * A mounted counter page on a fresh shop API.
 *
 * :return: {page, document}.
 */
async function counter() {
  const document = StubDocument.fromHtml(await readFile(new URL("../counter.html", import.meta.url), "utf8"), `${BASE}/counter.html`);
  const page = new CounterPage({ document, api: client() });
  await page.mount();
  return { page, document };
}

test("the counter lists every item and bills a typed quantity", async () => {
  const { page, document } = await counter();
  assert.equal(document.getElementById("counter-rows").children.length, items.length);
  const target = items.find((item) => item.qty >= 2);
  assert.equal(page.add(target.id, "2"), true);
  assert.equal(document.getElementById("counter-cart").children.length, 1);
  assert.equal(document.getElementById("counter-bill").disabled, false);
  const answer = await page.checkout();
  assert.equal(answer.ok, true);
  assert.equal(answer.items[0].qty, target.qty - 2);
  assert.match(document.getElementById("counter-status").textContent, /^Billed 2 items, total ₹/);
  assert.equal(document.getElementById("counter-cart").children.length, 0);
  assert.equal(page.item(target.id).qty, target.qty - 2);
});

test("the counter lets a line be changed or removed before billing", async () => {
  const { page, document } = await counter();
  const [first, second] = items.filter((item) => item.qty >= 2);
  page.add(first.id, "1");
  page.add(second.id, "1");
  assert.equal(page.setQty(first.id, "2"), true);
  assert.equal(page.cart.get(first.id), 2);
  assert.equal(page.remove(second.id), true);
  assert.deepEqual([...page.cart], [[first.id, 2]]);
  assert.equal(document.getElementById("counter-cart").children.length, 1);
  assert.equal(page.setQty(first.id, "0"), true);
  assert.equal(page.cart.size, 0);
  assert.equal(document.getElementById("counter-bill").disabled, true);
});

test("the counter refuses quantities that are not whole numbers or more than is free", async () => {
  const { page } = await counter();
  const target = items.find((item) => item.qty > 0);
  for (const bad of ["", "0", "-1", "1.5", "abc"]) {
    assert.equal(page.add(target.id, bad), false, bad);
  }
  assert.equal(page.add(target.id, String(target.qty + 1)), false);
  assert.equal(page.cart.size, 0);
});

test("the counter reads a unit price from the price text when the server sends no mrp", () => {
  assert.equal(unitPrice({ mrp: 38, price: "₹38" }), 38);
  assert.equal(unitPrice({ price: "₹38" }), 38);
  assert.equal(unitPrice({ price: "₹1,450.50" }), 1450.5);
  assert.equal(unitPrice({}), 0);
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

test("the dashboard marks a hold collected or released, and the stock follows", async () => {
  const api = client();
  const target = items.find((item) => item.qty >= 2 && !["H", "H1", "X"].includes(item.schedule));
  const first = await api.createHold({ itemId: target.id, qty: 1, name: "Asha Verma", phone: "9876543221" });
  const second = await api.createHold({ itemId: target.id, qty: 1, name: "Ravi Kumar", phone: "9876543299" });
  const document = StubDocument.fromHtml(await readFile(new URL("../dashboard.html", import.meta.url), "utf8"), `${BASE}/dashboard.html`);
  const page = new DashboardPage({ document, api });
  await page.mount();
  const rows = document.getElementById("dash-holds").children;
  assert.deepEqual(rows.map((row) => row.querySelectorAll("button").map((button) => button.textContent)), [["Collected", "Release"], ["Collected", "Release"]]);
  await page.collect(first.code);
  assert.match(document.getElementById("dash-status").textContent, new RegExp(`^${first.code} collected`));
  await page.release(second.code);
  assert.match(document.getElementById("dash-status").textContent, new RegExp(`^${second.code} released`));
  const item = (await api.stockAll()).items.find((entry) => entry.id === target.id);
  assert.deepEqual([item.qty, item.held], [target.qty - 1, 0]);
  const shown = document.getElementById("dash-holds").children;
  assert.match(textOf(shown[0]), /released/);
  assert.match(textOf(shown[1]), /collected/);
  assert.equal(shown.flatMap((row) => row.querySelectorAll("button")).length, 0);
});

test("the dashboard previews a stock file, then saves it or drops it", async () => {
  const api = client();
  const document = StubDocument.fromHtml(await readFile(new URL("../dashboard.html", import.meta.url), "utf8"), `${BASE}/dashboard.html`);
  const page = new DashboardPage({ document, api });
  await page.mount();
  const csv = (await readFile(new URL(`../../../shop-kit/samples/${shop.id}.csv`, import.meta.url), "utf8")).trimEnd();
  const [header, first] = csv.split(/\r?\n/);
  const fields = first.split(",");
  fields[fields.length - 1] = String(Number(fields[fields.length - 1]) + 25);
  const file = `${header}\n${fields.join(",")}`;
  const preview = await page.previewImport(file);
  assert.equal(preview.changed.length, 1);
  assert.equal(document.getElementById("import-preview").hidden, false);
  assert.match(textOf(document.getElementById("import-changes")), new RegExp(`count ${items[0].qty} → ${items[0].qty + 25}`));
  assert.equal((await api.stockAll()).items[0].qty, items[0].qty);
  page.cancelImport();
  assert.equal(document.getElementById("import-preview").hidden, true);
  assert.equal(await page.applyImport(), null);
  await page.previewImport(file);
  const saved = await page.applyImport();
  assert.equal(saved.applied, true);
  assert.match(document.getElementById("import-status").textContent, /^Stock updated: 1 changed, 0 new/);
  assert.equal((await api.stockAll()).items[0].qty, items[0].qty + 25);
  await page.previewImport("not,a,stock,file");
  assert.match(document.getElementById("import-status").textContent, /^Not read\. The header must be/);
  assert.equal(document.getElementById("import-preview").hidden, true);
});

test("a stock change is described in words", () => {
  assert.equal(describeChange({ qtyFrom: 40, qtyTo: 70, priceFrom: "₹21", priceTo: "₹23" }), "count 40 → 70 · price ₹21 → ₹23");
  assert.equal(describeChange({ qtyFrom: 3, qtyTo: 3, priceFrom: "₹21", priceTo: "₹21" }), "name or pack details change");
});
