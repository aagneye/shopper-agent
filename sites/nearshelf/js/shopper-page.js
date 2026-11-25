// The NearShelf page object. The page's own buttons and forms and the agent's website
// tools call these same methods, so both follow one set of rules. Operations refuse bad
// input by returning {ok: false, field, reason} before changing anything.
import { mentionsAmount, parseAmount, splitAmount } from "./amount.js";
import { areaNow, timePassed } from "./clock.js";
import { distanceMeters, formatDistance, openState, shortlistShops, toolNameFor } from "./directory.js";
import { planFewestStops } from "./fewest-stops.js";
import { PrescriptionReader } from "./prescription.js";
import { PrescriptionPanel } from "./prescription-panel.js";
import { renderHolds, renderResults, renderSaved, renderShops, renderSpots } from "./render.js";
import { CHIPS, composeListRequest, composeRequest } from "./search.js";

export const AVAILABILITY = ["in_stock", "limited", "out_of_stock", "no_answer", "declined"];
const LABELS = {
  in_stock: "In stock",
  limited: "Few left",
  out_of_stock: "Out of stock",
  no_answer: "No answer",
  declined: "Not asked (you declined)",
};
const ANSWERED = new Set(["in_stock", "limited", "out_of_stock"]);
const CATEGORY_LABELS = { pharmacy: "Pharmacy", auto_parts: "Parts dealer", parts_catalogue: "Parts catalogue" };
const MOST_ROWS = 6;
const MOST_PER_HOLD = 5;

/**
 * Trim text, collapse spaces and cut it to a length.
 *
 * :param value: Any value.
 * :param max: The longest result.
 * :return: The cleaned string.
 */
function clean(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

/**
 * The shopper's page: state, operations and rendering.
 */
export class ShopperPage {
  /**
   * :param options: {document, directory, store, clock}, where clock returns a Date.
   */
  constructor({ document, directory, store, clock }) {
    this.doc = document;
    this.directory = directory;
    this.store = store;
    this.clock = clock;
    this.results = null;
    // Set by site.js once the assistant runs: sends a request to the chat, returns true when sent.
    this.onAsk = null;
    // Set by site.js once the assistant runs: returns the runtime engine, which reads photos.
    this.engine = () => null;
    // What the visitor wrote lately in the chat, newest last. Set by site.js.
    this.said = [];
    // The counted medicines of this chat turn.
    this.needs = [];
    // How much each pharmacy can give, from its stock tool, in this chat turn.
    this.supplies = [];
    // The holds last offered as buttons.
    this.offers = [];
    // How many holds shops confirmed in this chat turn.
    this.heldNow = 0;
    this.scan = null;
    this.scanned = [];
    this.el = {};
  }

  /**
   * Find the page's elements, connect its forms and buttons, and draw every panel.
   */
  mount() {
    const ids = [
      "need-form", "need-input", "need-amount", "need-category", "need-open-now", "need-status",
      "chip-syrup", "chip-ors", "chip-clutch", "clock-line",
      "results-summary", "results", "holds-empty", "holds", "shops",
      "spot-select", "demo-time-select",
      "garage-form", "garage-maker", "garage-model", "garage-year", "garage-variant", "garage-status", "garage-list",
      "list-form", "list-name", "list-qty", "list-status", "list-items",
    ];
    for (const id of ids) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["need-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleAsk();
    });
    for (const [id, example] of Object.entries(CHIPS)) {
      this.el[id].addEventListener("click", () => {
        this.el["need-input"].value = example.need;
        this.el["need-category"].value = example.category;
        this.el["need-amount"].value = example.amount || "";
        this.showAmountField();
        this.el["need-status"].textContent = "";
      });
    }
    this.el["need-category"].addEventListener("change", () => this.showAmountField());
    this.el["spot-select"].addEventListener("change", () => this.setSpot(this.el["spot-select"].value));
    this.el["demo-time-select"].addEventListener("change", () => this.setDemoTime(this.el["demo-time-select"].value || null));
    this.el["garage-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleGarageForm();
    });
    this.el["list-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleListForm();
    });
    this.el["scan-ask"] = this.doc.getElementById("scan-ask");
    this.el["scan-ask"].addEventListener("click", () => this.askScanned());
    this.scan = new PrescriptionPanel({
      document: this.doc,
      reader: new PrescriptionReader({ engine: () => this.engine() }),
      onUse: (lines) => this.useScanned(lines),
    });
    this.scan.mount();
    this.doc.getElementById("scan-open").addEventListener("click", () => this.dropScanned());
    this.doc.getElementById("scan-clear").addEventListener("click", () => this.dropScanned());
    this.doc.getElementById("scan-file").addEventListener("change", () => this.dropScanned());
    this.refresh();
  }

  /**
   * Save a checked prescription list to My list, and offer to ask shops for it.
   *
   * :param lines: [{name, strength, form, amount}].
   * :return: {ok, message} for the scan panel.
   */
  useScanned(lines) {
    const items = lines.map((line) => ({ name: [line.name, line.strength, line.form].filter(Boolean).join(" "), qty: line.amount }));
    const result = this.store.addListItems(items);
    if (!result.ok) {
      return { ok: false, message: result.reason };
    }
    this.drawSaved();
    this.scanned = items;
    this.el["scan-ask"].hidden = false;
    const what = result.added === 0 ? "These items were already on My list" : `${result.added} item${result.added === 1 ? "" : "s"} saved to My list`;
    return { ok: true, message: result.added === 0 ? `${what}.` : this.savedText(result.saved, what) };
  }

  /**
   * Forget the list that was offered to shops. My list keeps its items.
   */
  dropScanned() {
    this.scanned = [];
    this.el["scan-ask"].hidden = true;
  }

  /**
   * Ask nearby pharmacies for the checked list.
   *
   * :return: True when the request went to the chat.
   */
  askScanned() {
    if (this.scanned.length === 0) {
      return false;
    }
    const request = composeListRequest(this.scanned, Boolean(this.el["need-open-now"].checked));
    const sent = typeof this.onAsk === "function" && this.onAsk(request);
    this.el["need-status"].textContent = sent
      ? "Asking nearby pharmacies, one at a time. Watch the chat."
      : "The chat cannot take this now. Wait for its answer or check AI model settings, then try again.";
    if (sent) {
      this.dropScanned();
    }
    return sent;
  }

  /**
   * Neem Chowk's date and time now, with the shopper's demo time if they set one.
   *
   * :return: An areaNow() result.
   */
  now() {
    return areaNow(this.clock(), this.directory.area.timezone, this.store.profile.demoTime);
  }

  /**
   * The time facts the agent needs, in the forms it can use.
   *
   * :param now: An areaNow() result.
   * :return: {date, day, time, timezone, demoTime}.
   */
  timeFacts(now) {
    return {
      date: now.date,
      day: now.day,
      time: now.time,
      timezone: `${this.directory.area.timezone} (IST)`,
      demoTime: now.demoTime,
    };
  }

  /**
   * The shopper's spot.
   *
   * :return: A spot from the directory.
   */
  spot() {
    const id = this.store.profile.spotId;
    return this.directory.spots.find((spot) => spot.id === id) || this.directory.spots[0];
  }

  /**
   * One place by id.
   *
   * :param id: A place id.
   * :return: The place, or undefined.
   */
  place(id) {
    return this.directory.places.find((place) => place.id === id);
  }

  /**
   * Distance from the shopper's spot to a place.
   *
   * :param place: A directory place.
   * :return: Meters, or null for an online place.
   */
  metersTo(place) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      return null;
    }
    return distanceMeters(this.spot(), place);
  }

  /**
   * Read the shopper's context: Neem Chowk time, their spot, saved details and the board.
   *
   * :return: Plain JSON data.
   */
  getState() {
    const profile = this.store.profile;
    const spot = this.spot();
    return {
      area: this.directory.area.name,
      now: this.timeFacts(this.now()),
      from: { spotId: spot.id, name: spot.name },
      vehicles: profile.vehicles.map((vehicle) => ({ id: vehicle.id, label: vehicle.label })),
      myList: profile.list.map((item) => ({ id: item.id, label: item.label })),
      holds: profile.holds.map((hold) => ({
        id: hold.id,
        shopId: hold.shopId,
        shop: hold.shopName || this.place(hold.shopId)?.name || hold.shopId,
        item: hold.item,
        code: hold.code,
        until: hold.until,
        pickup: hold.pickup || "",
        expired: timePassed(hold.until, hold.savedAt, this.clock(), this.directory.area.timezone),
        page: this.place(hold.shopId)?.page || "",
      })),
      results: this.results === null ? null : {
        need: this.results.need,
        askedAt: this.results.askedAt,
        rows: this.results.rows.map((row) => ({ shopId: row.shopId, shop: row.shop, availability: row.availability, item: row.item, price: row.price, asOf: row.asOf })),
      },
      onDevice: "These details are saved on this device only and are never sent to shops.",
    };
  }

  /**
   * Shortlist the shops to ask, nearest first, at most 4.
   *
   * A pharmacy is asked only about a known amount: without medicines the shops come
   * without their tools, and a medicine with no amount is refused.
   *
   * :param args: {category, medicines = [{name, amount}], openNow = true, limit = 4, exclude = []}.
   * :return: {ok: true, category, now, from, shops, notAsked, moreOpen, medicines} or
   *   {ok: false, field, reason}.
   */
  findShops({ category, medicines = [], openNow = true, limit = 4, exclude = [] }) {
    const needs = [];
    for (const { name, amount } of category === "pharmacy" ? medicines : []) {
      // The visitor says the amount: an AI model must not fill it in.
      const said = this.said.length === 0 || mentionsAmount(this.said.join(" ; "));
      const need = said ? parseAmount(amount, name) : { ok: false, reason: "How many are needed, or how many times a day and for how many days?" };
      if (!need.ok) {
        return { ok: false, field: "medicines", reason: `Ask the visitor about ${clean(name, 80)}: ${need.reason} Do not guess. If they do not know, use "1 pack".` };
      }
      needs.push({ name: clean(name, 80), need: need.count, unit: need.unit, amount: need.label, ...(need.how ? { counted: need.how } : {}), ask: `Do you have ${need.label} of ${clean(name, 80)}? Say how much you can give.` });
    }
    const now = this.now();
    const spot = this.spot();
    const result = shortlistShops(this.directory, { category, openNow, limit, exclude, spotId: spot.id, now });
    if (category === "pharmacy") {
      if (needs.length) {
        this.needs = needs;
        result.medicines = needs;
      } else {
        result.shops = result.shops.map(({ askWith, ...shop }) => shop);
        result.note = "To ask these shops about a medicine, call this again with medicines.";
      }
    }
    return { ok: true, category, now: this.timeFacts(now), from: spot.name, ...result };
  }

  /**
   * Plan the fewest stops for a list from the shops' answers.
   *
   * :param args: {items, offers: [{shopId, has}]}.
   * :return: {ok: true, stops: [{shopId, name, distance, items}], covered, missing, summary}
   *   or {ok: false, field, reason}.
   */
  planStops({ items, offers }) {
    const enriched = [];
    for (const offer of offers) {
      const place = this.place(offer.shopId);
      if (!place) {
        return { ok: false, field: "offers", reason: `Unknown shop "${offer.shopId}".` };
      }
      enriched.push({ shopId: place.id, name: place.name, distanceMeters: this.metersTo(place), has: offer.has });
    }
    const plan = planFewestStops(items, enriched);
    if (!plan.ok) {
      return { ...plan, field: "offers" };
    }
    const stops = plan.stops.map((stop) => {
      const meters = this.metersTo(this.place(stop.shopId));
      return { ...stop, distance: meters === null ? "online" : formatDistance(meters) };
    });
    return { ...plan, stops };
  }

  /**
   * The counted medicine a shop's stock question is about.
   *
   * :param query: What the shop's agent looked up.
   * :return: A need, or undefined.
   */
  needFor(query) {
    if (this.needs.length <= 1) {
      return this.needs[0];
    }
    const generic = new Set(["tablet", "tablets", "capsule", "capsules", "syrup", "strip", "oral"]);
    const words = (text) => (String(text).toLowerCase().match(/[a-z]{3,}/g) || []).filter((word) => !generic.has(word));
    const asked = new Set(words(query));
    return this.needs.find((need) => words(need.name).some((word) => asked.has(word)));
  }

  /**
   * Add the visitor's amount to a pharmacy's stock question.
   *
   * :param place: The directory's place, or undefined.
   * :param action: The shop's tool.
   * :param args: Its arguments.
   * :return: The arguments to run.
   */
  completeStock(place, action, args) {
    const need = place?.category === "pharmacy" && action === "check_stock" ? this.needFor(args.query) : null;
    return need ? { ...args, amount: need.need, unit: need.unit } : args;
  }

  /**
   * Keep how much a pharmacy can give, from its own stock tool, not from its words.
   *
   * :param place: The directory's place, or undefined.
   * :param action: The shop's tool.
   * :param args: Its arguments.
   * :param result: Its result.
   */
  heardStock(place, action, args, result) {
    const need = place?.category === "pharmacy" && action === "check_stock" ? this.needFor(args.query) : null;
    const matches = need ? (result?.matches || []).filter((entry) => entry.match === "full" && entry.supply) : [];
    // Prefer the strength other shops were found to have, so amounts of it can be added up.
    const key = (entry) => `${entry.name} ${String(entry.detail).split("·")[0].trim()}`;
    const known = this.supplies.find((supply) => supply.medicine === need?.name);
    const match = matches.find((entry) => key(entry) === known?.item) || matches[0];
    if (!match) {
      return;
    }
    this.supplies = this.supplies.filter((supply) => supply.shopId !== place.id || supply.medicine !== need.name);
    this.supplies.push({
      medicine: need.name,
      shopId: place.id,
      name: place.name,
      distanceMeters: this.metersTo(place),
      item: key(match),
      need: need.need,
      unit: need.unit,
      canGive: Number(match.supply.canGive) || 0,
      packs: Number(match.supply.packs) || 0,
      itemId: match.id,
      canHold: match.hold === "yes" || match.hold === "prescription",
      text: clean(match.supply.text, 120),
    });
  }

  /**
   * Where to get one counted medicine, in one strength: one shop, else the fewest together.
   *
   * :param need: One of this turn's needs.
   * :return: {item, stops, missing, summary}, or undefined when no shop has any.
   */
  planFor(need) {
    const all = this.supplies.filter((supply) => supply.medicine === need.name);
    return [...new Set(all.map((supply) => supply.item))]
      .map((item) => ({ item, ...splitAmount(need.need, all.filter((supply) => supply.item === item)) }))
      .sort((one, two) => one.missing - two.missing)
      .find((option) => option.stops.length);
  }

  /**
   * The holds to offer as buttons, from the shops' own stock answers. An offer stays until
   * newer stock answers replace it, so "hold them" in a later message still works.
   *
   * One offer per shop, with all its items.
   *
   * :return: [{shopId, shop, lines: [{itemId, qty, text}], label}].
   */
  holdOffers() {
    const fresh = this.needs.flatMap((need) => (this.planFor(need)?.stops ?? []).map((stop) => {
      const supply = this.supplies.find((entry) => entry.shopId === stop.shopId && entry.medicine === need.name);
      if (!supply.canHold || !supply.packs) {
        return null;
      }
      const size = need.unit === "tablets" ? Math.max(1, Math.ceil(supply.canGive / supply.packs)) : 1;
      const wanted = Math.min(supply.packs, Math.ceil(stop.take / size));
      const qty = Math.min(wanted, MOST_PER_HOLD);
      const limit = wanted > qty ? ` (of ${wanted}: a hold is at most ${MOST_PER_HOLD})` : "";
      return { shopId: stop.shopId, shop: stop.name, itemId: supply.itemId, qty, text: `${qty} × ${supply.item}${limit}` };
    })).filter(Boolean);
    if (fresh.length) {
      const shops = new Map();
      for (const { shopId, shop, ...line } of fresh) {
        const offer = shops.get(shopId) ?? { shopId, shop, lines: [] };
        // Two needs may mean the same item; the shop holds each item once.
        if (!offer.lines.some((other) => other.itemId === line.itemId)) {
          offer.lines.push(line);
        }
        shops.set(shopId, offer);
      }
      this.offers = [...shops.values()].map((offer) => ({ ...offer, label: `Hold at ${offer.shop}: ${offer.lines.map((line) => line.text).join(" + ")}` }));
    }
    return this.offers;
  }

  /**
   * Add to a pharmacy's answer what its stock tool said and which shops together have it.
   * Only the same medicine and strength are added up.
   *
   * :param place: The directory's place, or undefined.
   * :param text: The shop's answer.
   * :return: The answer for the agent.
   */
  withSupply(place, text) {
    if (place?.category !== "pharmacy") {
      return text;
    }
    const lines = this.needs.map((need) => {
      const all = this.supplies.filter((supply) => supply.medicine === need.name);
      const here = all.find((supply) => supply.shopId === place.id);
      const plan = this.planFor(need);
      const single = plan && plan.missing === 0 && plan.stops.length === 1;
      return [
        here ? `${need.name}: ${place.name} can give ${here.text} (${here.item}).` : `${need.name}: ${place.name} gave no count.`,
        plan ? `Best so far: ${plan.item}: ${plan.summary}` : "None found so far.",
        single ? "Complete: no need to ask more shops for this." : "Ask the next open shop. After the last one, tell the visitor Best so far.",
      ].join(" ");
    });
    return lines.length ? `${text}\n\nCHECKED COUNTS (use these, not other counts):\n${lines.join("\n")}` : text;
  }

  /**
   * Remember what the visitor wrote in the chat, for this visit only.
   *
   * :param text: One message.
   */
  noteSaid(text) {
    this.said = [...this.said, String(text ?? "")].slice(-6);
  }

  /**
   * Check what the agent is about to ask a shop: a pharmacy is always asked about an amount
   * the visitor gave. A hold also gets its steps. Any other request to another kind of shop passes unchanged.
   *
   * :param place: The directory's place, or undefined.
   * :param text: The agent's request.
   * :return: {text} to send, or {refusal} for the agent.
   */
  checkRequest(place, text) {
    if (place && /\b(hold|reserve|keep)\b/i.test(text)) {
      // Small models often stop after looking up the stock, so the request names both steps.
      return { text: `${text}. Use website_check_stock to get the item id, then you must call website_request_hold with that id. Do not reply before it returns.` };
    }
    if (place?.category !== "pharmacy") {
      return { text };
    }
    if (this.needs.length) {
      return { text: this.needs.map((need) => need.ask).join(" ") };
    }
    const latest = this.said.at(-1) ?? "";
    const own = parseAmount(latest);
    if (own.ok) {
      const name = clean(text.replace(/^do you have/i, ""), 80) || "the medicine";
      this.needs = [{ name, need: own.count, unit: own.unit, amount: own.label, ask: `${text} Amount needed: ${own.label}. Say how much you can give.` }];
      return { text: this.needs[0].ask };
    }
    if (mentionsAmount(text) && mentionsAmount(this.said.join(" ; "))) {
      return { text };
    }
    return { refusal: "Skipped: the amount is missing, so no shop was asked. Stop and ask the visitor: how many do you need, or how many times a day and for how many days?" };
  }

  /** The amount field is for medicines only. */
  showAmountField() {
    this.el["need-amount"].hidden = this.el["need-category"].value === "auto_parts";
  }

  /**
   * Put the shops' answers on the results board. Rows for shops that did not answer, or
   * that the shopper chose not to ask, keep no item, price, stock time or note.
   *
   * :param args: {need, rows: [{shopId, availability, item, price, asOf, note}]}.
   * :return: {ok: true, need, shown} or {ok: false, field, reason}.
   */
  showResults({ need, rows }) {
    const cleanNeed = clean(need, 120);
    if (!cleanNeed) {
      return { ok: false, field: "need", reason: "Say what was asked for." };
    }
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > MOST_ROWS) {
      return { ok: false, field: "rows", reason: `Give one row for each shop asked, up to ${MOST_ROWS}.` };
    }
    const seen = new Set();
    const normalized = [];
    for (const row of rows) {
      const place = this.place(row.shopId);
      if (!place) {
        return { ok: false, field: "rows", reason: `Unknown shop "${row.shopId}".` };
      }
      if (!AVAILABILITY.includes(row.availability)) {
        return { ok: false, field: "rows", reason: `Unknown availability "${row.availability}".` };
      }
      if (seen.has(place.id)) {
        return { ok: false, field: "rows", reason: `${place.name} appears twice. Give one row per shop.` };
      }
      seen.add(place.id);
      const answered = ANSWERED.has(row.availability);
      normalized.push({
        shopId: place.id,
        shop: place.name,
        availability: row.availability,
        item: answered ? clean(row.item, 120) : "",
        price: answered ? clean(row.price, 40) : "",
        asOf: answered ? clean(row.asOf, 40) : "",
        note: answered ? clean(row.note, 160) : "",
      });
    }
    const rank = (row) => AVAILABILITY.indexOf(row.availability);
    const meters = (row) => this.metersTo(this.place(row.shopId)) ?? Infinity;
    normalized.sort((a, b) => rank(a) - rank(b) || meters(a) - meters(b));
    this.results = { need: cleanNeed, askedAt: this.now().time, rows: normalized };
    this.drawResults();
    return { ok: true, need: cleanNeed, shown: normalized.length };
  }

  /**
   * Keep a hold code a shop gave in My holds.
   *
   * :param args: {shopId, item, code, until, pickup}.
   * :return: {ok: true, saved, duplicate, holds} or {ok: false, field, reason}.
   */
  saveHold({ shopId, item, code, until, pickup }) {
    const place = this.place(shopId);
    if (!place) {
      return { ok: false, field: "shopId", reason: `Unknown shop "${shopId}".` };
    }
    const result = this.store.addHold({ shopId: place.id, shopName: place.name, item, code, until, pickup });
    if (!result.ok) {
      return result;
    }
    this.drawHolds();
    return { ok: true, saved: result.saved, duplicate: result.duplicate, holds: this.getState().holds };
  }

  /**
   * Keep a hold the moment its shop confirms it, from the shop's own tool, so the code is
   * never lost or changed by an AI model.
   *
   * :param place: The directory's place, or undefined.
   * :param action: The shop's tool.
   * :param result: Its result.
   * :return: The hold's chat line, or null when nothing new was held.
   */
  heardHold(place, action, result) {
    if (!place || action !== "request_hold" || result?.ok !== true) {
      return null;
    }
    this.heldNow += 1;
    const item = clean(String(result.summary ?? "").split(" held at ")[0], 400) || "Held item";
    const kept = this.saveHold({ shopId: place.id, item, code: result.code, until: result.until, pickup: result.pickup });
    if (!kept.ok || kept.duplicate) {
      return null;
    }
    const code = clean(result.code, 40);
    return `Hold code ${code} at ${place.name}: ${item}. ${kept.saved ? "Saved in My holds." : "In My holds until you close this page: write it down."}`;
  }

  /**
   * Warn when the visitor asked to hold something and no shop confirmed a hold, whatever
   * the AI model said.
   *
   * :return: The chat line, or null.
   */
  holdMissing() {
    return /^\W*(?:(?:please|yes|ok|can you|could you)\W+)*(?:hold|reserve)\b/i.test(this.said.at(-1) ?? "") && this.heldNow === 0
      ? "Nothing was held: no shop gave a hold code."
      : null;
  }

  /**
   * Remove a hold from My holds. It stays held at the shop.
   *
   * :param id: The hold's id.
   * :return: The store's result.
   */
  removeHold(id) {
    const result = this.store.removeHold(id);
    this.drawHolds();
    return result;
  }

  /**
   * Save a vehicle to My garage.
   *
   * :param vehicle: {maker, model, year, variant}.
   * :return: The store's result.
   */
  addVehicle(vehicle) {
    const result = this.store.addVehicle(vehicle);
    this.drawSaved();
    return result;
  }

  /**
   * Remove a vehicle from My garage.
   *
   * :param id: The vehicle's id.
   * :return: The store's result.
   */
  removeVehicle(id) {
    const result = this.store.removeVehicle(id);
    this.drawSaved();
    return result;
  }

  /**
   * Save an item to My list.
   *
   * :param item: {name, qty}.
   * :return: The store's result.
   */
  addListItem(item) {
    const result = this.store.addListItem(item);
    this.drawSaved();
    return result;
  }

  /**
   * Remove an item from My list.
   *
   * :param id: The item's id.
   * :return: The store's result.
   */
  removeListItem(id) {
    const result = this.store.removeListItem(id);
    this.drawSaved();
    return result;
  }

  /**
   * Move the shopper to another spot in the area.
   *
   * :param spotId: A spot id from the directory.
   * :return: {ok: true, saved, spotId} or {ok: false, field, reason}.
   */
  setSpot(spotId) {
    if (!this.directory.spots.some((spot) => spot.id === spotId)) {
      return { ok: false, field: "spotId", reason: "Pick a spot in Neem Chowk." };
    }
    const result = this.store.setSpot(spotId);
    this.refresh();
    return result;
  }

  /**
   * Set or clear the demo time of day.
   *
   * :param value: "HH:MM" or null for live time.
   * :return: The store's result.
   */
  setDemoTime(value) {
    const result = this.store.setDemoTime(value);
    this.refresh();
    return result;
  }

  /**
   * The search form's submit: hand the request to the assistant, or explain what it
   * would do when the assistant is not connected yet.
   */
  handleAsk() {
    const status = this.el["need-status"];
    const need = clean(this.el["need-input"].value, 120);
    if (!need) {
      status.textContent = "Type what you need first, such as a medicine or a vehicle part.";
      return;
    }
    const category = this.el["need-category"].value === "auto_parts" ? "auto_parts" : "pharmacy";
    const openNow = Boolean(this.el["need-open-now"].checked);
    const typed = clean(this.el["need-amount"].value, 80);
    // The amount may be in its own field or in the request, such as "paracetamol 2 times a day for 1 week".
    const amount = category === "pharmacy" ? parseAmount(typed || need, need) : null;
    if (amount && !amount.ok) {
      status.textContent = `How much do you need? ${amount.reason} For example: 14 tablets, 2 bottles, or 2 times a day for 1 week.`;
      this.el["need-amount"].focus();
      return;
    }
    const request = composeRequest({ need, category, openNow, amount, written: typed });
    if (typeof this.onAsk === "function" && this.onAsk(request)) {
      status.textContent = `${amount?.how ? `${amount.label}: ${amount.how}. ` : ""}Asking nearby shops, one at a time. Watch the chat.`;
      return;
    }
    const names = this.findShops({ category, openNow }).shops.map((shop) => shop.name);
    status.textContent = names.length
      ? `Your agent would ask ${names.join(", ")}. Add an AI provider in the assistant's settings to ask them.`
      : "No shop of that kind is open now. Untick \"Open now only\" to see the rest.";
  }

  /**
   * The garage form's submit: save the vehicle or show why not.
   */
  handleGarageForm() {
    const result = this.addVehicle({
      maker: this.el["garage-maker"].value,
      model: this.el["garage-model"].value,
      year: this.el["garage-year"].value,
      variant: this.el["garage-variant"].value,
    });
    this.el["garage-status"].textContent = result.ok ? this.savedText(result.saved, "Vehicle saved") : result.reason;
    if (result.ok) {
      for (const id of ["garage-maker", "garage-model", "garage-year", "garage-variant"]) {
        this.el[id].value = "";
      }
    }
  }

  /**
   * The list form's submit: save the item or show why not.
   */
  handleListForm() {
    const result = this.addListItem({ name: this.el["list-name"].value, qty: this.el["list-qty"].value });
    this.el["list-status"].textContent = result.ok ? this.savedText(result.saved, "Item saved") : result.reason;
    if (result.ok) {
      this.el["list-name"].value = "";
      this.el["list-qty"].value = "";
    }
  }

  /**
   * Say whether a save reached the browser's storage.
   *
   * :param saved: The store's saved flag.
   * :param what: What was saved.
   * :return: The status text.
   */
  savedText(saved, what) {
    return saved ? `${what} on this device.` : `${what} for this visit only: this browser blocks storage.`;
  }

  /**
   * Redraw every panel.
   */
  refresh() {
    this.drawClock();
    this.drawShops();
    this.drawResults();
    this.drawHolds();
    this.drawSaved();
    renderSpots(this.doc, this.el["spot-select"], this.directory.spots, this.spot().id);
    this.el["demo-time-select"].value = this.store.profile.demoTime || "";
  }

  /**
   * Redraw what changes with the clock.
   */
  tick() {
    this.drawClock();
    this.drawShops();
  }

  /**
   * Draw the Neem Chowk time line.
   */
  drawClock() {
    const now = this.now();
    const demo = now.demoTime ? " (demo time)" : "";
    this.el["clock-line"].textContent = `Neem Chowk time: ${now.day} · ${now.time} IST${demo}`;
  }

  /**
   * Draw "Shops near you": every place, nearest first, with open status.
   */
  drawShops() {
    const now = this.now();
    const shops = this.directory.places
      .map((place) => ({ place, meters: this.metersTo(place) }))
      .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.place.name.localeCompare(b.place.name))
      .map(({ place, meters }) => {
        const state = openState(place.hours, now);
        return {
          id: place.id,
          name: place.name,
          category: CATEGORY_LABELS[place.category],
          distance: meters === null ? "online" : formatDistance(meters),
          open: state.open,
          openLabel: state.label,
          verified: place.verified ? `Verified: ${place.verified.ref}` : "Not verified",
          page: place.page,
          network: place.agent.network,
          tool: toolNameFor(place.agent.network),
        };
      });
    renderShops(this.doc, this.el.shops, shops);
  }

  /**
   * Draw the results board from the last answers.
   */
  drawResults() {
    if (this.results === null) {
      renderResults(this.doc, this.el.results, this.el["results-summary"], { summary: "Ask for something and your agent's comparison appears here.", cards: [] });
      return;
    }
    const now = this.now();
    const count = this.results.rows.length;
    const cards = this.results.rows.map((row) => {
      const place = this.place(row.shopId);
      const meters = this.metersTo(place);
      const distance = meters === null ? "online" : formatDistance(meters);
      const state = openState(place.hours, now);
      let source = `Answer from ${row.shop}'s own agent.`;
      if (row.availability === "no_answer") {
        source = "This shop's agent did not answer.";
      } else if (row.availability === "declined") {
        source = "You chose not to contact this shop.";
      } else if (row.asOf) {
        source = `Stock as of ${row.asOf} · answer from ${row.shop}'s own agent.`;
      }
      return {
        shop: row.shop,
        availability: row.availability,
        label: LABELS[row.availability],
        item: [row.item, row.price].filter(Boolean).join(" · "),
        meta: `${distance} · ${state.label}${place.verified ? " · licence verified" : ""}`,
        source,
        note: row.note,
      };
    });
    renderResults(this.doc, this.el.results, this.el["results-summary"], {
      summary: `Asked ${count} shop${count === 1 ? "" : "s"} about "${this.results.need}" at ${this.results.askedAt}.`,
      cards,
    });
  }

  /**
   * Draw My holds, newest first.
   */
  drawHolds() {
    const holds = this.getState().holds.reverse();
    renderHolds(this.doc, this.el.holds, this.el["holds-empty"], holds, (id) => this.removeHold(id));
  }

  /**
   * Draw My garage and My list.
   */
  drawSaved() {
    const profile = this.store.profile;
    renderSaved(this.doc, this.el["garage-list"], profile.vehicles, (id) => this.removeVehicle(id));
    renderSaved(this.doc, this.el["list-items"], profile.list, (id) => this.removeListItem(id));
  }
}
