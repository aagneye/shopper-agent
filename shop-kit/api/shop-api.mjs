// A shop's live stock API, fed by its billing counter. The shop's page, its counter, its
// dashboard, its website tools and its agent bridge all call these routes on the shop's
// own origin. No Node built-ins, so the same handlers can run in a serverless function.
//
// Agents only ever see stock bands, prices and hold rules. Shoppers' names and phone
// numbers stay in the holds list, masked for the dashboard.
import { areaNow, parseHHMM } from "../../sites/nearshelf/js/clock.js";
import { DAYS, openState } from "../../sites/nearshelf/js/directory.js";
import { band, formatRupees, holdKind, searchStock } from "./stock.mjs";

const MOST_PER_SALE = 50;
const MOST_PER_HOLD = 5;
const MOST_LOGGED = 500;
const MOST_MISSED_SHOWN = 20;
const ALL_DAY_HOLD_MINUTES = 120;

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
  const isActive = (hold) => Date.parse(hold.untilIso) > clock().getTime();
  const heldOf = (state, itemId) => state.holds.filter((hold) => hold.itemId === itemId && isActive(hold)).reduce((sum, hold) => sum + hold.qty, 0);
  const shopkeeperItem = (state, item) => {
    const held = heldOf(state, item.id);
    return { id: item.id, name: item.name, detail: item.detail, price: formatRupees(item.mrp), qty: item.qty, held, available: item.qty - held };
  };

  /**
   * GET /api/stock?q=: bands for the items a shopper's words mean, and a missed-demand
   * entry when nothing that matches fully is on the shelf.
   */
  async function stock({ query }) {
    const state = await store.get();
    const text = clean(query.q).slice(0, 80);
    const search = searchStock(state.items, text);
    if (!search.ok) {
      return { status: 400, body: { ok: false, reason: search.reason } };
    }
    const matches = search.matches.map(({ item, match }) => {
      const available = item.qty - heldOf(state, item.id);
      return {
        id: item.id,
        name: item.name,
        detail: item.detail,
        price: formatRupees(item.mrp),
        availability: band(available),
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
   * POST /api/holds {itemId, qty, name, phone}: hold items for pickup until closing.
   * The shopper's details stay here; the answer has only the code and what is held.
   */
  async function createHold({ body }) {
    const state = await store.get();
    const item = state.items.find((entry) => entry.id === body.itemId);
    if (!item) {
      return refuse("itemId", "That item is not sold here.");
    }
    if (!Number.isInteger(body.qty) || body.qty < 1 || body.qty > MOST_PER_HOLD) {
      return refuse("qty", `Hold 1 to ${MOST_PER_HOLD} at a time.`);
    }
    const name = clean(body.name);
    if (name.length < 2 || name.length > 60) {
      return refuse("name", "Enter the name to give at the counter, 2 to 60 letters.");
    }
    const phone = mobile(body.phone);
    if (!phone) {
      return refuse("phone", "Enter a 10-digit mobile number.");
    }
    if (item.schedule === "X") {
      return refuse("itemId", "This medicine cannot be held. Ask the pharmacist in person.");
    }
    const today = now();
    const open = openState(profile.hours, today);
    if (!open.open) {
      return refuse("itemId", `The shop is closed now, ${open.label.replace(/^closed, /, "")}. Holds are taken while it is open.`);
    }
    const available = item.qty - heldOf(state, item.id);
    if (body.qty > available) {
      return refuse("qty", available <= 0 ? "None left to hold." : `Only ${available} left to hold.`);
    }
    const minutes = open.label === "open 24 hours" ? ALL_DAY_HOLD_MINUTES : minutesUntilClose(profile.hours, today);
    const untilDate = new Date(clock().getTime() + minutes * 60000);
    const until = areaNow(untilDate, profile.timezone, null).time;
    const code = newCode(state);
    state.holds.push({
      code,
      itemId: item.id,
      item: item.name,
      qty: body.qty,
      name,
      phone,
      at: clock().toISOString(),
      untilIso: untilDate.toISOString(),
      until,
    });
    state.holds.splice(0, Math.max(0, state.holds.length - MOST_LOGGED));
    await store.set(state);
    const prescription = holdKind(item, available) === "prescription";
    const what = `${body.qty} × ${item.name}${item.detail ? ` (${item.detail})` : ""}`;
    return {
      status: 200,
      body: {
        ok: true,
        code,
        until,
        summary: `${what} held at ${profile.name} until ${until}.`,
        prescription,
        ...(prescription ? { note: "Bring the prescription: the pharmacist checks it at the counter." } : {}),
      },
    };
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
      name: hold.name.split(" ")[0],
      phone: `••••••••${hold.phone.slice(-2)}`,
      until: hold.until,
      at: timeOf(hold.at),
      status: isActive(hold) ? "held" : "expired",
    }));
    return { status: 200, body: { ok: true, holds } };
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
    "/api/sale": { POST: sale },
    "/api/holds": { GET: listHolds, POST: createHold },
    "/api/missed": { GET: listMissed },
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
