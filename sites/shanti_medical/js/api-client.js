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
  stock(query) {
    return this.transport("GET", "/api/stock", { q: query }, null);
  }

  /** The shopkeeper's full stock list, with counts. */
  stockAll() {
    return this.transport("GET", "/api/stock/all", null, null);
  }

  /** Bill items at the counter. */
  sale(itemId, qty) {
    return this.transport("POST", "/api/sale", null, { itemId, qty });
  }

  /** Hold items for pickup, with the shopper's own details. */
  createHold(details) {
    return this.transport("POST", "/api/holds", null, details);
  }

  /** The holds list, masked. */
  holds() {
    return this.transport("GET", "/api/holds", null, null);
  }

  /** What people asked for that the shop could not give. */
  missed() {
    return this.transport("GET", "/api/missed", null, null);
  }

  /** Put the demo stock back to the billing export. */
  reset() {
    return this.transport("POST", "/api/reset", null, {});
  }
}

/** The one client this site's modules share. */
export const shopApi = new ApiClient();
