// The demo billing counter: the stand-in for a shop's billing software. The shopkeeper adds
// items with a typed quantity, fixes or removes lines, then bills them together. The bill
// goes to the shop's stock API, so the shop's agent answers from the new stock at once.
import { shopApi } from "./api-client.js";
import { el } from "./render.js";

const MOST_PER_LINE = 50;

/**
 * Read a typed quantity.
 *
 * :param value: The input's text.
 * :return: A whole number of 1 or more, or null when it is not one.
 */
export function parseQty(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const qty = Number(text);
  return qty >= 1 ? qty : null;
}

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
    // The current bill: item id to quantity, in the order items were added.
    this.cart = new Map();
    // Quantities typed next to items but not added yet, so a refresh does not clear them.
    this.drafts = new Map();
    // True while the shopkeeper is typing in a quantity box, so a refresh does not redraw it.
    this.editing = false;
    this.busy = false;
    this.el = {};
  }

  /**
   * Find the page's elements, connect the controls and load the stock.
   *
   * :return: A promise that settles when the stock is shown.
   */
  mount() {
    for (const id of ["counter-filter", "counter-rows", "counter-status", "counter-asof", "counter-cart", "counter-empty", "counter-total", "counter-bill", "counter-clear"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["counter-filter"].addEventListener("input", () => this.renderItems());
    this.el["counter-bill"].addEventListener("click", () => this.checkout());
    this.el["counter-clear"].addEventListener("click", () => this.clear());
    return this.refresh();
  }

  /**
   * Load the stock and redraw.
   *
   * :return: A promise that settles when the page is drawn.
   */
  async refresh() {
    let changed = true;
    try {
      const data = await this.api.stockAll();
      const seen = JSON.stringify(data.items);
      changed = seen !== this.seen;
      this.seen = seen;
      this.items = data.items;
      this.el["counter-asof"].textContent = `Stock as of ${data.asOf}.`;
    } catch {
      this.say("The stock service did not answer.");
    }
    // Redraw only when the stock changed, so a timed refresh never swaps a button out
    // from under a click or a box out from under typing.
    if (changed && !this.editing) {
      this.render();
    }
  }

  /**
   * :param itemId: An item id.
   * :return: The item, or undefined.
   */
  item(itemId) {
    return this.items.find((entry) => entry.id === itemId);
  }

  /**
   * :param text: A message for the status line.
   */
  say(text) {
    this.el["counter-status"].textContent = text;
  }

  /**
   * Redraw the item list and the bill.
   */
  render() {
    this.renderItems();
    this.renderCart();
  }

  /**
   * A quantity box that tells the page while it is being typed in.
   *
   * :param label: Its accessible name.
   * :param value: Its starting text.
   * :param max: The most that can be entered.
   * :return: The input.
   */
  qtyInput(label, value, max) {
    // A text box with a number keypad, not type="number": no spinner arrows, no "e", and
    // the whole value is selected on focus, so typing 10 replaces the 1 instead of making 110.
    const input = el(this.doc, "input", "qty-input");
    input.setAttribute("type", "text");
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("maxlength", "3");
    input.setAttribute("aria-label", `${label}, up to ${Math.max(0, max)}`);
    input.value = String(value);
    input.addEventListener("focus", () => {
      this.editing = true;
      setTimeout(() => typeof input.select === "function" && input.select(), 0);
    });
    input.addEventListener("input", () => {
      // Keep digits only, so a stray letter never sits in the box.
      const digits = String(input.value).replace(/\D+/g, "");
      if (digits !== input.value) {
        input.value = digits;
      }
    });
    input.addEventListener("blur", (event) => {
      this.editing = false;
      // Focus went to a button, such as Add, + or ×: its own click redraws the page.
      // Redrawing now would swap the button out before the click lands.
      const next = event && event.relatedTarget;
      if (next && String(next.tagName).toUpperCase() === "BUTTON") {
        return;
      }
      // Otherwise redraw what was held back while typing, unless focus moved to another box.
      setTimeout(() => !this.editing && this.render(), 0);
    });
    return input;
  }

  /**
   * Mark a quantity box as wrong or right.
   *
   * :param input: The box.
   * :param wrong: True when its value cannot be used.
   */
  mark(input, wrong) {
    if (wrong) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  }

  /**
   * A − / + button beside a quantity box.
   *
   * :param text: "−" or "+".
   * :param label: Its accessible name.
   * :param onClick: What it does.
   * :return: The button.
   */
  stepButton(text, label, onClick) {
    const button = el(this.doc, "button", "step-button", text);
    button.setAttribute("type", "button");
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Draw the items that match the filter, each with a quantity box and an Add button.
   */
  renderItems() {
    const filter = String(this.el["counter-filter"].value || "").trim().toLowerCase();
    const rows = this.items
      .filter((item) => !filter || `${item.name} ${item.id} ${item.detail}`.toLowerCase().includes(filter))
      .map((item) => {
        const free = item.available - (this.cart.get(item.id) || 0);
        const row = el(this.doc, "li", free <= 0 ? "counter-line row-empty" : "counter-line");
        const name = el(this.doc, "div", "counter-name");
        const held = item.held > 0 ? ` · ${item.held} held` : "";
        name.append(el(this.doc, "strong", "", item.name), el(this.doc, "span", "cell-detail", `${item.id} · ${item.detail}`));
        const facts = el(this.doc, "div", "counter-facts", `${item.price} · ${Math.max(0, free)} free${held}`);
        const input = this.qtyInput(`Quantity of ${item.name}`, this.drafts.get(item.id) ?? "1", free);
        input.disabled = free <= 0;
        input.addEventListener("input", () => {
          this.drafts.set(item.id, input.value);
          const qty = parseQty(input.value);
          this.mark(input, input.value !== "" && (qty === null || qty > free));
        });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            this.add(item.id, input.value);
          }
        });
        const add = el(this.doc, "button", "primary small-button", "Add");
        add.setAttribute("type", "button");
        add.setAttribute("aria-label", `Add ${item.name} to the bill`);
        add.disabled = free <= 0;
        add.addEventListener("click", () => this.add(item.id, input.value));
        const controls = el(this.doc, "div", "counter-controls");
        controls.append(input, add);
        row.append(name, facts, controls);
        return row;
      });
    if (rows.length === 0) {
      rows.push(el(this.doc, "li", "muted", this.items.length ? "No item matches." : "No items."));
    }
    this.el["counter-rows"].replaceChildren(...rows);
  }

  /**
   * Draw the bill: each line with an editable quantity, its amount and a remove button.
   */
  renderCart() {
    const lines = [];
    for (const [itemId, qty] of this.cart) {
      const item = this.item(itemId);
      if (!item) {
        continue;
      }
      const amount = unitPrice(item) * qty;
      // Two rows, so a long name gets the full width of the narrow bill panel:
      //   name ............ ×
      //   ₹38 each   [− 1 +]   ₹38
      const line = el(this.doc, "li", qty > item.available ? "bill-line line-over" : "bill-line");
      const name = el(this.doc, "strong", "bill-name", item.name);
      const price = el(this.doc, "span", "bill-price cell-detail", `${item.price} each${qty > item.available ? ` · only ${Math.max(0, item.available)} free` : ""}`);
      const most = Math.min(item.available, MOST_PER_LINE);
      const input = this.qtyInput(`Quantity of ${item.name} on the bill`, qty, most);
      const amountEl = el(this.doc, "span", "counter-amount", rupees(amount));
      // While typing, the line amount and the total follow each keystroke without redrawing
      // the box. A wrong number gets a red outline and is put back when the box is left.
      input.addEventListener("input", () => {
        const typed = parseQty(input.value);
        const fits = typed !== null && typed <= most;
        this.mark(input, input.value !== "" && !fits);
        if (fits) {
          this.cart.set(itemId, typed);
          amountEl.textContent = rupees(unitPrice(item) * typed);
          this.renderTotal();
        }
      });
      input.addEventListener("blur", () => {
        if (input.value.trim() === "0") {
          this.remove(itemId);
          return;
        }
        input.value = String(this.cart.get(itemId) ?? "");
        this.mark(input, false);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.setQty(itemId, input.value);
        }
      });
      const minus = this.stepButton("−", `One less ${item.name}`, () => this.setQty(itemId, String((this.cart.get(itemId) || 1) - 1 || 1)));
      minus.disabled = qty <= 1;
      const plus = this.stepButton("+", `One more ${item.name}`, () => this.setQty(itemId, String((this.cart.get(itemId) || 0) + 1)));
      plus.disabled = qty >= most;
      const stepper = el(this.doc, "div", "stepper");
      stepper.append(minus, input, plus);
      const remove = el(this.doc, "button", "remove-button", "×");
      remove.setAttribute("type", "button");
      remove.setAttribute("aria-label", `Remove ${item.name} from the bill`);
      remove.addEventListener("click", () => this.remove(itemId));
      line.append(name, remove, price, stepper, amountEl);
      lines.push(line);
    }
    this.el["counter-cart"].replaceChildren(...lines);
    this.el["counter-empty"].hidden = lines.length > 0;
    this.renderTotal();
  }

  /**
   * Show the bill's total and enable or disable its buttons.
   */
  renderTotal() {
    let total = 0;
    let count = 0;
    for (const [itemId, qty] of this.cart) {
      const item = this.item(itemId);
      if (item) {
        total += unitPrice(item) * qty;
        count += 1;
      }
    }
    this.el["counter-total"].textContent = rupees(total);
    this.el["counter-bill"].textContent = count ? `Bill ${rupees(total)}` : "Bill";
    this.el["counter-bill"].disabled = this.busy || count === 0;
    this.el["counter-clear"].disabled = this.busy || count === 0;
  }

  /**
   * Add a typed quantity of an item to the bill.
   *
   * :param itemId: The item.
   * :param value: The typed quantity.
   * :return: True when it was added.
   */
  add(itemId, value) {
    const item = this.item(itemId);
    const qty = parseQty(value);
    if (!item) {
      return false;
    }
    if (qty === null) {
      this.say(`Enter a whole number of 1 or more for ${item.name}.`);
      return false;
    }
    const next = (this.cart.get(itemId) || 0) + qty;
    const most = Math.min(item.available, MOST_PER_LINE);
    if (next > most) {
      const already = this.cart.get(itemId) || 0;
      this.say(`${item.name}: only ${Math.max(0, most - already)} more can go on this bill.`);
      return false;
    }
    this.cart.set(itemId, next);
    this.drafts.delete(itemId);
    this.editing = false;
    this.say(`Added ${qty} × ${item.name}.`);
    this.render();
    return true;
  }

  /**
   * Change a line's quantity. Zero removes the line.
   *
   * :param itemId: The item.
   * :param value: The typed quantity.
   * :return: True when it changed.
   */
  setQty(itemId, value) {
    const item = this.item(itemId);
    if (!item || !this.cart.has(itemId)) {
      return false;
    }
    if (String(value ?? "").trim() === "0") {
      return this.remove(itemId);
    }
    const qty = parseQty(value);
    const most = Math.min(item.available, MOST_PER_LINE);
    if (qty === null || qty > most) {
      this.say(qty === null ? `Enter a whole number of 1 or more for ${item.name}.` : `${item.name}: only ${most} can be billed.`);
      this.editing = false;
      this.renderCart();
      return false;
    }
    this.cart.set(itemId, qty);
    this.editing = false;
    this.say("");
    this.render();
    return true;
  }

  /**
   * Take a line off the bill.
   *
   * :param itemId: The item.
   * :return: True when it was on the bill.
   */
  remove(itemId) {
    const item = this.item(itemId);
    const had = this.cart.delete(itemId);
    if (had) {
      this.editing = false;
      this.say(`Removed ${item ? item.name : "the item"}.`);
      this.render();
    }
    return had;
  }

  /**
   * Empty the bill.
   */
  clear() {
    this.cart.clear();
    this.editing = false;
    this.say("Bill cleared.");
    this.render();
  }

  /**
   * Bill every line together, then reload the stock.
   *
   * :return: A promise of the API's answer, or null when the bill is empty.
   */
  async checkout() {
    if (this.busy || this.cart.size === 0) {
      return null;
    }
    this.busy = true;
    this.renderCart();
    let answer;
    try {
      answer = await this.api.bill([...this.cart].map(([itemId, qty]) => ({ itemId, qty })));
    } catch {
      answer = { ok: false, reason: "The stock service did not answer, so nothing was billed." };
    }
    this.busy = false;
    if (answer.ok) {
      const count = answer.lines.reduce((sum, line) => sum + line.qty, 0);
      this.cart.clear();
      this.say(`Billed ${count} ${count === 1 ? "item" : "items"}, total ${answer.total}.`);
    } else {
      this.say(`Not billed. ${answer.reason}`);
    }
    this.editing = false;
    await this.refresh();
    // Draw the bill again even when the stock did not change, such as after a refusal.
    this.render();
    return answer;
  }
}

/**
 * One unit's price as a number.
 *
 * :param item: A stock item from the shop API.
 * :return: Its MRP, read from the price text ("₹1,450.50") when an older server sent no mrp.
 */
export function unitPrice(item) {
  if (Number.isFinite(item.mrp)) {
    return item.mrp;
  }
  const number = Number(String(item.price ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

/**
 * Format rupees with Indian digit grouping, as the shop API does.
 *
 * :param amount: The amount.
 * :return: Such as "₹38" or "₹1,450.50".
 */
function rupees(amount) {
  const whole = Number.isInteger(amount);
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

if (typeof window !== "undefined") {
  const page = new CounterPage({ document, api: shopApi });
  page.mount();
  setInterval(() => page.refresh(), 5000);
}
