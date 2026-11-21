// The shop's public facts, worked out from shop.json and the clock. The page and the
// action bridge both use it, so the agent gets the same facts on and off the site.
import { areaNow, formatMinutes, parseHHMM } from "./clock.js";
import { DAYS, openState } from "./directory.js";

/**
 * Today's opening hours in words.
 *
 * :param hours: The shop's hours.
 * :param now: An areaNow() result.
 * :return: Such as "9:00 am to 11:00 pm", "open 24 hours" or "closed today".
 */
export function todayHours(hours, now) {
  const ranges = hours[now.weekday] || [];
  if (DAYS.every((day) => (hours[day] || []).length === 1 && hours[day][0][0] === "00:00" && hours[day][0][1] === "24:00")) {
    return "open 24 hours";
  }
  if (ranges.length === 0) {
    return "closed today";
  }
  return ranges.map(([start, end]) => `${formatMinutes(parseHHMM(start))} to ${formatMinutes(parseHHMM(end))}`).join(", ");
}

/**
 * The facts a visitor, or another site's agent, may ask about.
 *
 * :param shop: The shop's public profile (shop.json).
 * :param date: The moment to describe.
 * :return: Plain JSON facts, with links.
 */
export function shopInfo(shop, date) {
  const now = areaNow(date, shop.timezone, null);
  return {
    name: shop.name,
    kind: shop.kindLabel,
    address: `${shop.address} (${shop.area})`,
    open: openState(shop.hours, now).label,
    today: todayHours(shop.hours, now),
    now: `${now.day} · ${now.time} IST`,
    verified: shop.verified ? `${shop.verified.ref}, checked by ${shop.verified.by}` : "not verified",
    page: shop.page,
    partners: shop.partners.map((partner) => ({ name: partner.name, page: partner.page })),
    holds: "Held until closing time, or for 2 hours at a 24-hour shop. Paid for and picked up at the counter.",
    ...(shop.kind === "pharmacy"
      ? { prescriptions: "Prescription medicines can be held; the pharmacist checks the prescription at the counter. Schedule X medicines are not held." }
      : {}),
  };
}
