// The shopkeeper's dashboard: holds to set aside, missed demand and low stock.
import { shopApi } from "./api-client.js";
import { el } from "./render.js";

const MOST_FILE_BYTES = 400 * 1024;
const MOST_ROWS_SHOWN = 60;

/**
 * How an item's count or price changes, in words.
 *
 * :param item: {qtyFrom, qtyTo, priceFrom, priceTo}.
 * :return: Such as "count 40 → 70 · price ₹21 → ₹23".
 */
export function describeChange(item) {
  const parts = [];
  if (item.qtyFrom !== item.qtyTo) {
    parts.push(`count ${item.qtyFrom} → ${item.qtyTo}`);
  }
  if (item.priceFrom !== item.priceTo) {
    parts.push(`price ${item.priceFrom} → ${item.priceTo}`);
  }
  return parts.join(" · ") || "name or pack details change";
}

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
    for (const id of ["import-file", "import-status", "import-preview", "import-summary", "import-changes", "import-apply", "import-cancel"]) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["dash-reset"].addEventListener("click", () => this.reset());
    this.el["import-file"].addEventListener("change", () => this.pickFile());
    this.el["import-apply"].addEventListener("click", () => this.applyImport());
    this.el["import-cancel"].addEventListener("click", () => this.cancelImport());
    this.pendingCsv = null;
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
   * Read the chosen file and show what it would change.
   *
   * :return: A promise that settles when the preview is shown.
   */
  async pickFile() {
    const input = this.el["import-file"];
    const file = input.files && input.files[0];
    if (!file) {
      return;
    }
    if (file.size > MOST_FILE_BYTES) {
      this.cancelImport();
      this.el["import-status"].textContent = "That file is too large. Export up to 5,000 items at a time.";
      return;
    }
    await this.previewImport(await file.text());
  }

  /**
   * Ask the shop API what a stock export would change, without saving it.
   *
   * :param csv: The export's text.
   * :return: The API's answer.
   */
  async previewImport(csv) {
    let answer;
    try {
      answer = await this.api.importStock(csv, false);
    } catch {
      answer = { ok: false, reason: "The stock service did not answer. Try again." };
    }
    if (!answer.ok) {
      this.cancelImport();
      this.el["import-status"].textContent = `Not read. ${answer.reason}`;
      return answer;
    }
    this.pendingCsv = csv;
    const { changed, added, missing, unchanged, warnings } = answer;
    const counts = [
      `${changed.length} item${changed.length === 1 ? "" : "s"} change`,
      `${added.length} new`,
      `${unchanged} unchanged`,
    ];
    if (missing.length) {
      counts.push(`${missing.length} not in the file (kept as they are)`);
    }
    this.el["import-status"].textContent = "";
    this.el["import-summary"].textContent = counts.join(" · ");
    const rows = [
      ...warnings.map((text) => this.importRow("import-warning", "Check", text)),
      ...changed.map((item) => this.importRow("", item.name, describeChange(item))),
      ...added.map((item) => this.importRow("import-new", `New: ${item.name}`, `${item.qty} at ${item.price}${item.detail ? ` · ${item.detail}` : ""}`)),
      ...missing.map((item) => this.importRow("import-missing", item.name, `not in the file, kept at ${item.qty}`)),
    ];
    const shown = rows.slice(0, MOST_ROWS_SHOWN);
    if (rows.length > shown.length) {
      shown.push(this.importRow("import-missing", `and ${rows.length - shown.length} more`, ""));
    }
    this.el["import-changes"].replaceChildren(...shown);
    this.el["import-apply"].disabled = changed.length === 0 && added.length === 0;
    this.el["import-apply"].textContent = this.el["import-apply"].disabled ? "Nothing to save" : "Save these changes";
    this.el["import-preview"].hidden = false;
    return answer;
  }

  /**
   * One row of the import preview.
   *
   * :param className: Extra class for the row.
   * :param title: The bold part.
   * :param text: The rest.
   * :return: The row.
   */
  importRow(className, title, text) {
    const row = el(this.doc, "li", className);
    row.append(el(this.doc, "strong", "", title), el(this.doc, "span", "cell-detail", text));
    return row;
  }

  /**
   * Save the previewed stock export.
   *
   * :return: The API's answer, or null when nothing was previewed.
   */
  async applyImport() {
    if (!this.pendingCsv) {
      return null;
    }
    this.el["import-apply"].disabled = true;
    let answer;
    try {
      answer = await this.api.importStock(this.pendingCsv, true);
    } catch {
      answer = { ok: false, reason: "The stock service did not answer. Try again." };
    }
    if (!answer.ok) {
      this.el["import-apply"].disabled = false;
      this.el["import-status"].textContent = `Not saved. ${answer.reason}`;
      return answer;
    }
    this.cancelImport();
    this.el["import-status"].textContent = `Stock updated: ${answer.changed.length} changed, ${answer.added.length} new.`;
    await this.refresh();
    return answer;
  }

  /**
   * Drop the previewed export without saving it.
   */
  cancelImport() {
    this.pendingCsv = null;
    this.el["import-preview"].hidden = true;
    this.el["import-changes"].replaceChildren();
    this.el["import-status"].textContent = "";
    this.el["import-file"].value = "";
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
