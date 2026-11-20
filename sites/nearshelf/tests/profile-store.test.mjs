// The shopper's profile lives only on this device, and the page keeps working when the
// browser blocks storage (private windows, strict settings).
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { PROFILE_KEY, ProfileStore } from "../js/profile-store.js";

const DEFAULTS = { version: 1, spotId: "metro-gate", demoTime: null, vehicles: [], list: [], holds: [] };
const ZIP = { maker: "Vayu", model: "Zip 125", year: 2019, variant: "drum brake" };

/** A Map-backed stand-in for localStorage. */
class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

/** Storage that throws on every call, like a blocked localStorage. */
class BlockedStorage {
  getItem() {
    throw new Error("SecurityError: storage is blocked");
  }

  setItem() {
    throw new Error("SecurityError: storage is blocked");
  }

  removeItem() {
    throw new Error("SecurityError: storage is blocked");
  }
}

test("with no storage the profile works in memory", () => {
  const store = new ProfileStore(null);
  assert.deepEqual(store.profile, DEFAULTS);
  const result = store.addVehicle(ZIP);
  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  assert.equal(store.profile.vehicles.length, 1);
});

test("corrupt saved data gives the defaults", () => {
  const store = new ProfileStore(new MemoryStorage({ [PROFILE_KEY]: "{not json" }));
  assert.deepEqual(store.profile, DEFAULTS);
});

test("two stores sharing one storage see each other's saves", () => {
  const storage = new MemoryStorage();
  const first = new ProfileStore(storage);
  assert.equal(first.addVehicle(ZIP).saved, true);
  const second = new ProfileStore(storage);
  assert.equal(second.profile.vehicles[0].label, "Vayu Zip 125 (2019, drum brake)");
});

test("a vehicle needs a maker, a model and a year from 1980 to 2027", () => {
  const store = new ProfileStore(null);
  assert.deepEqual(store.addVehicle({ ...ZIP, year: 1979 }), { ok: false, field: "year", reason: "Enter a year from 1980 to 2027." });
  assert.deepEqual(store.addVehicle({ ...ZIP, maker: "  " }), { ok: false, field: "maker", reason: "Enter the vehicle's maker." });
  assert.deepEqual(store.addVehicle({ ...ZIP, model: "" }), { ok: false, field: "model", reason: "Enter the vehicle's model." });
  assert.equal(store.addVehicle({ ...ZIP, year: "2027" }).ok, true);
  assert.equal(store.profile.vehicles.length, 1);
});

test("a vehicle label reads naturally, with or without a variant", () => {
  const store = new ProfileStore(null);
  assert.equal(store.addVehicle(ZIP).vehicle.label, "Vayu Zip 125 (2019, drum brake)");
  assert.equal(store.addVehicle({ maker: "Vayu", model: "Swift 150", year: 2021 }).vehicle.label, "Vayu Swift 150 (2021)");
});

test("at most 5 vehicles are saved", () => {
  const store = new ProfileStore(null);
  for (let index = 0; index < 5; index += 1) {
    assert.equal(store.addVehicle(ZIP).ok, true);
  }
  assert.deepEqual(store.addVehicle(ZIP), { ok: false, field: "vehicles", reason: "You can save up to 5 vehicles." });
});

test("list items keep a quantity in the label, up to 12 items", () => {
  const store = new ProfileStore(null);
  assert.equal(store.addListItem({ name: "ORS sachets", qty: "4" }).item.label, "ORS sachets × 4");
  assert.equal(store.addListItem({ name: "Amoxicillin 500 mg capsules", qty: "" }).item.label, "Amoxicillin 500 mg capsules");
  assert.deepEqual(store.addListItem({ name: " ", qty: "1" }), { ok: false, field: "name", reason: "Enter the item's name." });
  for (let index = 0; index < 10; index += 1) {
    store.addListItem({ name: `Item ${index}`, qty: "" });
  }
  assert.deepEqual(store.addListItem({ name: "One more", qty: "" }), { ok: false, field: "list", reason: "You can save up to 12 items." });
});

test("the same hold code from the same shop is saved once", () => {
  const store = new ProfileStore(null);
  const hold = { shopId: "shanti_medical", shopName: "Shanti Medical", item: "Paracetamol syrup", code: "H-4821", until: "11:00 pm" };
  const first = store.addHold(hold);
  assert.equal(first.ok, true);
  assert.equal(first.duplicate, false);
  const again = store.addHold({ ...hold, code: "h-4821" });
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(store.profile.holds.length, 1);
});

test("a 21st hold drops the oldest", () => {
  const store = new ProfileStore(null);
  for (let index = 0; index < 21; index += 1) {
    store.addHold({ shopId: "night_owl_pharmacy", shopName: "Night Owl Pharmacy", item: "ORS sachets", code: `H-${1000 + index}`, until: "" });
  }
  const codes = store.profile.holds.map((hold) => hold.code);
  assert.equal(codes.length, 20);
  assert.equal(codes[0], "H-1001");
  assert.equal(codes[19], "H-1020");
});

test("blocked storage still works in memory and says it did not save", () => {
  const store = new ProfileStore(new BlockedStorage());
  assert.deepEqual(store.profile, DEFAULTS);
  const result = store.addListItem({ name: "ORS sachets", qty: "2" });
  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
  assert.equal(store.profile.list.length, 1);
});

test("removing works by id and refuses an id that is not saved", () => {
  const store = new ProfileStore(null);
  const { vehicle } = store.addVehicle(ZIP);
  assert.equal(store.removeVehicle(vehicle.id).ok, true);
  assert.equal(store.profile.vehicles.length, 0);
  assert.deepEqual(store.removeVehicle("missing"), { ok: false, field: "id", reason: "That item is not saved." });
});

test("the demo time takes HH:MM or null", () => {
  const store = new ProfileStore(null);
  assert.equal(store.setDemoTime("22:45").ok, true);
  assert.equal(store.profile.demoTime, "22:45");
  assert.deepEqual(store.setDemoTime("25:00"), { ok: false, field: "demoTime", reason: "Pick a time like 22:45." });
  assert.equal(store.profile.demoTime, "22:45");
  assert.equal(store.setDemoTime(null).ok, true);
  assert.equal(store.profile.demoTime, null);
});

test("the spot is saved", () => {
  const storage = new MemoryStorage();
  new ProfileStore(storage).setSpot("bus-stand");
  assert.equal(new ProfileStore(storage).profile.spotId, "bus-stand");
});
