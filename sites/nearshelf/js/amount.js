// How much of a medicine the visitor needs, from their own words. The page counts, not the
// AI model, so the arithmetic is always right. It only multiplies what the visitor wrote:
// it never suggests a dose.

/** The most tablets or packs to ask shops for. */
export const MOST_UNITS = 500;

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
const DAYS = { day: 1, week: 7, month: 30 };
const TABLET = "(?:tablets?|tabs?|capsules?|caps?|pills?)";
const PACK = "(strip|pack|packet|bottle|box|sachet|piece|tube)(?:s|es)?";
const NOT_COUNTED = /\b(syrup|suspension|drops|solution|cream|ointment|gel|inhaler|sachets?|ml)\b/;

/**
 * Lower-case words with strengths removed and number words turned into digits.
 *
 * :param text: The visitor's words.
 * :return: The text to search.
 */
function plain(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|%)(?:\s*\/\s*\d*\s*ml)?(?![a-z])/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*ml\b/g, " ml ")
    .replace(/\bonce\b/g, "1 time")
    .replace(/\btwice\b/g, "2 times")
    .replace(/\bthrice\b/g, "3 times")
    .replace(/\bhalf an?\b|\bhalf\b/g, "0.5")
    .replace(/\bone and 0\.5\b/g, "1.5")
    .replace(new RegExp(`\\b(${Object.keys(NUMBERS).join("|")})\\b`, "g"), (word) => NUMBERS[word])
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Take the first match out of a text.
 *
 * :param state: {text}, changed in place.
 * :param pattern: A regular expression.
 * :return: The match, or null.
 */
function take(state, pattern) {
  const match = pattern.exec(state.text);
  if (match) {
    state.text = state.text.replace(match[0], " ; ");
  }
  return match;
}

/**
 * How many times a day, when the text says so.
 *
 * :param state: {text}, with the words that were understood taken out.
 * :return: {times, doses}, where doses is a count for the whole day such as 1-0-1, or null.
 */
function perDay(state) {
  const pattern = take(state, /\b([0-4](?:\.5)?)\s*-\s*([0-4](?:\.5)?)\s*-\s*([0-4](?:\.5)?)\b/);
  if (pattern) {
    return { doses: Number(pattern[1]) + Number(pattern[2]) + Number(pattern[3]) };
  }
  const times = take(state, /\b(\d+)\s*(?:times?|x)\s*(?:a|per|each|every|in a|in)?\s*(?:day|daily)\b/);
  if (times) {
    return { times: Number(times[1]) };
  }
  const hours = take(state, /\bevery\s+(\d+)\s*(?:hours?|hrs?|h)\b/);
  if (hours && Number(hours[1]) > 0) {
    return { times: Math.floor(24 / Number(hours[1])) };
  }
  const code = take(state, /\b(od|bd|bid|tds|tid|qid)\b/);
  if (code) {
    return { times: { od: 1, bd: 2, bid: 2, tds: 3, tid: 3, qid: 4 }[code[1]] };
  }
  const parts = new Set(state.text.match(/\b(?:morning|noon|afternoon|evening|night)\b/g) || []);
  if (parts.size) {
    return { times: parts.size };
  }
  return take(state, /\b(?:daily|(?:a|per|each|every) day)\b/) ? { times: 1 } : null;
}

/**
 * Work out how much the visitor needs.
 *
 * :param words: Their words for one medicine, such as "2 times a day for 1 week".
 * :param name: The medicine, when it is known: a bare "2" of a syrup or sachet is packs.
 * :return: {ok: true, count, unit: "tablets" or "packs", label, how} or {ok: false, reason}.
 */
export function parseAmount(words, name = "") {
  const text = plain(words);
  const notCounted = NOT_COUNTED.test(`${text} ${plain(name)}`);
  const state = { text };
  const day = perDay(state);
  const length = take(state, /\b(\d+|an?)\s*(day|week|month)s?\b/);
  const tablets = take(state, new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*(?:x\\s*)?(?:[a-z']+ ){0,3}?${TABLET}\\b`));
  const packs = take(state, new RegExp(`\\b(\\d+|an?)\\s*(?:x\\s*)?(?:[a-z']+ ){0,3}?${PACK}\\b`));
  const again = new RegExp(`\\b\\d+\\s*${TABLET}\\b|\\b\\d+\\s*${PACK}\\b|\\b\\d+\\s*(?:day|week|month)s?\\b`).test(state.text);
  if (again) {
    return { ok: false, reason: "Give one amount for each medicine." };
  }
  const asNumber = (value) => (/^an?$/.test(value) ? 1 : Number(value));
  if (day && !packs) {
    if (notCounted) {
      return { ok: false, reason: "This is not counted in tablets. How many bottles or packs?" };
    }
    if (!length) {
      return { ok: false, reason: "For how many days?" };
    }
    const days = asNumber(length[1]) * DAYS[length[2]];
    const each = tablets ? Number(tablets[1]) : 1;
    const doses = day.doses ?? day.times;
    const exact = day.doses === undefined ? each * doses * days : doses * days;
    const how = day.doses === undefined
      ? `${each} each time × ${doses} a day × ${days} days${tablets ? "" : ", counting 1 each time"}`
      : `${doses} a day × ${days} days`;
    return amount(Math.ceil(exact), "tablets", "tablet", how);
  }
  if (tablets && !packs) {
    if (NOT_COUNTED.test(plain(name)) && !length) {
      return amount(Math.ceil(Number(tablets[1])), "packs", "pack", "");
    }
    return length && !day
      ? { ok: false, reason: "How many times a day?" }
      : amount(Math.ceil(Number(tablets[1])), "tablets", "tablet", "");
  }
  if (packs) {
    return amount(asNumber(packs[1]), "packs", packs[2] === "box" ? "boxe" : packs[2], "");
  }
  if (length) {
    return { ok: false, reason: "How many times a day?" };
  }
  const bare = /^\D{0,20}?(\d+)\D{0,20}$/.exec(text);
  if (bare) {
    return notCounted ? amount(Number(bare[1]), "packs", "pack", "") : amount(Number(bare[1]), "tablets", "tablet", "");
  }
  return { ok: false, reason: "How many are needed, or how many times a day and for how many days?" };
}

/**
 * Check and label a count.
 */
function amount(count, unit, name, how) {
  if (!Number.isInteger(count) || count < 1 || count > MOST_UNITS) {
    return { ok: false, reason: `Ask for 1 to ${MOST_UNITS}.` };
  }
  const label = `${count} ${count === 1 ? name.replace("boxe", "box") : `${name}s`}`;
  return { ok: true, count, unit, label, how };
}

/**
 * True when words hold any amount at all, so an AI model cannot make one up.
 *
 * :param words: Everything the visitor wrote lately.
 * :return: Whether a number, or "a strip", "daily" and the like, is in it.
 */
export function mentionsAmount(words) {
  const text = plain(words);
  return /\d/.test(text) || new RegExp(`\\ban? ${PACK}\\b|\\bdaily\\b|\\b(?:od|bd|bid|tds|tid|qid)\\b`).test(text);
}

/**
 * Where to get an amount: one shop with all of it, else the fewest shops together.
 *
 * :param need: How many.
 * :param offers: [{shopId, name, distanceMeters, canGive}].
 * :return: {ok: true, stops: [{shopId, name, take}], missing, summary}.
 */
export function splitAmount(need, offers) {
  const shops = offers.filter((offer) => offer.canGive > 0);
  const far = (list) => list.reduce((sum, shop) => sum + (shop.distanceMeters ?? 0), 0);
  let best = null;
  for (let mask = 1; mask < 1 << shops.length; mask += 1) {
    const chosen = shops.filter((_, index) => mask & (1 << index));
    const got = Math.min(need, chosen.reduce((sum, shop) => sum + shop.canGive, 0));
    if (!best || got > best.got || (got === best.got && (chosen.length < best.chosen.length
      || (chosen.length === best.chosen.length && far(chosen) < far(best.chosen))))) {
      best = { chosen, got };
    }
  }
  if (!best) {
    return { ok: true, stops: [], missing: need, summary: "No shop asked has any." };
  }
  let left = need;
  const stops = [...best.chosen]
    .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity))
    .map((shop) => {
      const taken = Math.min(left, shop.canGive);
      left -= taken;
      return { shopId: shop.shopId, name: shop.name, take: taken };
    })
    .filter((stop) => stop.take > 0);
  const parts = stops.map((stop) => `${stop.take} from ${stop.name}`).join(" + ");
  return { ok: true, stops, missing: left, summary: `${parts} = ${need - left} of ${need}.${left ? ` ${left} not found.` : ""}` };
}
