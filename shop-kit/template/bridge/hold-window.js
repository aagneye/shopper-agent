// The hold this shop shares with other agent sites. It runs in a window on this shop's
// origin, which the visitor sees: the shop's own form takes their name and phone, and the
// calling assistant gets back only the hold code and what is held.
import catalog from "../catalog.json" with { type: "json" };
import shop from "../shop.json" with { type: "json" };
import { shopApi } from "../js/api-client.js";
import { HoldForm } from "../js/hold-form.js";
import { HOLD_TOOL } from "../js/tool-defs.js";

/**
 * Shares request_hold, made in this shop's own window.
 */
export class HoldWindow {
  /**
   * Describe the shared hold.
   *
   * :return: The action definition.
   */
  static definition() {
    return {
      ...HOLD_TOOL,
      effect: "write",
      availability: "bridge",
      // Only NearShelf and the other Neem Chowk shops may ask. Never "*".
      callerOrigins: shop.holdCallers,
      // The shop's form shows the hold and asks the visitor to confirm or cancel.
      confirmsInWindow: true,
      execute: HoldWindow.start,
    };
  }

  /**
   * Check the request with the shop's live rules, then show the form in this window. A
   * refusal comes back before the form opens, so nobody types details for nothing.
   *
   * :param args: The validated request {itemId, qty}.
   * :param context: The bridge's call details, with the calling site's origin.
   * :return: A promise of the refusal, the hold, or the visitor's cancel.
   */
  static async start(args, context) {
    const item = catalog.find((entry) => entry.id === args.itemId);
    if (!item) {
      return { ok: false, reason: "That item is not sold here." };
    }
    let check;
    try {
      check = await shopApi.checkHold(item.id, args.qty);
    } catch {
      return { ok: false, reason: "The shop's stock service did not answer, so nothing was held." };
    }
    if (!check.ok) {
      return { ok: false, reason: check.reason };
    }
    document.title = `Hold at ${shop.name}`;
    const sheet = document.createElement("link");
    sheet.rel = "stylesheet";
    sheet.href = new URL("../styles.css", import.meta.url).href;
    document.head.append(sheet);
    const header = document.createElement("header");
    header.className = "window-head";
    header.textContent = shop.name;
    const main = document.createElement("main");
    main.className = "hold-window";
    document.body.append(header, main);
    const form = new HoldForm({
      doc: document,
      container: main,
      api: shopApi,
      item,
      qty: args.qty,
      until: check.until,
      intro: `The assistant on ${HoldWindow.hostOf(context?.callerOrigin)} asked ${shop.name} to hold this for you. Type your details here, not in the chat: its chat gets only the hold code.`,
    });
    return form.result;
  }

  /**
   * The calling site's host, for the form's text.
   *
   * :param origin: The caller's origin, if any.
   * :return: The host, or "another site".
   */
  static hostOf(origin) {
    try {
      return new URL(origin).host;
    } catch {
      return "another site";
    }
  }
}
