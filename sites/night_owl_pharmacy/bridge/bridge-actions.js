// The tools this shop shares with other agent sites, through its action bridge. The build
// names this file in bridge/agent-manifest.json. When another site's assistant calls this
// shop, the bridge loads it in a hidden frame on this shop's origin, which has no page.
//
// Reads (live stock and the shop's facts) are shared with every site: the shop's own page
// shows the same stock bands. The hold is shared only with NearShelf and the other Neem
// Chowk shops, and always runs in this shop's own window (hold-window.js).
import shop from "../shop.json" with { type: "json" };
import { shopApi } from "../js/api-client.js";
import { shopInfo } from "../js/shop-info.js";
import { INFO_TOOL, STOCK_TOOL } from "../js/tool-defs.js";
import { HoldWindow } from "./hold-window.js";

/**
 * Register the shared tools, with the same names and inputs as the page's own.
 *
 * :param actions: The runtime registry facade with a register(definition) method.
 */
export function registerActions(actions) {
  actions.register({ ...STOCK_TOOL, effect: "read", availability: "bridge", callerOrigins: ["*"], execute: (args) => shopApi.stock(args.query) });
  actions.register({ ...INFO_TOOL, effect: "read", availability: "bridge", callerOrigins: ["*"], execute: () => shopInfo(shop, new Date()) });
  actions.register(HoldWindow.definition());
}
