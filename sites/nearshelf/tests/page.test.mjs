// The shopper page: its own operations, what they show, and what they refuse.
// These run the real page code against the template's DOM stand-in.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { StubDocument } from "./stub_document.mjs";
import { StubOption } from "./stub_option.mjs";

const BASE = "http://127.0.0.1:8080";
// Friday, Nov 20, 2026 at 10:45 pm in Neem Chowk.
const FRIDAY_NIGHT = new Date("2026-11-20T17:15:00Z");

globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), `${BASE}/`);
globalThis.Option = StubOption;
const { App } = await import("../js/app.js");
const { composeRequest } = await import("../js/search.js");
App.clock = () => FRIDAY_NIGHT;
App.page.refresh();

/**
 * All text in a stand-in element and its children, as a reader would see it.
 *
 * :param node: A StubElement or a text child.
 * :return: The joined text.
 */
function textOf(node) {
  if (typeof node === "string") {
    return node;
  }
  return [node.textContent || "", ...(node.children || []).map(textOf)].join(" ");
}

test("the page lists every Neem Chowk place and shows Neem Chowk time", () => {
  assert.equal(document.getElementById("shops").children.length, 6);
  assert.match(textOf(document.getElementById("clock-line")), /10:45 pm/);
});

test("the results board shows each shop's answer, best first", () => {
  const result = App.page.showResults({
    need: "Children's paracetamol syrup",
    rows: [
      { shopId: "night_owl_pharmacy", availability: "out_of_stock", item: "Paracetamol syrup 120 mg/5 ml", price: "", asOf: "10:43 pm" },
      { shopId: "shanti_medical", availability: "limited", item: "Paracetamol syrup 120 mg/5 ml, 60 ml", price: "₹38", asOf: "10:44 pm" },
    ],
  });
  assert.deepEqual(result, { ok: true, need: "Children's paracetamol syrup", shown: 2 });
  const cards = document.getElementById("results").children;
  assert.equal(cards.length, 2);
  const first = textOf(cards[0]);
  assert.match(first, /Shanti Medical/);
  assert.match(first, /Few left/);
  assert.match(first, /₹38/);
  assert.match(first, /Stock as of 10:44 pm/);
  assert.match(textOf(cards[1]), /Out of stock/);
  assert.match(textOf(document.getElementById("results-summary")), /Asked 2 shops/);
});

test("a shop that did not answer shows no item, price or stock time", () => {
  App.page.showResults({
    need: "ORS sachets",
    rows: [{ shopId: "jeevan_chemist", availability: "no_answer", item: "ORS sachets 21 g", price: "₹99", asOf: "9:15 pm", note: "Plenty left" }],
  });
  const text = textOf(document.getElementById("results"));
  assert.match(text, /No answer/);
  assert.doesNotMatch(text, /₹99/);
  assert.doesNotMatch(text, /9:15 pm/);
  assert.doesNotMatch(text, /21 g/);
  assert.doesNotMatch(text, /Plenty left/);
  assert.doesNotMatch(text, /Stock as of/);
});

test("the same shop twice is refused and the board stays as it was", () => {
  App.page.showResults({ need: "ORS sachets", rows: [{ shopId: "shanti_medical", availability: "in_stock", item: "ORS sachets", price: "₹21", asOf: "10:44 pm" }] });
  const before = document.snapshot();
  const result = App.page.showResults({
    need: "ORS sachets",
    rows: [
      { shopId: "shanti_medical", availability: "in_stock" },
      { shopId: "shanti_medical", availability: "out_of_stock" },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, "rows");
  assert.match(result.reason, /Shanti Medical appears twice/);
  assert.deepEqual(document.snapshot(), before);
});

test("a blank need is refused", () => {
  const result = App.page.showResults({ need: "   ", rows: [{ shopId: "shanti_medical", availability: "in_stock" }] });
  assert.deepEqual(result, { ok: false, field: "need", reason: "Say what was asked for." });
});

test("reads leave the page as it was", () => {
  const before = document.snapshot();
  const found = App.page.findShops({ category: "pharmacy" });
  assert.equal(found.ok, true);
  assert.deepEqual(found.shops.map((shop) => shop.askWith), ["shanti_medical", "night_owl_pharmacy"]);
  assert.equal(found.from, "Neem Chowk Metro, Gate 2");
  const plan = App.page.planStops({
    items: ["ORS sachets", "Paracetamol syrup"],
    offers: [
      { shopId: "shanti_medical", has: ["ORS sachets"] },
      { shopId: "night_owl_pharmacy", has: ["ORS sachets", "Paracetamol syrup"] },
    ],
  });
  assert.equal(plan.summary, "1 stop covers all 2 items.");
  assert.equal(plan.stops[0].distance, "390 m");
  const state = App.page.getState();
  assert.equal(state.now.time, "10:45 pm");
  assert.equal(state.area, "Neem Chowk");
  assert.deepEqual(document.snapshot(), before);
});

test("a saved hold appears in My holds", () => {
  const result = App.page.saveHold({ shopId: "shanti_medical", item: "Paracetamol syrup 60 ml", code: "H-4821", until: "11:00 pm" });
  assert.equal(result.ok, true);
  assert.equal(document.getElementById("holds").children.length, 1);
  assert.equal(document.getElementById("holds-empty").hidden, true);
  assert.match(textOf(document.getElementById("holds")), /H-4821/);
  assert.deepEqual(App.page.getState().holds.map((hold) => [hold.shop, hold.code]), [["Shanti Medical", "H-4821"]]);
});

test("the garage form saves a vehicle", () => {
  document.getElementById("garage-maker").value = "Vayu";
  document.getElementById("garage-model").value = "Zip 125";
  document.getElementById("garage-year").value = "2019";
  document.getElementById("garage-variant").value = "drum brake";
  document.getElementById("garage-form").dispatch("submit");
  assert.equal(document.getElementById("garage-list").children.length, 1);
  assert.match(textOf(document.getElementById("garage-list")), /Vayu Zip 125 \(2019, drum brake\)/);
  assert.deepEqual(App.page.getState().vehicles.map((vehicle) => vehicle.label), ["Vayu Zip 125 (2019, drum brake)"]);
});

test("a refused vehicle shows the reason and saves nothing", () => {
  document.getElementById("garage-maker").value = "Vayu";
  document.getElementById("garage-model").value = "Zip 125";
  document.getElementById("garage-year").value = "1979";
  document.getElementById("garage-variant").value = "";
  document.getElementById("garage-form").dispatch("submit");
  assert.equal(document.getElementById("garage-status").textContent, "Enter a year from 1980 to 2027.");
  assert.equal(document.getElementById("garage-list").children.length, 1);
});

test("the demo time changes which shops count as open", () => {
  App.page.setDemoTime("12:00");
  assert.deepEqual(App.page.findShops({ category: "pharmacy" }).shops.map((shop) => shop.id), ["shanti_medical", "night_owl_pharmacy", "jeevan_chemist"]);
  App.page.setDemoTime(null);
  assert.deepEqual(App.page.findShops({ category: "pharmacy" }).shops.map((shop) => shop.id), ["shanti_medical", "night_owl_pharmacy"]);
});

test("the shopper's spot changes the distances", () => {
  App.page.setSpot("gulmohar");
  assert.deepEqual(App.page.findShops({ category: "pharmacy" }).shops.map((shop) => [shop.id, shop.distance]), [
    ["shanti_medical", "660 m"],
    ["night_owl_pharmacy", "1.0 km"],
  ]);
  App.page.setSpot("metro-gate");
});

test("the search form's request names the item and the kind of shop", () => {
  assert.equal(composeRequest({ need: "ORS sachets", category: "pharmacy", openNow: true }), "Medicine: ORS sachets. Ask pharmacies that are open now whether they have it, and compare their answers.");
  assert.equal(composeRequest({ need: " clutch cable  for my scooter ", category: "auto_parts", openNow: false }), "Vehicle part: clutch cable for my scooter. Ask parts dealers whether they have it, and compare their answers.");
});
