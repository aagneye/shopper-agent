// Mounts the shop's assistant inside its page. index.html loads it with:
//   <script type="module" src="site.js"></script>
// Adapted from the agentify-website template (vendor/agentify-website/templates/site.js).
import shop from "./shop.json" with { type: "json" };

/**
 * Boots the browser runtime in the page's assistant section.
 *
 * The shop has no irreversible action of its own: a hold is confirmed in the shop's own
 * form. So DIALOGS is empty and any confirmation goes to the runtime's dialog.
 */
export class AssistantMount {
  /** The first chat message once the visitor has a key. */
  static GREETING = `Ask me what ${shop.name} has in stock. I check the live shelf, and I can hold an item for you to pick up.`;

  /** This page's own confirmation dialogs, by irreversible action. None. */
  static DIALOGS = {};

  /**
   * Boot the runtime and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
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
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "The assistant needs an AI provider. Add one in AI model settings below."
        : "Assistant connected to the shop's live stock.";
      if (!needsKey) {
        const first = document.querySelector("#ns-msgs .ns-msg.bot");
        if (first) {
          first.textContent = AssistantMount.GREETING;
        }
      }
      return booted.engine;
    } catch (error) {
      status.textContent = "The assistant could not load. You can still search the shop's stock above.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }

  /**
   * Every confirmation goes to the runtime's dialog, which names the origin that runs it.
   *
   * :param items: The actions waiting for confirmation.
   * :return: True when the visitor confirms.
   */
  static async review(items) {
    const confirmed = await AssistantMount.defaultReview(items);
    AssistantMount.keepFocusInChat();
    return confirmed;
  }

  /**
   * Ask the visitor, with the runtime's consent card, before contacting a partner shop.
   * Focus the card while it waits, then put focus back in the chat.
   *
   * :param info: What the card shows.
   * :return: The card's answer: "allow", "always" or "decline".
   */
  static async consent(info) {
    const answer = AssistantMount.defaultConsent(info);
    AssistantMount.focusConsentCard();
    const decision = await answer;
    AssistantMount.keepFocusInChat();
    return decision;
  }

  /**
   * Name the newest consent card for screen readers, and focus its title unless the
   * visitor is typing in the page's own form.
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
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest("#agent-app")) {
      return;
    }
    title.tabIndex = -1;
    title.focus();
  }

  /**
   * Put focus back in the chat input when it fell to the page body.
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
