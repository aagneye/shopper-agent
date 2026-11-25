// Checks how amounts are read, refused and split over shops.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mentionsAmount, parseAmount, splitAmount } from "../js/amount.js";
import { StubDocument } from "./stub_document.mjs";
import { StubOption } from "./stub_option.mjs";

globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), "http://127.0.0.1:8080/");
globalThis.Option = StubOption;
const { App } = await import("../js/app.js");
App.clock = () => new Date("2026-11-20T17:15:00Z");

test("a schedule is counted into tablets", () => {
  for (const [words, label] of [
    ["2 times a day for 1 week need paracetamol", "14 tablets"],
    ["paracetamol 500 mg twice a day for a week", "14 tablets"],
    ["2 tablets 3 times a day for 5 days", "30 tablets"],
    ["1-0-1 for 10 days", "20 tablets"],
    ["every 8 hours for five days", "15 tablets"],
    ["bd x 5 days", "10 tablets"],
    ["morning and night for 2 weeks", "28 tablets"],
    ["half tablet daily for 15 days", "8 tablets"],
    ["once daily for 1 month", "30 tablets"],
    ["14 tablets of paracetamol 650mg", "14 tablets"],
    ["2 strips", "2 strips"],
    ["children's paracetamol syrup 1 bottle", "1 bottle"],
    ["5 ORS sachets", "5 sachets"],
    ["14 paracetamol tablets", "14 tablets"],
    ["14", "14 tablets"],
  ]) {
    assert.equal(parseAmount(words).label, label, words);
  }
  assert.equal(parseAmount("2", "ORS 21 g sachet").label, "2 packs");
  assert.equal(parseAmount("2 tablets", "ORS 21 g sachet").label, "2 packs");
  assert.equal(parseAmount("1", "Ibuprofen oral suspension 100 mg/5 ml").label, "1 pack");
  assert.match(parseAmount("2 times a day for 1 week", "Cough syrup").reason, /bottles/);
  assert.match(parseAmount("2 times a day for 1 week").how, /counting 1 each time/);
});

test("a missing or unclear amount is refused", () => {
  for (const words of ["paracetamol", "paracetamol 500 mg", "", "vitamin b12 and more words 5 mg 3 things 4"]) {
    assert.equal(parseAmount(words).ok, false, words);
  }
  assert.match(parseAmount("2 times a day").reason, /how many days/);
  assert.match(parseAmount("for 1 week").reason, /times a day/);
  assert.match(parseAmount("syrup 2 times a day for 1 week").reason, /bottles/);
  assert.match(parseAmount("10 tablets of A and 5 tablets of B").reason, /one amount/);
  assert.equal(parseAmount("9000 tablets").ok, false);
  assert.equal(mentionsAmount("I need paracetamol 500 mg"), false);
  assert.equal(mentionsAmount("a strip of paracetamol"), true);
});

test("one shop with all of it wins, else the fewest shops together", () => {
  const shop = (shopId, canGive, distanceMeters) => ({ shopId, name: shopId, canGive, distanceMeters });
  assert.equal(splitAmount(80, [shop("a", 50, 100), shop("b", 80, 900)]).summary, "80 from b = 80 of 80.");
  assert.equal(splitAmount(80, [shop("a", 50, 100), shop("b", 40, 900), shop("c", 0, 10)]).summary, "50 from a + 30 from b = 80 of 80.");
  assert.equal(splitAmount(80, [shop("a", 50, 100)]).summary, "50 from a = 50 of 80. 30 not found.");
  assert.equal(splitAmount(8, [shop("a", 0, 1)]).missing, 8);
});

test("find_shops asks for the amount and never takes one the visitor did not say", () => {
  const medicines = [{ name: "Paracetamol 500 mg", amount: "2 times a day for 1 week" }];
  App.page.said = [];
  const found = App.page.findShops({ category: "pharmacy", medicines });
  assert.equal(found.medicines[0].ask, "Do you have 14 tablets of Paracetamol 500 mg? Say how much you can give.");
  assert.ok(found.shops.every((shop) => shop.askWith));
  App.page.noteSaid("I need paracetamol 500 mg");
  assert.match(App.page.findShops({ category: "pharmacy", medicines }).reason, /^Ask the visitor/);
  App.page.noteSaid("2 times a day for 1 week");
  assert.equal(App.page.findShops({ category: "pharmacy", medicines }).ok, true);
  assert.ok(App.page.findShops({ category: "pharmacy" }).shops.every((shop) => !("askWith" in shop)));
  App.page.said = [];
});

test("counts come from the shops' stock tools, and the page adds up the same strength", () => {
  const { page } = App;
  page.said = [];
  page.supplies = [];
  page.findShops({ category: "pharmacy", medicines: [{ name: "Cefixime 200 mg", amount: "80 tablets" }] });
  const hear = (id, detail, canGive) => {
    const args = page.completeStock(page.place(id), "check_stock", { query: "cefixime" });
    assert.deepEqual(args, { query: "cefixime", amount: 80, unit: "tablets" });
    page.heardStock(page.place(id), "check_stock", args, { matches: [{ id: "X-1", hold: "prescription", match: "full", name: "Cefixime Tablets", detail, supply: { canGive, packs: canGive / 10, text: `${canGive} of 80 tablets` } }] });
    return page.withSupply(page.place(id), "CAN GIVE: 999");
  };
  assert.match(hear("shanti_medical", "200 mg · strip of 10", 50), /50 from Shanti Medical = 50 of 80\. 30 not found\. Ask the next open shop/);
  assert.match(hear("jeevan_chemist", "100 mg · strip of 10", 60), /Best so far: Cefixime Tablets 100 mg: 60 from Jeevan Chemist = 60 of 80/);
  assert.match(hear("night_owl_pharmacy", "200 mg · strip of 10", 40), /50 from Shanti Medical \+ 30 from Night Owl Pharmacy = 80 of 80\./);
  assert.deepEqual(page.holdOffers().map(({ shopId, lines }) => [shopId, ...lines.map((line) => `${line.itemId}:${line.qty}`)]), [["shanti_medical", "X-1:5"], ["night_owl_pharmacy", "X-1:3"]]);
  page.needs = [{ name: "Aaa", need: 2, unit: "packs" }, { name: "Bbb", need: 1, unit: "packs" }];
  page.supplies = page.needs.map((need) => ({ medicine: need.name, shopId: "shanti_medical", name: "Shanti Medical", item: need.name, itemId: need.name, need: need.need, canGive: need.need, packs: need.need, canHold: true }));
  assert.deepEqual(page.holdOffers().map((offer) => offer.label), ["Hold at Shanti Medical: 2 × Aaa + 1 × Bbb"]);
  page.needs = [];
  page.supplies = [];
  assert.equal(page.holdOffers().length, 1);
  page.offers = [];
});

test("the form asks for the amount before it sends anything", () => {
  const sent = [];
  App.page.onAsk = (text) => sent.push(text) > 0;
  document.getElementById("need-category").value = "pharmacy";
  document.getElementById("need-input").value = "Paracetamol 500 mg";
  document.getElementById("need-amount").value = "";
  App.page.handleAsk();
  assert.equal(sent.length, 0);
  assert.match(document.getElementById("need-status").textContent, /^How much do you need/);
  document.getElementById("need-amount").value = "2 times a day for 1 week";
  App.page.handleAsk();
  assert.match(sent[0], /I need 2 times a day for 1 week: 14 tablets/);
  App.page.onAsk = null;
});

test("a pharmacy is never asked without the visitor's amount", () => {
  const shop = App.page.place("shanti_medical");
  App.page.needs = [];
  App.page.said = ["I need cefixime 200 mg"];
  assert.match(App.page.checkRequest(shop, "Do you have cefixime?").refusal, /^Skipped/);
  assert.match(App.page.checkRequest(shop, "Do you have 10 tablets of cefixime?").refusal, /^Skipped/);
  App.page.noteSaid("2 times a day for 1 week");
  assert.match(App.page.checkRequest(shop, "Do you have cefixime?").text, /Amount needed: 14 tablets/);
  App.page.findShops({ category: "pharmacy", medicines: [{ name: "Cefixime", amount: "2 times a day for 1 week" }] });
  assert.equal(App.page.checkRequest(shop, "cefixime?").text, "Do you have 14 tablets of Cefixime? Say how much you can give.");
  assert.match(App.page.checkRequest(shop, "Hold SM-1010").text, /^Hold SM-1010\. .*website_request_hold/);
  assert.equal(App.page.checkRequest(App.page.place("bharat_auto_spares"), "clutch cable").text, "clutch cable");
  App.page.needs = [];
  App.page.said = [];
});
