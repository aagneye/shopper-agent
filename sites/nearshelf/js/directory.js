// The places directory (format "nearshelf-places/v1"): which shops exist, where they are,
// when they are open, who verified them and where their agent network lives.
import { formatMinutes, parseHHMM } from "./clock.js";

export const CATEGORIES = ["pharmacy", "auto_parts", "parts_catalogue"];
export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const EARTH_RADIUS_METERS = 6371008.8;
const MOST_SHOPS_PER_ROUND = 4;

/**
 * Check a directory document before the page uses it.
 *
 * :param doc: The parsed directory JSON.
 * :return: {ok: true, directory} or {ok: false, reason}.
 */
export function validateDirectory(doc) {
  if (!doc || doc.format !== "nearshelf-places/v1") {
    return { ok: false, reason: "Unknown directory format." };
  }
  if (!doc.area || !doc.area.name || !isTimeZone(doc.area.timezone)) {
    return { ok: false, reason: "The directory needs an area with a name and a valid time zone." };
  }
  if (!Array.isArray(doc.spots) || doc.spots.length === 0) {
    return { ok: false, reason: "The directory needs at least one spot." };
  }
  for (const spot of doc.spots) {
    if (!spot.id || !spot.name || !Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) {
      return { ok: false, reason: `Spot "${spot.id}" needs an id, a name, lat and lng.` };
    }
  }
  if (!Array.isArray(doc.places)) {
    return { ok: false, reason: "The directory needs a list of places." };
  }
  const seen = new Set();
  for (const place of doc.places) {
    const problem = placeProblem(place);
    if (problem) {
      return { ok: false, reason: problem };
    }
    if (seen.has(place.id)) {
      return { ok: false, reason: `Duplicate place id "${place.id}".` };
    }
    seen.add(place.id);
  }
  return { ok: true, directory: doc };
}

/**
 * Find what is wrong with one place, if anything.
 *
 * :param place: One entry of directory.places.
 * :return: A reason, or null when the place is valid.
 */
function placeProblem(place) {
  if (!place || !place.id || !place.name) {
    return "Every place needs an id and a name.";
  }
  if (!CATEGORIES.includes(place.category)) {
    return `Place "${place.id}" has unknown category "${place.category}".`;
  }
  const located = Number.isFinite(place.lat) && Number.isFinite(place.lng);
  if (place.category !== "parts_catalogue" && !located) {
    return `Place "${place.id}" needs lat and lng.`;
  }
  if (!place.hours || typeof place.hours !== "object") {
    return `Place "${place.id}" needs opening hours.`;
  }
  for (const [day, ranges] of Object.entries(place.hours)) {
    if (!DAYS.includes(day) || !Array.isArray(ranges)) {
      return `Place "${place.id}" has bad hours for "${day}".`;
    }
    for (const range of ranges) {
      for (const time of Array.isArray(range) ? range : [range]) {
        if (parseHHMM(time) === null) {
          return `Place "${place.id}" has a bad time "${time}" on ${day}.`;
        }
      }
      if (!Array.isArray(range) || range.length !== 2) {
        return `Place "${place.id}" has a bad range on ${day}.`;
      }
    }
  }
  if (!place.agent || !isHttpUrl(place.agent.network) || !toolNameFor(place.agent.network) || !place.agent.label) {
    return `Place "${place.id}" has a bad agent network URL.`;
  }
  return null;
}

/**
 * True when the text is an http or https URL.
 *
 * :param text: The URL text.
 * :return: Whether it parses with an http(s) scheme.
 */
function isHttpUrl(text) {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * True when the runtime knows the IANA time zone.
 *
 * :param timeZone: The time zone name.
 * :return: Whether Intl accepts it.
 */
function isTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return Boolean(timeZone);
  } catch {
    return false;
  }
}

/**
 * The partner tool name the runtime gives a network URL: its last path segment.
 *
 * :param networkUrl: A peer network URL, such as "http://localhost:8081/shanti_medical".
 * :return: The tool name, such as "shanti_medical", or "" when the URL has no path.
 */
export function toolNameFor(networkUrl) {
  try {
    const segments = new URL(networkUrl).pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : "";
  } catch {
    return "";
  }
}

/**
 * Decide whether a place is open at a moment, with the label shoppers read.
 *
 * :param hours: The place's hours: weekday → list of ["HH:MM", "HH:MM"]. An end at or
 *   before the start runs past midnight; "24:00" is the end of the day.
 * :param now: An areaNow() result (uses weekday and minutes).
 * :return: {open, label}, such as {open: true, label: "open until 11:00 pm"}.
 */
export function openState(hours, now) {
  if (DAYS.every((day) => isAllDay(hours[day]))) {
    return { open: true, label: "open 24 hours" };
  }
  const today = DAYS.indexOf(now.weekday);
  const yesterday = DAYS[(today + 6) % 7];
  for (const [start, end] of ranges(hours, now.weekday)) {
    const overnight = end <= start;
    if (now.minutes >= start && (overnight || now.minutes < end)) {
      return { open: true, label: `open until ${formatMinutes(end)}` };
    }
  }
  for (const [start, end] of ranges(hours, yesterday)) {
    if (end <= start && now.minutes < end) {
      return { open: true, label: `open until ${formatMinutes(end)}` };
    }
  }
  const laterToday = ranges(hours, now.weekday).map(([start]) => start).filter((start) => start > now.minutes);
  if (laterToday.length) {
    return { open: false, label: `closed, opens ${formatMinutes(Math.min(...laterToday))}` };
  }
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = DAYS[(today + ahead) % 7];
    const starts = ranges(hours, day).map(([start]) => start);
    if (starts.length) {
      return { open: false, label: `closed, opens ${DAY_LABELS[day]} ${formatMinutes(Math.min(...starts))}` };
    }
  }
  return { open: false, label: "closed" };
}

/**
 * The day's ranges in minutes.
 *
 * :param hours: The place's hours.
 * :param day: A weekday key such as "fri".
 * :return: A list of [startMinutes, endMinutes].
 */
function ranges(hours, day) {
  return (hours[day] || []).map(([start, end]) => [parseHHMM(start), parseHHMM(end)]);
}

/**
 * True when a day's hours are exactly the whole day.
 *
 * :param dayHours: The list of ranges for one day.
 * :return: Whether it is [["00:00", "24:00"]].
 */
function isAllDay(dayHours) {
  return Array.isArray(dayHours) && dayHours.length === 1 && dayHours[0][0] === "00:00" && dayHours[0][1] === "24:00";
}

/**
 * Great-circle distance between two points.
 *
 * :param a: {lat, lng} in degrees.
 * :param b: {lat, lng} in degrees.
 * :return: The distance in meters.
 */
export function distanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/**
 * Format a distance as shoppers read it.
 *
 * :param meters: The distance in meters.
 * :return: "210 m" below a kilometre (nearest 10 m), otherwise "1.2 km".
 */
export function formatDistance(meters) {
  const rounded = Math.round(meters / 10) * 10;
  return rounded < 1000 ? `${rounded} m` : `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Pick the shops to ask about an item: one category, nearest first, at most 4.
 *
 * Pharmacies without a verified licence are never asked. Shops already asked, and
 * closed shops when openNow is true, are listed in notAsked with the reason.
 *
 * :param directory: A validated directory.
 * :param options: {category, openNow = true, limit = 4, exclude = [], spotId, now}.
 * :return: {shops, notAsked, moreOpen}.
 */
export function shortlistShops(directory, { category, openNow = true, limit = MOST_SHOPS_PER_ROUND, exclude = [], spotId, now }) {
  const spot = directory.spots.find((entry) => entry.id === spotId) || directory.spots[0];
  const candidates = directory.places
    .filter((place) => place.category === category)
    .map((place) => ({
      place,
      meters: Number.isFinite(place.lat) && Number.isFinite(place.lng) ? distanceMeters(spot, place) : null,
      state: openState(place.hours, now),
    }))
    .sort((a, b) => (a.meters ?? Infinity) - (b.meters ?? Infinity) || a.place.name.localeCompare(b.place.name));
  const eligible = [];
  const notAsked = [];
  for (const candidate of candidates) {
    const { place, state } = candidate;
    if (exclude.includes(place.id)) {
      notAsked.push({ id: place.id, name: place.name, reason: "already asked" });
    } else if (place.category === "pharmacy" && !place.verified) {
      notAsked.push({ id: place.id, name: place.name, reason: "license not verified" });
    } else if (openNow && !state.open) {
      notAsked.push({ id: place.id, name: place.name, reason: state.label });
    } else {
      eligible.push(candidate);
    }
  }
  const chosen = eligible.slice(0, Math.max(1, Math.min(limit, MOST_SHOPS_PER_ROUND)));
  return {
    shops: chosen.map(({ place, meters, state }) => ({
      id: place.id,
      name: place.name,
      askWith: toolNameFor(place.agent.network),
      distance: meters === null ? "online" : formatDistance(meters),
      distanceMeters: meters === null ? null : Math.round(meters),
      open: state.label,
      verified: place.verified ? `${place.verified.ref}, checked by ${place.verified.by}` : "not verified",
      address: place.address,
      page: place.page,
    })),
    notAsked,
    moreOpen: eligible.length - chosen.length,
  };
}
