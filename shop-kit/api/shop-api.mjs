// A shop's live stock API, fed by its billing counter. The shop's page, its counter, its
// dashboard, its website tools and its agent bridge all call these routes on the shop's
// own origin. No Node built-ins, so the same handlers can run in a serverless function.
//
// Agents see stock bands, prices, hold rules and, for an amount they ask for, how much of it can be given. Shoppers' names and phone
// numbers stay in the holds list, masked for the dashboard.
import { areaNow, parseHHMM } from "../../sites/nearshelf/js/clock.js";
import { DAYS, openState } from "../../sites/nearshelf/js/directory.js";
import { band, formatRupees, holdKind, parseBillingCsv, searchStock, supplyOf } from "./stock.mjs";

const MOST_PER_SALE = 50;
const MOST_LINES_PER_BILL = 30;
const MOST_IMPORT_CHARS = 400 * 1024;
const MOST_IMPORT_ITEMS = 5000;
const MOST_PER_HOLD = 5;
const MOST_LINES_PER_LIST = 12;
const MOST_ITEMS_PER_HOLD = 8;
const MOST_UNITS_ASKED = 500;
const MOST_LOGGED = 500;
const MOST_MISSED_SHOWN = 20;
const ALL_DAY_HOLD_MINUTES = 120;
const PICKUP_MINUTES = { 30: "Within 30 minutes", 60: "Within 1 hour", 90: "Within 1 hour 30 minutes", 120: "Within 2 hours" };

/**
 * The state a shop starts from, or returns to on reset.
 *
 * :param items: The items from the shop's billing export.
 * :return: {version, items, holds, sales, missed}.
 */
export function initialState(items) {
  return { version: 1, items: items.map((item) => ({ ...item })), holds: [], sales: [], missed: [] };
}

/**
 * Trim text and collapse inner spaces.
 *
 * :param value: Any value.
 * :return: The cleaned string.
 */
function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Read an Indian mobile number.
 *
 * :param value: The number as typed, possibly with +91, a leading 0, spaces or dashes.
 * :return: The 10 digits, or null when it is not a mobile number.
 */
function mobile(value) {
  let digits = String(value ?? "").replace(/[\s()-]/g, "");
  if (digits.startsWith("+91")) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * A refusal: nothing changed, and the reason says why.
 *
 * :param field: The field at fault.
 * :param reason: What the shopper or shopkeeper should know.
 * :return: The response.
 */
function refuse(field, reason) {
  return { status: 200, body: { ok: false, field, reason } };
}

/**
 * Minutes from now until the shop's current opening range ends.
 *
 * :param hours: The shop's hours.
 * :param now: An areaNow() result.
 * :return: Minutes, or 0 when the shop is not open now.
 */
function minutesUntilClose(hours, now) {
  const ranges = (day) => (hours[day] || []).map(([start, end]) => [parseHHMM(start), parseHHMM(end)]);
  const today = DAYS.indexOf(now.weekday);
  for (const [start, end] of ranges(now.weekday)) {
    if (end <= start && now.minutes >= start) {
      return end + 1440 - now.minutes;
    }
    if (end > start && now.minutes >= start && now.minutes < end) {
      return end - now.minutes;
    }
  }
  for (const [start, end] of ranges(DAYS[(today + 6) % 7])) {
    if (end <= start && now.minutes < end) {
      return end - now.minutes;
    }
  }
  return 0;
}

/**
 * Create the API for one shop.
 *
 * :param options: {profile: {id, name, kind, timezone, hours}, items, store, clock,
 *   allowReset}. The store has get() and set(state), sync or async; clock returns a Date.
 * :return: {handle(request)}, where request is {method, path, query, body} and the
 *   promise resolves to {status, body}.
 */
export function createShopApi({ profile, items, store, clock = () => new Date(), allowReset = false }) {
  const now = () => areaNow(clock(), profile.timezone, null);
  const timeOf = (iso) => areaNow(new Date(iso), profile.timezone, null).time;
  // A hold is active until it is collected, released or past its time.
  const isActive = (hold) => !hold.outcome && Date.parse(hold.untilIso) > clock().getTime();
  // A hold's items: its first, and any more held under the same code.
  const linesOf = (hold) => [{ itemId: hold.itemId, item: hold.item, qty: hold.qty }, ...(hold.more || [])];
  const listText = (hold) => linesOf(hold).map((line) => `${line.qty} × ${line.item}`).join(" + ");
  const heldOf = (state, itemId) => state.holds.filter(isActive).flatMap(linesOf).filter((line) => line.itemId === itemId).reduce((sum, line) => sum + line.qty, 0);
  const shopkeeperItem = (state, item) => {
    const held = heldOf(state, item.id);
    return { id: item.id, name: item.name, detail: item.detail, price: formatRupees(item.mrp), mrp: item.mrp, qty: item.qty, held, available: item.qty - held };
  };

  /**
   * GET /api/stock?q=&amount=&unit=: bands for the items a shopper's words mean, and a missed-demand
   * entry when nothing that matches fully is on the shelf. With an amount, each match also
   * says how much of that amount the shop can give.
   */
  async function stock({ query }) {
    const state = await store.get();
    const text = clean(query.q).slice(0, 80);
    const amount = query.amount === undefined ? null : Number(query.amount);
    const unit = query.unit === "packs" ? "packs" : "tablets";
    if (amount !== null && (!Number.isInteger(amount) || amount < 1 || amount > MOST_UNITS_ASKED)) {
      return { status: 400, body: { ok: false, reason: `Ask for 1 to ${MOST_UNITS_ASKED}.` } };
    }
    const search = searchStock(state.items, text);
    if (!search.ok) {
      return { status: 400, body: { ok: false, reason: search.reason } };
    }
    const matches = search.matches.map(({ item, match }) => {
      const available = item.qty - heldOf(state, item.id);
      const supply = amount === null ? null : supplyOf(item, available, amount, unit);
      return {
        id: item.id,
        name: item.name,
        detail: item.detail,
        price: formatRupees(item.mrp),
        availability: band(available),
        ...(supply ? { supply } : {}),
        hold: holdKind(item, available),
        match,
      };
    });
    const full = matches.filter((entry) => entry.match === "full");
    if (!full.some((entry) => entry.availability !== "out_of_stock")) {
      state.missed.push({ query: text, reason: full.length ? "out of stock" : "not stocked", at: clock().toISOString() });
      state.missed.splice(0, Math.max(0, state.missed.length - MOST_LOGGED));
      await store.set(state);
    }
    return { status: 200, body: { ok: true, query: text, asOf: now().time, matches } };
  }

  /**
   * GET /api/stock/all: the shopkeeper's view, with exact counts and holds.
   */
  async function stockAll() {
    const state = await store.get();
    return { status: 200, body: { ok: true, asOf: now().time, items: state.items.map((item) => shopkeeperItem(state, item)) } };
  }

  /**
   * POST /api/sale {itemId, qty}: bill at the counter. Held units cannot be sold.
   */
  async function sale({ body }) {
    const state = await store.get();
    const item = state.items.find((entry) => entry.id === body.itemId);
    if (!item) {
      return refuse("itemId", "That item is not sold here.");
    }
    if (!Number.isInteger(body.qty) || body.qty < 1 || body.qty > MOST_PER_SALE) {
      return refuse("qty", `Bill 1 to ${MOST_PER_SALE} at a time.`);
    }
    const held = heldOf(state, item.id);
    const available = item.qty - held;
    if (body.qty > available) {
      return refuse("qty", held > 0 ? `Only ${available} can be billed: ${held} on hold.` : `Only ${item.qty} in stock.`);
    }
    item.qty -= body.qty;
    state.sales.push({ itemId: item.id, qty: body.qty, at: clock().toISOString() });
    state.sales.splice(0, Math.max(0, state.sales.length - MOST_LOGGED));
    await store.set(state);
    return { status: 200, body: { ok: true, item: shopkeeperItem(state, item) } };
  }

  /**
   * POST /api/bill {lines: [{itemId, qty}]}: bill several items as one sale. Every line is
   * checked before any stock changes, so a bill is taken whole or not at all. Lines for the
   * same item are added together. Held units cannot be sold.
   */
  async function bill({ body }) {
    const lines = body && Array.isArray(body.lines) ? body.lines : null;
    if (!lines || lines.length === 0) {
      return refuse("lines", "Add at least one item to the bill.");
    }
    if (lines.length > MOST_LINES_PER_BILL) {
      return refuse("lines", `Bill up to ${MOST_LINES_PER_BILL} lines at a time.`);
    }
    const state = await store.get();
    const wanted = new Map();
    for (const line of lines) {
      const item = state.items.find((entry) => entry.id === (line && line.itemId));
      if (!item) {
        return refuse("lines", "One of the items is not sold here.");
      }
      if (!Number.isInteger(line.qty) || line.qty < 1) {
        return refuse("lines", `${item.name}: enter a whole number of 1 or more.`);
      }
      wanted.set(item.id, (wanted.get(item.id) || 0) + line.qty);
    }
    for (const [itemId, qty] of wanted) {
      const item = state.items.find((entry) => entry.id === itemId);
      if (qty > MOST_PER_SALE) {
        return refuse("lines", `${item.name}: bill 1 to ${MOST_PER_SALE} at a time.`);
      }
      const held = heldOf(state, itemId);
      const available = item.qty - held;
      if (qty > available) {
        const left = held > 0 ? `only ${available} can be billed, ${held} on hold` : `only ${item.qty} in stock`;
        return refuse("lines", `${item.name}: ${left}.`);
      }
    }
    const at = clock().toISOString();
    let total = 0;
    const billed = [];
    for (const [itemId, qty] of wanted) {
      const item = state.items.find((entry) => entry.id === itemId);
      item.qty -= qty;
      total += item.mrp * qty;
      state.sales.push({ itemId, qty, at });
      billed.push({ itemId, name: item.name, detail: item.detail, qty, price: formatRupees(item.mrp), amount: formatRupees(item.mrp * qty) });
    }
    state.sales.splice(0, Math.max(0, state.sales.length - MOST_LOGGED));
    await store.set(state);
    return {
      status: 200,
      body: {
        ok: true,
        lines: billed,
        total: formatRupees(total),
        items: [...wanted.keys()].map((itemId) => shopkeeperItem(state, state.items.find((entry) => entry.id === itemId))),
      },
    };
  }

  /**
   * POST /api/quote {lines: [{itemId, qty}]}: an estimate for a shopper's list, from live
   * stock. The total counts only lines the shop can supply now. It gives bands, never
   * counts, and changes nothing.
   */
  async function quote({ body }) {
    const lines = body && Array.isArray(body.lines) ? body.lines : null;
    if (!lines || lines.length === 0 || lines.length > MOST_LINES_PER_LIST) {
      return refuse("lines", `Send 1 to ${MOST_LINES_PER_LIST} items.`);
    }
    const state = await store.get();
    const answers = [];
    const seen = new Set();
    let total = 0;
    for (const line of lines) {
      const item = state.items.find((entry) => entry.id === (line && line.itemId));
      if (!item) {
        return refuse("lines", "One of the items is not sold here.");
      }
      if (seen.has(item.id)) {
        return refuse("lines", `${item.name} is on the list twice.`);
      }
      seen.add(item.id);
      if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > MOST_PER_HOLD) {
        return refuse("lines", `${item.name}: choose 1 to ${MOST_PER_HOLD}.`);
      }
      const available = item.qty - heldOf(state, item.id);
      const enough = line.qty <= available;
      const amount = item.mrp * line.qty;
      if (enough) {
        total += amount;
      }
      answers.push({
        itemId: item.id,
        name: item.name,
        detail: item.detail,
        qty: line.qty,
        price: formatRupees(item.mrp),
        amount: formatRupees(amount),
        availability: band(available),
        enough,
        hold: holdKind(item, available),
        prescription: ["H", "H1", "X"].includes(item.schedule),
      });
    }
    return { status: 200, body: { ok: true, asOf: now().time, lines: answers, total: formatRupees(total) } };
  }

  /**
   * The shop's own rules for holding an item, without the shopper's details: it exists,
   * the amount is allowed, it is not Schedule X, the shop is open and enough is free.
   *
   * :param state: The shop's state.
   * :param itemId: The item's id.
   * :param qty: How many to hold.
   * :return: {refusal} when the shop refuses, or {item, untilDate, until, prescription}.
   */
  function holdRules(state, itemId, qty) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) {
      return { refusal: refuse("itemId", "That item is not sold here.") };
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > MOST_PER_HOLD) {
      return { refusal: refuse("qty", `Hold 1 to ${MOST_PER_HOLD} at a time.`) };
    }
    if (item.schedule === "X") {
      return { refusal: refuse("itemId", "This medicine cannot be held. Ask the pharmacist in person.") };
    }
    const today = now();
    const open = openState(profile.hours, today);
    if (!open.open) {
      return { refusal: refuse("itemId", `The shop is closed now, ${open.label.replace(/^closed, /, "")}. Holds are taken while it is open.`) };
    }
    const available = item.qty - heldOf(state, item.id);
    if (qty > available) {
      return { refusal: refuse("qty", available <= 0 ? "None left to hold." : `Only ${available} left to hold.`) };
    }
    const minutes = open.label === "open 24 hours" ? ALL_DAY_HOLD_MINUTES : minutesUntilClose(profile.hours, today);
    const untilDate = new Date(clock().getTime() + minutes * 60000);
    return {
      item,
      minutes,
      untilDate,
      until: areaNow(untilDate, profile.timezone, null).time,
      prescription: holdKind(item, available) === "prescription",
    };
  }

  /**
   * Check a hold of one or more items: it is taken whole, or refused whole.
   *
   * :param state: The shop's state.
   * :param itemId: The first item's id.
   * :param qty: How many of it.
   * :param more: Further [{itemId, qty}].
   * :return: {refusal}, or holdRules() of the first item with every {item, qty} in lines.
   */
  function holdAll(state, itemId, qty, more) {
    if (!Array.isArray(more) || more.length >= MOST_ITEMS_PER_HOLD || more.some((line) => !line || typeof line !== "object")) {
      return { refusal: refuse("itemId", `Hold up to ${MOST_ITEMS_PER_HOLD} items at once.`) };
    }
    const asked = [{ itemId, qty }, ...more];
    if (new Set(asked.map((line) => line.itemId)).size !== asked.length) {
      return { refusal: refuse("itemId", "List each item once.") };
    }
    const checked = [];
    for (const line of asked) {
      const rules = holdRules(state, line.itemId, line.qty);
      if (rules.refusal) {
        const item = state.items.find((entry) => entry.id === line.itemId);
        const { field, reason } = rules.refusal.body;
        return asked.length > 1 && item ? { refusal: refuse(field, `${item.name}: ${reason}`) } : rules;
      }
      checked.push({ ...rules, qty: line.qty });
    }
    return { ...checked[0], prescription: checked.some((rules) => rules.prescription), lines: checked.map((rules) => ({ item: rules.item, qty: rules.qty })) };
  }

  /**
   * GET /api/holds/check?itemId=&qty=&more=ID:2,ID:1: would the shop hold this? Changes nothing, so the
   * hold form can give the shop's reason before it asks for anyone's details.
   */
  async function checkHold({ query }) {
    const state = await store.get();
    const more = String(query.more ?? "").split(",").filter(Boolean).map((part) => {
      const [id, count] = part.split(":");
      return { itemId: id, qty: Number(count) };
    });
    const rules = holdAll(state, String(query.itemId ?? ""), Number(query.qty ?? 1), more);
    if (rules.refusal) {
      return rules.refusal;
    }
    return { status: 200, body: { ok: true, until: rules.until, pickups: pickupsFor(rules), prescription: rules.prescription } };
  }

  /**
   * The pickup times to offer: only those before the hold would end.
   *
   * :param rules: A holdRules() result.
   * :return: [{value, label}].
   */
  function pickupsFor(rules) {
    return [
      ...Object.entries(PICKUP_MINUTES)
        .filter(([minutes]) => Number(minutes) < rules.minutes)
        .map(([value, label]) => ({ value, label })),
      { value: "any", label: `Any time until ${rules.until}` },
    ];
  }

  /**
   * Read the pickup time a shopper chose. It tells the shop when to expect them; the hold
   * still lasts until its own end.
   *
   * :param pickup: "30", "60", "90", "120", "any", an own time as "HH:MM", or undefined.
   * :param rules: A holdRules() result.
   * :return: {by}, a clock time, or {refusal}.
   */
  function readPickup(pickup, rules) {
    if (pickup === undefined || pickup === "any") {
      return { by: rules.until };
    }
    const at = /^([01]\d|2[0-3]):[0-5]\d$/.test(pickup) ? parseHHMM(pickup) : null;
    if (at === null && !Object.hasOwn(PICKUP_MINUTES, String(pickup))) {
      return { refusal: refuse("pickup", "Choose when you will pick it up.") };
    }
    const wait = at === null ? Math.min(Number(pickup), rules.minutes) : (at - now().minutes + 1440) % 1440;
    if (wait < 1 || wait > rules.minutes) {
      return { refusal: refuse("pickup", `Choose a time after now and not later than ${rules.until}.`) };
    }
    return { by: timeOf(new Date(clock().getTime() + wait * 60000).toISOString()) };
  }

  /**
   * The answer for a hold that was taken: the code and what is held, never the details.
   *
   * :param hold: The hold as stored.
   * :param items: The shop's items.
   * :return: The response.
   */
  function holdAnswer(hold, items) {
    const lines = linesOf(hold).map((line) => ({ ...line, entry: items.find((item) => item.id === line.itemId) || {} }));
    const prescription = lines.some(({ entry }) => entry.schedule === "H" || entry.schedule === "H1");
    const what = lines.map(({ qty, item, entry }) => `${qty} × ${item}${entry.detail ? ` (${entry.detail})` : ""}`).join(" + ");
    return {
      status: 200,
      body: {
        ok: true,
        code: hold.code,
        until: hold.until,
        summary: `${what} held at ${profile.name} until ${hold.until}.${hold.pickup && hold.pickup !== hold.until ? ` Pickup planned by ${hold.pickup}.` : ""}`,
        ...(hold.pickup ? { pickup: hold.pickup } : {}),
        prescription,
        ...(prescription ? { note: "Bring the prescription: the pharmacist checks it at the counter." } : {}),
      },
    };
  }

  /**
   * POST /api/holds {requestId, itemId, qty, more, name, phone, pickup}: hold items for pickup
   * until closing, all under one code. more is further [{itemId, qty}]. pickup says when the shopper plans to come. The same requestId sent again, after an answer was lost, gets the same hold
   * back instead of a second one. The shop's rules for the item come next, then the
   * shopper's details, which stay here; the answer has only the code and what is held.
   */
  async function createHold({ body }) {
    const state = await store.get();
    const requestId = body.requestId ?? null;
    if (requestId !== null && (typeof requestId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(requestId))) {
      return refuse("requestId", "Send a request id of 8 to 100 letters, digits or dashes.");
    }
    const earlier = requestId && state.holds.find((hold) => hold.requestId === requestId);
    if (earlier) {
      const asked = [{ itemId: body.itemId, qty: body.qty }, ...(Array.isArray(body.more) ? body.more : [])];
      const same = JSON.stringify(linesOf(earlier).map(({ itemId, qty }) => [itemId, qty])) === JSON.stringify(asked.map((line) => [line?.itemId, line?.qty]));
      if (!same) {
        return refuse("requestId", "That request id was used for another hold.");
      }
      return holdAnswer(earlier, state.items);
    }
    const rules = holdAll(state, body.itemId, body.qty, body.more ?? []);
    if (rules.refusal) {
      return rules.refusal;
    }
    const name = clean(body.name);
    if (name.length < 2 || name.length > 60) {
      return refuse("name", "Enter the name to give at the counter, 2 to 60 letters.");
    }
    const phone = mobile(body.phone);
    if (!phone) {
      return refuse("phone", "Enter a 10-digit mobile number.");
    }
    const pickup = readPickup(body.pickup, rules);
    if (pickup.refusal) {
      return pickup.refusal;
    }
    const { item, untilDate, until } = rules;
    const hold = {
      code: newCode(state),
      itemId: item.id,
      item: item.name,
      qty: body.qty,
      ...(rules.lines.length > 1 ? { more: rules.lines.slice(1).map((line) => ({ itemId: line.item.id, item: line.item.name, qty: line.qty })) } : {}),
      name,
      phone,
      at: clock().toISOString(),
      untilIso: untilDate.toISOString(),
      until,
      pickup: pickup.by,
      ...(requestId ? { requestId } : {}),
    };
    state.holds.push(hold);
    state.holds.splice(0, Math.max(0, state.holds.length - MOST_LOGGED));
    await store.set(state);
    return holdAnswer(hold, state.items);
  }

  /**
   * GET /api/holds: the dashboard's list, newest first, with names and phones masked.
   */
  async function listHolds() {
    const state = await store.get();
    const holds = [...state.holds].reverse().map((hold) => ({
      code: hold.code,
      item: hold.item,
      qty: hold.qty,
      what: listText(hold),
      name: hold.name.split(" ")[0],
      phone: `••••••••${hold.phone.slice(-2)}`,
      until: hold.until,
      pickup: hold.pickup || hold.until,
      at: timeOf(hold.at),
      status: hold.outcome || (isActive(hold) ? "held" : "expired"),
    }));
    return { status: 200, body: { ok: true, holds } };
  }

  /**
   * The hold a shopkeeper names by its code, while it is still held.
   *
   * :param state: The shop's state.
   * :param code: The code as typed, such as "h-4821".
   * :param expiredNote: What to do about an expired hold.
   * :return: {hold}, or {refusal} when there is no such hold or it has ended.
   */
  function heldHold(state, code, expiredNote) {
    const wanted = clean(code).toUpperCase();
    const hold = state.holds.find((entry) => entry.code === wanted);
    if (!hold) {
      return { refusal: refuse("code", wanted ? `No hold has the code ${wanted}.` : "Enter a hold code.") };
    }
    if (hold.outcome) {
      return { refusal: refuse("code", `${hold.code} was already ${hold.outcome}.`) };
    }
    if (!isActive(hold)) {
      return { refusal: refuse("code", `${hold.code} expired at ${hold.until}. ${expiredNote}`) };
    }
    return { hold };
  }

  /**
   * POST /api/holds/collect {code}: the shopper picked the hold up and paid. Its units are
   * billed and the hold ends in one step, so the counter never has to sell held units.
   */
  async function collectHold({ body }) {
    const state = await store.get();
    const found = heldHold(state, body.code, "Bill it at the counter if it is still on the shelf.");
    if (found.refusal) {
      return found.refusal;
    }
    const { hold } = found;
    const lines = linesOf(hold).map((line) => ({ qty: line.qty, item: state.items.find((entry) => entry.id === line.itemId) }));
    if (lines.some(({ item, qty }) => !item || item.qty < qty)) {
      return refuse("code", `The units held for ${hold.code} are no longer in stock.`);
    }
    hold.outcome = "collected";
    hold.endedAt = clock().toISOString();
    for (const { item, qty } of lines) {
      item.qty -= qty;
      state.sales.push({ itemId: item.id, qty, at: hold.endedAt, hold: hold.code });
    }
    state.sales.splice(0, Math.max(0, state.sales.length - MOST_LOGGED));
    await store.set(state);
    return {
      status: 200,
      body: { ok: true, code: hold.code, summary: `${hold.code} collected: billed ${listText(hold)}.`, item: shopkeeperItem(state, lines[0].item) },
    };
  }

  /**
   * POST /api/holds/release {code}: the shopper will not come, so the held units go back
   * on the shelf before the hold would end.
   */
  async function releaseHold({ body }) {
    const state = await store.get();
    const found = heldHold(state, body.code, "Its units are already back on the shelf.");
    if (found.refusal) {
      return found.refusal;
    }
    const { hold } = found;
    hold.outcome = "released";
    hold.endedAt = clock().toISOString();
    await store.set(state);
    return { status: 200, body: { ok: true, code: hold.code, summary: `${hold.code} released: ${listText(hold)} back on the shelf.` } };
  }

  /**
   * GET /api/missed: what people asked for that the shop could not give, most asked first.
   */
  async function listMissed() {
    const state = await store.get();
    const groups = new Map();
    for (const entry of state.missed) {
      const key = entry.query.toLowerCase();
      const group = groups.get(key) || { query: key, count: 0, lastAt: "", reason: "" };
      group.count += 1;
      if (entry.at >= group.lastAt) {
        group.lastAt = entry.at;
        group.reason = entry.reason;
      }
      groups.set(key, group);
    }
    const missed = [...groups.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
      .slice(0, MOST_MISSED_SHOWN)
      .map((group) => ({ query: group.query, count: group.count, last: timeOf(group.lastAt), reason: group.reason }));
    return { status: 200, body: { ok: true, missed } };
  }

  /**
   * POST /api/stock/import {csv, apply}: a new stock export from the billing software.
   * The file's counts and prices replace the shop's, matched by item code, because the
   * billing software's count is the true one: uploading the same file twice changes
   * nothing. New codes are added. Items missing from the file are kept, and listed.
   * Holds are kept. Without apply it only says what would change.
   */
  async function importStock({ body }) {
    const csv = body && typeof body.csv === "string" ? body.csv : null;
    if (!csv || !csv.trim()) {
      return refuse("csv", "Choose a stock export (.csv) first.");
    }
    if (csv.length > MOST_IMPORT_CHARS) {
      return refuse("csv", "That file is too large. Export up to 5,000 items at a time.");
    }
    const parsed = parseBillingCsv(csv, profile.kind);
    if (!parsed.ok) {
      return refuse("csv", parsed.reason);
    }
    if (parsed.items.length === 0) {
      return refuse("csv", "The file has a header but no items.");
    }
    if (parsed.items.length > MOST_IMPORT_ITEMS) {
      return refuse("csv", "That file is too large. Export up to 5,000 items at a time.");
    }
    const state = await store.get();
    const byCode = new Map(state.items.map((item) => [item.id.toLowerCase(), item]));
    const inFile = new Set();
    const changed = [];
    const added = [];
    const warnings = [];
    let unchanged = 0;
    const next = state.items.map((item) => ({ ...item }));
    const nextByCode = new Map(next.map((item) => [item.id.toLowerCase(), item]));
    for (const fresh of parsed.items) {
      const code = fresh.id.toLowerCase();
      inFile.add(code);
      const old = byCode.get(code);
      if (!old) {
        added.push({ id: fresh.id, name: fresh.name, detail: fresh.detail, qty: fresh.qty, price: formatRupees(fresh.mrp) });
        next.push({ ...fresh });
        continue;
      }
      if (old.qty === fresh.qty && old.mrp === fresh.mrp && old.name === fresh.name && old.detail === fresh.detail) {
        unchanged += 1;
      } else {
        changed.push({
          id: old.id,
          name: fresh.name,
          qtyFrom: old.qty,
          qtyTo: fresh.qty,
          priceFrom: formatRupees(old.mrp),
          priceTo: formatRupees(fresh.mrp),
        });
      }
      const held = heldOf(state, old.id);
      if (fresh.qty < held) {
        warnings.push(`${fresh.name}: the file says ${fresh.qty}, but ${held} are on hold.`);
      }
      // Keep the shop's own code spelling, so holds and past sales still point at it.
      Object.assign(nextByCode.get(code), { ...fresh, id: old.id });
    }
    const missing = state.items.filter((item) => !inFile.has(item.id.toLowerCase())).map((item) => ({ id: item.id, name: item.name, qty: item.qty }));
    const answer = { ok: true, applied: false, changed, added, missing, unchanged, warnings };
    if (body.apply === true) {
      state.items = next;
      await store.set(state);
      answer.applied = true;
    }
    return { status: 200, body: answer };
  }

  /**
   * POST /api/reset: put the shop back to its billing export, for demos.
   */
  async function reset() {
    if (!allowReset) {
      return { status: 403, body: { ok: false, reason: "Reset is turned off." } };
    }
    await store.set(initialState(items));
    return { status: 200, body: { ok: true } };
  }

  /**
   * A hold code no current hold uses.
   *
   * :param state: The shop's state.
   * :return: Such as "H-4821".
   */
  function newCode(state) {
    const used = new Set(state.holds.map((hold) => hold.code));
    for (let tries = 0; tries < 50; tries += 1) {
      const code = `H-${1000 + Math.floor(Math.random() * 9000)}`;
      if (!used.has(code)) {
        return code;
      }
    }
    return `H-${String(state.holds.length).padStart(4, "0")}`;
  }

  const routes = {
    "/api/stock": { GET: stock },
    "/api/stock/all": { GET: stockAll },
    "/api/quote": { POST: quote },
    "/api/sale": { POST: sale },
    "/api/bill": { POST: bill },
    "/api/holds": { GET: listHolds, POST: createHold },
    "/api/holds/check": { GET: checkHold },
    "/api/holds/collect": { POST: collectHold },
    "/api/holds/release": { POST: releaseHold },
    "/api/missed": { GET: listMissed },
    "/api/stock/import": { POST: importStock },
    "/api/reset": { POST: reset },
  };

  return {
    /**
     * Answer one request.
     *
     * :param request: {method, path, query, body}.
     * :return: A promise of {status, body}.
     */
    async handle({ method, path, query = {}, body = null }) {
      const route = routes[path];
      if (!route) {
        return { status: 404, body: { ok: false, reason: "Not found." } };
      }
      const handler = route[method];
      if (!handler) {
        return { status: 405, body: { ok: false, reason: "Method not allowed." } };
      }
      if (method === "POST" && (body === null || typeof body !== "object" || Array.isArray(body))) {
        return { status: 400, body: { ok: false, reason: "Send a JSON object." } };
      }
      return handler({ query, body });
    },
  };
}
