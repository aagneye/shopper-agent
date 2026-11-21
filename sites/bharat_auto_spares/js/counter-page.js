// The demo billing counter: the stand-in for a shop's billing software. Every bill goes to
// the shop's stock API, so the shop's agent answers from the new stock at once.
import { shopApi } from "./api-client.js";
import { el } from "./render.js";

/**
 * The counter page.
 */
export class CounterPage {
  /**
   * :param options: {document, api}.
   */
  constructor({ document, api }) {
    this.doc = document;
    this.api = api;
    this.items = [];
    this.el = {};
  }

  /**
   * Find the page's elements, connect the filter and load the stock.
   *
   * :return: A promise that settles when the stock is shown.
   */
  mount() {
    for (const id of ["counter-filter", "counter-rows", "counter-status", "counter-asof"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["counter-filter"].addEventListener("input", () => this.render());
    return this.refresh();
  }

  /**
   * Load the stock and redraw the table.
   *
   * :return: A promise that settles when the table is drawn.
   */
  async refresh() {
    try {
      const data = await this.api.stockAll();
      this.items = data.items;
      this.el["counter-asof"].textContent = `Stock as of ${data.asOf}.`;
    } catch {
      this.el["counter-status"].textContent = "The stock service did not answer.";
    }
    this.render();
  }

  /**
   * Draw the rows that match the filter.
   */
  render() {
    const filter = String(this.el["counter-filter"].value || "").trim().toLowerCase();
    const rows = this.items
      .filter((item) => !filter || `${item.name} ${item.id} ${item.detail}`.toLowerCase().includes(filter))
      .map((item) => {
        const row = el(this.doc, "tr", item.available === 0 ? "row-empty" : "");
        const name = el(this.doc, "td", "");
        name.append(el(this.doc, "strong", "", item.name), el(this.doc, "span", "cell-detail", `${item.id} · ${item.detail}`));
        const bill = el(this.doc, "button", "primary small-button", "Bill 1");
        bill.setAttribute("type", "button");
        bill.setAttribute("aria-label", `Bill 1 ${item.name}`);
        bill.disabled = item.available === 0;
        bill.addEventListener("click", () => this.bill(item.id));
        const billCell = el(this.doc, "td", "");
        billCell.append(bill);
        row.append(name, el(this.doc, "td", "", item.price), el(this.doc, "td", "", String(item.qty)), el(this.doc, "td", "", String(item.held)), el(this.doc, "td", "", String(item.available)), billCell);
        return row;
      });
    this.el["counter-rows"].replaceChildren(...rows);
  }

  /**
   * Bill one unit, then reload the stock.
   *
   * :param itemId: The item to bill.
   * :return: A promise of the API's answer.
   */
  async bill(itemId) {
    const answer = await this.api.sale(itemId, 1);
    this.el["counter-status"].textContent = answer.ok
      ? `Billed 1 × ${answer.item.name}. ${answer.item.available} free on the shelf.`
      : answer.reason;
    await this.refresh();
    return answer;
  }
}

if (typeof window !== "undefined") {
  const page = new CounterPage({ document, api: shopApi });
  page.mount();
  setInterval(() => page.refresh(), 5000);
}
