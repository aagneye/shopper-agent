// The shop API: live stock bands, holds, counter sales and missed demand.
// Run: node --test "shop-kit/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import directory from "../../sites/nearshelf/directory/neem-chowk.json" with { type: "json" };
import { MemoryStore } from "../api/memory-store.mjs";
import { createShopApi, initialState } from "../api/shop-api.mjs";
import { parseBillingCsv } from "../api/stock.mjs";

// Friday, Nov 20, 2026 at 10:45 pm in Neem Chowk.
const FRIDAY_NIGHT = new Date("2026-11-20T17:15:00Z");
const ASHA = { name: "Asha Verma", phone: "98765 43221" };

/**
 * A shop API over its bundled billing export, with a settable clock.
 *
 * :param id: The shop id.
 * :param options: {allowReset, extraCsvRows, clock}.
 * :return: {api, clock}, where clock.now can be changed.
 */
async function shop(id, { allowReset = false, extraCsvRows = "", clock = { now: FRIDAY_NIGHT } } = {}) {
  const place = directory.places.find((entry) => entry.id === id);
  const text = await readFile(new URL(`../samples/${id}.csv`, import.meta.url), "utf8");
  const parsed = parseBillingCsv(text.trimEnd() + (extraCsvRows ? `\n${extraCsvRows}` : ""), place.category);
  assert.equal(parsed.ok, true, parsed.reason);
  const api = createShopApi({
    profile: { id, name: place.name, kind: place.category, timezone: directory.area.timezone, hours: place.hours },
    items: parsed.items,
    store: new MemoryStore(initialState(parsed.items)),
    clock: () => clock.now,
    allowReset,
  });
  return { api, clock };
}

const get = (api, path, query = {}) => api.handle({ method: "GET", path, query });
const post = (api, path, body) => api.handle({ method: "POST", path, body });

test("a stock answer gives the band, price, hold rule and time, never the count", async () => {
  const { api } = await shop("shanti_medical");
  const { status, body } = await get(api, "/api/stock", { q: "children's paracetamol syrup" });
  assert.equal(status, 200);
  assert.equal(body.asOf, "10:45 pm");
  assert.deepEqual(body.matches[0], {
    id: "SM-1001",
    name: "Paracetamol Oral Suspension (Paediatric)",
    detail: "120 mg/5 ml · 60 ml bottle",
    price: "₹38",
    availability: "limited",
    hold: "yes",
    match: "full",
  });
});

test("a hold lasts until closing and takes the unit off the shelf", async () => {
  const { api } = await shop("shanti_medical");
  const held = await post(api, "/api/holds", { itemId: "SM-1001", qty: 1, ...ASHA });
  assert.equal(held.status, 200);
  assert.equal(held.body.ok, true);
  assert.match(held.body.code, /^H-\d{4}$/);
  assert.equal(held.body.until, "11:00 pm");
  assert.equal(held.body.prescription, false);
  const all = await get(api, "/api/stock/all");
  assert.deepEqual(all.body.items.find((item) => item.id === "SM-1001").available, 1);
  const tooMany = await post(api, "/api/holds", { itemId: "SM-1001", qty: 2, ...ASHA });
  assert.deepEqual(tooMany.body, { ok: false, field: "qty", reason: "Only 1 left to hold." });
});

test("a prescription medicine is held with a prescription note", async () => {
  const { api } = await shop("shanti_medical");
  const { body } = await post(api, "/api/holds", { itemId: "SM-1005", qty: 1, ...ASHA });
  assert.equal(body.ok, true);
  assert.equal(body.prescription, true);
  assert.match(body.note, /prescription/);
});

test("a Schedule X medicine is never held", async () => {
  const { api } = await shop("shanti_medical", { extraCsvRows: "SM-X01,Controlled Tablets,Testamine,1 mg,strip of 10,X,10,5" });
  const answer = await get(api, "/api/stock", { q: "controlled tablets" });
  assert.equal(answer.body.matches[0].hold, "no");
  const { body } = await post(api, "/api/holds", { itemId: "SM-X01", qty: 1, ...ASHA });
  assert.equal(body.ok, false);
  assert.equal(body.field, "itemId");
});

test("a hold needs a name and a 10-digit mobile number", async () => {
  const { api } = await shop("shanti_medical");
  assert.equal((await post(api, "/api/holds", { itemId: "SM-1002", qty: 1, name: "Asha", phone: "12345" })).body.field, "phone");
  assert.equal((await post(api, "/api/holds", { itemId: "SM-1002", qty: 1, name: "A", phone: "9876543221" })).body.field, "name");
  assert.equal((await post(api, "/api/holds", { itemId: "SM-1002", qty: 1, name: "Asha", phone: "+91 98765-43221" })).body.ok, true);
});

test("a counter sale updates the band at once, and a later hold is refused", async () => {
  const { api } = await shop("shanti_medical");
  const sale = await post(api, "/api/sale", { itemId: "SM-1004", qty: 3 });
  assert.equal(sale.body.ok, true);
  assert.equal(sale.body.item.available, 0);
  const answer = await get(api, "/api/stock", { q: "ors" });
  assert.equal(answer.body.matches[0].availability, "out_of_stock");
  assert.equal(answer.body.matches[0].hold, "no");
  const late = await post(api, "/api/holds", { itemId: "SM-1004", qty: 1, ...ASHA });
  assert.deepEqual(late.body, { ok: false, field: "qty", reason: "None left to hold." });
});

test("the counter cannot sell units that are on hold", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1001", qty: 2, ...ASHA });
  const sale = await post(api, "/api/sale", { itemId: "SM-1001", qty: 1 });
  assert.equal(sale.body.ok, false);
  assert.match(sale.body.reason, /2 on hold/);
});

test("a counter bill takes several items in one sale and adds up the total", async () => {
  const { api } = await shop("shanti_medical");
  const before = (await get(api, "/api/stock/all")).body.items;
  const tablets = before.find((item) => item.id === "SM-1002");
  const { body } = await post(api, "/api/bill", { lines: [{ itemId: "SM-1002", qty: 10 }, { itemId: "SM-1004", qty: 2 }, { itemId: "SM-1002", qty: 2 }] });
  assert.equal(body.ok, true);
  assert.deepEqual(body.lines.map((line) => [line.itemId, line.qty]), [["SM-1002", 12], ["SM-1004", 2]]);
  const ors = before.find((item) => item.id === "SM-1004");
  assert.equal(body.total, `₹${(tablets.mrp * 12 + ors.mrp * 2).toLocaleString("en-IN")}`);
  assert.equal(body.items.find((item) => item.id === "SM-1002").qty, tablets.qty - 12);
  assert.equal(body.items.find((item) => item.id === "SM-1004").available, ors.available - 2);
});

test("a counter bill is refused whole when any line cannot be billed", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1001", qty: 2, ...ASHA });
  const tabletsQty = async () => (await get(api, "/api/stock/all")).body.items.find((item) => item.id === "SM-1002").qty;
  const before = await tabletsQty();
  const refused = await post(api, "/api/bill", { lines: [{ itemId: "SM-1002", qty: 1 }, { itemId: "SM-1001", qty: 1 }] });
  assert.equal(refused.body.ok, false);
  assert.match(refused.body.reason, /2 on hold/);
  assert.equal(await tabletsQty(), before);
  for (const lines of [[], [{ itemId: "SM-1002", qty: 0 }], [{ itemId: "SM-1002", qty: 1.5 }], [{ itemId: "nope", qty: 1 }], [{ itemId: "SM-1002", qty: 51 }]]) {
    assert.equal((await post(api, "/api/bill", { lines })).body.ok, false, JSON.stringify(lines));
  }
  assert.equal((await post(api, "/api/bill", {})).body.ok, false);
});

test("a quote totals only what the shop can supply, gives no counts and changes nothing", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1004", qty: 2, ...ASHA });
  const before = (await get(api, "/api/stock/all")).body.items;
  const { body } = await post(api, "/api/quote", { lines: [{ itemId: "SM-1003", qty: 2 }, { itemId: "SM-1004", qty: 2 }, { itemId: "SM-1005", qty: 1 }, { itemId: "SM-1008", qty: 1 }] });
  assert.equal(body.total, "₹155");
  assert.deepEqual(body.lines.map((line) => [line.enough, line.availability, line.prescription]), [[true, "in_stock", false], [false, "limited", false], [true, "in_stock", true], [false, "out_of_stock", false]]);
  for (const line of body.lines) {
    assert.deepEqual(Object.keys(line).filter((key) => ["held", "available", "left"].includes(key)), []);
  }
  assert.deepEqual((await get(api, "/api/stock/all")).body.items, before);
  assert.deepEqual((await get(api, "/api/missed")).body.missed, []);
});

test("a bad quote list is refused", async () => {
  const { api } = await shop("shanti_medical");
  const line = { itemId: "SM-1002", qty: 1 };
  for (const lines of [undefined, [], Array(13).fill(line), [null], [line, line], [{ itemId: "nope", qty: 1 }], ...[0, 6, 1.5, "1"].map((qty) => [{ ...line, qty }])]) {
    assert.equal((await post(api, "/api/quote", { lines })).body.ok, false);
  }
});

test("missed demand counts what people asked for that the shop could not give", async () => {
  const { api } = await shop("shanti_medical");
  await get(api, "/api/stock", { q: "unicorn tears" });
  await get(api, "/api/stock", { q: "Unicorn tears" });
  await get(api, "/api/stock", { q: "ibuprofen syrup" });
  const { body } = await get(api, "/api/missed");
  assert.deepEqual(body.missed.map(({ query, count, reason }) => ({ query, count, reason })), [
    { query: "unicorn tears", count: 2, reason: "not stocked" },
    { query: "ibuprofen syrup", count: 1, reason: "out of stock" },
  ]);
});

test("names and phone numbers never reach stock or missed answers, and are masked in the holds list", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1002", qty: 1, ...ASHA });
  await get(api, "/api/stock", { q: "unicorn tears" });
  const holds = await get(api, "/api/holds");
  assert.equal(holds.body.holds[0].name, "Asha");
  assert.equal(holds.body.holds[0].phone, "••••••••21");
  const visible = JSON.stringify([(await get(api, "/api/stock", { q: "paracetamol" })).body, (await get(api, "/api/missed")).body, (await get(api, "/api/stock/all")).body]);
  for (const secret of ["Asha", "Verma", "98765", "43221"]) {
    assert.ok(!visible.includes(secret), secret);
  }
});

test("a hold check gives the shop's reason before any details are asked, and changes nothing", async () => {
  const { api } = await shop("shanti_medical", { extraCsvRows: "SM-X01,Controlled Tablets,Testamine,1 mg,strip of 10,X,10,5" });
  assert.deepEqual((await get(api, "/api/holds/check", { itemId: "SM-1001", qty: "1" })).body, { ok: true, until: "11:00 pm", pickups: [{ value: "any", label: "Any time until 11:00 pm" }], prescription: false });
  assert.deepEqual((await get(api, "/api/holds/check", { itemId: "SM-1008", qty: "1" })).body, { ok: false, field: "qty", reason: "None left to hold." });
  assert.equal((await get(api, "/api/holds/check", { itemId: "SM-X01", qty: "1" })).body.field, "itemId");
  assert.equal((await get(api, "/api/holds/check", { itemId: "SM-1005", qty: "1" })).body.prescription, true);
  assert.deepEqual((await get(api, "/api/holds")).body.holds, []);
  assert.deepEqual((await get(api, "/api/missed")).body.missed, []);
  const closed = (await shop("jeevan_chemist")).api;
  const answer = (await get(closed, "/api/holds/check", { itemId: "JC-302", qty: "1" })).body;
  assert.equal(answer.ok, false);
  assert.match(answer.reason, /closed now/);
});

test("a hold refused for the item says so before checking the details", async () => {
  const { api } = await shop("shanti_medical");
  const { body } = await post(api, "/api/holds", { itemId: "SM-1008", qty: 1, name: "", phone: "" });
  assert.deepEqual(body, { ok: false, field: "qty", reason: "None left to hold." });
});

test("the same hold request sent again gets the same hold, not a second one", async () => {
  const { api } = await shop("shanti_medical");
  const request = { requestId: "form-2f6b1c9e", itemId: "SM-1001", qty: 2, ...ASHA };
  const first = await post(api, "/api/holds", request);
  assert.equal(first.body.ok, true, first.body.reason);
  assert.deepEqual((await post(api, "/api/holds", request)).body, first.body);
  assert.equal((await get(api, "/api/holds")).body.holds.length, 1);
  assert.equal((await post(api, "/api/holds", { ...request, qty: 1 })).body.field, "requestId");
  assert.equal((await post(api, "/api/holds", { ...request, requestId: "x" })).body.field, "requestId");
});

test("collecting a hold bills its units once", async () => {
  const { api } = await shop("shanti_medical");
  const { body: held } = await post(api, "/api/holds", { itemId: "SM-1001", qty: 1, ...ASHA });
  const collected = await post(api, "/api/holds/collect", { code: ` ${held.code.toLowerCase()} ` });
  assert.equal(collected.body.ok, true, collected.body.reason);
  assert.match(collected.body.summary, new RegExp(`^${held.code} collected: billed 1 × Paracetamol`));
  const item = (await get(api, "/api/stock/all")).body.items.find((entry) => entry.id === "SM-1001");
  assert.deepEqual([item.qty, item.held, item.available], [1, 0, 1]);
  assert.equal((await get(api, "/api/holds")).body.holds[0].status, "collected");
  assert.deepEqual((await post(api, "/api/holds/collect", { code: held.code })).body, { ok: false, field: "code", reason: `${held.code} was already collected.` });
  assert.equal((await post(api, "/api/holds/release", { code: held.code })).body.ok, false);
  assert.equal((await post(api, "/api/sale", { itemId: "SM-1001", qty: 1 })).body.ok, true);
});

test("releasing a hold puts its units back on the shelf", async () => {
  const { api } = await shop("shanti_medical");
  const { body: held } = await post(api, "/api/holds", { itemId: "SM-1001", qty: 2, ...ASHA });
  assert.equal((await get(api, "/api/stock", { q: "SM-1001" })).body.matches[0].availability, "out_of_stock");
  const released = await post(api, "/api/holds/release", { code: held.code });
  assert.deepEqual(released.body, { ok: true, code: held.code, summary: `${held.code} released: 2 × Paracetamol Oral Suspension (Paediatric) back on the shelf.` });
  assert.equal((await get(api, "/api/stock", { q: "SM-1001" })).body.matches[0].availability, "limited");
  assert.equal((await get(api, "/api/holds")).body.holds[0].status, "released");
  assert.equal((await post(api, "/api/holds/collect", { code: held.code })).body.ok, false);
  assert.deepEqual((await post(api, "/api/holds/collect", { code: "H-0000" })).body, { ok: false, field: "code", reason: "No hold has the code H-0000." });
});

test("an expired hold is billed at the counter, not collected", async () => {
  const { api, clock } = await shop("shanti_medical");
  const { body: held } = await post(api, "/api/holds", { itemId: "SM-1001", qty: 1, ...ASHA });
  clock.now = new Date("2026-11-20T18:00:00Z");
  const late = await post(api, "/api/holds/collect", { code: held.code });
  assert.deepEqual(late.body, { ok: false, field: "code", reason: `${held.code} expired at 11:00 pm. Bill it at the counter if it is still on the shelf.` });
});

test("a 24-hour shop holds for two hours", async () => {
  const { api } = await shop("night_owl_pharmacy");
  const { body } = await post(api, "/api/holds", { itemId: "NO-203", qty: 1, ...ASHA });
  assert.equal(body.until, "12:45 am");
});

test("a closed shop takes no holds", async () => {
  const { api } = await shop("jeevan_chemist");
  const { body } = await post(api, "/api/holds", { itemId: "JC-302", qty: 1, ...ASHA });
  assert.equal(body.ok, false);
  assert.match(body.reason, /closed now, opens Sat 8:30 am/);
});

test("an expired hold puts the unit back on the shelf", async () => {
  const { api, clock } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1001", qty: 2, ...ASHA });
  assert.equal((await get(api, "/api/stock", { q: "SM-1001" })).body.matches[0].availability, "out_of_stock");
  clock.now = new Date("2026-11-20T18:00:00Z");
  assert.equal((await get(api, "/api/stock", { q: "SM-1001" })).body.matches[0].availability, "limited");
});

test("reset is off unless allowed, and restores the billing export when on", async () => {
  const { api } = await shop("shanti_medical");
  assert.equal((await post(api, "/api/reset", {})).status, 403);
  const open = (await shop("shanti_medical", { allowReset: true })).api;
  await post(open, "/api/sale", { itemId: "SM-1004", qty: 3 });
  assert.equal((await post(open, "/api/reset", {})).status, 200);
  assert.equal((await get(open, "/api/stock", { q: "ors" })).body.matches[0].availability, "limited");
});

const HEADER = "code,name,composition,strength,pack,schedule,mrp,qty";
const IMPORT = [
  HEADER,
  "SM-1002,Paracetamol Tablets,Paracetamol,500 mg,strip of 10,OTC,15,70",
  "SM-1004,Oral Rehydration Salts (ORS),Sodium chloride + potassium chloride + sodium citrate + glucose,21 g,sachet,OTC,23,3",
  "SM-1003,Paracetamol Tablets,Paracetamol,650 mg,strip of 15,OTC,30,25",
  "SM-9001,Dolo 650,Paracetamol,650 mg,strip of 15,OTC,32,50",
].join("\n");

test("a stock import previews the changes and saves nothing until applied", async () => {
  const { api } = await shop("shanti_medical");
  const before = (await get(api, "/api/stock/all")).body.items;
  const preview = await post(api, "/api/stock/import", { csv: IMPORT });
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.applied, false);
  assert.deepEqual(preview.body.changed, [
    { id: "SM-1002", name: "Paracetamol Tablets", qtyFrom: 40, qtyTo: 70, priceFrom: "₹15", priceTo: "₹15" },
    { id: "SM-1004", name: "Oral Rehydration Salts (ORS)", qtyFrom: 3, qtyTo: 3, priceFrom: "₹21", priceTo: "₹23" },
  ]);
  assert.deepEqual(preview.body.added, [{ id: "SM-9001", name: "Dolo 650", detail: "650 mg · strip of 15", qty: 50, price: "₹32" }]);
  assert.equal(preview.body.unchanged, 1);
  assert.equal(preview.body.missing.length, before.length - 3);
  assert.deepEqual((await get(api, "/api/stock/all")).body.items, before);
});

test("an applied stock import sets counts and prices, adds new items, and keeps the rest and the holds", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1002", qty: 2, ...ASHA });
  const answer = await post(api, "/api/stock/import", { csv: IMPORT, apply: true });
  assert.equal(answer.body.applied, true);
  const items = (await get(api, "/api/stock/all")).body.items;
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  assert.deepEqual([byId["SM-1002"].qty, byId["SM-1002"].held, byId["SM-1002"].available], [70, 2, 68]);
  assert.equal(byId["SM-1004"].price, "₹23");
  assert.equal(byId["SM-1001"].qty, 2);
  assert.equal(byId["SM-9001"].qty, 50);
  assert.equal((await get(api, "/api/stock", { q: "dolo 650" })).body.matches[0].id, "SM-9001");
  assert.equal((await get(api, "/api/holds")).body.holds.length, 1);
  const again = await post(api, "/api/stock/import", { csv: IMPORT, apply: true });
  assert.deepEqual([again.body.changed.length, again.body.added.length, again.body.unchanged], [0, 0, 4]);
});

test("a stock import warns when the file has fewer than are on hold", async () => {
  const { api } = await shop("shanti_medical");
  await post(api, "/api/holds", { itemId: "SM-1002", qty: 2, ...ASHA });
  const csv = `${HEADER}\nSM-1002,Paracetamol Tablets,Paracetamol,500 mg,strip of 10,OTC,15,1`;
  const answer = await post(api, "/api/stock/import", { csv });
  assert.deepEqual(answer.body.warnings, ["Paracetamol Tablets: the file says 1, but 2 are on hold."]);
});

test("a bad stock file is refused whole, with the line at fault", async () => {
  const { api } = await shop("shanti_medical", { allowReset: true });
  const before = (await get(api, "/api/stock/all")).body.items;
  const cases = [
    [undefined, /Choose a stock export/],
    ["", /Choose a stock export/],
    ["code,name\nA,B", /header must be/],
    [HEADER, /no items/],
    [`${HEADER}\nSM-1002,Paracetamol Tablets,Paracetamol,500 mg,strip of 10,OTC,15,lots`, /Line 2: qty/],
    [`${IMPORT}\nSM-1002,Paracetamol Tablets,Paracetamol,500 mg,strip of 10,OTC,15,9`, /Line 6: duplicate/],
  ];
  for (const [csv, reason] of cases) {
    const answer = await post(api, "/api/stock/import", { csv, apply: true });
    assert.equal(answer.body.ok, false, String(csv));
    assert.match(answer.body.reason, reason);
  }
  assert.deepEqual((await get(api, "/api/stock/all")).body.items, before);
});

test("reset after a stock import goes back to the original billing export", async () => {
  const { api } = await shop("shanti_medical", { allowReset: true });
  await post(api, "/api/stock/import", { csv: IMPORT, apply: true });
  await post(api, "/api/reset", {});
  const items = (await get(api, "/api/stock/all")).body.items;
  assert.equal(items.find((item) => item.id === "SM-1002").qty, 40);
  assert.equal(items.some((item) => item.id === "SM-9001"), false);
});

test("unknown routes, wrong methods and bad bodies are refused", async () => {
  const { api } = await shop("shanti_medical");
  assert.equal((await get(api, "/api/nothing")).status, 404);
  assert.equal((await get(api, "/api/sale")).status, 405);
  assert.equal((await post(api, "/api/holds", "not an object")).status, 400);
  assert.equal((await get(api, "/api/stock", { q: "  " })).status, 400);
});

test("a hold offers pickup times that fit, and takes the shopper's own time", async () => {
  // Night Owl holds for two hours, until 12:45 am.
  const { api } = await shop("night_owl_pharmacy");
  const check = await get(api, "/api/holds/check", { itemId: "NO-202", qty: "1" });
  assert.deepEqual(check.body.pickups.map((entry) => entry.value), ["30", "60", "90", "any"]);
  const hold = async (pickup) => (await post(api, "/api/holds", { itemId: "NO-202", qty: 1, ...ASHA, pickup })).body;
  const half = await hold("30");
  assert.equal(half.pickup, "11:15 pm");
  assert.equal(half.until, "12:45 am");
  assert.match(half.summary, /Pickup planned by 11:15 pm\.$/);
  assert.equal((await hold("00:10")).pickup, "12:10 am");
  assert.equal((await hold("any")).pickup, "12:45 am");
  for (const wrong of ["", "22:45", "21:00", "01:00", "25:00", "soon", null, 45]) {
    assert.equal((await hold(wrong)).field, "pickup", String(wrong));
  }
  assert.equal((await get(api, "/api/holds")).body.holds[0].pickup, "12:45 am");
});

test("one hold takes several items under one code, and collects or releases them together", async () => {
  const { api } = await shop("night_owl_pharmacy");
  const more = [{ itemId: "NO-203", qty: 3 }, { itemId: "NO-205", qty: 1 }];
  const request = { requestId: "form-many-1", itemId: "NO-202", qty: 2, more, ...ASHA };
  assert.equal((await get(api, "/api/holds/check", { itemId: "NO-202", qty: "2", more: "NO-203:3,NO-205:1" })).body.ok, true);
  const first = (await post(api, "/api/holds", request)).body;
  assert.match(first.summary, /^2 × Paracetamol Tablets \(.+\) \+ 3 × Oral Rehydration Salts \(ORS\) \(.+\) \+ 1 × Cetirizine Tablets/);
  assert.deepEqual((await post(api, "/api/holds", request)).body, first);
  assert.equal((await post(api, "/api/holds", { ...request, more: [] })).body.field, "requestId");
  const holds = (await get(api, "/api/holds")).body.holds;
  assert.equal(holds.length, 1);
  assert.match(holds[0].what, /3 × Oral/);
  const count = async (id) => (await get(api, "/api/stock/all")).body.items.find((item) => item.id === id);
  assert.equal((await count("NO-203")).held, 3);
  assert.equal((await post(api, "/api/holds/collect", { code: first.code })).body.ok, true);
  assert.deepEqual([(await count("NO-203")).qty, (await count("NO-203")).held, (await count("NO-202")).qty], [17, 0, 58]);
  const short = (await post(api, "/api/holds", { itemId: "NO-202", qty: 1, more: [{ itemId: "NO-201", qty: 1 }], ...ASHA })).body;
  assert.match(short.reason, /^Paracetamol Oral Suspension.*None left/);
  for (const bad of ["x", [null], [{ itemId: "NO-202", qty: 1 }], Array(8).fill({ itemId: "NO-203", qty: 1 })]) {
    assert.equal((await post(api, "/api/holds", { itemId: "NO-202", qty: 1, more: bad, ...ASHA })).body.ok, false);
  }
  assert.equal((await count("NO-202")).held, 0);
});
