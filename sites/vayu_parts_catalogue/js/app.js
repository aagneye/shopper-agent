// The catalogue page: a part finder that uses the same look-up as the agent.
import { lookupPart, MODELS, PART_KINDS, VARIANTS } from "./catalogue.js";

/**
 * Create an element with optional text.
 *
 * :param tag: The tag name.
 * :param text: Text content, or undefined.
 * :param className: The class attribute, or "".
 * :return: The element.
 */
function el(tag, text = undefined, className = "") {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Fill a select with options.
 *
 * :param select: The select element.
 * :param values: The option values (shown as they are).
 * :param blank: A first, empty option's label, or null for none.
 */
function fill(select, values, blank) {
  const options = values.map((value) => {
    const option = el("option", value);
    option.value = value;
    return option;
  });
  if (blank !== null) {
    const empty = el("option", blank);
    empty.value = "";
    options.unshift(empty);
  }
  select.replaceChildren(...options);
}

/**
 * The page object: the finder form and its results.
 */
export class CataloguePage {
  /**
   * Find the form's elements, fill its choices and connect it.
   */
  mount() {
    this.el = {};
    for (const id of ["find-form", "find-model", "find-year", "find-variant", "find-part", "find-status", "find-results"]) {
      this.el[id] = document.getElementById(id);
    }
    fill(this.el["find-model"], MODELS, null);
    fill(this.el["find-variant"], VARIANTS, "Not sure");
    fill(this.el["find-part"], PART_KINDS, null);
    this.el["find-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleFind();
    });
  }

  /**
   * Look up the chosen part and show the result.
   */
  handleFind() {
    const variant = this.el["find-variant"].value || undefined;
    const result = lookupPart({
      model: this.el["find-model"].value,
      year: Number(this.el["find-year"].value),
      ...(variant ? { variant } : {}),
      part: this.el["find-part"].value,
    });
    if (!result.ok) {
      this.el["find-status"].textContent = result.reason;
      this.el["find-results"].replaceChildren();
      return;
    }
    this.el["find-status"].textContent = `Parts for a ${result.vehicle}:`;
    this.el["find-results"].replaceChildren(...result.parts.map((part) => {
      const item = el("li", undefined, "part");
      item.append(
        el("strong", part.partNo, "part-no"),
        el("span", ` ${part.name} · ${part.type}`),
        el("span", `Fits ${part.fits}`, "part-fits"),
        el("span", part.alternatives.length ? `Alternatives: ${part.alternatives.join(", ")}` : "No alternatives listed", "part-fits"),
      );
      return item;
    }));
  }
}

export const page = new CataloguePage();
page.mount();
