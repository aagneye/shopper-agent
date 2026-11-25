// Agentify a shop: turn a shop profile and its billing export into a complete open
// agentic website in sites/<id>/, then build its agent network with the official script.
//
// Usage:
//   node shop-kit/generate.mjs <shop id>
//   node shop-kit/generate.mjs --all
//
// The shop's name, address, hours, licence and agent address come from the Neem Chowk
// places directory; its look, tagline and partner shops from shop-kit/shops/<id>.json;
// its products from shop-kit/samples/<id>.csv. The generated folder is output: change the
// template, the profile or the export, never the folder.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { formatRupees, parseBillingCsv } from "./api/stock.mjs";
import { buildShopManifest, buildShopNetwork } from "./lib/network.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const DIRECTORY = JSON.parse(readFileSync(path.join(REPO, "sites/nearshelf/directory/neem-chowk.json"), "utf8"));
const TEMPLATE = path.join(REPO, "shop-kit/template");
// Extra files and page section for pharmacies: the medicine list.
const PHARMACY = path.join(REPO, "shop-kit/pharmacy");
const MEDICINE_LIST = readFileSync(path.join(REPO, "shop-kit/lib/medicine-list.html"), "utf8").replace(/\r\n/g, "\n");
const TOOLKIT = path.join(REPO, "vendor/agentify-website");
// NearShelf, the shopper's agent, may ask every shop to hold an item.
const NEARSHELF_ORIGIN = "http://127.0.0.1:8080";
const KIND_LABELS = { pharmacy: "Pharmacy", auto_parts: "Vehicle parts dealer" };
const TEXT_FILES = new Set([".html", ".css", ".md", ".svg"]);
const STAND_INS = ["stub_document.mjs", "stub_element.mjs", "stub_dialog.mjs", "stub_option.mjs", "scripted_model.mjs"];

/**
 * The shop's public profile, written to sites/<id>/shop.json.
 *
 * :param place: The shop's entry in the places directory.
 * :param profile: shop-kit/shops/<id>.json.
 * :return: The profile object.
 */
export function shopProfile(place, profile) {
  const partners = profile.partners.map((partnerId) => {
    const partner = DIRECTORY.places.find((entry) => entry.id === partnerId);
    if (!partner) {
      throw new Error(`${place.id}: partner "${partnerId}" is not in the directory.`);
    }
    return { id: partner.id, name: partner.name, page: partner.page, network: partner.agent.network };
  });
  const shopOrigins = DIRECTORY.places
    .filter((entry) => entry.category !== "parts_catalogue" && entry.id !== place.id)
    .map((entry) => new URL(entry.agent.network).origin);
  return {
    id: place.id,
    name: place.name,
    kind: place.category,
    kindLabel: KIND_LABELS[place.category],
    tagline: profile.tagline,
    address: place.address,
    area: DIRECTORY.area.name,
    timezone: DIRECTORY.area.timezone,
    hours: place.hours,
    verified: place.verified,
    page: place.page,
    network: place.agent.network,
    theme: profile.theme,
    partners,
    holdCallers: [NEARSHELF_ORIGIN, ...shopOrigins],
    nearshelf: `${NEARSHELF_ORIGIN}/`,
  };
}

/**
 * The public product list, written to sites/<id>/catalog.json: no stock counts.
 *
 * :param items: The parsed billing export.
 * :return: [{id, name, detail, price, schedule?, type?}].
 */
export function publicCatalog(items) {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    detail: item.detail,
    price: formatRupees(item.mrp),
    ...(item.schedule ? { schedule: item.schedule } : {}),
    ...(item.type ? { type: item.type } : {}),
  }));
}

/**
 * The hosting headers for the shop's public agent files.
 *
 * :param id: The shop id, which names its network file.
 * :return: The _headers file text.
 */
function headersFile(id) {
  const open = ["/agent-manifest.json", `/${id}.network.json`, "/links.json", "/agent-mcp.json", "/.well-known/nsdeploy.json", "/.well-known/nsdeploy-agent.json"];
  return [
    ...open.flatMap((file) => [file, "  Access-Control-Allow-Origin: *"]),
    "/runtime/sandbox-worker.js",
    "  Content-Security-Policy: default-src 'none'; script-src blob:; connect-src 'none'; worker-src 'none'",
    "",
  ].join("\n");
}

/**
 * Copy the template, filling its placeholders in text files.
 *
 * :param from: The template folder.
 * :param to: The output folder.
 * :param values: Placeholder values, by name.
 */
function copyTemplate(from, to, values) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (statSync(source).isDirectory()) {
      copyTemplate(source, target, values);
    } else if (TEXT_FILES.has(path.extname(name))) {
      const text = readFileSync(source, "utf8").replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
        if (!Object.hasOwn(values, key)) {
          throw new Error(`${source}: unknown placeholder ${match}.`);
        }
        return values[key];
      });
      writeFileSync(target, text);
    } else {
      cpSync(source, target);
    }
  }
}

/**
 * Generate one shop's site and build its network.
 *
 * :param id: The shop id.
 * :return: The output folder.
 * :raises Error: When the shop, its profile or its export is missing or invalid, or the
 *   build reports errors.
 */
export function generateShop(id) {
  const place = DIRECTORY.places.find((entry) => entry.id === id);
  if (!place || place.category === "parts_catalogue") {
    throw new Error(`"${id}" is not a shop in the Neem Chowk directory.`);
  }
  const profile = JSON.parse(readFileSync(path.join(REPO, "shop-kit/shops", `${id}.json`), "utf8"));
  const parsed = parseBillingCsv(readFileSync(path.join(REPO, "shop-kit/samples", `${id}.csv`), "utf8"), place.category);
  if (!parsed.ok) {
    throw new Error(`shop-kit/samples/${id}.csv: ${parsed.reason}`);
  }
  const shop = shopProfile(place, profile);
  const out = path.join(REPO, "sites", id);
  rmSync(out, { recursive: true, force: true });
  const values = {
    NAME: shop.name,
    KIND_LABEL: shop.kindLabel,
    TAGLINE: shop.tagline,
    THEME: shop.theme,
    NETWORK: shop.id,
    ADDRESS: shop.address,
    MEDICINE_LINK: shop.kind === "pharmacy" ? '      <a href="#medicines">Scan prescription</a>\n' : "",
    MEDICINE_LIST: shop.kind === "pharmacy" ? MEDICINE_LIST : "",
  };
  copyTemplate(TEMPLATE, out, values);
  if (shop.kind === "pharmacy") {
    copyTemplate(PHARMACY, out, values);
  }
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path.join(out, "shop.json"), json(shop));
  writeFileSync(path.join(out, "catalog.json"), json(publicCatalog(parsed.items)));
  writeFileSync(path.join(out, `${id}.hocon`), `# ${shop.name}'s agent network. Generated by shop-kit/generate.mjs from shop-kit/shops/${id}.json.\n# Do not edit: change the profile or shop-kit/lib/network.mjs and generate again.\n${JSON.stringify(buildShopNetwork(shop), null, 4)}\n`);
  writeFileSync(path.join(out, "agent-manifest.json"), json(buildShopManifest(shop)));
  writeFileSync(path.join(out, "links.json"), json({ version: 1, networks: { [id]: {} } }));
  writeFileSync(path.join(out, "_headers"), headersFile(id));
  cpSync(path.join(TOOLKIT, "runtime"), path.join(out, "runtime"), { recursive: true });
  for (const file of ["clock.js", "directory.js", ...(shop.kind === "pharmacy" ? ["prescription.js", "prescription-panel.js"] : [])]) {
    cpSync(path.join(REPO, "sites/nearshelf/js", file), path.join(out, "js", file));
  }
  for (const file of STAND_INS) {
    cpSync(path.join(TOOLKIT, "templates/tests", file), path.join(out, "tests", file));
  }
  execFileSync(process.execPath, [path.join(TOOLKIT, "scripts/build_network.mjs"), path.join(out, `${id}.hocon`), "--manifest", path.join(out, "agent-manifest.json")], { stdio: "inherit" });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = process.argv[2];
  const ids = arg === "--all"
    ? DIRECTORY.places.filter((place) => place.category !== "parts_catalogue" && existsSync(path.join(REPO, "shop-kit/shops", `${place.id}.json`))).map((place) => place.id)
    : [arg];
  if (!arg) {
    console.error("Usage: node shop-kit/generate.mjs <shop id> | --all");
    process.exit(1);
  }
  for (const id of ids) {
    try {
      console.log(`Generated ${path.relative(REPO, generateShop(id))}`);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
}
