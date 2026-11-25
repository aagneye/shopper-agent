// The "What do you need?" form: turns the shopper's words into one clear request for
// their agent, and offers a few examples to try. The visitor sees the request in the chat as
// their own message, so it holds only what they need. How to ask shops is in the network.

export const CHIPS = {
  "chip-syrup": { need: "Children's paracetamol syrup", amount: "1 bottle", category: "pharmacy" },
  "chip-ors": { need: "ORS sachets", amount: "5 sachets", category: "pharmacy" },
  "chip-clutch": { need: "Clutch cable for my scooter", category: "auto_parts" },
};

/**
 * Write the request the agent receives for a checked prescription list.
 *
 * :param items: [{name, qty}].
 * :param openNow: Whether to ask only open shops.
 * :return: The request.
 */
export function composeListRequest(items, openNow) {
  const list = items.map(({ name, qty }) => `${name}${qty ? ` × ${qty}` : ""}`).join("; ");
  return `I need these medicines: ${list}.${openNow ? "" : " Include closed shops."}`;
}

/**
 * Write the request the agent receives when the shopper presses "Ask around".
 *
 * :param form: {need, category, openNow, amount, written}, where category is "pharmacy" or
 *   "auto_parts", amount is a parseAmount() result and written is the amount as typed apart.
 * :return: The item, how much of it, and whether to include closed shops.
 */
export function composeRequest({ need, category, openNow, amount = null, written = "" }) {
  const item = String(need ?? "").trim().replace(/\s+/g, " ");
  const kind = category === "auto_parts" ? "Vehicle part" : "Medicine";
  const closed = openNow ? "" : " Include closed shops.";
  if (amount?.ok) {
    const count = `${amount.label}${amount.how ? ` (${amount.how})` : ""}`;
    return `Medicine: ${item}. I need ${written ? `${written}: ` : ""}${count}.${closed}`;
  }
  return `${kind}: ${item}.${closed}`;
}
