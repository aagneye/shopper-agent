# NearShelf: the shopper's personal agent

NearShelf is the shopper's own agent site in the Neem Chowk demo. You tell it what you need, such as a medicine or a vehicle part. It then:

- picks up to four open, verified shops near you from the area's places directory;
- asks each shop's own agent network, after you agree on a consent card;
- puts the answers on a results board, with the time each shop checked its stock;
- keeps any hold code a shop gives you.

Your saved details (spot, vehicles, regular medicines, holds) are stored only in this browser and never sent to shops. When the assistant reads them, they go to the AI provider you choose, along with your messages.

Neem Chowk is fictional. Every shop, licence, brand and stock level is made up.

## Run it

Use Node.js 22 or newer and run from the repository root. There is nothing to install.

```shell
npm run serve:nearshelf
```

This serves the site at http://127.0.0.1:8080/ with the organizers' server, `vendor/agentify-website/scripts/serve_site.mjs`. That server sends the CORS header on the public agent files, so other agent sites can read them.

To try the assistant, open **⚙ AI model settings** in the assistant section. Then either paste a key for your AI provider (hosted Otari is the default) and select **Save and start**, or select **Connect with OpenRouter**.

- On `127.0.0.1` the runtime also copies the saved setup, key included, into a cookie for that host. Use a key with a low spending limit.
- Afterwards, select **Delete setup** under **Advanced settings (optional)**, then close the tab. The tab keeps using the key until it is closed.

The page works without a key: you can browse shops, set your spot and demo time, and save vehicles and items. The assistant then names the shops it would ask.

## What goes where

| Data | Goes to |
|---|---|
| Your messages and the page data the agent reads | The AI provider you choose in the settings, and nowhere else |
| A request to a shop, such as "Do you have ORS sachets?" | That shop's agent network, after you approve its consent card |
| Your name and phone for a hold | Typed in the shop's own window, so they never pass through an agent |
| Spot, vehicles, list, holds | Stored in this browser only (localStorage `nearshelf.profile.v1`). They reach the AI provider only when the assistant reads them |

## The agent network

The network URL is `http://127.0.0.1:8080/nearshelf`.

| Agent | Job | Tools |
|---|---|---|
| `nearshelf_assistant` (front) | Shortlists shops, asks them, compares their answers, keeps holds | `parts_fitment_specialist`, the 5 shop networks, and the website tools below |
| `parts_fitment_specialist` | Turns a vehicle and a part into the exact part number | The Vayu Parts Catalogue network |

Website tools (`agent-manifest.json` → `actions.agentTools`), all from `site-actions.js`:

| Tool | Effect | Wraps |
|---|---|---|
| `website_get_shopper_state` | read | `App.page.getState()`: Neem Chowk time, spot, saved details, the board |
| `website_find_shops` | read | `App.page.findShops()`: up to 4 open, verified shops, nearest first, each with the partner tool to call |
| `website_plan_fewest_stops` | read | `App.page.planStops()`: fewest shops that cover a list |
| `website_show_results` | write | `App.page.showResults()`: fills the results board |
| `website_save_hold` | write | `App.page.saveHold()`: keeps a shop's hold code in My holds |

Other agent sites can call this network, but they get no website tools, because NearShelf's bridge shares none. Their assistant can only say what NearShelf does.

## Linked sites

NearShelf asks these partner networks. They are built in phase 2 of the project.

| Partner | Network URL | Asked by |
|---|---|---|
| Shanti Medical | `http://localhost:8081/shanti_medical` | front agent |
| Night Owl Pharmacy | `http://[::1]:8082/night_owl_pharmacy` | front agent |
| Jeevan Chemist | `http://localhost:8083/jeevan_chemist` | front agent |
| Bharat Auto Spares | `http://localhost:8084/bharat_auto_spares` | front agent |
| Speedline Moto Parts | `http://[::1]:8085/speedline_moto_parts` | front agent |
| Vayu Parts Catalogue | `http://[::1]:8086/vayu_parts_catalogue` | fitment specialist |

How the consent card works:

- Before any contact, a card names the shop, its host and the first 140 characters of the request. **Always allow** skips the card for that host until the page is reloaded.
- A request names the item, its strength or part number, and the quantity. The agent is told to ask a shop only about the item, and never to put names, emails, phone numbers or booking codes in a request. The runtime does not filter requests, so check what the card shows.
- A shop's network runs in this browser on your AI provider and key. It gets only the actions that shop's own bridge shares with NearShelf.
- A call costs more than the card's token estimate.

These partner URLs work only on this machine. Before hosting, the release step puts each partner's https URL in `tools`, `link_labels` and `allowed_peers`, then rebuilds.

## Files

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `favicon.svg` | The page |
| `js/app.js` | Page script; creates `App.page` |
| `js/shopper-page.js`, `js/render.js`, `js/search.js` | Page object, DOM building, search request |
| `js/clock.js`, `js/directory.js`, `js/fewest-stops.js`, `js/profile-store.js` | Neem Chowk time, places directory, fewest stops, on-device profile |
| `directory/neem-chowk.json` | The places directory (format `nearshelf-places/v1`) |
| `site.js` | Boots the assistant and connects the search form to the chat |
| `site-actions.js` | The website tools |
| `nearshelf.hocon` | Source of truth for the network |
| `nearshelf.network.json`, `agent-mcp.json`, `.well-known/`, `bridge/` | Written by the build; never edit by hand |
| `agent-manifest.json`, `links.json` | Public bundle files |
| `runtime/` | The browser runtime, copied unchanged from `vendor/agentify-website/runtime` |
| `_headers` | Hosting headers (CORS on the public agent files, sandbox worker CSP) |
| `tests/` | Node tests with the template's DOM stand-ins and scripted model |

## Build and test

```shell
npm run build:nearshelf   # nearshelf.hocon → nearshelf.network.json, with the runtime's validator
npm run check:nearshelf   # the same checks, and fails if a generated file is out of date
npm test                  # every test
```

## Limits

- **Static hosting with a patched runtime.** The runtime is the agentify-website copy of nsdeploy's runtime.
- **Writes run without a dialog.** `write` tools (the results board, My holds) run without showing the visitor first, which spec §3.1 asks for. Both change only this page's own panels.
- **Every agent sees every website tool.** Each agent's instructions say which tools are its job.
- **At most 4 partner calls per message, and 1 per partner.** The agent asks a shortlist and offers to ask more in the next message.
  - A call over the limit still shows its card first; allowing it only skips the call.
  - A partner that accepts the connection but never answers leaves the chat waiting until the page is reloaded.
- **The consent card shows only part of the request.** It shows the first 140 characters, and the partner gets all of it.
- **The AI provider must allow browser (CORS) requests.** Hosted Otari, OpenRouter and OpenAI do.
- **The network file is public**, including its instructions.
