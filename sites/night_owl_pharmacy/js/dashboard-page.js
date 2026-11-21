// The shopkeeper's dashboard: holds to set aside, missed demand and low stock.
import { shopApi } from "./api-client.js";
import { el } from "./render.js";

/**
 * The dashboard page.
 */
export class DashboardPage {
  /**
   * :param options: {document, api}.
   */
  constructor({ document, api }) {
    this.doc = document;
    this.api = api;
    this.el = {};
  }

  /**
   * Find the page's elements, connect the reset button and load the lists.
   *
   * :return: A promise that settles when the lists are shown.
   */
  mount() {
    for (const id of ["dash-holds", "dash-holds-empty", "dash-missed", "dash-missed-empty", "dash-low", "dash-low-empty", "dash-reset", "dash-status"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["dash-reset"].addEventListener("click", () => this.reset());
    return this.refresh();
  }

  /**
   * Load and draw the three lists.
   *
   * :return: A promise that settles when they are drawn.
   */
  async refresh() {
    let holds;
    let missed;
    let stock;
    try {
      [holds, missed, stock] = await Promise.all([this.api.holds(), this.api.missed(), this.api.stockAll()]);
    } catch {
      this.el["dash-status"].textContent = "The stock service did not answer.";
      return;
    }
    this.list("dash-holds", holds.holds, (hold) => {
      const parts = [
        el(this.doc, "strong", "", hold.code),
        el(this.doc, "span", "", ` ${hold.qty} × ${hold.item}`),
        el(this.doc, "span", "cell-detail", `${hold.name} · ${hold.phone} · until ${hold.until} · ${hold.status}`),
      ];
      if (hold.status === "held") {
        const actions = el(this.doc, "span", "dash-actions");
        actions.append(
          this.button("Collected", "primary", () => this.collect(hold.code)),
          this.button("Release", "secondary", () => this.release(hold.code)),
        );
        parts.push(actions);
      }
      return parts;
    });
    this.list("dash-missed", missed.missed, (entry) => [
      el(this.doc, "strong", "", entry.query),
      el(this.doc, "span", "cell-detail", `asked ${entry.count} time${entry.count === 1 ? "" : "s"} · ${entry.reason} · last at ${entry.last}`),
    ]);
    const low = stock.items.filter((item) => item.available <= 3);
    this.list("dash-low", low, (item) => [
      el(this.doc, "strong", "", item.name),
      el(this.doc, "span", "cell-detail", `${item.detail} · ${item.available} free · ${item.held} held`),
    ]);
  }

  /**
   * Draw one list, or its empty note.
   *
   * :param id: The list's id; its empty note is "<id>-empty".
   * :param entries: The entries.
   * :param parts: Makes an entry's child nodes.
   */
  list(id, entries, parts) {
    this.el[`${id}-empty`].hidden = entries.length > 0;
    this.el[id].replaceChildren(...entries.map((entry) => {
      const item = el(this.doc, "li", "");
      item.append(...parts(entry));
      return item;
    }));
  }

  /**
   * A small button for a hold's row.
   *
   * :param label: The button's text.
   * :param className: "primary" or "secondary".
   * :param onClick: Called on click.
   * :return: The button.
   */
  button(label, className, onClick) {
    const button = el(this.doc, "button", `${className} small-button`, label);
    button.setAttribute("type", "button");
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * The shopper picked the hold up and paid: bill its units and end the hold.
   *
   * :param code: The hold code.
   * :return: A promise that settles when the lists are redrawn.
   */
  collect(code) {
    return this.endHold(() => this.api.collectHold(code));
  }

  /**
   * The shopper will not come: put the held units back on the shelf.
   *
   * :param code: The hold code.
   * :return: A promise that settles when the lists are redrawn.
   */
  release(code) {
    return this.endHold(() => this.api.releaseHold(code));
  }

  /**
   * End a hold, say how it went and redraw the lists.
   *
   * :param call: Makes the API call.
   * :return: A promise that settles when the lists are redrawn.
   */
  async endHold(call) {
    let answer;
    try {
      answer = await call();
    } catch {
      this.el["dash-status"].textContent = "The stock service did not answer. Try again.";
      return;
    }
    this.el["dash-status"].textContent = answer.ok ? answer.summary : answer.reason;
    await this.refresh();
  }

  /**
   * Put the demo stock back to the billing export.
   *
   * :return: A promise that settles when the lists are redrawn.
   */
  async reset() {
    const answer = await this.api.reset();
    this.el["dash-status"].textContent = answer.ok ? "Demo stock is back to the billing export." : answer.reason;
    await this.refresh();
  }
}

if (typeof window !== "undefined") {
  const page = new DashboardPage({ document, api: shopApi });
  page.mount();
  setInterval(() => page.refresh(), 10000);
}
