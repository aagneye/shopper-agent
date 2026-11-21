// The directory, the network and the manifest must agree on every partner site: who is
// asked, by which agent, under which consent-card label, and which origins are allowed.
// Run: node --test "sites/nearshelf/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import directory from "../directory/neem-chowk.json" with { type: "json" };

const config = JSON.parse(await readFile(new URL("../nearshelf.network.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../agent-manifest.json", import.meta.url), "utf8"));

/**
 * The partner network URLs an agent lists in its tools.
 *
 * :param agent: An agent definition from the network.
 * :return: The http(s) URLs among its tools.
 */
function partners(agent) {
  return (agent.tools || []).filter((ref) => typeof ref === "string" && /^https?:\/\//.test(ref));
}

/**
 * One agent of the network by name.
 *
 * :param name: The agent's name.
 * :return: The agent definition.
 */
function agent(name) {
  return config.tools.find((candidate) => candidate.name === name);
}

test("every directory place's agent is a partner of exactly one agent, and no other partner exists", () => {
  const owners = new Map();
  for (const definition of config.tools) {
    for (const ref of partners(definition)) {
      owners.set(ref, [...(owners.get(ref) || []), definition.name]);
    }
  }
  for (const place of directory.places) {
    assert.equal((owners.get(place.agent.network) || []).length, 1, place.id);
  }
  assert.equal(owners.size, directory.places.length);
});

test("pharmacies and parts dealers are the front agent's partners, the catalogue is the specialist's", () => {
  const shops = directory.places.filter((place) => place.category !== "parts_catalogue").map((place) => place.agent.network);
  const catalogue = directory.places.filter((place) => place.category === "parts_catalogue").map((place) => place.agent.network);
  assert.deepEqual(partners(agent("nearshelf_assistant")).sort(), shops.sort());
  assert.deepEqual(partners(agent("parts_fitment_specialist")), catalogue);
  assert.ok(agent("nearshelf_assistant").tools.includes("parts_fitment_specialist"));
});

test("each partner's consent-card label is its directory label", () => {
  for (const place of directory.places) {
    assert.equal(config.link_labels[place.agent.network], place.agent.label, place.id);
  }
  assert.equal(Object.keys(config.link_labels).length, directory.places.length);
});

test("allowed_peers lists exactly the partners' origins, with the peer policy closed", () => {
  const origins = [...new Set(directory.places.map((place) => new URL(place.agent.network).origin))].sort();
  assert.deepEqual([...manifest.allowed_peers].sort(), origins);
  assert.equal(manifest.peer_policy.mode, "closed");
});

test("the network and the manifest name the same network, front agent and sample queries", () => {
  const entry = manifest.networks[0];
  assert.equal(entry.name, "nearshelf");
  assert.equal(entry.front_man, "nearshelf_assistant");
  assert.equal(entry.hocon, "./nearshelf.network.json");
  assert.deepEqual(entry.sample_queries, config.metadata.sample_queries);
  assert.equal(entry.sample_queries.length, 6);
});
