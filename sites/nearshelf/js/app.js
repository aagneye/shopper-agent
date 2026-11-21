// NearShelf's page script. index.html loads it as a module, and site-actions.js imports
// it by this same URL, so the page and the agent share one page object, App.page.
import directory from "../directory/neem-chowk.json" with { type: "json" };
import { validateDirectory } from "./directory.js";
import { ProfileStore } from "./profile-store.js";
import { ShopperPage } from "./shopper-page.js";

/**
 * Starts the page once and holds its page object.
 */
export class App {
  /** The only clock the page reads. Tests replace it. */
  static clock = () => new Date();

  /** The page object, created when this module loads. */
  static page = null;

  /**
   * Check the directory, create the page object and draw the page.
   *
   * :return: The page object.
   * :raises Error: When the bundled directory is invalid.
   */
  static start() {
    const checked = validateDirectory(directory);
    if (!checked.ok) {
      throw new Error(`The Neem Chowk directory is invalid: ${checked.reason}`);
    }
    App.page = new ShopperPage({
      document: globalThis.document,
      directory: checked.directory,
      store: new ProfileStore(),
      clock: () => App.clock(),
    });
    App.page.mount();
    if (typeof window !== "undefined") {
      // Open and closed labels change with the clock.
      setInterval(() => App.page.tick(), 30000);
    }
    return App.page;
  }
}

App.start();
