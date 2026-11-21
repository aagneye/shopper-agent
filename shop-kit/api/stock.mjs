// A shop's stock, read from its billing software's export, and the search its agent uses.
// No Node built-ins, so the same code can run in a serverless function later.

const COLUMNS = {
  pharmacy: ["code", "name", "composition", "strength", "pack", "schedule", "mrp", "qty"],
  auto_parts: ["part_no", "name", "fits", "type", "mrp", "qty"],
};
const SCHEDULES = ["OTC", "H", "H1", "X"];
const PART_TYPES = ["genuine", "compatible"];
const MOST_MATCHES = 5;
const STOP_WORDS = new Set([
  "a", "an", "and", "any", "available", "do", "for", "get", "have", "i", "in", "is", "it",
  "me", "my", "need", "of", "please", "some", "stock", "the", "there", "to", "want", "with", "you",
]);
// Words shoppers use, and the words billing exports use for the same thing.
const SYNONYMS = {
  syrup: ["suspension", "syrup"],
  suspension: ["syrup", "suspension"],
  kid: ["paediatric", "pediatric"],
  child: ["paediatric", "pediatric"],
  children: ["paediatric", "pediatric"],
  baby: ["paediatric", "pediatric"],
  pediatric: ["paediatric", "pediatric"],
  tab: ["tablet"],
  cap: ["capsule"],
  acetaminophen: ["paracetamol"],
};

/**
 * Split one CSV line into fields, honouring double quotes.
 *
 * :param line: One line of the export.
 * :return: The fields, trimmed.
 */
function csvFields(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === "\"" && line[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field.trim());
  return fields;
}

/**
 * Normalize text into search words: lower case, letters and digits, singular.
 *
 * :param text: Any text.
 * :return: The words.
 */
export function words(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

/**
 * Read a billing export.
 *
 * :param text: The CSV text.
 * :param kind: "pharmacy" or "auto_parts".
 * :return: {ok: true, items} or {ok: false, reason}.
 */
export function parseBillingCsv(text, kind) {
  const columns = COLUMNS[kind];
  if (!columns) {
    return { ok: false, reason: `Unknown shop kind "${kind}".` };
  }
  const lines = String(text ?? "").split(/\r?\n/);
  const header = csvFields(lines[0] || "").map((name) => name.toLowerCase());
  if (header.join(",") !== columns.join(",")) {
    return { ok: false, reason: `The header must be: ${columns.join(",")}` };
  }
  const items = [];
  const seen = new Set();
  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].trim()) {
      continue;
    }
    const lineNumber = index + 1;
    const fields = csvFields(lines[index]);
    if (fields.length !== columns.length) {
      return { ok: false, reason: `Line ${lineNumber}: expected ${columns.length} fields, found ${fields.length}.` };
    }
    const row = Object.fromEntries(columns.map((name, column) => [name, fields[column]]));
    const qty = Number(row.qty);
    const mrp = Number(row.mrp);
    if (!/^\d+$/.test(row.qty) || !Number.isInteger(qty)) {
      return { ok: false, reason: `Line ${lineNumber}: qty must be a whole number of 0 or more.` };
    }
    if (row.mrp === "" || !Number.isFinite(mrp) || mrp < 0) {
      return { ok: false, reason: `Line ${lineNumber}: mrp must be a price of 0 or more.` };
    }
    const item = kind === "pharmacy" ? pharmacyItem(row) : partItem(row);
    if (!item.id || !item.name) {
      return { ok: false, reason: `Line ${lineNumber}: every item needs an id and a name.` };
    }
    if (item.problem) {
      return { ok: false, reason: `Line ${lineNumber}: ${item.problem}` };
    }
    if (seen.has(item.id.toLowerCase())) {
      return { ok: false, reason: `Line ${lineNumber}: duplicate item "${item.id}".` };
    }
    seen.add(item.id.toLowerCase());
    items.push({ ...item, mrp, qty });
  }
  return { ok: true, items };
}

/**
 * Build a pharmacy item from a row.
 *
 * :param row: The row's fields by column name.
 * :return: The item, with problem set when a field is invalid.
 */
function pharmacyItem(row) {
  const schedule = row.schedule.toUpperCase();
  const item = {
    id: row.code,
    name: row.name,
    composition: row.composition,
    strength: row.strength,
    pack: row.pack,
    schedule,
    detail: [row.strength, row.pack].filter(Boolean).join(" · "),
    searchWords: words([row.code, row.name, row.composition, row.strength, row.pack].join(" ")),
    yearRanges: [],
  };
  if (!SCHEDULES.includes(schedule)) {
    item.problem = `schedule must be one of ${SCHEDULES.join(", ")}.`;
  }
  return item;
}

/**
 * Build a vehicle part from a row.
 *
 * :param row: The row's fields by column name.
 * :return: The item, with problem set when a field is invalid.
 */
function partItem(row) {
  const type = row.type.toLowerCase();
  const yearRanges = [...row.fits.matchAll(/(\d{4})\s*-\s*(\d{4})/g)].map((match) => [Number(match[1]), Number(match[2])]);
  const item = {
    id: row.part_no,
    name: row.name,
    fits: row.fits,
    type,
    detail: `${row.part_no} · ${type} · fits ${row.fits}`,
    searchWords: words([row.part_no, row.name, row.fits, type].join(" ")),
    yearRanges,
  };
  if (!PART_TYPES.includes(type)) {
    item.problem = `type must be genuine or compatible.`;
  }
  return item;
}

/**
 * The stock band shoppers see instead of an exact count.
 *
 * :param available: Units on the shelf that are not held.
 * :return: "out_of_stock" for 0, "limited" for 1 to 3, otherwise "in_stock".
 */
export function band(available) {
  if (available <= 0) {
    return "out_of_stock";
  }
  return available <= 3 ? "limited" : "in_stock";
}

/**
 * Whether an item can be held for pickup.
 *
 * :param item: The item (pharmacy items have a schedule).
 * :param available: Units that are not held.
 * :return: "no" when none are left or it is Schedule X, "prescription" for Schedule H
 *   and H1 (checked at the counter), otherwise "yes".
 */
export function holdKind(item, available) {
  if (available <= 0 || item.schedule === "X") {
    return "no";
  }
  return item.schedule === "H" || item.schedule === "H1" ? "prescription" : "yes";
}

/**
 * Format a price in rupees, with Indian digit grouping.
 *
 * :param amount: The amount.
 * :return: Such as "₹38", "₹38.50" or "₹1,450".
 */
export function formatRupees(amount) {
  const options = Number.isInteger(amount) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return `₹${amount.toLocaleString("en-IN", options)}`;
}

/**
 * True when one query word matches an item.
 *
 * :param token: A significant query word.
 * :param item: The item.
 * :return: Whether a word of the item starts with it or a synonym, or a 4-digit year
 *   falls inside one of the item's fitment ranges.
 */
function tokenMatches(token, item) {
  if (/^\d{4}$/.test(token)) {
    const year = Number(token);
    if (item.yearRanges.some(([from, to]) => year >= from && year <= to)) {
      return true;
    }
  }
  const forms = [token, ...(SYNONYMS[token] || [])];
  return item.searchWords.some((word) => forms.some((form) => word.startsWith(form)));
}

/**
 * Find the items a shopper's words mean, best first.
 *
 * :param items: The shop's items.
 * :param query: The shopper's words, or a part number or item code.
 * :return: {ok: true, matches: [{item, score, match}]} with at most 5 matches scoring
 *   0.5 or more, or {ok: false, reason} when the query has no meaningful words.
 */
export function searchStock(items, query) {
  const text = String(query ?? "").trim();
  const exact = items.find((item) => item.id.toLowerCase() === text.toLowerCase());
  if (exact) {
    return { ok: true, matches: [{ item: exact, score: 1, match: "full" }] };
  }
  const significant = [...new Set(words(text).filter((word) => !STOP_WORDS.has(word)))];
  if (significant.length === 0) {
    return { ok: false, reason: "Say which item you need." };
  }
  const matches = items
    .map((item) => {
      const score = significant.filter((token) => tokenMatches(token, item)).length / significant.length;
      return { item, score, match: score === 1 ? "full" : "partial" };
    })
    .filter((entry) => entry.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || a.item.id.localeCompare(b.item.id))
    .slice(0, MOST_MATCHES);
  return { ok: true, matches };
}
