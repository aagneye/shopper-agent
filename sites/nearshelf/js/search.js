// The "What do you need?" form: turns the shopper's words into one clear request for
// their agent, and offers a few examples to try.

export const CHIPS = {
  "chip-syrup": { need: "Children's paracetamol syrup", category: "pharmacy" },
  "chip-ors": { need: "ORS sachets", category: "pharmacy" },
  "chip-clutch": { need: "Clutch cable for my scooter", category: "auto_parts" },
};

/**
 * Write the request the agent receives when the shopper presses "Ask around".
 *
 * :param form: {need, category, openNow}, where category is "pharmacy" or "auto_parts".
 * :return: One sentence naming the item, the kind of shop and whether to ask only open shops.
 */
export function composeRequest({ need, category, openNow }) {
  const item = String(need ?? "").trim().replace(/\s+/g, " ");
  const kind = category === "auto_parts"
    ? { label: "Vehicle part", shops: "parts dealers" }
    : { label: "Medicine", shops: "pharmacies" };
  const when = openNow ? " that are open now" : "";
  return `${kind.label}: ${item}. Ask ${kind.shops}${when} whether they have it, and compare their answers.`;
}
