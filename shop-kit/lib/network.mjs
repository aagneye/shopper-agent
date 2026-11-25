// Builds a shop's agent network and manifest from its public profile (shop.json).
// The grounding, partner and presentation rules come from the agentify-website template,
// read with the runtime's own HOCON parser, so they stay word for word.
import { readFileSync } from "node:fs";
import { parseHocon } from "../../vendor/agentify-website/runtime/hocon.js";

const TEMPLATE = parseHocon(readFileSync(new URL("../../vendor/agentify-website/templates/network.hocon", import.meta.url), "utf8"));
const RULES = TEMPLATE.commondefs.replacement_strings;
const READ_ACTION = "website_get_shop_info";
const MODEL = "alibaba/qwen3.8-flash";

export const AGENT_TOOLS = ["check_stock", "get_shop_info", "request_hold"];

const CANNOT = {
  pharmacy: "This shop cannot deliver, take payment or sell online, give medical advice, or hold Schedule X medicines. Held items are paid for and picked up at the counter.",
  auto_parts: "This shop cannot deliver, take payment or sell online, or fit parts. Held parts are paid for and picked up at the counter.",
};

const ANSWER_RULES = {
  pharmacy: `
For a stock question, call website_check_stock, then start your reply with this line, from the best full match:
AVAILABILITY: in_stock|limited|out_of_stock · ITEM: <name, strength, pack> · PRICE: <price> · STOCK AS OF: <asOf> · HOLD: yes|no|prescription
When an amount is asked for, pass amount and unit, and add this line, with supply.text copied exactly: CAN GIVE: <supply.text>. If no amount is asked for, answer, then ask how many are needed, or how many times a day and for how many days.
If nothing matches, use out_of_stock and say the shop does not stock it. Give no count except CAN GIVE: limited means only a few are left.
Never diagnose, give a dose, or say which medicine to take or switch to; say to ask a doctor or pharmacist. You may name an item with the same composition as information, adding: ask your doctor or pharmacist before switching. In an emergency, say to call 112.
To hold an item, call website_request_hold with its id and supply.packs as qty, at most 5. The visitor types their own name, phone and pickup time in the shop's form, so never ask for them. Then reply: HOLD: <code> until <until>.
`,
  auto_parts: `
For a stock question, call website_check_stock with the part number, or the part and vehicle, then start your reply with this line, from the best full match:
AVAILABILITY: in_stock|limited|out_of_stock · ITEM: <part name, part number, genuine or compatible> · PRICE: <price> · STOCK AS OF: <asOf> · HOLD: yes|no
If nothing matches, use out_of_stock and say the shop does not stock it. Never give a count: limited means only a few are left. Say which vehicles a part fits.
To hold a part, call website_request_hold with its id. The visitor types their own name, phone and pickup time in the shop's form, so never ask for them. Then reply: HOLD: <code> until <until>.
`,
};

const SAMPLE_QUERIES = {
  pharmacy: [
    "Do you have children's paracetamol syrup?",
    "Is amoxicillin 500 mg in stock, and can it be held?",
    "Hold one pack of ORS sachets for me.",
    "Are you open now, and where are you?",
    "What dose of cetirizine should I take?",
  ],
  auto_parts: [
    "Do you have part VZ125-CLC-1722?",
    "Do you have a clutch cable for a 2019 Vayu Zip 125?",
    "Hold one A7 spark plug for me.",
    "Are you open now, and where are you?",
    "Can you fit the part for me?",
  ],
};

const KIND_LABELS = { pharmacy: "pharmacy", auto_parts: "vehicle parts dealer" };

/**
 * The template's grounding rules with this shop's "cannot" line and read action.
 *
 * :param kind: "pharmacy" or "auto_parts".
 * :return: The rules text.
 */
function groundingRules(kind) {
  const lines = RULES.grounding_rules.split("\n").map((line) => (line.startsWith("TODO: list what this site cannot do") ? CANNOT[kind] : line));
  return lines.join("\n").replace("website_<read_action>", READ_ACTION);
}

/**
 * The shop's agent network, as data the build turns into <id>.network.json.
 *
 * :param shop: The shop's public profile (shop.json).
 * :return: The network object.
 */
export function buildShopNetwork(shop) {
  const partnerTools = shop.partners.map((partner) => partner.network);
  const partnerLines = shop.partners.map((partner) => `- If an item is out of stock and the visitor wants it, offer to ask ${partner.id}, our partner shop ${partner.name}; ask it only after they agree, about that item only.`);
  const instructions = [
    `You are the assistant of {site_name}, a ${KIND_LABELS[shop.kind]} in Neem Chowk. You answer what is in stock from the shop's live billing stock, and hold items for pickup.`,
    "{grounding_rules}",
    "{answer_rules}",
    ...(partnerLines.length ? ["How to work:", ...partnerLines, "{partner_rules}"] : []),
    "{cruse_rules}",
  ].join("\n");
  const strings = {
    site_name: shop.name,
    grounding_rules: groundingRules(shop.kind),
    answer_rules: ANSWER_RULES[shop.kind],
    ...(partnerLines.length ? { partner_rules: RULES.partner_rules.replace("website_<read_action>", READ_ACTION) } : {}),
    cruse_rules: RULES.cruse_rules,
  };
  return {
    metadata: {
      description: `Ask ${shop.name} what is in stock right now, from its live billing stock, and hold an item for pickup.`,
      sample_queries: SAMPLE_QUERIES[shop.kind],
    },
    llm_config: { model_name: MODEL },
    max_steps: 12,
    cruse: { version: 1 },
    ...(partnerTools.length ? { link_labels: Object.fromEntries(shop.partners.map((partner) => [partner.network, partner.name])) } : {}),
    commondefs: { replacement_strings: strings },
    tools: [
      {
        name: `${shop.id}_assistant`,
        function: {
          description: `Answer what ${shop.name} has in stock right now and hold an item for pickup.`,
          parameters: {
            type: "object",
            properties: { request: { type: "string", description: "The request in plain language." } },
            required: ["request"],
          },
        },
        instructions: `\n${instructions}\n`,
        tools: partnerTools,
      },
    ],
  };
}

/**
 * The shop's agent-manifest.json.
 *
 * :param shop: The shop's public profile (shop.json).
 * :return: The manifest object.
 */
export function buildShopManifest(shop) {
  const network = buildShopNetwork(shop);
  const front = `${shop.id}_assistant`;
  const peers = [...new Set(shop.partners.map((partner) => new URL(partner.network).origin))];
  return {
    brand: shop.name,
    networks: [
      {
        name: shop.id,
        front_man: front,
        hocon: `./${shop.id}.network.json`,
        description: `Ask ${shop.name} what is in stock right now and hold an item for pickup.`,
        tags: ["agentified-website", "local-shop", shop.kind],
        sample_queries: network.metadata.sample_queries,
      },
    ],
    llm_router: { base_url: "https://api.otari.ai/api/v1", mock: false, byok_router: "https://api.otari.ai/api/v1" },
    allowed_peers: peers,
    peer_policy: {
      mode: "closed",
      deny_origins: [],
      note: peers.length ? "Calls only its partner shop in allowed_peers, after the visitor agrees." : "Local agents and page-local actions only.",
    },
    agent_mcp: {
      protocol: "nsdeploy-agent-mcp/v1",
      network: shop.id,
      front_man: front,
      available: false,
      reason: "This is a static bundle; a public MCP facade requires an application host.",
    },
    theme: { primary: shop.theme },
    linking: {
      protocol: "nsdeploy-link/v1",
      exports: [{ network: shop.id, front_man: front, aliases: [shop.id, front], url: shop.id }],
      imports: [],
      link_updates: { mode: "browser-local" },
    },
    deployment: {
      mode: "static",
      self_contained_runtime: true,
      browser_mock: false,
      direct_byok: true,
      direct_mcp_requires_cors: true,
      public_mcp_facade: false,
    },
    actions: {
      version: 1,
      module: "./site-actions.js",
      bridge: "./bridge/action-bridge.html",
      agentTools: AGENT_TOOLS,
    },
  };
}
