// The "Scan a prescription" panel: say who gets the photo, read it, and let the visitor
// check every line. The page decides what happens to the checked list. Nothing here keeps
// the photo. The text goes in with textContent and value, never as HTML.
import { MOST_LINES, PrescriptionError } from "./prescription.js";
import { el } from "./render.js";

const IDS = ["scan-open", "scan-panel", "scan-note", "scan-settings", "scan-pick", "scan-file", "scan-status", "scan-review", "scan-lines", "scan-use", "scan-clear"];
const FIELDS = [
  { key: "name", label: "Medicine", most: 80 },
  { key: "strength", label: "Strength", most: 30 },
  { key: "form", label: "Form", most: 30 },
  { key: "amount", label: "How many", most: 20 },
];

/** The scan panel. */
export class PrescriptionPanel {
  /**
   * :param options: {document, reader, onUse}. onUse gets the checked lines and returns
   *   {ok, message}, or a promise of it. The list closes when ok is true.
   */
  constructor({ document, reader, onUse }) {
    this.doc = document;
    this.reader = reader;
    this.onUse = onUse;
    this.lines = [];
    this.el = {};
    // Goes up whenever a reading stops mattering, so a late answer is dropped.
    this.turn = 0;
  }

  /**
   * Find the panel's elements and connect them.
   */
  mount() {
    for (const id of IDS) {
      this.el[id] = this.doc.getElementById(id);
    }
    this.el["scan-open"].addEventListener("click", () => this.toggle());
    this.el["scan-file"].addEventListener("change", () => this.pick());
    this.el["scan-settings"].addEventListener("click", () => this.openSettings());
    this.el["scan-use"].addEventListener("click", () => this.use());
    this.el["scan-clear"].addEventListener("click", () => this.clear());
    this.showSetup();
  }

  /**
   * Open the panel, or close it and drop what was read.
   */
  toggle() {
    const opening = this.el["scan-panel"].hidden;
    this.el["scan-panel"].hidden = !opening;
    this.el["scan-open"].setAttribute("aria-expanded", String(opening));
    this.clear();
  }

  /**
   * Say who would get the photo, or what is missing first.
   *
   * :return: The provider's host, or null when a photo cannot be read yet.
   */
  showSetup() {
    try {
      const { host } = this.reader.setup();
      this.el["scan-note"].textContent = `Choosing a photo sends it to your AI provider, ${host}, and to no shop. This page does not save it. The provider's own privacy rules apply.`;
      this.el["scan-settings"].hidden = true;
      this.el["scan-file"].disabled = false;
      return host;
    } catch (error) {
      this.el["scan-note"].textContent = error instanceof PrescriptionError ? error.message : "The assistant could not be set up.";
      this.el["scan-settings"].hidden = false;
      this.el["scan-file"].disabled = true;
      return null;
    }
  }

  /**
   * Open the assistant's AI model settings, where a key is added.
   */
  openSettings() {
    const settings = this.doc.querySelector(".ns-settings");
    if (settings) {
      settings.open = true;
      settings.scrollIntoView({ block: "start" });
      this.doc.getElementById("ns-key")?.focus();
    }
  }

  /**
   * Read the chosen photo.
   *
   * :return: A promise that settles when the list or a problem is shown.
   */
  async pick() {
    const file = this.el["scan-file"].files?.[0];
    if (!file) {
      return;
    }
    this.clear();
    const turn = this.turn;
    this.el["scan-file"].disabled = true;
    this.el["scan-status"].textContent = "Reading the photo…";
    try {
      const lines = await this.reader.read(file);
      if (turn === this.turn) {
        this.lines = lines.map((line) => ({ ...line, checked: !line.unsure }));
        this.el["scan-status"].textContent = "Check every line against your prescription. Fix or remove anything that is wrong.";
        this.draw();
      }
    } catch (error) {
      if (turn === this.turn) {
        this.el["scan-status"].textContent = error instanceof PrescriptionError ? error.message : "The photo could not be read. Try again.";
      }
    } finally {
      if (turn === this.turn) {
        this.showSetup();
        // Choosing the same photo again must count as a change.
        this.el["scan-file"].value = "";
      }
    }
  }

  /**
   * Draw the lines to check.
   */
  draw() {
    this.el["scan-lines"].replaceChildren(...this.lines.map((line) => this.drawLine(line)));
    this.el["scan-review"].hidden = this.lines.length === 0;
    this.updateUse();
  }

  /**
   * One line: its fields, a check box when it was hard to read, and Remove.
   *
   * :param line: A line from the reader, with checked.
   * :return: The list item.
   */
  drawLine(line) {
    const item = el(this.doc, "li", line.unsure ? "scan-line scan-unsure" : "scan-line");
    for (const { key, label, most } of FIELDS) {
      const wrap = el(this.doc, "label", `scan-field scan-${key}`);
      const input = el(this.doc, "input");
      input.setAttribute("maxlength", String(most));
      input.setAttribute("autocomplete", "off");
      input.value = line[key];
      input.addEventListener("input", () => {
        line[key] = input.value;
        this.updateUse();
      });
      // The panel can sit inside another form: Enter here must not submit it.
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
        }
      });
      wrap.append(el(this.doc, "span", "", label), input);
      item.append(wrap);
    }
    if (line.unsure) {
      const wrap = el(this.doc, "label", "scan-check");
      const box = el(this.doc, "input");
      box.setAttribute("type", "checkbox");
      box.checked = line.checked;
      box.addEventListener("change", () => {
        line.checked = box.checked;
        this.updateUse();
      });
      wrap.append(box, el(this.doc, "span", "", "Hard to read. I checked this line."));
      item.append(wrap);
    }
    const remove = el(this.doc, "button", "link-button scan-remove", "Remove");
    remove.setAttribute("type", "button");
    remove.setAttribute("aria-label", `Remove ${line.name}`);
    remove.addEventListener("click", () => {
      this.lines = this.lines.filter((entry) => entry !== line);
      if (this.lines.length === 0) {
        this.clear();
      } else {
        this.draw();
      }
    });
    item.append(remove);
    return item;
  }

  /**
   * Allow the list to be used only when every line has a name and was checked.
   */
  updateUse() {
    this.el["scan-use"].disabled = this.lines.length === 0 || this.lines.length > MOST_LINES || this.lines.some((line) => !line.checked || !line.name.trim());
  }

  /**
   * Hand the checked lines to the page.
   *
   * :return: A promise that settles when the page has answered.
   */
  async use() {
    this.updateUse();
    if (this.el["scan-use"].disabled) {
      return;
    }
    const turn = this.turn;
    this.el["scan-use"].disabled = true;
    const lines = this.lines.map(({ name, strength, form, amount }) => ({ name: name.trim(), strength: strength.trim(), form: form.trim(), amount: amount.trim() }));
    let answer;
    try {
      answer = await this.onUse(lines);
    } catch {
      answer = { ok: false, message: "That did not work. Try again." };
    }
    if (turn !== this.turn) {
      return;
    }
    if (answer.ok) {
      this.clear();
    } else {
      this.updateUse();
    }
    this.el["scan-status"].textContent = answer.message;
  }

  /**
   * Drop what was read, and any reading still on its way.
   */
  clear() {
    this.turn += 1;
    this.lines = [];
    this.el["scan-file"].value = "";
    this.el["scan-status"].textContent = "";
    this.draw();
    this.showSetup();
  }
}
