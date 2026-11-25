// Mounts the NearShelf assistant inside the page. index.html loads it with:
//   <script type="module" src="site.js"></script>
// Adapted from the agentify-website template (vendor/agentify-website/templates/site.js).
import { App } from "./js/app.js";
import { ShopClock } from "./js/shop-clock.js";

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

  /** The shops asked in this turn, by trace span: {line, category}. */
  static checks = new Map();

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
      ShopClock.check = (ref, text) => App.page.checkRequest(AssistantMount.placeAt(new URL(ref).host), text);
      ShopClock.items = (ref) => (AssistantMount.placeAt(new URL(ref).host)?.category === "pharmacy" ? App.page.needs.length : 1);
      ShopClock.complete = (ref, action, args) => App.page.completeStock(AssistantMount.placeAt(new URL(ref).host), action, args);
      ShopClock.heard = (ref, action, args, result) => {
        const place = AssistantMount.placeAt(new URL(ref).host);
        App.page.heardStock(place, action, args, result);
        AssistantMount.note(App.page.heardHold(place, action, result));
      };
      ShopClock.answered = (ref, text) => App.page.withSupply(AssistantMount.placeAt(new URL(ref).host), text);
      ShopClock.install(booted.engine);
      AssistantMount.defaultReview = booted.engine.onActionConfirm;
      booted.engine.onActionConfirm = AssistantMount.review;
      AssistantMount.defaultConsent = booted.engine.onConsent;
      booted.engine.onConsent = AssistantMount.consent;
      booted.trace.addEventListener("event", (event) => AssistantMount.showChecking(event.detail));
      App.page.onAsk = AssistantMount.ask;
      App.page.engine = () => AssistantMount.engine;
      App.page.scan.showSetup();
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
   * Find the Neem Chowk place whose agent network is on a host.
   *
   * :param host: A host, such as "localhost:8081".
   * :return: The directory's place, or undefined.
   */
  static placeAt(host) {
    return App.page.directory.places.find((place) => place.agent && new URL(place.agent.network).host === host);
  }

  /**
   * Show which shop is being asked, in the chat, as it happens. This only reports: whether
   * the shop has the item is in the assistant's answer.
   *
   * :param event: A runtime trace event.
   */
  static showChecking(event) {
    if (event.kind === "run" && event.phase === "end") {
      // After the runtime has drawn the answer.
      setTimeout(() => AssistantMount.afterAnswer(), 600);
    }
    if (event.kind === "run" && event.phase === "start") {
      AssistantMount.checks = new Map();
      if (event.input) {
        App.page.noteSaid(event.input);
        App.page.heldNow = 0;
        App.page.needs = [];
        App.page.supplies = [];
      }
    }
    const place = event.kind === "remote_call" ? AssistantMount.placeAt(event.peerOrigin) : null;
    const box = document.querySelector("#ns-msgs");
    if (!place || !box) {
      return;
    }
    if (event.phase === "start") {
      const line = document.createElement("div");
      line.className = "ns-msg bot ns-checking";
      line.setAttribute("role", "status");
      const another = [...AssistantMount.checks.values()].some((check) => check.category === place.category);
      const kind = place.category === "pharmacy" ? "pharmacy" : "shop";
      line.textContent = another ? `Checking another ${kind}: ${place.name}…` : `Checking ${place.name}…`;
      AssistantMount.checks.set(event.id, { line, category: place.category });
      box.append(line);
      box.scrollTop = box.scrollHeight;
    } else if (event.phase === "end") {
      const check = AssistantMount.checks.get(event.id);
      if (check) {
        check.line.textContent = AssistantMount.checkResult(event, place);
      }
    }
  }

  /**
   * Add a line to the chat from the page itself, not from the AI.
   *
   * :param text: The line, or null for none.
   */
  static note(text) {
    const box = document.querySelector("#ns-msgs");
    if (!text || !box) {
      return;
    }
    const line = document.createElement("div");
    line.className = "ns-msg bot ns-checking";
    line.setAttribute("role", "status");
    line.textContent = text;
    box.append(line);
    box.scrollTop = box.scrollHeight;
  }

  /**
   * After an answer, warn when a hold did not happen, and offer the holds as buttons: after
   * stock answers, or when the visitor or the assistant talks about holding.
   */
  static afterAnswer() {
    AssistantMount.note(App.page.holdMissing());
    const fresh = App.page.supplies.length > 0;
    const last = [...document.querySelectorAll("#ns-msgs .ns-msg.bot:not(.ns-checking)")].at(-1)?.textContent ?? "";
    const talk = /\b(hold|reserve|phone)\b/i.test(`${App.page.said.at(-1) ?? ""} ${last}`);
    if (App.page.heldNow === 0 && (fresh || talk)) {
      AssistantMount.showHolds(App.page.holdOffers());
    }
  }

  /**
   * Show hold buttons in the chat. Each opens the shop's own form, without the AI model.
   *
   * :param offers: App.page.holdOffers().
   */
  static showHolds(offers) {
    const box = document.querySelector("#ns-msgs");
    if (!box || !offers.length) {
      return;
    }
    document.querySelector("#hold-offers")?.remove();
    const line = document.createElement("div");
    line.id = "hold-offers";
    line.className = "ns-msg bot ns-checking ns-holds";
    const text = document.createElement("p");
    text.textContent = "To hold, use these buttons. The shop's own window asks your name, phone and pickup time. Do not type them in this chat.";
    line.append(text);
    for (const offer of offers) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = offer.label;
      button.addEventListener("click", () => AssistantMount.hold(offer, button));
      line.append(button);
    }
    box.append(line);
    box.scrollTop = box.scrollHeight;
  }

  /**
   * Hold one offer with the shop's own tool. The chat then asks to open the shop's window.
   *
   * :param offer: One of the offers.
   * :param button: Its button.
   */
  static async hold(offer, button) {
    const entry = [...AssistantMount.engine.actions.entries.values()]
      .find((candidate) => candidate.name === "request_hold" && AssistantMount.placeAt(new URL(candidate.base).host)?.id === offer.shopId);
    if (!entry) {
      AssistantMount.note(`${offer.shop} is not connected now. Ask for the item again first.`);
      return;
    }
    button.disabled = true;
    const [first, ...more] = offer.lines.map(({ itemId, qty }) => ({ itemId, qty }));
    const [receipt] = await AssistantMount.engine.actions.execute(
      [{ entry, args: { ...first, ...(more.length ? { more } : {}) } }], async () => true, `hold-${Date.now()}`);
    document.querySelector("#ns-status")?.classList.remove("busy");
    const status = document.querySelector("#ns-status-text");
    if (status) {
      status.textContent = "Ready.";
    }
    if (receipt.status === "succeeded" && receipt.result?.ok) {
      AssistantMount.note(App.page.heardHold(App.page.place(offer.shopId), "request_hold", receipt.result));
      App.page.offers = App.page.offers.filter((other) => other !== offer);
      button.textContent = `Held: ${receipt.result.code}`;
      return;
    }
    button.disabled = false;
    AssistantMount.note(receipt.status === "succeeded"
      ? `Not held: ${receipt.result?.reason ?? "the shop refused."}`
      : `Not confirmed: ${receipt.error} If you pressed Hold it there, check with the shop.`);
  }

  /**
   * Say how asking a shop ended.
   *
   * :param event: The call's last trace event.
   * :param place: The shop.
   * :return: The chat line.
   */
  static checkResult(event, place) {
    if (event.status !== "error") {
      const given = App.page.supplies
        .filter((supply) => supply.shopId === place.id)
        .map((supply) => `${supply.canGive} of ${supply.need} ${supply.unit}`);
      return given.length ? `Checked ${place.name}: ${given.join(", ")}.` : `Checked ${place.name}.`;
    }
    return String(event.error || "").includes(ShopClock.TOO_SLOW)
      ? `${place.name} took too long to answer.`
      : `Could not check ${place.name}.`;
  }

  /**
   * Decide whether to contact another site. Asking NearShelf is the visitor's OK to ask the
   * shops in its directory, so those get no card. Anything else asks the visitor with the
   * runtime's consent card: focus the card while it waits, then put focus back in the chat.
   *
   * :param info: What the card shows, such as the shop's label and host and the request.
   * :return: The card's answer, unchanged: "allow", "always" or "decline".
   */
  static async consent(info) {
    if (info.kind === "network" && AssistantMount.placeAt(info.peerOrigin)) {
      return "allow";
    }
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
