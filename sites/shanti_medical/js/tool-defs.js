// The shop's website tools, shared by the page (site-actions.js) and the action bridge
// (bridge/bridge-actions.js), so both give the agent the same names, rules and inputs.
import catalog from "../catalog.json" with { type: "json" };

export const STOCK_TOOL = {
  name: "check_stock",
  description: "Check what this shop has in stock right now, from its live billing stock. Pass only the item (name, strength, form) or part numbers, one call per item. Returns the best matches with availability (in_stock, limited or out_of_stock), price, hold (yes, no or prescription) and asOf, the time the stock was read. Call it for every stock question, and again in each turn that needs it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 80, description: "Only the item, such as \"paracetamol syrup 120 mg\", or part numbers." },
      amount: { type: "integer", minimum: 1, maximum: 500, description: "How many are needed, when the visitor says. Each match then has supply.text: how much of it this shop can give, and the cost." },
      unit: { type: "string", enum: ["tablets", "packs"], description: "tablets counts tablets or capsules; packs counts strips, bottles, sachets or pieces. Default tablets." },
    },
  },
};

export const INFO_TOOL = {
  name: "get_shop_info",
  description: "Read this shop's facts: address, whether it is open now and until when, today's hours, licence check, hold rules, its website link and its partner shops with their links. Call it for questions about the shop, and for a link to give.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export const HOLD_TOOL = {
  name: "request_hold",
  description: "Hold an item for pickup at this shop. Call it only when the visitor asks for a hold, with an id from website_check_stock. A form opens on the shop's own page or window where the visitor types their own name and phone and chooses a pickup time, so never ask for these. It returns when they confirm or cancel: the hold code and until when, or ok false with the reason.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemId", "qty"],
    properties: {
      itemId: { type: "string", enum: catalog.map((item) => item.id), description: "The item's id from website_check_stock." },
      qty: { type: "integer", minimum: 1, maximum: 5, description: "How many to hold." },
      more: {
        type: "array",
        maxItems: 7,
        description: "Further items for the same hold, so the visitor gets one form and one code.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["itemId", "qty"],
          properties: {
            itemId: { type: "string", enum: catalog.map((item) => item.id), description: "The item's id." },
            qty: { type: "integer", minimum: 1, maximum: 5, description: "How many." },
          },
        },
      },
    },
  },
};
