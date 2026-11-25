// The shop page's script. index.html loads it as a module, and site-actions.js imports it
// by this same URL, so the page and the agent share one page object, App.page.
import catalog from "../catalog.json" with { type: "json" };
import shop from "../shop.json" with { type: "json" };
import { shopApi } from "./api-client.js";
import { ShopPage } from "./shop-page.js";

/**
 * Starts the page once and holds its page object.
 */
export class App {
  /** The only clock the page reads. Tests replace it. */
  static clock = () => new Date();

  /** The page object, created when this module loads. */
  static page = null;

  /** The medicine list, on pharmacy pages only. */
  static list = null;

  /** Settles when the medicine list, if any, is ready. */
  static ready = Promise.resolve();

  /**
   * Create the page object and draw the page.
   *
   * :return: The page object.
   */
  static start() {
    App.page = new ShopPage({ document: globalThis.document, shop, catalog, api: shopApi, clock: () => App.clock() });
    App.page.mount();
    if (shop.kind === "pharmacy") {
      App.ready = App.startList().catch((error) => console.error("The medicine list could not load", error));
    }
    if (typeof window !== "undefined") {
      setInterval(() => App.page.tick(), 30000);
    }
    return App.page;
  }

  /**
   * Load and draw a pharmacy's medicine list.
   */
  static async startList() {
    const { MedicineList } = await import("./medicine-list.js");
    App.list = new MedicineList({ document: globalThis.document, api: shopApi });
    App.list.mount();
    App.page.onAdd = (match) => App.list.addItem(match);
  }
}

App.start();
