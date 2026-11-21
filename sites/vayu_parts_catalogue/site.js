// Mounts the catalogue's assistant inside its page. index.html loads it with:
//   <script type="module" src="site.js"></script>
// Adapted from the agentify-website template (vendor/agentify-website/templates/site.js).

/**
 * Boots the browser runtime in the page's assistant section. The catalogue only reads,
 * so it has no confirmation dialogs of its own.
 */
export class AssistantMount {
  /** The first chat message once the visitor has a key. */
  static GREETING = "Tell me your Vayu model, its year and the part you need. I'll give you the exact part number to ask a dealer for.";

  /** This page's own confirmation dialogs. None: the catalogue only reads. */
  static DIALOGS = {};

  /**
   * Boot the runtime and report the result in the status line.
   *
   * :return: The runtime engine, or null when boot failed.
   */
  static async start() {
    const status = document.querySelector("#assistant-status");
    const siteBase = new URL("./", import.meta.url).href;
    try {
      const { boot } = await import("./runtime/index.js");
      const booted = await boot("#agent-app", {
        originUrl: siteBase,
        sandboxWorkerUrl: new URL("runtime/sandbox-worker.js", siteBase).href,
      });
      const needsKey = !booted.engine.mockLLM && (!booted.engine.byokKey || booted.engine.byokKey === "demo");
      status.textContent = needsKey
        ? "The assistant needs an AI provider. Add one in AI model settings below."
        : "Assistant connected to the parts catalogue.";
      if (!needsKey) {
        const first = document.querySelector("#ns-msgs .ns-msg.bot");
        if (first) {
          first.textContent = AssistantMount.GREETING;
        }
      }
      return booted.engine;
    } catch (error) {
      status.textContent = "The assistant could not load. You can still use the part finder above.";
      console.error("Assistant startup failed", error);
      return null;
    }
  }
}

// Boot only in a browser. Node tests import the page without it.
if (typeof window !== "undefined") {
  await AssistantMount.start();
}
