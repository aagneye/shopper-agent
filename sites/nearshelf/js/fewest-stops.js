// "Whole list, fewest stops": given which shops have which items, find the fewest shops
// to visit. With at most 6 shops there are at most 63 combinations, so every combination
// is checked and the answer is exact.

/**
 * Normalize an item name for matching: trimmed, single-spaced, lower case.
 *
 * :param text: An item name.
 * :return: The matching key.
 */
function itemKey(text) {
  return String(text).trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * True when candidate a is a better plan than b.
 *
 * :param a: {coveredCount, size, distance, ids}.
 * :param b: The same shape.
 * :return: More items covered, then fewer stops, then less total distance, then ids.
 */
function isBetter(a, b) {
  if (a.coveredCount !== b.coveredCount) {
    return a.coveredCount > b.coveredCount;
  }
  if (a.size !== b.size) {
    return a.size < b.size;
  }
  if (a.distance !== b.distance) {
    return a.distance < b.distance;
  }
  return a.ids < b.ids;
}

/**
 * Plan the fewest stops that cover a list.
 *
 * :param items: The shopper's items, in their order.
 * :param offers: For each shop that answered, {shopId, name, distanceMeters, has}, where
 *   has lists the items it has, using the list's names (case and spacing may differ).
 * :return: {ok: true, stops: [{shopId, name, items}], covered, missing, summary}, or
 *   {ok: false, reason} when an offer names an item that is not on the list.
 */
export function planFewestStops(items, offers) {
  const byKey = new Map(items.map((item) => [itemKey(item), item]));
  const shops = [];
  for (const offer of offers) {
    const has = new Set();
    for (const entry of offer.has) {
      const item = byKey.get(itemKey(entry));
      if (item === undefined) {
        return { ok: false, reason: `"${entry}" is not one of the items.` };
      }
      has.add(item);
    }
    if (has.size) {
      shops.push({ ...offer, has });
    }
  }
  let best = null;
  for (let mask = 1; mask < 1 << shops.length; mask += 1) {
    const chosen = shops.filter((_, index) => mask & (1 << index));
    const covered = new Set();
    for (const shop of chosen) {
      for (const item of shop.has) {
        covered.add(item);
      }
    }
    const candidate = {
      chosen,
      coveredCount: covered.size,
      size: chosen.length,
      distance: chosen.reduce((sum, shop) => sum + (shop.distanceMeters ?? 0), 0),
      ids: chosen.map((shop) => shop.shopId).sort().join(","),
    };
    if (best === null || isBetter(candidate, best)) {
      best = candidate;
    }
  }
  if (best === null) {
    return { ok: true, stops: [], covered: [], missing: [...items], summary: `No shop has any of the ${items.length} items.` };
  }
  const nearestFirst = [...best.chosen].sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.shopId.localeCompare(b.shopId));
  const stops = nearestFirst.map((shop) => ({ shopId: shop.shopId, name: shop.name, items: [] }));
  const covered = [];
  const missing = [];
  for (const item of items) {
    const index = nearestFirst.findIndex((shop) => shop.has.has(item));
    if (index === -1) {
      missing.push(item);
    } else {
      stops[index].items.push(item);
      covered.push(item);
    }
  }
  const kept = stops.filter((stop) => stop.items.length);
  const count = kept.length;
  const verb = count === 1 ? "stop covers" : "stops cover";
  const reach = covered.length === items.length ? `all ${items.length} items` : `${covered.length} of ${items.length} items`;
  return { ok: true, stops: kept, covered, missing, summary: `${count} ${verb} ${reach}.` };
}
