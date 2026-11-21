// Registers NearShelf's website tools with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Each name in
// "actions.agentTools" becomes a model tool called website_<name>.
//
// Every action wraps a method of the page object, App.page, so the agent and the page's
// own forms follow one set of rules. Import the page script by the same URL index.html
// loads it from, or the actions would get a second, separate page.
import { App } from "./js/app.js";
import { AVAILABILITY } from "./js/shopper-page.js";

/**
 * Describes the page's operations as actions the agents can call.
 */
class SiteActions {
  /**
   * Register every website tool with the runtime.
   *
   * :param actions: The runtime registry facade with a register(definition) method.
   */
  static registerActions(actions) {
    actions.register(SiteActions.getShopperState());
    actions.register(SiteActions.findShops());
    actions.register(SiteActions.planFewestStops());
    actions.register(SiteActions.showResults());
    actions.register(SiteActions.saveHold());
  }

  /**
   * Every place id in the Neem Chowk directory.
   *
   * :return: The ids, for schema enums.
   */
  static placeIds() {
    return App.page.directory.places.map((place) => place.id);
  }

  /**
   * The ids of places that sell and hold items: pharmacies and parts dealers.
   *
   * :return: The ids, for schema enums.
   */
  static shopIds() {
    return App.page.directory.places.filter((place) => place.category !== "parts_catalogue").map((place) => place.id);
  }

  /**
   * The read that gives the shopper's context.
   *
   * :return: The action definition.
   */
  static getShopperState() {
    return {
      name: "get_shopper_state",
      description: "Read the shopper's details saved on this device: Neem Chowk date and time (IST), their spot, saved vehicles, regular medicines, holds and the results board. Call it when you need the time, a vehicle, the list or a hold, and again in each turn that needs it.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    };
  }

  /**
   * The read that shortlists shops to ask.
   *
   * :return: The action definition.
   */
  static findShops() {
    return {
      name: "find_shops",
      description: "List the shops to ask about an item, from the Neem Chowk directory: up to 4 open, verified shops of one category, nearest first. askWith is the partner tool to call for each shop, and page is its website. notAsked says why other shops are left out. Call it before asking any shop, in each turn that asks shops. To ask more shops, call it again with exclude.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["category"],
        properties: {
          category: {
            type: "string",
            enum: ["pharmacy", "auto_parts", "parts_catalogue"],
            description: "pharmacy for medicines, auto_parts for vehicle parts, parts_catalogue for part numbers.",
          },
          openNow: { type: "boolean", description: "List only shops open now. Default true." },
          limit: { type: "integer", minimum: 1, maximum: 4, description: "How many shops to list. Default 4." },
          exclude: {
            type: "array",
            maxItems: 6,
            items: { type: "string", enum: SiteActions.placeIds() },
            description: "Ids of shops already asked about this item.",
          },
        },
      },
      execute: (args) => App.page.findShops(args),
    };
  }

  /**
   * The read that plans the fewest stops for a list.
   *
   * :return: The action definition.
   */
  static planFewestStops() {
    return {
      name: "plan_fewest_stops",
      description: "Work out the fewest shops to visit for a list of items, from the shops' answers. List every item once and, for each shop that answered, the items it has, using the same names. Returns which shop to visit for which item and what no shop has.",
      effect: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["items", "offers"],
        properties: {
          items: {
            type: "array",
            minItems: 2,
            maxItems: 8,
            items: { type: "string", minLength: 1, maxLength: 80 },
            description: "The shopper's items.",
          },
          offers: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            description: "One entry per shop that answered.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["shopId", "has"],
              properties: {
                shopId: { type: "string", enum: SiteActions.shopIds(), description: "The shop's id from website_find_shops." },
                has: {
                  type: "array",
                  maxItems: 8,
                  items: { type: "string", minLength: 1, maxLength: 80 },
                  description: "The items this shop said it has.",
                },
              },
            },
          },
        },
      },
      execute: (args) => App.page.planStops(args),
    };
  }

  /**
   * The write that fills the results board.
   *
   * :return: The action definition.
   */
  static showResults() {
    return {
      name: "show_results",
      description: "Show the shops' answers on the page's results board, replacing it. Call it only when the visitor asks about an item's stock, after you ask the shops: one row per shop you asked, from that shop's own reply. Use no_answer when a shop did not answer and declined when the visitor declined its card. Returns ok, or ok false with a reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["need", "rows"],
        properties: {
          need: { type: "string", minLength: 1, maxLength: 120, description: "What the visitor asked for." },
          rows: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["shopId", "availability"],
              properties: {
                shopId: { type: "string", enum: SiteActions.placeIds(), description: "The shop's id from website_find_shops." },
                availability: { type: "string", enum: AVAILABILITY, description: "From the shop's AVAILABILITY line, or no_answer or declined." },
                item: { type: "string", maxLength: 120, description: "The item the shop named, with strength and pack." },
                price: { type: "string", maxLength: 40, description: "The price the shop gave." },
                asOf: { type: "string", maxLength: 40, description: "When the shop's stock was checked, as it said." },
                note: { type: "string", maxLength: 160, description: "Anything else the shop said, such as a hold rule." },
              },
            },
          },
        },
      },
      execute: (args) => App.page.showResults(args),
    };
  }

  /**
   * The write that keeps a hold code.
   *
   * :return: The action definition.
   */
  static saveHold() {
    return {
      name: "save_hold",
      description: "Keep a shop's hold in My holds on this page. Call it only when the visitor asks for a hold and the shop's reply gives a hold code. Pass the code and time exactly as the shop gave them. It does not contact the shop.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["shopId", "item", "code"],
        properties: {
          shopId: { type: "string", enum: SiteActions.shopIds(), description: "The shop that holds the item." },
          item: { type: "string", minLength: 1, maxLength: 120, description: "The item held." },
          code: { type: "string", minLength: 1, maxLength: 40, description: "The hold code from the shop's reply." },
          until: { type: "string", maxLength: 60, description: "Until when the shop holds it." },
        },
      },
      execute: (args) => App.page.saveHold(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = SiteActions.registerActions;
