# Vayu Parts Catalogue

The Vayu Parts Catalogue is the fictional maker's official parts catalogue in the Neem Chowk demo, and an open agentic website. It gives the exact part number for a Vayu two-wheeler and a part, plus any compatible alternative. NearShelf's parts specialist asks it before asking dealers, so the dealers are asked about one exact part number.

## Run it

From the repository root, run `npm run dev`, which serves it at `http://[::1]:8086/`. To serve it alone:

```shell
node vendor/agentify-website/scripts/serve_site.mjs sites/vayu_parts_catalogue --host ::1 --port 8086
```

## The agent

- **Network URL:** `http://[::1]:8086/vayu_parts_catalogue`, with front agent `vayu_parts_catalogue_assistant`.
- **`lookup_part` (read):** takes the model, year, optional variant and kind of part, and returns part numbers, fitment and alternatives. If it needs the brake variant first, it says so.
- **Shared with every agent site** through the action bridge (`"*"`), because part numbers and fitment are public facts.
- **Every part answer starts with:** `PART: <partNo> · NAME: <name> · FITS: <fits> · TYPE: <type> · ALTERNATIVES: <…>`

The catalogue data is `catalogue.json`. This catalogue does not sell parts, check stock or hold parts: Neem Chowk's dealers do.

## Build and test

```shell
node vendor/agentify-website/scripts/build_network.mjs sites/vayu_parts_catalogue/vayu_parts_catalogue.hocon --manifest sites/vayu_parts_catalogue/agent-manifest.json
node --test "sites/vayu_parts_catalogue/tests/*.test.mjs"
```

The visitor's messages, and the catalogue data the assistant reads, go to the AI provider they choose.
