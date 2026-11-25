// Talks to the shop's live stock API on this site's own origin. The page, the counter,
// the dashboard, the website tools and the action bridge all use the same client.

/**
 * A client for the shop's /api/ routes. The transport is replaceable, so tests can run
 * the real API in the same process.
 */
export class ApiClient {
  /**
   * :param transport: async (method, path, query, body) => response body.
   */
  constructor(transport = ApiClient.fetchTransport) {
    this.transport = transport;
  }

  /**
   * Call the API over HTTP on this page's origin.
   *
   * :param method: "GET" or "POST".
   * :param path: Such as "/api/stock".
   * :param query: Query parameters, or null.
   * :param body: A JSON body, or null.
   * :return: A promise of the parsed response body.
   * :raises Error: When the service does not answer with JSON.
   */
  static async fetchTransport(method, path, query, body) {
    const url = new URL(path, globalThis.location.origin);
    for (const [key, value] of Object.entries(query || {})) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!data || typeof data !== "object") {
      throw new Error(`The shop's stock service did not answer (HTTP ${response.status}).`);
    }
    return data;
  }

  /** Stock bands for the items a shopper's words mean. */
  stock(query, amount, unit) {
    return this.transport("GET", "/api/stock", { q: query, ...(amount ? { amount: String(amount), unit: unit || "tablets" } : {}) }, null);
  }

  /** An estimate for a list of {itemId, qty}, from live stock. */
  quote(lines) {
    return this.transport("POST", "/api/quote", null, { lines });
  }

  /** The shopkeeper's full stock list, with counts. */
  stockAll() {
    return this.transport("GET", "/api/stock/all", null, null);
  }

  /** Bill items at the counter. */
  sale(itemId, qty) {
    return this.transport("POST", "/api/sale", null, { itemId, qty });
  }

  /** Bill several items as one sale: lines is [{itemId, qty}]. */
  bill(lines) {
    return this.transport("POST", "/api/bill", null, { lines });
  }

  /** Whether the shop would hold an item now, before anyone's details are asked. */
  checkHold(itemId, qty, more = []) {
    const extra = more.length ? { more: more.map((line) => `${line.itemId}:${line.qty}`).join(",") } : {};
    return this.transport("GET", "/api/holds/check", { itemId, qty: String(qty), ...extra }, null);
  }

  /** Hold items for pickup, with the shopper's own details. */
  createHold(details) {
    return this.transport("POST", "/api/holds", null, details);
  }

  /** The shopper picked a hold up and paid: bill its units and end it. */
  collectHold(code) {
    return this.transport("POST", "/api/holds/collect", null, { code });
  }

  /** The shopper will not come: put a hold's units back on the shelf. */
  releaseHold(code) {
    return this.transport("POST", "/api/holds/release", null, { code });
  }

  /** The holds list, masked. */
  holds() {
    return this.transport("GET", "/api/holds", null, null);
  }

  /** What people asked for that the shop could not give. */
  missed() {
    return this.transport("GET", "/api/missed", null, null);
  }

  /**
   * Update the stock from a new billing export.
   *
   * :param csv: The export's text.
   * :param apply: False to only see what would change, true to save it.
   */
  importStock(csv, apply) {
    return this.transport("POST", "/api/stock/import", null, { csv, apply: apply === true });
  }

  /** Put the demo stock back to the billing export. */
  reset() {
    return this.transport("POST", "/api/reset", null, {});
  }
}

/** The one client this site's modules share. */
export const shopApi = new ApiClient();
