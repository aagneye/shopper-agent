// Billing exports and stock search: what a shop's agent can find, and how it reads.
// Run: node --test "shop-kit/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { band, formatRupees, holdKind, parseBillingCsv, searchStock } from "../api/stock.mjs";

const SHOPS = {
  shanti_medical: "pharmacy",
  night_owl_pharmacy: "pharmacy",
  jeevan_chemist: "pharmacy",
  bharat_auto_spares: "auto_parts",
  speedline_moto_parts: "auto_parts",
};

/**
 * Parse one bundled billing export.
 *
 * :param id: The shop id.
 * :return: The parsed items.
 */
async function items(id) {
  const text = await readFile(new URL(`../samples/${id}.csv`, import.meta.url), "utf8");
  const parsed = parseBillingCsv(text, SHOPS[id]);
  assert.equal(parsed.ok, true, parsed.reason);
  return parsed.items;
}

test("every bundled billing export parses", async () => {
  for (const id of Object.keys(SHOPS)) {
    assert.ok((await items(id)).length >= 6, id);
  }
});

test("stock bands: none left, a few left, plenty", () => {
  assert.equal(band(0), "out_of_stock");
  assert.equal(band(1), "limited");
  assert.equal(band(3), "limited");
  assert.equal(band(4), "in_stock");
});

test("children's paracetamol syrup finds the paediatric suspension first", async () => {
  const result = searchStock(await items("shanti_medical"), "children's paracetamol syrup");
  assert.equal(result.ok, true);
  assert.equal(result.matches[0].item.id, "SM-1001");
  assert.equal(result.matches[0].match, "full");
});

test("a part number matches exactly, whatever its case", async () => {
  const result = searchStock(await items("bharat_auto_spares"), "vz125-clc-1722");
  assert.equal(result.matches[0].item.id, "VZ125-CLC-1722");
  assert.equal(result.matches[0].match, "full");
});

test("a vehicle year inside a part's fitment range counts as a match", async () => {
  const result = searchStock(await items("bharat_auto_spares"), "clutch cable vayu zip 125 2019");
  assert.equal(result.matches[0].item.id, "VZ125-CLC-1722");
  assert.equal(result.matches[0].match, "full");
});

test("plural and short forms still match, such as ORS sachets", async () => {
  const result = searchStock(await items("shanti_medical"), "ORS sachets");
  assert.equal(result.matches[0].item.id, "SM-1004");
  assert.equal(result.matches[0].match, "full");
});

test("doses written together with their unit still match fully", async () => {
  const stock = await items("shanti_medical");
  for (const [query, id] of [
    ["paracetamol 500mg", "SM-1002"],
    ["amoxicillin 500mg", "SM-1005"],
    ["cetirizine 10mg", "SM-1006"],
    ["children's paracetamol syrup 60ml", "SM-1001"],
  ]) {
    const result = searchStock(stock, query);
    assert.equal(result.matches[0].item.id, id, query);
    assert.equal(result.matches[0].match, "full", query);
  }
});

test("a part number inside a sentence, or several of them, match exactly", async () => {
  const bharat = await items("bharat_auto_spares");
  const asked = searchStock(bharat, "Do you have part VZ125-CLC-1722?");
  assert.deepEqual(asked.matches.map((entry) => [entry.item.id, entry.match]), [["VZ125-CLC-1722", "full"]]);
  assert.equal(searchStock(bharat, "part no. VZ125-CLC-1722").matches[0].item.id, "VZ125-CLC-1722");
  const speedline = await items("speedline_moto_parts");
  const both = searchStock(speedline, "VZ125-CLC-1722 or NX-CC-125A");
  assert.deepEqual(both.matches.map((entry) => [entry.item.id, entry.match]), [["VZ125-CLC-1722", "full"], ["NX-CC-125A", "full"]]);
});

test("an empty query is refused and junk finds nothing", async () => {
  const stock = await items("shanti_medical");
  assert.equal(searchStock(stock, "   ").ok, false);
  assert.equal(searchStock(stock, "do you have any").ok, false);
  assert.deepEqual(searchStock(stock, "unicorn tears").matches, []);
});

test("a bad row is refused with its line number", () => {
  const csv = "code,name,composition,strength,pack,schedule,mrp,qty\nA-1,Thing,,,,OTC,10,lots\n";
  assert.deepEqual(parseBillingCsv(csv, "pharmacy"), { ok: false, reason: "Line 2: qty must be a whole number of 0 or more." });
});

test("a wrong header is refused", () => {
  const result = parseBillingCsv("id,title\nA,B\n", "pharmacy");
  assert.equal(result.ok, false);
  assert.match(result.reason, /header must be: code,name,composition,strength,pack,schedule,mrp,qty/);
});

test("quoted fields with commas parse", () => {
  const csv = "part_no,name,fits,type,mrp,qty\n\"P-1\",\"Cable, clutch\",\"Vayu Zip 125 2017-2022\",genuine,99.5,2\n";
  const result = parseBillingCsv(csv, "auto_parts");
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.items[0].name, "Cable, clutch");
  assert.equal(result.items[0].mrp, 99.5);
});

test("which items can be held", () => {
  assert.equal(holdKind({ schedule: "OTC" }, 2), "yes");
  assert.equal(holdKind({ schedule: "H" }, 2), "prescription");
  assert.equal(holdKind({ schedule: "H1" }, 2), "prescription");
  assert.equal(holdKind({ schedule: "X" }, 2), "no");
  assert.equal(holdKind({ schedule: "OTC" }, 0), "no");
  assert.equal(holdKind({ type: "genuine" }, 1), "yes");
});

test("rupee amounts read as shoppers expect", () => {
  assert.equal(formatRupees(38), "₹38");
  assert.equal(formatRupees(38.5), "₹38.50");
  assert.equal(formatRupees(1450), "₹1,450");
});
