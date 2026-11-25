// Neem Chowk time. Every "open now" decision uses the area's own time zone, never the
// time zone of the shopper's browser, so a visitor abroad sees the same answer as a
// shopper standing in Neem Chowk.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse "HH:MM" (00:00 to 24:00) into minutes after midnight.
 *
 * :param text: The time as two-digit hours and minutes.
 * :return: Minutes after midnight, or null when the text is not a valid time.
 */
export function parseHHMM(text) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(text ?? ""));
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) {
    return null;
  }
  return hours * 60 + minutes;
}

/**
 * Format minutes after midnight on a 12-hour clock, such as "10:45 pm".
 *
 * :param minutes: Minutes after midnight, 0 to 1440.
 * :return: The time as shoppers read it; 1440 is "midnight".
 */
export function formatMinutes(minutes) {
  if (minutes === 1440) {
    return "midnight";
  }
  const hours24 = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  const suffix = hours24 < 12 ? "am" : "pm";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(rest).padStart(2, "0")} ${suffix}`;
}

/**
 * Whether a clock time such as "11:00 pm" has passed. It is the first such time after it
 * was given, within a day.
 *
 * :param label: The time, as formatMinutes writes it.
 * :param givenIso: The moment it was given.
 * :param now: The real moment now.
 * :param timeZone: The area's time zone.
 * :return: True when it has passed, false when not or when the times cannot be read.
 */
export function timePassed(label, givenIso, now, timeZone) {
  const match = /^(\d{1,2}):(\d{2}) (am|pm)$/.exec(String(label ?? ""));
  const given = new Date(givenIso);
  if (!match || Number.isNaN(given.getTime())) {
    return false;
  }
  const at = (Number(match[1]) % 12) * 60 + Number(match[2]) + (match[3] === "pm" ? 720 : 0);
  const wait = (at - areaNow(given, timeZone).minutes + 1440) % 1440;
  return now.getTime() >= given.getTime() + wait * 60000;
}

/**
 * Read the date and time of day in an area's time zone.
 *
 * :param date: The real moment.
 * :param timeZone: The area's IANA time zone, such as "Asia/Kolkata".
 * :param demoTime: "HH:MM" to replace the time of day for a demo, or null for live time.
 * :return: {date, day, time, weekday, minutes, demoTime}, with date as "2026-11-20",
 *   day as "Fri, Nov 20, 2026", time as "10:45 pm" and weekday as "fri".
 */
export function areaNow(date, timeZone, demoTime = null) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const dayOfMonth = part("day");
  const weekday = part("weekday");
  // Some engines print midnight as "24" even with hourCycle h23.
  const hours = Number(part("hour")) % 24;
  let minutes = hours * 60 + Number(part("minute"));
  const demoMinutes = demoTime === null ? null : parseHHMM(demoTime);
  if (demoMinutes !== null && demoMinutes < 1440) {
    minutes = demoMinutes;
  }
  const monthNumber = String(MONTHS.indexOf(month) + 1).padStart(2, "0");
  return {
    date: `${year}-${monthNumber}-${dayOfMonth}`,
    day: `${weekday}, ${month} ${Number(dayOfMonth)}, ${year}`,
    time: formatMinutes(minutes),
    weekday: weekday.slice(0, 3).toLowerCase(),
    minutes,
    demoTime: demoMinutes === null || demoMinutes >= 1440 ? null : demoTime,
  };
}
