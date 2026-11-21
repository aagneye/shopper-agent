// The local shop server: static files with the agentify-website hosting rules, the shop
// API on the same origin, and stock that persists in a data file.
// Run: node --test "shop-kit/tests/*.test.mjs"
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startShopServer } from "../../tools/serve-shop.mjs";

/**
 * A minimal site folder with the public agent files the server must recognize.
 *
 * :return: The folder's path.
 */
async function fixtureSite() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nearshelf-site-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Shop</title>");
  await writeFile(path.join(dir, "agent-manifest.json"), JSON.stringify({
    networks: [{ name: "shanti_medical", hocon: "./shanti_medical.network.json" }],
    linking: { protocol: "nsdeploy-link/v1" },
  }));
  await writeFile(path.join(dir, "shanti_medical.network.json"), "{}");
  await mkdir(path.join(dir, "runtime"));
  await writeFile(path.join(dir, "runtime", "sandbox-worker.js"), "// worker");
  return dir;
}

/**
 * Send a GET with a raw, unnormalized path, as a hostile client could.
 *
 * :param port: The server's port.
 * :param rawPath: The request path, sent as is.
 * :return: A promise of the status code.
 */
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: rawPath }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
  });
}

test("the shop server follows the hosting rules, serves the API and keeps stock in its data file", async (t) => {
  const site = await fixtureSite();
  const dataFile = path.join(await mkdtemp(path.join(os.tmpdir(), "nearshelf-data-")), "shanti_medical.json");
  const server = await startShopServer({ siteDir: site, shopId: "shanti_medical", port: 0, dataFile });
  t.after(() => server.close());

  const manifest = await fetch(new URL("agent-manifest.json", server.url));
  assert.equal(manifest.headers.get("access-control-allow-origin"), "*");
  assert.match(manifest.headers.get("content-type"), /application\/json/);
  const network = await fetch(new URL("shanti_medical.network.json", server.url));
  assert.equal(network.headers.get("access-control-allow-origin"), "*");
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("access-control-allow-origin"), null);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const worker = await fetch(new URL("runtime/sandbox-worker.js", server.url));
  assert.match(worker.headers.get("content-security-policy"), /default-src 'none'/);

  const stock = await fetch(new URL("api/stock?q=ors", server.url));
  assert.equal(stock.headers.get("access-control-allow-origin"), null);
  const answer = await stock.json();
  assert.equal(answer.matches[0].id, "SM-1004");
  assert.equal(answer.matches[0].availability, "limited");

  assert.equal(await rawGet(server.port, "/..%2fpackage.json"), 404);
  assert.equal(await rawGet(server.port, "/missing.html"), 404);

  const sale = await fetch(new URL("api/sale", server.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemId: "SM-1004", qty: 1 }),
  });
  assert.equal((await sale.json()).item.qty, 2);
  const saved = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(saved.items.find((item) => item.id === "SM-1004").qty, 2);
});

/**
 * Send a request with exact headers, as another site's page could make a browser send.
 *
 * :param port: The server's port.
 * :param method: "GET" or "POST".
 * :param path: The request path.
 * :param headers: The headers to send.
 * :param body: The body text, or "".
 * :return: A promise of the status code.
 */
function rawRequest(port, method, path, headers, body = "") {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path, headers }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("the shop API refuses writes from other sites, cross-site reads and non-JSON writes", async (t) => {
  const site = await fixtureSite();
  const dataFile = path.join(await mkdtemp(path.join(os.tmpdir(), "nearshelf-data-")), "shanti_medical.json");
  const server = await startShopServer({ siteDir: site, shopId: "shanti_medical", port: 0, dataFile });
  t.after(() => server.close());
  const sale = JSON.stringify({ itemId: "SM-1004", qty: 1 });
  const own = `http://127.0.0.1:${server.port}`;
  assert.equal(await rawRequest(server.port, "POST", "/api/sale", { "Content-Type": "text/plain" }, sale), 415);
  assert.equal(await rawRequest(server.port, "POST", "/api/sale", { "Content-Type": "application/json", Origin: "https://evil.example" }, sale), 403);
  assert.equal(await rawRequest(server.port, "POST", "/api/reset", { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, "{}"), 403);
  assert.equal(await rawRequest(server.port, "GET", "/api/stock?q=ors", { "Sec-Fetch-Site": "cross-site" }), 403);
  const answer = await (await fetch(new URL("api/stock?q=ors", server.url))).json();
  assert.equal(answer.matches[0].availability, "limited");
  assert.equal(await rawRequest(server.port, "POST", "/api/sale", { "Content-Type": "application/json", Origin: own, "Sec-Fetch-Site": "same-origin" }, sale), 200);
  const saved = JSON.parse(await readFile(dataFile, "utf8"));
  assert.equal(saved.items.find((item) => item.id === "SM-1004").qty, 2);
});

test("stock survives a restart of the shop server", async (t) => {
  const site = await fixtureSite();
  const dataFile = path.join(await mkdtemp(path.join(os.tmpdir(), "nearshelf-data-")), "shanti_medical.json");
  const first = await startShopServer({ siteDir: site, shopId: "shanti_medical", port: 0, dataFile });
  await fetch(new URL("api/sale", first.url), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: "SM-1004", qty: 3 }) });
  await first.close();
  const second = await startShopServer({ siteDir: site, shopId: "shanti_medical", port: 0, dataFile });
  t.after(() => second.close());
  const answer = await (await fetch(new URL("api/stock?q=ors", second.url))).json();
  assert.equal(answer.matches[0].availability, "out_of_stock");
});
