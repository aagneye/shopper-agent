// The look-up this catalogue shares with every agent site, through its action bridge.
// Part numbers and fitment are public facts, so any site may ask ("*").
import { lookupPart } from "../js/catalogue.js";
import { LOOKUP_TOOL } from "../js/tool-defs.js";

/**
 * Register the shared look-up, with the same name and input as the page's own.
 *
 * :param actions: The runtime registry facade with a register(definition) method.
 */
export function registerActions(actions) {
  actions.register({ ...LOOKUP_TOOL, effect: "read", availability: "bridge", callerOrigins: ["*"], execute: (args) => lookupPart(args) });
}
