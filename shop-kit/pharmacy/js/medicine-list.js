// A pharmacy page's medicine list: scan a prescription or pick from the stock search,
// choose the shop's item and the number of packs, and see an estimate from live stock.
// The page never chooses a medicine or a number of packs from a prescription by itself.
import { PrescriptionReader } from "./prescription.js";
import { PrescriptionPanel } from "./prescription-panel.js";
import { el } from "./render.js";

export const MOST_ROWS = 12;
export const MOST_PACKS = 5;
const LABELS = { in_stock: "In stock", limited: "Few left", out_of_stock: "Out of stock" };

/**
 * True when a written strength is not in an item's details.
 *
 * :param strength: The strength as written, or "".
 * :param detail: The item's details, such as "500 mg · strip of 10".
 * :return: Whether the visitor should be warned.
 */
export function strengthDiffers(strength, detail) {
  const squash = (text) => text.toLowerCase().replace(/\s+/g, "");
  const wanted = squash(strength);
  return wanted !== "" && !detail.split("·").some((part) => squash(part) === wanted);
}

/** The medicine list on a pharmacy's page. */
export class MedicineList {
  /**
   * :param options: {document, api}.
   */
  constructor({ document, api }) {
    this.doc = document;
    this.api = api;
    this.rows = [];
    this.quote = null;
    this.el = {};
    // Set by site.js once the assistant runs: it reads the photos.
    this.engine = () => null;
    this.nextKey = 1;
    // Goes up with each change, so a late price answer is dropped.
    this.turn = 0;
    this.scan = new PrescriptionPanel({
      document,
      reader: new PrescriptionReader({ engine: () => this.engine() }),
      onUse: (lines) => this.addWritten(lines),
    });
  }

  /**
   * Find the list's elements and connect them.
   */
  mount() {
    for (const id of ["list-empty", "list-rows", "list-summary", "list-total", "list-status", "list-refresh", "list-clear"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["list-refresh"].addEventListener("click", () => this.price());
    this.el["list-clear"].addEventListener("click", () => this.clear());
    this.scan.mount();
    this.draw();
  }

  /**
   * Use the assistant's AI setup for photos.
   *
   * :param engine: Returns the runtime engine.
   */
  connect(engine) {
    this.engine = engine;
    this.scan.showSetup();
  }

  /**
   * Add an item from the stock search, or one more pack of it.
   *
   * :param match: {id, name, detail, price} from a stock answer.
   * :return: A promise that settles when the prices are shown.
   */
  async addItem(match) {
    const row = this.rows.find((entry) => entry.itemId === match.id);
    if (row) {
      row.qty = Math.min(MOST_PACKS, (row.qty || 0) + 1);
    } else if (this.rows.length >= MOST_ROWS) {
      this.el["list-status"].textContent = `The list holds up to ${MOST_ROWS} items.`;
      return;
    } else {
      this.rows.push({ key: this.nextKey++, written: "", strength: "", options: [match], itemId: match.id, qty: 1 });
    }
    await this.price();
    this.el["list-status"].textContent = `${match.name} is on your list.`;
  }

  /**
   * Find the shop's items for checked prescription lines. Only items that match every word
   * of the medicine's name are offered: a shared strength is not a match.
   *
   * :param lines: [{name, strength, form, amount}].
   * :return: A promise of {ok, message} for the scan panel.
   */
  async addWritten(lines) {
    const room = MOST_ROWS - this.rows.length;
    if (lines.length > room) {
      return { ok: false, message: `The list has room for ${room} more. Remove some items first.` };
    }
    const found = [];
    for (const line of lines) {
      const answer = await this.api.stock(line.name);
      found.push({
        key: this.nextKey++,
        written: [line.name, line.strength, line.form, line.amount ? `(${line.amount} written)` : ""].filter(Boolean).join(" "),
        strength: line.strength,
        options: answer.ok ? answer.matches.filter((match) => match.match === "full") : [],
        itemId: "",
        qty: 0,
      });
    }
    if (this.rows.length + found.length > MOST_ROWS) {
      return { ok: false, message: "The list changed while we checked. Try again." };
    }
    this.rows.push(...found);
    await this.price();
    return { ok: true, message: "Now choose the item and the number of packs for each line below." };
  }

  /**
   * Choose the shop's item for a row.
   *
   * :param row: The row.
   * :param itemId: The chosen item's id, or "".
   * :return: A promise that settles when the prices are shown.
   */
  choose(row, itemId) {
    const taken = itemId && this.rows.some((entry) => entry !== row && entry.itemId === itemId);
    row.itemId = taken || !row.options.some((option) => option.id === itemId) ? "" : itemId;
    return this.price().then(() => {
      if (taken) {
        this.el["list-status"].textContent = "That item is already on your list. Change its packs there.";
      }
    });
  }

  /**
   * Set a row's number of packs.
   *
   * :param row: The row.
   * :param value: The number, or "" for not chosen.
   * :return: A promise that settles when the prices are shown.
   */
  setPacks(row, value) {
    const qty = Number(value);
    row.qty = Number.isInteger(qty) && qty >= 1 && qty <= MOST_PACKS ? qty : 0;
    return this.price();
  }

  /**
   * Remove a row.
   *
   * :param row: The row.
   * :return: A promise that settles when the prices are shown.
   */
  remove(row) {
    this.rows = this.rows.filter((entry) => entry !== row);
    return this.price();
  }

  /**
   * Empty the list.
   */
  clear() {
    this.turn += 1;
    this.rows = [];
    this.quote = null;
    this.el["list-status"].textContent = "";
    this.draw();
  }

  /**
   * Ask the shop for live prices of the rows that are ready, and show them.
   *
   * :return: A promise that settles when they are shown.
   */
  async price() {
    this.turn += 1;
    const turn = this.turn;
    this.quote = null;
    this.el["list-status"].textContent = "";
    this.draw();
    const lines = this.rows.filter((row) => row.itemId && row.qty).map((row) => ({ itemId: row.itemId, qty: row.qty }));
    if (lines.length === 0) {
      return;
    }
    let answer;
    try {
      answer = await this.api.quote(lines);
    } catch {
      answer = { ok: false, reason: "The stock service did not answer. Press Refresh prices." };
    }
    if (turn !== this.turn) {
      return;
    }
    if (answer.ok) {
      this.quote = answer;
    } else {
      this.el["list-status"].textContent = answer.reason;
    }
    this.draw();
  }

  /**
   * Draw the rows and the estimate.
   */
  draw() {
    const any = this.rows.length > 0;
    this.el["list-empty"].hidden = any;
    this.el["list-summary"].hidden = !any;
    // Redrawing must not take the keyboard focus away from a drop-down.
    const label = this.doc.activeElement?.getAttribute?.("aria-label");
    const focused = this.el["list-rows"].contains(this.doc.activeElement);
    this.el["list-rows"].replaceChildren(...this.rows.map((row) => this.drawRow(row)));
    if (label && focused) {
      [...this.el["list-rows"].querySelectorAll("select")].find((select) => select.getAttribute("aria-label") === label)?.focus();
    }
    const waiting = this.rows.filter((row) => row.options.length > 0 && !(row.itemId && row.qty)).length;
    const priced = this.quote ? this.quote.lines.filter((line) => line.enough).length : 0;
    if (this.quote) {
      const rest = this.rows.length - priced;
      const parts = [`Estimated total for ${priced} of ${this.rows.length} item${this.rows.length === 1 ? "" : "s"}: ${this.quote.total}.`, `Live stock as of ${this.quote.asOf}.`];
      if (rest) {
        parts.push(waiting ? `${waiting} still to choose.` : `${rest} not included.`);
      }
      this.el["list-total"].textContent = parts.join(" ");
    } else {
      this.el["list-total"].textContent = waiting ? `${waiting} still to choose.` : "";
    }
  }

  /**
   * One row: what was written, the item, the packs and the price.
   *
   * :param row: The row.
   * :return: The list item.
   */
  drawRow(row) {
    const item = el(this.doc, "li", "medicine-row");
    const name = row.written || row.options[0].name;
    item.append(el(this.doc, "strong", "medicine-name", name));
    const remove = el(this.doc, "button", "remove-button", "×");
    remove.setAttribute("type", "button");
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => this.remove(row));
    item.append(remove);
    if (row.options.length === 0) {
      item.append(el(this.doc, "p", "medicine-note", "We found no item with this name here. Check the spelling, or ask our pharmacist."));
      return item;
    }
    if (row.written) {
      const options = [["", "Choose the item…"], ...row.options.map((option) => [option.id, `${option.detail} · ${option.name} · ${option.price}`])];
      item.append(this.picker(`Item for ${name}`, "medicine-item", options, row.itemId, (value) => this.choose(row, value)));
    } else {
      item.append(el(this.doc, "span", "medicine-detail", `${row.options[0].detail} · ${row.options[0].price} a pack`));
    }
    const packs = [["", "Packs…"], ...Array.from({ length: MOST_PACKS }, (_, index) => [String(index + 1), `${index + 1} pack${index ? "s" : ""}`])];
    item.append(this.picker(`Packs of ${name}`, "medicine-packs", packs, row.qty ? String(row.qty) : "", (value) => this.setPacks(row, value)));
    const chosen = row.options.find((option) => option.id === row.itemId);
    if (chosen && strengthDiffers(row.strength, chosen.detail)) {
      item.append(el(this.doc, "p", "medicine-note medicine-warning", `Your list says ${row.strength}. This item says ${chosen.detail}. Ask the pharmacist before you choose it.`));
    }
    const line = this.quote?.lines.find((entry) => entry.itemId === row.itemId);
    if (line) {
      const result = el(this.doc, "p", "medicine-result");
      result.append(el(this.doc, "span", `badge badge-${line.enough ? line.availability : "out_of_stock"}`, line.enough || line.availability === "out_of_stock" ? LABELS[line.availability] : "Not enough for this many"));
      if (line.enough) {
        result.append(el(this.doc, "strong", "medicine-amount", line.amount));
      }
      item.append(result);
      if (line.prescription) {
        item.append(el(this.doc, "p", "medicine-note", "Bring the prescription. The pharmacist checks it at the counter."));
      }
    }
    return item;
  }

  /**
   * A drop-down.
   *
   * :param label: Its accessible name.
   * :param className: Its class.
   * :param options: [[value, text]].
   * :param value: The selected value.
   * :param onChange: Called with the new value.
   * :return: The select.
   */
  picker(label, className, options, value, onChange) {
    const select = el(this.doc, "select", className);
    select.setAttribute("aria-label", label);
    select.append(...options.map(([key, text]) => {
      const option = el(this.doc, "option", "", text);
      option.value = key;
      return option;
    }));
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }
}
