// The shopper's profile: their spot, demo time, vehicles, regular medicines and holds.
// It is kept only in this browser (localStorage) and never sent to a shop. When the
// browser blocks storage, it keeps working in memory and reports saved: false.
import { parseHHMM } from "./clock.js";

export const PROFILE_KEY = "nearshelf.profile.v1";
const MOST_VEHICLES = 5;
const MOST_LIST_ITEMS = 12;
const MOST_HOLDS = 20;
const NEWEST_YEAR = 2027;
const OLDEST_YEAR = 1980;

let idCounter = 0;

/**
 * Make a fresh id for a saved record.
 *
 * :param prefix: A short prefix such as "v" for a vehicle.
 * :return: A unique id.
 */
function newId(prefix) {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * The profile a new visitor starts with.
 *
 * :return: A fresh default profile.
 */
function defaults() {
  return { version: 1, spotId: "metro-gate", demoTime: null, vehicles: [], list: [], holds: [] };
}

/**
 * Trim text and collapse inner spaces.
 *
 * :param value: Any value.
 * :return: The cleaned string ("" for null or undefined).
 */
function clean(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Keep only well-formed records from saved data.
 *
 * :param list: The saved list, possibly malformed.
 * :param fields: The string fields each record must have.
 * :return: The records that have an id and every field as a string.
 */
function records(list, fields) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry) => entry && typeof entry.id === "string" && fields.every((field) => typeof entry[field] === "string"));
}

/**
 * The shopper's on-device profile.
 */
export class ProfileStore {
  /**
   * Load the profile from storage, or start from the defaults.
   *
   * :param storage: An object with getItem and setItem, such as localStorage. Null keeps
   *   the profile in memory only. Leave it out to use the browser's localStorage.
   */
  constructor(storage = ProfileStore.browserStorage()) {
    this.storage = storage || null;
    const loaded = this.read();
    this.data = loaded.profile;
    // True while storage holds this tab's latest profile. Each change then re-reads it
    // first, so a save never erases what another open tab saved.
    this.persisted = loaded.ok;
  }

  /**
   * The browser's localStorage, or null when it is missing or blocked.
   *
   * :return: localStorage or null.
   */
  static browserStorage() {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  }

  /**
   * Read the saved profile again, for example when another tab saved it.
   *
   * :return: True when storage could be read and its profile is now this tab's.
   */
  reload() {
    const loaded = this.read();
    if (!loaded.ok) {
      return false;
    }
    this.data = loaded.profile;
    this.persisted = true;
    return true;
  }

  /**
   * Before a change, start from the saved profile, so another tab's saves survive.
   * While saving fails, memory is the only copy, so it is kept as it is.
   */
  sync() {
    if (this.persisted) {
      this.reload();
    }
  }

  /**
   * Read and sanitize the saved profile.
   *
   * :return: {ok, profile}: ok is false when there is no storage or it cannot be read,
   *   and profile is then the defaults.
   */
  read() {
    const profile = defaults();
    if (!this.storage) {
      return { ok: false, profile };
    }
    let saved = null;
    try {
      saved = JSON.parse(this.storage.getItem(PROFILE_KEY) || "null");
    } catch {
      // A blocked getItem and corrupt JSON both land here. Corrupt JSON is overwritten
      // by the next save, so only a blocked storage keeps ok false.
      return { ok: this.canRead(), profile };
    }
    if (!saved || saved.version !== 1) {
      return { ok: true, profile };
    }
    if (typeof saved.spotId === "string" && saved.spotId) {
      profile.spotId = saved.spotId;
    }
    if (typeof saved.demoTime === "string" && parseHHMM(saved.demoTime) !== null && parseHHMM(saved.demoTime) < 1440) {
      profile.demoTime = saved.demoTime;
    }
    profile.vehicles = records(saved.vehicles, ["maker", "model", "label"]);
    profile.list = records(saved.list, ["name", "label"]);
    profile.holds = records(saved.holds, ["shopId", "item", "code"]);
    return { ok: true, profile };
  }

  /**
   * True when storage answers getItem without throwing.
   *
   * :return: Whether storage can be read.
   */
  canRead() {
    try {
      this.storage.getItem(PROFILE_KEY);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write the profile to storage, if there is any.
   *
   * :return: True when the profile is now saved in storage.
   */
  save() {
    if (!this.storage) {
      this.persisted = false;
      return false;
    }
    try {
      this.storage.setItem(PROFILE_KEY, JSON.stringify(this.data));
      this.persisted = true;
    } catch {
      this.persisted = false;
    }
    return this.persisted;
  }

  /**
   * A copy of the profile, safe to hand to other code.
   *
   * :return: The profile as plain JSON data.
   */
  get profile() {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Save a vehicle to My garage.
   *
   * :param vehicle: {maker, model, year, variant}.
   * :return: {ok: true, saved, vehicle, vehicles} or {ok: false, field, reason}.
   */
  addVehicle({ maker, model, year, variant }) {
    this.sync();
    const cleanMaker = clean(maker);
    const cleanModel = clean(model);
    const cleanVariant = clean(variant);
    const yearNumber = Number(year);
    if (!cleanMaker || cleanMaker.length > 40) {
      return { ok: false, field: "maker", reason: "Enter the vehicle's maker." };
    }
    if (!cleanModel || cleanModel.length > 40) {
      return { ok: false, field: "model", reason: "Enter the vehicle's model." };
    }
    if (!Number.isInteger(yearNumber) || yearNumber < OLDEST_YEAR || yearNumber > NEWEST_YEAR) {
      return { ok: false, field: "year", reason: `Enter a year from ${OLDEST_YEAR} to ${NEWEST_YEAR}.` };
    }
    if (cleanVariant.length > 40) {
      return { ok: false, field: "variant", reason: "Keep the variant under 40 characters." };
    }
    if (this.data.vehicles.length >= MOST_VEHICLES) {
      return { ok: false, field: "vehicles", reason: `You can save up to ${MOST_VEHICLES} vehicles.` };
    }
    const label = `${cleanMaker} ${cleanModel} (${yearNumber}${cleanVariant ? `, ${cleanVariant}` : ""})`;
    const record = { id: newId("v"), maker: cleanMaker, model: cleanModel, year: yearNumber, variant: cleanVariant, label };
    this.data.vehicles.push(record);
    const saved = this.save();
    return { ok: true, saved, vehicle: { ...record }, vehicles: this.profile.vehicles };
  }

  /**
   * Remove a vehicle from My garage.
   *
   * :param id: The vehicle's id.
   * :return: {ok: true, saved, vehicles} or {ok: false, field, reason}.
   */
  removeVehicle(id) {
    return this.remove("vehicles", id);
  }

  /**
   * Save a regular medicine or item to My list.
   *
   * :param item: {name, qty}, where qty is free text such as "4" or "2 strips".
   * :return: {ok: true, saved, item, list} or {ok: false, field, reason}.
   */
  addListItem({ name, qty }) {
    this.sync();
    const cleanName = clean(name);
    const cleanQty = clean(qty);
    if (!cleanName || cleanName.length > 80) {
      return { ok: false, field: "name", reason: "Enter the item's name." };
    }
    if (cleanQty.length > 20) {
      return { ok: false, field: "qty", reason: "Keep the quantity under 20 characters." };
    }
    if (this.data.list.length >= MOST_LIST_ITEMS) {
      return { ok: false, field: "list", reason: `You can save up to ${MOST_LIST_ITEMS} items.` };
    }
    const record = { id: newId("i"), name: cleanName, qty: cleanQty, label: cleanQty ? `${cleanName} × ${cleanQty}` : cleanName };
    this.data.list.push(record);
    const saved = this.save();
    return { ok: true, saved, item: { ...record }, list: this.profile.list };
  }

  /**
   * Save several items to My list, all or none. Items already on the list are skipped.
   *
   * :param items: [{name, qty}].
   * :return: {ok: true, saved, added, list} or {ok: false, field, reason}.
   */
  addListItems(items) {
    this.sync();
    const have = new Set(this.data.list.map((entry) => entry.label.toLowerCase()));
    const records = [];
    for (const item of items) {
      const name = clean(item.name);
      const qty = clean(item.qty);
      if (!name || name.length > 80) {
        return { ok: false, field: "name", reason: "Each item needs a name of up to 80 characters." };
      }
      if (qty.length > 20) {
        return { ok: false, field: "qty", reason: "Keep the quantity under 20 characters." };
      }
      const label = qty ? `${name} × ${qty}` : name;
      if (!have.has(label.toLowerCase())) {
        have.add(label.toLowerCase());
        records.push({ id: newId("i"), name, qty, label });
      }
    }
    const room = MOST_LIST_ITEMS - this.data.list.length;
    if (records.length > room) {
      return { ok: false, field: "list", reason: `My list has room for ${room} more. Remove some items first.` };
    }
    this.data.list.push(...records);
    const saved = this.save();
    return { ok: true, saved, added: records.length, list: this.profile.list };
  }

  /**
   * Remove an item from My list.
   *
   * :param id: The item's id.
   * :return: {ok: true, saved, list} or {ok: false, field, reason}.
   */
  removeListItem(id) {
    return this.remove("list", id);
  }

  /**
   * Keep a hold code a shop gave. The same code from the same shop is kept once, and
   * only the newest 20 holds are kept.
   *
   * :param hold: {shopId, shopName, item, code, until, pickup}.
   * :return: {ok: true, saved, duplicate, hold, holds} or {ok: false, field, reason}.
   */
  addHold({ shopId, shopName, item, code, until, pickup }) {
    this.sync();
    const cleanItem = clean(item);
    const cleanCode = clean(code);
    if (!clean(shopId)) {
      return { ok: false, field: "shopId", reason: "Say which shop holds the item." };
    }
    if (!cleanItem || cleanItem.length > 400) {
      return { ok: false, field: "item", reason: "Say which item is held." };
    }
    if (!cleanCode || cleanCode.length > 40) {
      return { ok: false, field: "code", reason: "Give the hold code the shop gave." };
    }
    const existing = this.data.holds.find((hold) => hold.shopId === shopId && hold.code.toLowerCase() === cleanCode.toLowerCase());
    if (existing) {
      return { ok: true, saved: this.persisted, duplicate: true, hold: { ...existing }, holds: this.profile.holds };
    }
    const record = {
      id: newId("h"),
      shopId: clean(shopId),
      shopName: clean(shopName),
      item: cleanItem,
      code: cleanCode,
      until: clean(until).slice(0, 60),
      pickup: clean(pickup).slice(0, 60),
      savedAt: new Date().toISOString(),
    };
    this.data.holds.push(record);
    while (this.data.holds.length > MOST_HOLDS) {
      this.data.holds.shift();
    }
    const saved = this.save();
    return { ok: true, saved, duplicate: false, hold: { ...record }, holds: this.profile.holds };
  }

  /**
   * Remove a hold from My holds (it does not cancel it at the shop).
   *
   * :param id: The hold's id.
   * :return: {ok: true, saved, holds} or {ok: false, field, reason}.
   */
  removeHold(id) {
    return this.remove("holds", id);
  }

  /**
   * Remember where the shopper is, by spot id.
   *
   * :param spotId: A spot id from the directory (the page checks it).
   * :return: {ok: true, saved, spotId} or {ok: false, field, reason}.
   */
  setSpot(spotId) {
    this.sync();
    const id = clean(spotId);
    if (!id) {
      return { ok: false, field: "spotId", reason: "Pick a spot." };
    }
    this.data.spotId = id;
    return { ok: true, saved: this.save(), spotId: id };
  }

  /**
   * Set or clear the demo time of day.
   *
   * :param value: "HH:MM" (00:00 to 23:59), or null for live time.
   * :return: {ok: true, saved, demoTime} or {ok: false, field, reason}.
   */
  setDemoTime(value) {
    this.sync();
    if (value !== null) {
      const minutes = parseHHMM(value);
      if (minutes === null || minutes >= 1440) {
        return { ok: false, field: "demoTime", reason: "Pick a time like 22:45." };
      }
    }
    this.data.demoTime = value;
    return { ok: true, saved: this.save(), demoTime: value };
  }

  /**
   * Remove one record by id from a list.
   *
   * :param listName: "vehicles", "list" or "holds".
   * :param id: The record's id.
   * :return: {ok: true, saved, [listName]} or {ok: false, field, reason}.
   */
  remove(listName, id) {
    this.sync();
    const index = this.data[listName].findIndex((entry) => entry.id === id);
    if (index === -1) {
      return { ok: false, field: "id", reason: "That item is not saved." };
    }
    this.data[listName].splice(index, 1);
    const saved = this.save();
    return { ok: true, saved, [listName]: this.profile[listName] };
  }
}
