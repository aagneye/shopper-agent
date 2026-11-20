// "Whole list, fewest stops": the smallest set of shops that covers a shopping list.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { planFewestStops } from "../js/fewest-stops.js";

const AMOX = "Amoxicillin 500 mg capsules";
const ORS = "ORS sachets";
const SYRUP = "Paracetamol syrup";
const ITEMS = [AMOX, ORS, SYRUP];

const SHANTI = { shopId: "shanti_medical", name: "Shanti Medical", distanceMeters: 205 };
const NIGHT_OWL = { shopId: "night_owl_pharmacy", name: "Night Owl Pharmacy", distanceMeters: 389 };
const JEEVAN = { shopId: "jeevan_chemist", name: "Jeevan Chemist", distanceMeters: 531 };

test("one shop that has everything beats two nearer shops", () => {
  const result = planFewestStops(ITEMS, [
    { ...SHANTI, has: [AMOX, ORS] },
    { ...NIGHT_OWL, has: [ORS, SYRUP] },
    { ...JEEVAN, has: [AMOX, ORS, SYRUP] },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.stops.map((stop) => [stop.shopId, stop.items]), [["jeevan_chemist", [AMOX, ORS, SYRUP]]]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.summary, "1 stop covers all 3 items.");
});

test("two shops split the list, each item at the nearest shop that has it", () => {
  const result = planFewestStops(ITEMS, [
    { ...SHANTI, has: [AMOX, ORS] },
    { ...NIGHT_OWL, has: [ORS, SYRUP] },
  ]);
  assert.deepEqual(result.stops.map((stop) => [stop.shopId, stop.items]), [
    ["shanti_medical", [AMOX, ORS]],
    ["night_owl_pharmacy", [SYRUP]],
  ]);
  assert.equal(result.summary, "2 stops cover all 3 items.");
});

test("an item no shop has is reported as missing", () => {
  const result = planFewestStops(ITEMS, [{ ...SHANTI, has: [AMOX, ORS] }]);
  assert.deepEqual(result.covered, [AMOX, ORS]);
  assert.deepEqual(result.missing, [SYRUP]);
  assert.equal(result.summary, "1 stop covers 2 of 3 items.");
});

test("with the same coverage and stops, the nearer shop wins", () => {
  const result = planFewestStops([ORS, SYRUP], [
    { ...NIGHT_OWL, has: [ORS] },
    { ...SHANTI, has: [ORS] },
  ]);
  assert.deepEqual(result.stops.map((stop) => stop.shopId), ["shanti_medical"]);
  assert.deepEqual(result.missing, [SYRUP]);
});

test("item names match without regard to case or spaces", () => {
  const result = planFewestStops(ITEMS, [{ ...JEEVAN, has: ["  ors sachets ", "amoxicillin 500 MG capsules", "Paracetamol Syrup"] }]);
  assert.deepEqual(result.stops[0].items, [AMOX, ORS, SYRUP]);
});

test("an item that is not on the list is refused", () => {
  const result = planFewestStops(ITEMS, [{ ...SHANTI, has: ["Cough syrup"] }]);
  assert.deepEqual(result, { ok: false, reason: "\"Cough syrup\" is not one of the items." });
});

test("no shop with any item gives no stops", () => {
  const result = planFewestStops(ITEMS, [{ ...SHANTI, has: [] }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.stops, []);
  assert.deepEqual(result.missing, ITEMS);
  assert.equal(result.summary, "No shop has any of the 3 items.");
});
