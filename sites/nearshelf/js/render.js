// DOM building for the shopper page. Each function takes plain view data and replaces
// one element's children. Text always goes in with textContent, never as HTML, so a
// shop's or a model's words can never become markup on this page.

/**
 * Create an element with a class and, optionally, text.
 *
 * :param doc: The document.
 * :param tag: The tag name.
 * :param className: The class attribute, or "".
 * :param text: Text content, or undefined for none.
 * :return: The element.
 */
export function el(doc, tag, className = "", text = undefined) {
  const node = doc.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Create a link that opens in a new tab.
 *
 * :param doc: The document.
 * :param href: The address.
 * :param text: The link text.
 * :return: The anchor element.
 */
function link(doc, href, text) {
  const anchor = el(doc, "a", "", text);
  anchor.setAttribute("href", href);
  anchor.setAttribute("target", "_blank");
  anchor.setAttribute("rel", "noopener");
  return anchor;
}

/**
 * Show the "Shops near you" list.
 *
 * :param doc: The document.
 * :param list: The <ul> element.
 * :param shops: [{id, name, category, distance, open, openLabel, verified, page, network}].
 */
export function renderShops(doc, list, shops) {
  const items = shops.map((shop) => {
    const item = el(doc, "li", `shop ${shop.open ? "is-open" : "is-closed"}`);
    item.dataset.shopId = shop.id;
    const head = el(doc, "div", "shop-head");
    head.append(el(doc, "span", "shop-name", shop.name), el(doc, "span", "tag", shop.category));
    const meta = el(doc, "p", "shop-meta", `${shop.distance} · ${shop.openLabel}`);
    const trust = el(doc, "p", "shop-trust", shop.verified);
    const links = el(doc, "p", "shop-links");
    links.append(link(doc, shop.page, "Website"), link(doc, shop.network, "Agent network"));
    item.append(head, meta, trust, links);
    return item;
  });
  list.replaceChildren(...items);
}

/**
 * Show the results board.
 *
 * :param doc: The document.
 * :param list: The <ol> element.
 * :param summary: The summary paragraph.
 * :param view: {summary, cards: [{shop, availability, label, item, meta, source, note}]}.
 */
export function renderResults(doc, list, summary, view) {
  summary.textContent = view.summary;
  const cards = view.cards.map((card) => {
    const item = el(doc, "li", `card availability-${card.availability}`);
    item.dataset.availability = card.availability;
    const head = el(doc, "div", "card-head");
    head.append(el(doc, "span", "card-shop", card.shop), el(doc, "span", `badge badge-${card.availability}`, card.label));
    item.append(head);
    if (card.item) {
      item.append(el(doc, "p", "card-item", card.item));
    }
    item.append(el(doc, "p", "card-meta", card.meta));
    item.append(el(doc, "p", "card-source", card.source));
    if (card.note) {
      item.append(el(doc, "p", "card-note", card.note));
    }
    return item;
  });
  list.replaceChildren(...cards);
}

/**
 * Show My holds.
 *
 * :param doc: The document.
 * :param list: The <ul> element.
 * :param empty: The "no holds" paragraph.
 * :param holds: [{id, shop, item, code, until, pickup, expired, page}], newest first.
 * :param onRemove: Called with a hold id when its Remove button is pressed.
 */
export function renderHolds(doc, list, empty, holds, onRemove) {
  empty.hidden = holds.length > 0;
  const items = holds.map((hold) => {
    const item = el(doc, "li", hold.expired ? "hold is-expired" : "hold");
    const code = el(doc, "span", "hold-code", hold.code);
    const what = el(doc, "span", "hold-item", hold.item);
    const times = hold.expired
      ? "Expired"
      : [hold.pickup && hold.pickup !== hold.until ? `pickup by ${hold.pickup}` : "", hold.until ? `held until ${hold.until}` : ""].filter(Boolean).join(" · ");
    const where = el(doc, "span", "hold-where", [hold.shop, times].filter(Boolean).join(" · "));
    const tools = el(doc, "span", "hold-tools");
    const copy = el(doc, "button", "link-button", "Copy code");
    copy.setAttribute("type", "button");
    copy.setAttribute("aria-label", `Copy hold code ${hold.code}`);
    copy.addEventListener("click", async () => {
      try {
        await globalThis.navigator.clipboard.writeText(hold.code);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Could not copy";
      }
    });
    tools.append(copy);
    if (hold.page) {
      tools.append(link(doc, hold.page, "Website"));
    }
    const remove = el(doc, "button", "link-button", "Remove");
    remove.setAttribute("type", "button");
    remove.setAttribute("aria-label", `Remove hold ${hold.code} from this list`);
    remove.addEventListener("click", () => onRemove(hold.id));
    tools.append(remove);
    item.append(code, what, where, tools);
    return item;
  });
  list.replaceChildren(...items);
}

/**
 * Show a saved list (My garage or My list) with a Remove button per entry.
 *
 * :param doc: The document.
 * :param list: The <ul> element.
 * :param entries: [{id, label}].
 * :param onRemove: Called with an entry id when its Remove button is pressed.
 */
export function renderSaved(doc, list, entries, onRemove) {
  const items = entries.map((entry) => {
    const item = el(doc, "li", "saved");
    const remove = el(doc, "button", "link-button", "Remove");
    remove.setAttribute("type", "button");
    remove.setAttribute("aria-label", `Remove ${entry.label}`);
    remove.addEventListener("click", () => onRemove(entry.id));
    item.append(el(doc, "span", "saved-label", entry.label), remove);
    return item;
  });
  list.replaceChildren(...items);
}

/**
 * Fill the spot drop-down.
 *
 * :param doc: The document.
 * :param select: The <select> element.
 * :param spots: [{id, name}].
 * :param selectedId: The spot to select.
 */
export function renderSpots(doc, select, spots, selectedId) {
  const options = spots.map((spot) => {
    const option = el(doc, "option", "", spot.name);
    option.value = spot.id;
    return option;
  });
  select.replaceChildren(...options);
  select.value = selectedId;
}
