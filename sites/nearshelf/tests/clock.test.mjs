// Neem Chowk time must follow IST, whatever time zone the shopper's browser is in.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";
import { areaNow, formatMinutes, parseHHMM } from "../js/clock.js";

const IST = "Asia/Kolkata";

test("a UTC instant becomes Friday 10:45 pm in Neem Chowk", () => {
  assert.deepEqual(areaNow(new Date("2026-11-20T17:15:00Z"), IST, null), {
    date: "2026-11-20",
    day: "Fri, Nov 20, 2026",
    time: "10:45 pm",
    weekday: "fri",
    minutes: 1365,
    demoTime: null,
  });
});

test("just after midnight IST is the next day", () => {
  const now = areaNow(new Date("2026-11-20T19:00:00Z"), IST, null);
  assert.equal(now.weekday, "sat");
  assert.equal(now.date, "2026-11-21");
  assert.equal(now.time, "12:30 am");
  assert.equal(now.minutes, 30);
});

test("a demo time replaces the time of day but keeps today's IST date", () => {
  const now = areaNow(new Date("2026-11-21T03:30:00Z"), IST, "22:45");
  assert.equal(now.minutes, 1365);
  assert.equal(now.time, "10:45 pm");
  assert.equal(now.date, "2026-11-21");
  assert.equal(now.weekday, "sat");
  assert.equal(now.demoTime, "22:45");
});

test("minutes format as a 12-hour clock", () => {
  assert.equal(formatMinutes(0), "12:00 am");
  assert.equal(formatMinutes(30), "12:30 am");
  assert.equal(formatMinutes(540), "9:00 am");
  assert.equal(formatMinutes(720), "12:00 pm");
  assert.equal(formatMinutes(1365), "10:45 pm");
  assert.equal(formatMinutes(1440), "midnight");
});

test("HH:MM text parses to minutes and refuses bad times", () => {
  assert.equal(parseHHMM("00:00"), 0);
  assert.equal(parseHHMM("08:30"), 510);
  assert.equal(parseHHMM("24:00"), 1440);
  assert.equal(parseHHMM("25:00"), null);
  assert.equal(parseHHMM("12:60"), null);
  assert.equal(parseHHMM("8:30"), null);
  assert.equal(parseHHMM(""), null);
});
