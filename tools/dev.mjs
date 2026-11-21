// Runs the whole Neem Chowk demo locally: NearShelf, the five shops (with their stock
// APIs) and the parts catalogue, each on its own host name and port, as the Neem Chowk
// directory names them. Stop them all with Ctrl+C.
//
// Usage: node tools/dev.mjs   (or npm run dev)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import directory from "../sites/nearshelf/directory/neem-chowk.json" with { type: "json" };

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SERVE_SITE = "vendor/agentify-website/scripts/serve_site.mjs";

/**
 * How to serve each site: the command, the address to bind and the URL to open.
 *
 * :return: [{name, args, url}].
 */
function plan() {
  const sites = [{
    name: "NearShelf",
    folder: "sites/nearshelf",
    args: [SERVE_SITE, "sites/nearshelf", "--port", "8080", "--open-as", "127.0.0.1"],
    url: "http://127.0.0.1:8080/",
  }];
  for (const place of directory.places) {
    const network = new URL(place.agent.network);
    const port = network.port;
    const bind = network.hostname === "[::1]" ? "::1" : "127.0.0.1";
    const folder = `sites/${place.id}`;
    const args = place.category === "parts_catalogue"
      ? [SERVE_SITE, folder, "--host", bind, "--port", port, ...(bind === "::1" ? [] : ["--open-as", network.hostname])]
      : ["tools/serve-shop.mjs", folder, "--shop", place.id, "--host", bind, "--port", port, "--open-as", network.hostname, "--allow-reset"];
    sites.push({ name: place.name, folder, args, url: `${network.origin}/` });
  }
  return sites;
}

const children = [];
for (const site of plan()) {
  if (!existsSync(path.join(REPO, site.folder))) {
    console.log(`Skipping ${site.name}: ${site.folder} does not exist yet.`);
    continue;
  }
  const child = spawn(process.execPath, site.args, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${site.name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${site.name}] ${chunk}`));
  child.on("exit", (code) => {
    if (code) {
      console.error(`[${site.name}] stopped with code ${code}.`);
    }
  });
  children.push(child);
  console.log(`${site.name.padEnd(22)} ${site.url}`);
}

const stopAll = () => {
  for (const child of children) {
    child.kill();
  }
  process.exit(0);
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
