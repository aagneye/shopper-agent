// Serves one Neem Chowk shop site for local checks: its files, with the hosting rules of
// the agentify-website skill's serve_site.mjs, and its live stock API under /api/.
//
// Usage:
//   node tools/serve-shop.mjs <site folder> --shop <id> [--host 127.0.0.1] [--port 8081]
//        [--open-as localhost] [--data .data/<id>.json] [--allow-reset]
//
// Only the public agent files get Access-Control-Allow-Origin: *. The API answers its own
// origin only: the shop's page, counter, dashboard, website tools and action bridge. It
// refuses requests a browser marks as cross-site, writes from another Origin, and writes
// that are not JSON (a JSON write from another site needs a CORS preflight, which fails).
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import directory from "../sites/nearshelf/directory/neem-chowk.json" with { type: "json" };
import { createShopApi, initialState } from "../shop-kit/api/shop-api.mjs";
import { parseBillingCsv } from "../shop-kit/api/stock.mjs";
import { FileStore } from "./file-store.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const WORKER_CSP = "default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'";
const MOST_BODY_BYTES = 64 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

/**
 * The URL paths of a site's public agent files, read from its manifest on each request.
 *
 * :param root: The site folder.
 * :return: A promise of a set of URL paths.
 */
async function publicPaths(root) {
  const paths = new Set(["/agent-manifest.json", "/links.json", "/agent-mcp.json"]);
  try {
    const manifest = JSON.parse(await readFile(path.join(root, "agent-manifest.json"), "utf8"));
    for (const entry of manifest.networks || []) {
      if (typeof entry.hocon === "string" && !/^[a-z][a-z0-9+.-]*:/i.test(entry.hocon)) {
        paths.add(`/${entry.hocon.replace(/^(\.\/|\/)+/, "")}`);
      }
    }
    const match = String((manifest.linking || {}).protocol || "").match(/^([a-z][a-z0-9-]*)-link\/v1$/);
    if (match) {
      paths.add(`/.well-known/${match[1]}.json`);
      paths.add(`/.well-known/${match[1]}-agent.json`);
    }
  } catch {
    // No manifest yet: only the fixed public names.
  }
  return paths;
}

/**
 * Read a request body as JSON, refusing large bodies.
 *
 * :param request: The incoming request.
 * :return: A promise of the parsed body, or "" when it is not JSON.
 */
function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MOST_BODY_BYTES) {
        reject(new Error("Body too large."));
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve("");
      }
    });
    request.on("error", reject);
  });
}

/**
 * Decide whether an API request must be refused because it does not come from this shop's
 * own pages.
 *
 * :param request: The incoming request.
 * :return: {status, reason} to refuse it, or null to answer it.
 */
function apiRefusal(request) {
  const site = request.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    return { status: 403, reason: "Only this shop's own pages can use its stock service." };
  }
  if (request.method === "POST") {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) {
      return { status: 403, reason: "Only this shop's own pages can change its stock." };
    }
    if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
      return { status: 415, reason: "Send JSON." };
    }
  }
  return null;
}

/**
 * Start serving one shop.
 *
 * :param options: {siteDir, shopId, host, port, openAs, dataFile, allowReset}.
 * :return: A promise of {url, port, close()}.
 * :raises Error: When the shop is not in the Neem Chowk directory or its export is invalid.
 */
export async function startShopServer({ siteDir, shopId, host = "127.0.0.1", port = 0, openAs, dataFile, allowReset = false }) {
  const root = path.resolve(siteDir);
  const place = directory.places.find((entry) => entry.id === shopId);
  if (!place || place.category === "parts_catalogue") {
    throw new Error(`"${shopId}" is not a shop in the Neem Chowk directory.`);
  }
  const csv = await readFile(path.join(REPO, "shop-kit", "samples", `${shopId}.csv`), "utf8");
  const parsed = parseBillingCsv(csv, place.category);
  if (!parsed.ok) {
    throw new Error(`shop-kit/samples/${shopId}.csv: ${parsed.reason}`);
  }
  const store = new FileStore(dataFile || path.join(REPO, ".data", `${shopId}.json`), () => initialState(parsed.items));
  const api = createShopApi({
    profile: { id: place.id, name: place.name, kind: place.category, timezone: directory.area.timezone, hours: place.hours },
    items: parsed.items,
    store,
    allowReset,
  });

  const send = (response, status, headers, body) => {
    response.writeHead(status, { "Cache-Control": "no-store", ...headers });
    response.end(body);
  };

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://shop.invalid");
      if (url.pathname.startsWith("/api/")) {
        const refusal = apiRefusal(request);
        if (refusal) {
          send(response, refusal.status, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify({ ok: false, reason: refusal.reason }));
          return;
        }
        const body = request.method === "POST" ? await readJson(request) : null;
        const answer = await api.handle({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        send(response, answer.status, { "Content-Type": "application/json; charset=utf-8" }, JSON.stringify(answer.body));
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        send(response, 405, { "Content-Type": "text/plain; charset=utf-8" }, "Method not allowed");
        return;
      }
      let urlPath = decodeURIComponent(url.pathname);
      if (urlPath.endsWith("/")) {
        urlPath += "index.html";
      }
      const file = path.resolve(root, `.${urlPath}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        send(response, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
        return;
      }
      let content;
      try {
        content = await readFile(file);
      } catch {
        send(response, 404, { "Content-Type": "text/plain; charset=utf-8" }, "Not found");
        return;
      }
      const headers = { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" };
      if ((await publicPaths(root)).has(urlPath)) {
        headers["Access-Control-Allow-Origin"] = "*";
      }
      if (urlPath === "/runtime/sandbox-worker.js") {
        headers["Content-Security-Policy"] = WORKER_CSP;
      }
      send(response, 200, headers, request.method === "HEAD" ? undefined : content);
    } catch (error) {
      send(response, 500, { "Content-Type": "text/plain; charset=utf-8" }, "Server error");
      console.error(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const shownHost = openAs || (host.includes(":") ? `[${host}]` : host);
  return {
    url: `http://${shownHost}:${actualPort}/`,
    port: actualPort,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Read the command line.
 *
 * :param argv: The arguments after the script name.
 * :return: The options for startShopServer.
 * :raises Error: On a missing site folder or shop id.
 */
function parseArgs(argv) {
  const options = { host: "127.0.0.1", port: 8081, allowReset: false };
  const flags = { "--shop": "shopId", "--host": "host", "--port": "port", "--open-as": "openAs", "--data": "dataFile" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-reset") {
      options.allowReset = true;
    } else if (flags[arg]) {
      options[flags[arg]] = argv[index + 1];
      index += 1;
    } else if (!arg.startsWith("--") && !options.siteDir) {
      options.siteDir = arg;
    } else {
      throw new Error(`Unknown argument ${arg}.`);
    }
  }
  options.port = Number(options.port);
  if (!options.siteDir || !options.shopId) {
    throw new Error("Usage: node tools/serve-shop.mjs <site folder> --shop <id> [--host 127.0.0.1] [--port 8081] [--open-as localhost] [--data file] [--allow-reset]");
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const server = await startShopServer(parseArgs(process.argv.slice(2)));
    console.log(`Serving ${process.argv[2]} at ${server.url}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
