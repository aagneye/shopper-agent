// Registers the shop's website tools with the agent runtime, on the shop's own page.
// agent-manifest.json loads this module through "actions.module". The action bridge
// (bridge/bridge-actions.js) shares the same tools with other agent sites.
import { App } from "./js/app.js";
import { HOLD_TOOL, INFO_TOOL, STOCK_TOOL } from "./js/tool-defs.js";

/**
 * Register the page's tools: two reads, and the hold, which opens the shop's form.
 *
 * :param actions: The runtime registry facade with a register(definition) method.
 */
export function registerActions(actions) {
  actions.register({ ...STOCK_TOOL, effect: "read", execute: (args) => App.page.checkStock(args) });
  actions.register({ ...INFO_TOOL, effect: "read", execute: () => App.page.getShopInfo() });
  // A write: nothing is held until the visitor confirms in the shop's own form.
  actions.register({ ...HOLD_TOOL, effect: "write", execute: (args) => App.page.requestHold(args) });
}
