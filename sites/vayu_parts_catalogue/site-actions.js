// Registers the catalogue's website tool with the agent runtime, on the catalogue's page.
import { lookupPart } from "./js/catalogue.js";
import { LOOKUP_TOOL } from "./js/tool-defs.js";

/**
 * Register lookup_part, a read that changes nothing.
 *
 * :param actions: The runtime registry facade with a register(definition) method.
 */
export function registerActions(actions) {
  actions.register({ ...LOOKUP_TOOL, effect: "read", execute: (args) => lookupPart(args) });
}
