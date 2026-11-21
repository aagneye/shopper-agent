// The shop's page object. The page's stock search and the agent's website tools call the
// same methods, so a visitor and the shop's assistant see the same live answers.
import { HoldForm } from "./hold-form.js";
import { el } from "./render.js";
import { shopInfo } from "./shop-info.js";

const LABELS = { in_stock: "In stock", limited: "Few left", out_of_stock: "Out of stock" };
const HOLD_LABELS = { yes: "Can be held", prescription: "Can be held with a prescription", no: "Cannot be held" };

/**
 * The shop's page: facts, stock search and holds.
 */
export class ShopPage {
  /**
   * :param options: {document, shop, catalog, api, clock}.
   */
  constructor({ document, shop, catalog, api, clock }) {
    this.doc = document;
    this.shop = shop;
    this.catalog = catalog;
    this.api = api;
    this.clock = clock;
    this.el = {};
  }

  /**
   * Find the page's elements, connect the stock search and draw the facts.
   */
  mount() {
    for (const id of ["shop-open", "shop-today", "stock-form", "stock-query", "stock-status", "stock-results"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["stock-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      return this.handleSearch();
    });
    this.refresh();
  }

  /**
   * The shop's facts now, for the page and the agent.
   *
   * :return: Plain JSON facts.
   */
  getShopInfo() {
    return shopInfo(this.shop, this.clock());
  }

  /**
   * Read live stock bands for a shopper's words. Changes nothing on the page.
   *
   * :param args: {query}.
   * :return: A promise of the stock answer, or {ok: false, reason}.
   */
  checkStock({ query }) {
    return this.api.stock(query);
  }

  /**
   * Hold an item. The shop first checks it would hold it, so a refusal comes before anyone
   * types their details; then its form opens in a dialog for the visitor's details.
   *
   * :param args: {itemId, qty}.
   * :return: A promise of {ok: true, code, until, ...} or {ok: false, reason}.
   */
  async requestHold({ itemId, qty }) {
    const item = this.catalog.find((entry) => entry.id === itemId);
    if (!item) {
      return this.holdOutcome({ ok: false, reason: "That item is not sold here." });
    }
    let check;
    try {
      check = await this.api.checkHold(item.id, qty);
    } catch {
      return this.holdOutcome({ ok: false, reason: "The shop's stock service did not answer, so nothing was held. Try again in a moment." });
    }
    if (!check.ok) {
      return this.holdOutcome({ ok: false, reason: check.reason });
    }
    const dialog = this.doc.createElement("dialog");
    dialog.className = "hold-dialog";
    dialog.setAttribute("aria-label", `Hold ${item.name}`);
    this.doc.body.append(dialog);
    const form = new HoldForm({ doc: this.doc, container: dialog, api: this.api, item, qty, intro: null, until: check.until });
    // Escape closes a dialog without its buttons: treat it as Cancel. While the hold is
    // being sent, the dialog stays open for the shop's answer.
    dialog.addEventListener("cancel", (event) => {
      if (form.pending) {
        event.preventDefault();
      } else {
        form.cancel();
      }
    });
    dialog.showModal();
    try {
      return this.holdOutcome(await form.result);
    } catch (error) {
      // The outcome is unknown: say so here, and fail so the assistant reports it as unknown.
      this.el["stock-status"].textContent = error.message;
      throw error;
    } finally {
      dialog.close();
      dialog.remove();
    }
  }

  /**
   * Show how a hold ended under the stock search, and pass the result on.
   *
   * :param result: {ok: true, code, until, ...} or {ok: false, reason}.
   * :return: The same result.
   */
  holdOutcome(result) {
    this.el["stock-status"].textContent = result.ok ? `Held: ${result.code} until ${result.until}. Show the code at the counter.` : result.reason;
    return result;
  }

  /**
   * The stock search form: check the shelf and show what was found.
   *
   * :return: A promise that settles when the results are shown.
   */
  async handleSearch() {
    const status = this.el["stock-status"];
    const query = this.el["stock-query"].value.trim();
    if (!query) {
      status.textContent = "Type an item or a part number.";
      return;
    }
    status.textContent = "Checking the shelf…";
    let answer;
    try {
      answer = await this.checkStock({ query });
    } catch {
      status.textContent = "The stock service did not answer. Try again in a moment.";
      return;
    }
    if (!answer.ok) {
      status.textContent = answer.reason;
      this.el["stock-results"].replaceChildren();
      return;
    }
    this.showResults(answer);
  }

  /**
   * Show a stock answer as cards, with a Hold button where an item can be held.
   *
   * :param answer: The stock answer.
   */
  showResults(answer) {
    this.el["stock-status"].textContent = answer.matches.length
      ? `Live stock as of ${answer.asOf}.`
      : `We don't stock "${answer.query}". Ask our assistant: it can ask our partner shop.`;
    const cards = answer.matches.map((match) => {
      const card = el(this.doc, "li", `stock-card availability-${match.availability}`);
      const head = el(this.doc, "div", "stock-head");
      head.append(el(this.doc, "span", "stock-name", match.name), el(this.doc, "span", `badge badge-${match.availability}`, LABELS[match.availability]));
      card.append(head, el(this.doc, "p", "stock-detail", `${match.detail} · ${match.price}`), el(this.doc, "p", "stock-hold", HOLD_LABELS[match.hold]));
      if (match.hold !== "no") {
        const hold = el(this.doc, "button", "secondary", "Hold 1");
        hold.setAttribute("type", "button");
        // An unknown outcome is already shown under the search, so there is nothing more to do.
        hold.addEventListener("click", () => this.requestHold({ itemId: match.id, qty: 1 }).catch(() => {}));
        card.append(hold);
      }
      return card;
    });
    this.el["stock-results"].replaceChildren(...cards);
  }

  /**
   * Redraw the facts that change with the clock.
   */
  refresh() {
    const info = this.getShopInfo();
    this.el["shop-open"].textContent = info.open;
    this.el["shop-today"].textContent = `Today: ${info.today}`;
  }

  /**
   * Called every half minute.
   */
  tick() {
    this.refresh();
  }
}
