// The NearShelf page object. The page's own buttons and forms and the agent's website
// tools call these same methods, so both follow one set of rules. Operations refuse bad
// input by returning {ok: false, field, reason} before changing anything.
import { areaNow } from "./clock.js";
import { distanceMeters, formatDistance, openState, shortlistShops, toolNameFor } from "./directory.js";
import { planFewestStops } from "./fewest-stops.js";
import { renderHolds, renderResults, renderSaved, renderShops, renderSpots } from "./render.js";
import { CHIPS, composeRequest } from "./search.js";

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
    this.el = {};
  }

  /**
   * Find the page's elements, connect its forms and buttons, and draw every panel.
   */
  mount() {
    const ids = [
      "need-form", "need-input", "need-category", "need-open-now", "need-status",
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
        this.el["need-status"].textContent = "";
      });
    }
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
    this.refresh();
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
   * :param args: {category, openNow = true, limit = 4, exclude = []}.
   * :return: {ok: true, category, now, from, shops, notAsked, moreOpen}.
   */
  findShops({ category, openNow = true, limit = 4, exclude = [] }) {
    const now = this.now();
    const spot = this.spot();
    const result = shortlistShops(this.directory, { category, openNow, limit, exclude, spotId: spot.id, now });
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
   * :param args: {shopId, item, code, until}.
   * :return: {ok: true, saved, duplicate, holds} or {ok: false, field, reason}.
   */
  saveHold({ shopId, item, code, until }) {
    const place = this.place(shopId);
    if (!place) {
      return { ok: false, field: "shopId", reason: `Unknown shop "${shopId}".` };
    }
    const result = this.store.addHold({ shopId: place.id, shopName: place.name, item, code, until });
    if (!result.ok) {
      return result;
    }
    this.drawHolds();
    return { ok: true, saved: result.saved, duplicate: result.duplicate, holds: this.getState().holds };
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
    const request = composeRequest({ need, category, openNow });
    if (typeof this.onAsk === "function" && this.onAsk(request)) {
      status.textContent = "Asking nearby shops. Approve each shop in the chat.";
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
