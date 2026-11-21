// The shop's hold form. It runs in a dialog on the shop's own page, or in the shop's own
// window when another site's assistant asks (bridge/hold-window.js). The visitor types
// their name and phone here; whoever asked gets back only the code and what is held.
import { el } from "./render.js";

/**
 * One hold request, from the form to the visitor's confirm or cancel.
 */
export class HoldForm {
  /**
   * Build the form in a container and start waiting for the visitor.
   *
   * :param options: {doc, container, api, item (a catalog entry), qty, intro (text or
   *   null), until (when the hold would end, from the shop's check, or null)}.
   */
  constructor({ doc, container, api, item, qty, intro, until = null }) {
    this.doc = doc;
    this.container = container;
    this.api = api;
    this.item = item;
    this.qty = qty;
    this.done = false;
    // True while the shop has the request and has not answered yet.
    this.pending = false;
    // True after an answer was lost: the shop may have taken the hold.
    this.uncertain = false;
    // Sent with every try, so the shop answers a repeat with the same hold.
    this.requestId = HoldForm.newRequestId();
    this.result = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.build(intro, until);
  }

  /**
   * A new id for one hold request.
   *
   * :return: A random id of letters, digits and dashes.
   */
  static newRequestId() {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return `hold-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  /**
   * Draw the form: what is held, the visitor's details, and the two buttons.
   *
   * :param intro: A line about who asked, or null on the shop's own page.
   * :param until: When the hold would end, or null.
   */
  build(intro, until) {
    const doc = this.doc;
    const form = el(doc, "form", "hold-form");
    form.id = "hold-form";
    form.noValidate = true;
    const parts = [
      el(doc, "h2", "", `Hold ${this.qty} × ${this.item.name}`),
      el(doc, "p", "hold-summary", [this.item.detail, this.item.price].filter(Boolean).join(" · ")),
    ];
    if (until) {
      parts.push(el(doc, "p", "hold-until", `Held until ${until}. Pay and pick it up at the counter.`));
    }
    if (this.item.schedule === "H" || this.item.schedule === "H1") {
      parts.push(el(doc, "p", "hold-note", "Prescription medicine: bring the prescription. The pharmacist checks it at the counter."));
    }
    if (intro) {
      parts.push(el(doc, "p", "hold-intro", intro));
    }
    this.name = this.field(parts, "hold-name", "Name to give at the counter", { maxLength: 60, autocomplete: "name" });
    this.phone = this.field(parts, "hold-phone", "Mobile number", { maxLength: 16, autocomplete: "tel", type: "tel" });
    this.error = el(doc, "p", "hold-error", "");
    this.error.id = "hold-error";
    this.error.setAttribute("role", "alert");
    this.confirm = el(doc, "button", "primary", "Hold it");
    this.confirm.id = "hold-confirm";
    this.confirm.setAttribute("type", "submit");
    this.cancelButton = el(doc, "button", "secondary", "Cancel");
    this.cancelButton.id = "hold-cancel";
    this.cancelButton.setAttribute("type", "button");
    const actions = el(doc, "div", "hold-actions");
    actions.append(this.confirm, this.cancelButton);
    form.append(...parts, this.error, actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      return this.submit();
    });
    this.cancelButton.addEventListener("click", () => this.cancel());
    this.container.replaceChildren(form);
  }

  /**
   * Add one labelled input.
   *
   * :param parts: The list of form children to append to.
   * :param id: The input's id.
   * :param label: The label text.
   * :param attributes: {maxLength, autocomplete, type}.
   * :return: The input.
   */
  field(parts, id, label, { maxLength, autocomplete, type = "text" }) {
    const labelNode = el(this.doc, "label", "", label);
    labelNode.setAttribute("for", id);
    const input = el(this.doc, "input", "");
    input.id = id;
    input.type = type;
    input.maxLength = maxLength;
    input.autocomplete = autocomplete;
    input.required = true;
    parts.push(labelNode, input);
    return input;
  }

  /**
   * Send the hold to the shop. Both buttons wait until it answers. Mistakes in the details
   * stay on the form to fix; a refusal about the item itself ends the request.
   *
   * :return: A promise that settles when the shop has answered.
   */
  async submit() {
    if (this.done || this.pending) {
      return;
    }
    this.pending = true;
    this.confirm.disabled = true;
    this.cancelButton.disabled = true;
    let answer;
    try {
      answer = await this.api.createHold({ requestId: this.requestId, itemId: this.item.id, qty: this.qty, name: this.name.value, phone: this.phone.value });
    } catch {
      // The shop may have taken the hold before its answer was lost. Sending again is safe:
      // the same request id gets the same hold back, not a second one.
      this.uncertain = true;
      this.error.textContent = "The shop's answer did not arrive, so the hold may have been taken. Press Hold it again to check: you will not get two holds.";
      return;
    } finally {
      this.pending = false;
      this.confirm.disabled = false;
      this.cancelButton.disabled = false;
    }
    // The shop answered, so whether a hold was taken is known again.
    this.uncertain = false;
    if (answer.ok) {
      const view = el(this.doc, "section", "hold-done");
      view.append(el(this.doc, "h2", "", `Held: ${answer.code}`), el(this.doc, "p", "", answer.summary));
      if (answer.note) {
        view.append(el(this.doc, "p", "hold-note", answer.note));
      }
      this.finish({
        ok: true,
        code: answer.code,
        until: answer.until,
        summary: answer.summary,
        prescription: answer.prescription,
        ...(answer.note ? { note: answer.note } : {}),
        details: "The visitor typed their name and phone in the shop's own form; they are not shared.",
      }, view);
      return;
    }
    this.error.textContent = answer.reason;
    if (answer.field === "itemId" || answer.field === "qty") {
      this.finish({ ok: false, reason: answer.reason }, null);
    }
  }

  /**
   * End the request without holding anything. Ignored while the shop is answering. After
   * a lost answer the hold may exist, so the asker is told the outcome is unknown.
   */
  cancel() {
    if (this.done || this.pending) {
      return;
    }
    if (this.uncertain) {
      const reason = "The shop's answer did not arrive, so the hold may have been taken. Check with the shop before asking again.";
      const view = el(this.doc, "section", "hold-done");
      view.append(el(this.doc, "h2", "", "Not confirmed"), el(this.doc, "p", "", reason));
      this.finish(null, view, new Error(reason));
      return;
    }
    this.finish({ ok: false, reason: "The visitor cancelled. Nothing was held." }, null);
  }

  /**
   * Settle the request, showing a final view if there is one.
   *
   * :param result: What the asker gets back.
   * :param view: The element to show in place of the form, or null.
   * :param error: When the outcome is unknown, the error the request fails with.
   */
  finish(result, view, error = null) {
    this.done = true;
    if (view) {
      this.container.replaceChildren(view);
    }
    if (error) {
      this.reject(error);
    } else {
      this.resolve(result);
    }
  }
}
