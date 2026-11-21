// The shop's website tools, shared by the page (site-actions.js) and the action bridge
// (bridge/bridge-actions.js), so both give the agent the same names, rules and inputs.
import catalog from "../catalog.json" with { type: "json" };

export const STOCK_TOOL = {
  name: "check_stock",
  description: "Check what this shop has in stock right now, from its live billing stock. Pass the item as the visitor said it, or a part number. Returns the best matches with availability (in_stock, limited or out_of_stock), price, hold (yes, no or prescription) and asOf, the time the stock was read. Call it for every stock question, and again in each turn that needs it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 80, description: "The item as the visitor said it, or a part number." },
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
  description: "Hold an item for pickup at this shop. Call it only when the visitor asks for a hold, with an id from website_check_stock. A form opens on the shop's own page or window where the visitor types their own name and phone, so never ask for them. It returns when they confirm or cancel: the hold code and until when, or ok false with the reason.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemId", "qty"],
    properties: {
      itemId: { type: "string", enum: catalog.map((item) => item.id), description: "The item's id from website_check_stock." },
      qty: { type: "integer", minimum: 1, maximum: 5, description: "How many to hold." },
    },
  },
};
