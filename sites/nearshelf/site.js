// Mounts the NearShelf assistant inside the page. index.html loads it with:
//   <script type="module" src="site.js"></script>
// Adapted from the agentify-website template (vendor/agentify-website/templates/site.js).
import { App } from "./js/app.js";

/**
 * Boots the browser runtime in the page's assistant section.
 *
 * It points the runtime at this folder, so the manifest, network and actions load from
 * the same place as the page. NearShelf has no irreversible action of its own: a hold is
 * confirmed in the shop's own window, so DIALOGS is empty and every confirmation goes to
 * the runtime's dialog, which names the shop's origin.
 */
export class AssistantMount {
  /**
   * The first chat message once the visitor has a key: what the assistant can do here.
   */
  static GREETING = "Tell me what you need, like a medicine or a vehicle part. I'll ask nearby shops that are open, compare their answers and help you hold it for pickup.";

  /**
   * This page's own confirmation dialogs, by irreversible action. NearShelf has none.
   */
  static DIALOGS = {};

  /**
   * Boot the runtime, report the result in the status line, and let the page's search
   * form hand requests to the chat.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      // Load the runtime here, so a missing or broken runtime is reported too.
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      AssistantMount.engine = booted.engine;
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      App.page.onAsk = AssistantMount.ask;
      const needsKey = AssistantMount.needsKey();
      status.textContent = needsKey
        ? "The assistant needs an AI provider. Add one in AI model settings below, then press Ask around again."
        : "Assistant connected. Ask for something above or in the chat.";
      if (!needsKey) {
        AssistantMount.greet();
      }
      return booted.engine;
    } catch (error) {
      // The page must keep working without the assistant.
      status.textContent = "The assistant could not load. You can still use the page directly.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * True when the chat cannot answer yet, because no AI provider key is set. This is the
   * same test as the runtime's "API key required" badge in runtime/ui.js.
   *
   * :return: Whether a key is still needed.
   */
  static needsKey() {
    const engine = AssistantMount.engine;
    return !engine || (!engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo"));
  }

  /**
   * Send a request to the chat as if the visitor typed it.
   *
   * :param text: The request from the page's search form.
   * :return: True when it was sent, false when the chat cannot take it yet.
   */
  static ask(text) {
    const input = document.querySelector("#ns-input");
    const send = document.querySelector("#ns-send");
    if (!input || !send || send.disabled || AssistantMount.needsKey()) {
      return false;
    }
    input.value = text;
    send.click();
    document.querySelector("#assistant").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }

  /**
   * Replace the runtime's general first chat message with GREETING.
   */
  static greet() {
    const first = document.querySelector("#ns-msgs .ns-msg.bot");
    if (first) {
      first.textContent = AssistantMount.GREETING;
    }
  }

  /**
   * Ask the visitor to confirm actions before they run. NearShelf has no dialog of its
   * own, so every confirmation, such as a shop's own action, gets the runtime's dialog,
   * which names the origin that will run it.
   *
   * :param items: The actions waiting for confirmation, each with action, origin, effect
   *   and arguments.
   * :return: True when the visitor confirms.
   */
  static async review(items) {
    const confirmed = await AssistantMount.defaultReview(items);
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /**
   * Ask the visitor, with the runtime's consent card, whether to contact a shop's site.
   * Focus the card while it waits, then put focus back in the chat.
   *
   * :param info: What the card shows, such as the shop's label and host and the request.
   * :return: The card's answer, unchanged: "allow", "always" or "decline".
   */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

  /**
   * Name the newest consent card after its title, for screen readers. Move focus to that
   * title when focus is in the chat or on the page body, not from the page's own form.
   */
  static focusConsentCard() {
    const cards = document.querySelectorAll("#ns-msgs .ns-consent");
    const card = cards[cards.length - 1];
    const title = card ? card.querySelector(".ns-consent-title") : null;
    if (!title) {
      return;
    }
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", title.textContent);
    // A visitor typing in the page's own form keeps focus, and their keystrokes.
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) {
      return;
    }
    // tabIndex -1 lets the title take focus. Enter cannot activate a title.
    title.tabIndex = -1;
    title.focus();
  }

  /**
   * Put focus back in the chat input when a dialog or the consent card left it on the
   * page body.
   */
  static keepFocusInChat() {
    if (document.activeElement === document.body || document.activeElement === null) {
      document.querySelector("#ns-input")?.focus();
    }
  }
}

// Boot only in a browser. Node tests import this file to check the mount.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
