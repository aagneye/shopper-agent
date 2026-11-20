// The places directory: validation, open hours in IST, distances and the shortlist.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import bundled from "../directory/neem-chowk.json" with { type: "json" };
import { areaNow } from "../js/clock.js";
import {
  distanceMeters,
  formatDistance,
  openState,
  shortlistShops,
  toolNameFor,
  validateDirectory,
} from "../js/directory.js";

const IST = "Asia/Kolkata";
const FRI_2245 = areaNow(new Date("2026-11-20T17:15:00Z"), IST, null);
const FRI_2300 = areaNow(new Date("2026-11-20T17:30:00Z"), IST, null);
const SAT_0030 = areaNow(new Date("2026-11-20T19:00:00Z"), IST, null);
const SUN_1200 = areaNow(new Date("2026-11-22T06:30:00Z"), IST, null);
const SUN_1500 = areaNow(new Date("2026-11-22T09:30:00Z"), IST, null);
const SUN_0130 = areaNow(new Date("2026-11-21T20:00:00Z"), IST, null);
const SUN_0200 = areaNow(new Date("2026-11-21T20:30:00Z"), IST, null);

function place(id) {
  return bundled.places.find((entry) => entry.id === id);
}

function copy() {
  return JSON.parse(JSON.stringify(bundled));
}

test("the bundled Neem Chowk directory is valid", () => {
  const result = validateDirectory(bundled);
  assert.equal(result.ok, true, result.reason);
});

test("a directory with a duplicate place id is refused", () => {
  const doc = copy();
  doc.places.push({ ...doc.places[0] });
  const result = validateDirectory(doc);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Duplicate place id "shanti_medical"/);
});

test("an unknown category is refused", () => {
  const doc = copy();
  doc.places[0].category = "bakery";
  const result = validateDirectory(doc);
  assert.equal(result.ok, false);
  assert.match(result.reason, /unknown category "bakery"/);
});

test("a bad opening time is refused", () => {
  const doc = copy();
  doc.places[0].hours.mon = [["25:00", "23:00"]];
  const result = validateDirectory(doc);
  assert.equal(result.ok, false);
  assert.match(result.reason, /bad time "25:00" on mon/);
});

test("a shop without coordinates is refused", () => {
  const doc = copy();
  delete doc.places[0].lat;
  const result = validateDirectory(doc);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Place "shanti_medical" needs lat and lng/);
});

test("an agent network URL that is not http or https is refused", () => {
  const doc = copy();
  doc.places[0].agent.network = "ftp://x/shanti_medical";
  const result = validateDirectory(doc);
  assert.equal(result.ok, false);
  assert.match(result.reason, /bad agent network URL/);
});

test("Shanti Medical is open until 11 pm on Friday night", () => {
  assert.deepEqual(openState(place("shanti_medical").hours, FRI_2245), { open: true, label: "open until 11:00 pm" });
});

test("at 11 pm Shanti Medical has closed and opens Saturday morning", () => {
  assert.deepEqual(openState(place("shanti_medical").hours, FRI_2300), { open: false, label: "closed, opens Sat 9:00 am" });
});

test("Night Owl Pharmacy is open 24 hours", () => {
  assert.deepEqual(openState(place("night_owl_pharmacy").hours, FRI_2245), { open: true, label: "open 24 hours" });
});

test("Jeevan Chemist is closed on Friday night and opens Saturday", () => {
  assert.deepEqual(openState(place("jeevan_chemist").hours, FRI_2245), { open: false, label: "closed, opens Sat 8:30 am" });
});

test("just after midnight the next opening the same day shows the time only", () => {
  assert.deepEqual(openState(place("jeevan_chemist").hours, SAT_0030), { open: false, label: "closed, opens 8:30 am" });
});

test("after Sunday's short hours Jeevan Chemist opens Monday", () => {
  assert.deepEqual(openState(place("jeevan_chemist").hours, SUN_1500), { open: false, label: "closed, opens Mon 8:30 am" });
});

test("a shop closed all Sunday opens Monday", () => {
  assert.deepEqual(openState(place("bharat_auto_spares").hours, SUN_1200), { open: false, label: "closed, opens Mon 10:00 am" });
});

test("hours that run past midnight stay open until they end", () => {
  const lateHours = { sat: [["18:00", "02:00"]] };
  assert.deepEqual(openState(lateHours, SUN_0130), { open: true, label: "open until 2:00 am" });
  assert.deepEqual(openState(lateHours, SUN_0200), { open: false, label: "closed, opens Sat 6:00 pm" });
});

test("distances round to 10 m below a kilometre and to 0.1 km above", () => {
  assert.equal(formatDistance(205.4), "210 m");
  assert.equal(formatDistance(995), "1.0 km");
  assert.equal(formatDistance(1152.5), "1.2 km");
  const metro = bundled.spots[0];
  assert.equal(formatDistance(distanceMeters(metro, place("shanti_medical"))), "210 m");
  assert.equal(formatDistance(distanceMeters(metro, place("speedline_moto_parts"))), "1.2 km");
});

test("the partner tool name is the network URL's last path segment", () => {
  assert.equal(toolNameFor("http://[::1]:8082/night_owl_pharmacy"), "night_owl_pharmacy");
  assert.equal(toolNameFor("https://shanti.example/agents/shanti_medical"), "shanti_medical");
});

test("on Friday night the shortlist has the two open pharmacies, nearest first", () => {
  const result = shortlistShops(bundled, { category: "pharmacy", spotId: "metro-gate", now: FRI_2245 });
  assert.deepEqual(result.shops.map((shop) => [shop.id, shop.distance, shop.open]), [
    ["shanti_medical", "210 m", "open until 11:00 pm"],
    ["night_owl_pharmacy", "390 m", "open 24 hours"],
  ]);
  assert.deepEqual(result.notAsked.map((entry) => [entry.id, entry.reason]), [["jeevan_chemist", "closed, opens Sat 8:30 am"]]);
  assert.equal(result.moreOpen, 0);
  for (const shop of result.shops) {
    assert.equal(shop.askWith, toolNameFor(place(shop.id).agent.network));
  }
});

test("shops already asked are left out and named", () => {
  const result = shortlistShops(bundled, { category: "pharmacy", spotId: "metro-gate", now: FRI_2245, exclude: ["shanti_medical"] });
  assert.deepEqual(result.shops.map((shop) => shop.id), ["night_owl_pharmacy"]);
  assert.ok(result.notAsked.some((entry) => entry.id === "shanti_medical" && entry.reason === "already asked"));
});

test("a limit of one leaves one more open shop to ask", () => {
  const result = shortlistShops(bundled, { category: "pharmacy", spotId: "metro-gate", now: FRI_2245, limit: 1 });
  assert.deepEqual(result.shops.map((shop) => shop.id), ["shanti_medical"]);
  assert.equal(result.moreOpen, 1);
});

test("openNow false lists closed shops too, nearest first", () => {
  const result = shortlistShops(bundled, { category: "pharmacy", spotId: "metro-gate", now: FRI_2245, openNow: false });
  assert.deepEqual(result.shops.map((shop) => shop.id), ["shanti_medical", "night_owl_pharmacy", "jeevan_chemist"]);
});

test("on Sunday only Speedline is open among the parts dealers", () => {
  const result = shortlistShops(bundled, { category: "auto_parts", spotId: "metro-gate", now: SUN_1200 });
  assert.deepEqual(result.shops.map((shop) => [shop.id, shop.distance, shop.open]), [["speedline_moto_parts", "1.2 km", "open until 9:30 pm"]]);
  assert.deepEqual(result.notAsked.map((entry) => [entry.id, entry.reason]), [["bharat_auto_spares", "closed, opens Mon 10:00 am"]]);
});

test("a pharmacy without a verified licence is never asked", () => {
  const doc = copy();
  doc.places.push({ ...copy().places[0], id: "unknown_pharmacy", name: "Unknown Pharmacy", verified: null, agent: { network: "http://localhost:9999/unknown_pharmacy", label: "Unknown Pharmacy" } });
  const result = shortlistShops(doc, { category: "pharmacy", spotId: "metro-gate", now: FRI_2245 });
  assert.ok(!result.shops.some((shop) => shop.id === "unknown_pharmacy"));
  assert.ok(result.notAsked.some((entry) => entry.id === "unknown_pharmacy" && entry.reason === "license not verified"));
});

test("the online parts catalogue has no distance", () => {
  const result = shortlistShops(bundled, { category: "parts_catalogue", spotId: "metro-gate", now: FRI_2245 });
  assert.deepEqual(result.shops.map((shop) => [shop.id, shop.distance]), [["vayu_parts_catalogue", "online"]]);
});
