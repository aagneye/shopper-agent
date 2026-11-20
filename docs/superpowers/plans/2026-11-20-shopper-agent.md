# NearShelf Shopper Agent Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `sites/nearshelf`, the shopper's personal agent site. It shortlists open, verified Neem Chowk shops, asks their agents (partners) after consent, shows a comparison board, and keeps hold codes. Personal details stay on the device.

**Architecture:** A static page whose own modules hold all business logic: clock, directory, fewest stops, profile store, page object. These are exposed to the vendored browser runtime as five `website_*` tools. A two-agent network (`nearshelf_assistant` and `parts_fitment_specialist`) calls six partner networks declared up front. The partner sites arrive in Phase 2; Phase 1 is complete when every test passes and the page works in a browser with the partners still offline.

**Tech Stack:** HTML, CSS, ES modules, a JSON module import for the directory, and Node 22 `node:test`. No dependencies. The toolkit is vendored at `vendor/agentify-website`.

**Spec:** `docs/idea.md`, `docs/superpowers/plans/2026-11-20-nearshelf-architecture.md` (contracts in §3.3, hosts in §4).

## Global Constraints

The constraints in the architecture plan apply. In addition:

- **Page code must run under the template's DOM stand-ins.**
  - Find elements by id only (`getElementById`, or `querySelector("#id")`).
  - Build nodes with `createElement`, `textContent`, `className`, `dataset` and `replaceChildren`.
  - Never use `innerHTML`, `classList`, `closest`, `matches` or `querySelectorAll`.
  - Start timers only when `typeof window !== "undefined"`.
- **Clock:** `App.clock` (default `() => new Date()`) is the only clock; tests replace it before loading the page.
- **Storage:** the key is `nearshelf.profile.v1`. When `localStorage` is missing or throws, the page keeps working from memory.
- **Directory:** load it with `import directory from "../directory/neem-chowk.json" with { type: "json" };`. No `fetch`.
- **Partner origins** (exact, used in the directory, hocon `tools`, `link_labels` and manifest `allowed_peers`):

| Place id | Category | Network URL | Label |
|---|---|---|---|
| shanti_medical | pharmacy | `http://localhost:8081/shanti_medical` | Shanti Medical |
| night_owl_pharmacy | pharmacy | `http://[::1]:8082/night_owl_pharmacy` | Night Owl Pharmacy |
| jeevan_chemist | pharmacy | `http://localhost:8083/jeevan_chemist` | Jeevan Chemist |
| bharat_auto_spares | auto_parts | `http://localhost:8084/bharat_auto_spares` | Bharat Auto Spares |
| speedline_moto_parts | auto_parts | `http://[::1]:8085/speedline_moto_parts` | Speedline Moto Parts |
| vayu_parts_catalogue | parts_catalogue | `http://[::1]:8086/vayu_parts_catalogue` | Vayu Parts Catalogue |

## Review Focus

1. **A shopper outside India** (for example a judge in the US): "open now" must follow Neem Chowk time (IST), never the browser's time zone. Test: 2026-11-20T17:15:00Z is Fri 10:45 pm IST in `clock.test.mjs` and `directory.test.mjs`.
2. **Shops open 24 hours or past midnight:** Night Owl reads "open 24 hours". A range `18:00–02:00` is open at 1:30 am the next day and closed at 2:00 am. Test in `directory.test.mjs`.
3. **Private window or blocked storage:** `localStorage` throws on every call. The page still renders and saves to memory, and results report `saved: false`. Test in `profile-store.test.mjs`.
4. **Model mistakes on the board:** the same shop twice, or a blank `need`, are refused with `ok: false` and the board is left unchanged. An unknown shop id is refused by the schema enum. Test in `page.test.mjs` and `agentified.test.mjs`.
5. **A shop that didn't answer, or a declined card:** a `no_answer` or `declined` row must never show an item, price or stock time, even if the model sends them. Test in `page.test.mjs`.

---

### Task 1: Repo tooling and the vendored toolkit

**Files:**
- Create: `package.json`, `.gitignore`, `.gitattributes`, `README.md`
- Create: `vendor/agentify-website/**`, copied unchanged from `C:/Projects/agentic-web/skills/agentify-website`, plus `vendor/agentify-website/LICENSE` (the repo's Apache-2.0 license) and `vendor/agentify-website/UPSTREAM.md`

- [ ] **Step 1:** `git init -b main`, then `git checkout -b shopper-agent`. Commit `docs/idea.md` (`docs: add NearShelf idea`), then both plans (`docs: add architecture and shopper plans`).
- [ ] **Step 2:** Write `package.json`: `{"name":"nearshelf","private":true,"type":"module","engines":{"node":">=22"}}`, with these scripts:
  - `build:nearshelf`: `node vendor/agentify-website/scripts/build_network.mjs sites/nearshelf/nearshelf.hocon --manifest sites/nearshelf/agent-manifest.json`
  - `check:nearshelf`: the same command plus ` --check`
  - `test:nearshelf`: `node --test "sites/nearshelf/tests/*.test.mjs"`
  - `serve:nearshelf`: `node vendor/agentify-website/scripts/serve_site.mjs sites/nearshelf --port 8080 --open-as 127.0.0.1`
  - `test`: `npm run test:nearshelf`
- [ ] **Step 3:** `.gitattributes`: `* text=auto eol=lf`. `.gitignore`: `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `requests.jsonl`.
- [ ] **Step 4:** Copy the toolkit, then verify: `node vendor/agentify-website/scripts/serve_site.mjs --help` prints `Usage: node serve_site.mjs`.
- [ ] **Step 5:** Commit `chore: set up repo tooling`, then `chore: vendor agentify-website toolkit`.

### Task 2: Neem Chowk clock and places directory

**Files:**
- Create: `sites/nearshelf/js/clock.js`, `sites/nearshelf/js/directory.js`, `sites/nearshelf/directory/neem-chowk.json`
- Test: `sites/nearshelf/tests/clock.test.mjs`, `sites/nearshelf/tests/directory.test.mjs`

**Interfaces:**
- Produces:
  - `areaNow(date: Date, timeZone: string, demoTime: string|null) -> {date, day, time, weekday, minutes, demoTime}`. `weekday` is one of `"mon"`…`"sun"`, `minutes` runs 0–1439, `day` looks like `"Fri, Nov 20, 2026"` and `time` like `"10:45 pm"`.
  - `formatMinutes(m: number) -> string`, where 1440 gives `"midnight"`.
  - `validateDirectory(doc) -> {ok: true, directory} | {ok: false, reason}`
  - `openState(hours, now) -> {open: boolean, label: string}`
  - `distanceMeters(a: {lat, lng}, b: {lat, lng}) -> number` (haversine, R = 6371008.8)
  - `formatDistance(m) -> "210 m" | "1.2 km"`
  - `shortlistShops(directory, {category, openNow = true, limit = 4, exclude = [], spotId, now}) -> {shops, notAsked, moreOpen}`
  - `toolNameFor(networkUrl) -> string` (the last path segment)

**Directory data:**

| Spot id | Name | lat, lng |
|---|---|---|
| metro-gate | Neem Chowk Metro, Gate 2 | 28.6000, 77.2000 |
| gulmohar | Gulmohar Park Society | 28.6045, 77.1960 |
| bus-stand | Old Bus Stand | 28.5955, 77.2055 |

| Place | Address | lat, lng | Hours (IST) | Verified ref |
|---|---|---|---|---|
| shanti_medical | 14 Gandhi Road | 28.6012, 77.2016 | mon–sat 09:00–23:00, sun 10:00–23:00 | DL-NC-0142 (demo) |
| night_owl_pharmacy | 2 Station Road | 28.5978, 77.2031 | every day 00:00–24:00 | DL-NC-0177 (demo) |
| jeevan_chemist | Shop 5, Gulmohar Market | 28.6041, 77.1972 | mon–sat 08:30–21:00, sun 09:00–14:00 | DL-NC-0093 (demo) |
| bharat_auto_spares | Motor Market, Lane 3 | 28.5949, 77.2071 | mon–sat 10:00–20:00 (sun closed) | GST-NC-2219 (demo) |
| speedline_moto_parts | Ring Road Service Lane | 28.6071, 77.2086 | every day 09:30–21:30 | GST-NC-2384 (demo) |
| vayu_parts_catalogue | Online catalogue | none | every day 00:00–24:00 | Vayu Motors (demo maker) |

The pharmacies are verified by "Neem Chowk Chemists' Association (demo)" and the dealers by "Neem Chowk Traders' Association (demo)". Each place's `page` is its origin plus `/`.

- [ ] **Step 1: Write the failing tests.**
  - `areaNow(new Date("2026-11-20T17:15:00Z"), "Asia/Kolkata", null)` deep-equals `{date: "2026-11-20", day: "Fri, Nov 20, 2026", time: "10:45 pm", weekday: "fri", minutes: 1365, demoTime: null}`.
  - `areaNow(new Date("2026-11-20T19:00:00Z"), …)` gives weekday `"sat"`, date `"2026-11-21"` and time `"12:30 am"`.
  - With demo time `"22:45"` on `2026-11-21T03:30:00Z`, it gives minutes 1365 and date `"2026-11-21"`.
  - `formatMinutes`: 0 → `"12:00 am"`, 540 → `"9:00 am"`, 720 → `"12:00 pm"`, 1440 → `"midnight"`.
  - `validateDirectory(bundled).ok === true`. Each of these is refused: a duplicate id (reason contains `Duplicate place id`), an unknown category, a time `"25:00"`, a shop with no lat, and an agent URL `ftp://x`.
  - `openState` (at the IST instants above):
    - Shanti at Fri 10:45 pm: `{open: true, label: "open until 11:00 pm"}`.
    - Shanti at Fri 11:00 pm (17:30Z): `"closed, opens Sat 9:00 am"`.
    - Night Owl: `"open 24 hours"`.
    - Jeevan at Fri 10:45 pm: `"closed, opens Sat 8:30 am"`.
    - Jeevan at Sat 12:30 am: `"closed, opens 8:30 am"`.
    - Jeevan at Sun 3:00 pm (2026-11-22T09:30Z): `"closed, opens Mon 8:30 am"`.
    - Bharat at Sun 12:00 pm (06:30Z): `"closed, opens Mon 10:00 am"`.
    - Hours `{sat: [["18:00","02:00"]]}`: Sun 1:30 am gives `"open until 2:00 am"`, and Sun 2:00 am gives `"closed, opens Sat 6:00 pm"`.
  - `formatDistance`: 205.4 → `"210 m"`, 995 → `"1.0 km"`, 1152.5 → `"1.2 km"`.
  - `shortlistShops` at Fri 10:45 pm from metro-gate, pharmacy:
    - shops `[shanti_medical "210 m" "open until 11:00 pm", night_owl_pharmacy "390 m" "open 24 hours"]`
    - `notAsked` `[{id: "jeevan_chemist", reason: "closed, opens Sat 8:30 am"}]`, `moreOpen` 0.
    - `exclude: ["shanti_medical"]` gives shops `[night_owl_pharmacy]`, with `notAsked` containing `{id: "shanti_medical", reason: "already asked"}`.
    - `limit: 1` gives `moreOpen: 1`.
    - `openNow: false` lists all three, nearest first.
  - auto_parts at Sun 12:00 pm gives shops `[speedline_moto_parts "1.2 km" "open until 9:30 pm"]`; Bharat is not asked: `"closed, opens Mon 10:00 am"`.
  - An unverified pharmacy fixture is not asked, with reason `"license not verified"`.
  - Each shop entry has `askWith === toolNameFor(agent.network)`.
- [ ] **Step 2:** `node --test "sites/nearshelf/tests/clock.test.mjs" "sites/nearshelf/tests/directory.test.mjs"` fails, because the module doesn't exist yet.
- [ ] **Step 3:** Implement.
  - Use `Intl.DateTimeFormat("en-US", {timeZone, weekday: "short", year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23"})` with `formatToParts`.
  - `openState` checks today's ranges, then yesterday's ranges that run past midnight. The next opening scans up to 7 days ahead. The label gives the time alone on the same calendar day, otherwise the weekday plus the time.
  - Distance rounds to the nearest 10 m below 1000 m, and to `toFixed(1)` km at or above it.
- [ ] **Step 4:** Run the tests again; all pass.
- [ ] **Step 5:** Commit `feat(nearshelf): add Neem Chowk directory and clock`.

### Task 3: Fewest-stops planner

**Files:** Create `sites/nearshelf/js/fewest-stops.js`. Test: `sites/nearshelf/tests/fewest-stops.test.mjs`

**Interfaces:**
- Produces: `planFewestStops(items: string[], offers: {shopId, name, distanceMeters, has: string[]}[]) -> {ok: true, stops: [{shopId, name, items}], covered, missing, summary} | {ok: false, reason}`

- [ ] **Step 1: Write the failing tests.**
  - Items `["Amoxicillin 500 mg capsules", "ORS sachets", "Paracetamol syrup"]`.
  - Shanti (205) has the first two, Night Owl (389) has the last two, and Jeevan (531) has all three. The result is stops `[jeevan_chemist]` with summary `"1 stop covers all 3 items."`.
  - Without Jeevan: stops Shanti `[Amoxicillin…, ORS sachets]` and Night Owl `[Paracetamol syrup]`, with summary `"2 stops cover all 3 items."`.
  - Nobody has the syrup: missing `["Paracetamol syrup"]`, with summary `"1 stop covers 2 of 3 items."`.
  - Both have only ORS: Shanti is picked (shorter distance).
  - `has: ["ors sachets"]` matches without regard to case.
  - `has: ["Cough syrup"]` gives `{ok: false, reason: "\"Cough syrup\" is not one of the items."}`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement.
  - Look at every non-empty subset of the offers (at most 6, so 63 subsets).
  - Rank by more items covered, then fewer stops, then smaller total distance, then ids in alphabetical order.
  - Give each item to the nearest chosen shop that has it.
  - Keep stops in order of distance.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit `feat(nearshelf): add fewest-stops planner`.

### Task 4: On-device profile store

**Files:** Create `sites/nearshelf/js/profile-store.js`. Test: `sites/nearshelf/tests/profile-store.test.mjs`

**Interfaces:**
- Produces: `class ProfileStore` with:
  - `constructor(storage?)`, defaulting to `globalThis.localStorage`; any access error falls back to memory
  - `profile` (a getter that returns a copy)
  - `addVehicle({maker, model, year, variant})`, `removeVehicle(id)`
  - `addListItem({name, qty})`, `removeListItem(id)`
  - `addHold({shopId, shopName, item, code, until})`, `removeHold(id)`
  - `setSpot(spotId)`, `setDemoTime(value|null)`
- Every method returns `{ok: true, saved: boolean, ...}` or `{ok: false, reason, field}`.
- Defaults: `{version: 1, spotId: "metro-gate", demoTime: null, vehicles: [], list: [], holds: []}`.

- [ ] **Step 1: Write the failing tests.**
  - With no storage it works in memory.
  - Corrupt JSON in the key gives the defaults.
  - Two stores sharing one fake storage see each other's saves.
  - Vehicle checks:
    - Year 1979 gives `{ok: false, field: "year", reason: "Enter a year from 1980 to 2027."}`.
    - A missing maker gives `"Enter the vehicle's maker."`.
    - The label for `{maker: "Vayu", model: "Zip 125", year: 2019, variant: "drum brake"}` is `"Vayu Zip 125 (2019, drum brake)"`.
    - A sixth vehicle gives `"You can save up to 5 vehicles."`.
  - List items: the label for `{name: "ORS sachets", qty: "4"}` is `"ORS sachets × 4"`, and a thirteenth item gives `"You can save up to 12 items."`.
  - Holds: the same `shopId` and code (in any case) returns `duplicate: true` without adding. A 21st hold drops the oldest.
  - Storage whose `getItem`/`setItem` throw: methods still return `ok: true` with `saved: false`.
  - `setDemoTime("25:00")` gives `{ok: false, field: "demoTime"}`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement. Ids come from `crypto.randomUUID()` when it exists, otherwise from a counter plus `Date.now()`.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit `feat(nearshelf): add on-device profile store`.

### Task 5: Shopper page

**Files:**
- Create: `sites/nearshelf/index.html`, `styles.css`, `favicon.svg`, `js/app.js`, `js/shopper-page.js`, `js/render.js`, `js/search.js`
- Copy into `tests/`: the template stand-ins `stub_document.mjs`, `stub_element.mjs`, `stub_dialog.mjs`, `stub_option.mjs` and `scripted_model.mjs`
- Test: `sites/nearshelf/tests/page.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces: `App.page`, a `ShopperPage` with:
  - `getState() -> {area, now, from: {spotId, name}, vehicles: [{id, label}], myList: [{id, label}], holds: [{id, shopId, shop, item, code, until}], results: null | {need, askedAt, rows}, onDevice}`
  - `findShops(args)` (Task 2 shape plus `ok: true`, `category`, `now`, `from`)
  - `planStops({items, offers: [{shopId, has}]})`
  - `showResults({need, rows})` returns `{ok: true, need, shown}`
  - `saveHold({shopId, item, code, until})` returns `{ok: true, holds, duplicate}`
  - Page-only: `removeHold`, `addVehicle`, `removeVehicle`, `addListItem`, `removeListItem`, `setSpot`, `setDemoTime`
- Also: `App.clock` and `App.storage` (both settable before the import). `composeRequest({need, category, openNow}) -> string` in `js/search.js`.
- Page ids:
  - Search: `need-form`, `need-input`, `need-category`, `need-open-now`, `need-status`, `chip-syrup`, `chip-ors`, `chip-clutch`
  - Header: `clock-line`
  - Results and holds: `results-summary`, `results`, `holds-empty`, `holds`
  - Shops and area: `shops`, `spot-select`, `demo-time-select`
  - Garage: `garage-form`, `garage-maker`, `garage-model`, `garage-year`, `garage-variant`, `garage-status`, `garage-list`
  - List: `list-form`, `list-name`, `list-qty`, `list-status`, `list-items`
  - Assistant (from the template): `assistant`, `assistant-heading`, `assistant-status`, `agent-app`
- Board labels: `in_stock` → "In stock", `limited` → "Few left", `out_of_stock` → "Out of stock", `no_answer` → "No answer", `declined` → "Not asked (you declined)".
- Board order: in_stock, then limited, out_of_stock, no_answer, declined; distance breaks ties.

- [ ] **Step 1: Write the failing tests.** They use the stand-in document from `index.html`, with the clock pinned to 2026-11-20T17:15:00Z.
  - The page loads, `#shops` gets 6 children, and `#clock-line` text contains `"10:45 pm"`.
  - `showResults` with two rows renders 2 cards, and the first one's text contains `"Few left"`, `"₹38"` and `"Stock as of 10:44 pm"`.
  - A `no_answer` row that carries a price `"₹99"` renders no `"₹99"`.
  - Duplicate rows return `{ok: false, field: "rows"}` and leave the board as it was.
  - A blank need returns `{ok: false, field: "need"}`.
  - `findShops` and `planStops` leave `document.snapshot()` unchanged.
  - `saveHold` adds a hold to `#holds` and hides `#holds-empty`.
  - Submitting `#garage-form` (dispatch `"submit"`) with valid values adds a `#garage-list` child.
  - `composeRequest({need: "ORS sachets", category: "pharmacy", openNow: true})` equals `"Medicine: ORS sachets. Ask pharmacies that are open now whether they have it, and compare their answers."`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement the page. The hero has the search form and the try-chips. A two-column layout puts the assistant section on the left and the board, holds and shops on the right. Below it come "Your details (saved on this device only)", "How it works" and a footer noting the fictional demo, with links to `agent-manifest.json`, `nearshelf.network.json` and `directory/neem-chowk.json`. `styles.css` adds the template's `assistant.css` rules, with `--ns-primary: #0f5f4f` and `--ns-accent: #9a3412`.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit `feat(nearshelf): add shopper page`.

### Task 6: Site actions

**Files:** Create `sites/nearshelf/site-actions.js`. Test: `sites/nearshelf/tests/actions.test.mjs`

**Interfaces:**
- Consumes: `App.page` (Task 5).
- Produces: `registerActions(actions)`, which registers these actions (all local-only):

| Name | Effect | Required args |
|---|---|---|
| get_shopper_state | read | (none) |
| find_shops | read | `category` (enum `pharmacy`, `auto_parts`, `parts_catalogue`); optional `openNow` boolean, `limit` integer 1–4, `exclude` array of place-id enum (max 6) |
| plan_fewest_stops | read | `items` (2–8 strings, max 80 chars), `offers` (1–6 of `{shopId: enum of shop ids, has: string[]}`) |
| show_results | write | `need` (1–120 chars), `rows` (1–6 of `{shopId: enum, availability: enum in_stock\|limited\|out_of_stock\|no_answer\|declined, item ≤120, price ≤40, asOf ≤40, note ≤160}`) |
| save_hold | write | `shopId` (enum), `item` (1–120 chars), `code` (1–40 chars); optional `until` (≤60 chars) |

Both write descriptions contain "only when the visitor asks".

- [ ] **Step 1: Write the failing tests.**
  - The registry catalog has exactly these 5 names, each `local-only`.
  - `execute` of `find_shops` with `{category: "pharmacy"}` returns `askWith` values `["shanti_medical", "night_owl_pharmacy"]`.
  - A `show_results` call with shop id `"nowhere"` throws or refuses in `prepare` (schema).
  - No description contains `TODO`.
- [ ] **Step 2:** The tests fail.
- [ ] **Step 3:** Implement from `vendor/agentify-website/templates/site-actions.js`, wrapping `App.page` methods only.
- [ ] **Step 4:** The tests pass.
- [ ] **Step 5:** Commit `feat(nearshelf): add website tools`.

### Task 7: Network, manifest and build

**Files:**
- Create: `sites/nearshelf/nearshelf.hocon`, `agent-manifest.json`, `links.json`
- Copy: `runtime/` (unchanged)
- Generated: `nearshelf.network.json`, `agent-mcp.json`, `.well-known/nsdeploy.json`, `.well-known/nsdeploy-agent.json`, `bridge/action-bridge.html`, `bridge/agent-manifest.json`
- Test: `sites/nearshelf/tests/partners.test.mjs`

**Exact values:**
- Network `nearshelf`, with front agent `nearshelf_assistant` and specialist `parts_fitment_specialist`. Model `alibaba/qwen3.8-flash`, `max_steps` 12, `cruse` `{version: 1}`.
- Front-agent `tools`: `parts_fitment_specialist` plus the 5 shop URLs. The specialist's `tools`: the catalogue URL. `link_labels` covers all 6.
- Replacement strings:
  - `site_name`: "Neem Chowk"
  - `grounding_rules`: the template text, with the TODO line replaced by `NearShelf cannot deliver, take payment, order or sell online, book a doctor, or alert anyone later when stock arrives. It asks shops only while this page is open.` and `website_<read_action>` replaced by `website_find_shops`
  - `shop_rules`: what to ask a shop, plus the medicine rules (no diagnosis, dose or switching advice; the same-composition note; prescription items hold-only; 112 in an emergency)
  - `partner_rules`: verbatim, with `website_find_shops`
  - `cruse_rules`: verbatim
- Manifest:
  - `brand` "NearShelf", `theme.primary` "#0f5f4f"
  - `llm_router`: Otari, with `mock: false`
  - `allowed_peers`: the 6 origins, `peer_policy` closed
  - `agentTools`: the 5 names
- Sample queries (the same in the hocon and the manifest):
  1. "Which pharmacies near me are open right now?"
  2. "Is children's paracetamol syrup in stock at a pharmacy that's open now?"
  3. "Where can I get amoxicillin 500 mg capsules and ORS sachets with the fewest stops?"
  4. "My 2019 Vayu Zip 125 needs a clutch cable. Which dealer has it?"
  5. "Hold one pack of ORS sachets for me at Night Owl Pharmacy."
  6. "What dose of paracetamol should I give my 4-year-old?"

- [ ] **Step 1: Write the failing test.** `partners.test.mjs` checks that:
  - every directory place's `agent.network` is in exactly one agent's `tools`
  - every such URL has a `link_labels` value equal to its directory label
  - the manifest `allowed_peers` equals the set of their origins
  - no partner is left over.
- [ ] **Step 2:** The test fails (no hocon yet).
- [ ] **Step 3:** Write the hocon, manifest and links, copy the runtime, then run `npm run build:nearshelf`. Expected: `0 errors`, `0 warnings`.
- [ ] **Step 4:** The test passes.
- [ ] **Step 5:** Commit `feat(nearshelf): add agent network and manifest`.

### Task 8: Mount the assistant and the runtime integration tests

**Files:**
- Create: `sites/nearshelf/site.js`
- Modify: `index.html` (assistant section)
- Test: `sites/nearshelf/tests/agentified.test.mjs`, adapted from the template

**Interfaces:**
- `AssistantMount` from the template:
  - `GREETING` = `"Tell me what you need, like a medicine or a vehicle part. I'll ask nearby shops that are open, compare their answers and help you hold it for pickup."`
  - `DIALOGS = {}`, since the site has no irreversible actions; holds are confirmed in the shop's window.
- `NearShelfSearch.wire()` runs in the browser only. It puts `composeRequest(...)` into `#ns-input` and clicks `#ns-send`. When the assistant isn't ready, it writes the reason to `#need-status`.

- [ ] **Step 1: Write the failing tests.** Keep the template's:
  - `testNetworkIsValid`, plus one check that the front instructions contain `"NearShelf cannot deliver"` and `"call 112"`
  - `testActionsMatchManifest`, `testReadActionRunsAsTool` (with `CALL_BUDGET` 16000), `testWriteActionChangesState` (show_results, plus an unknown shop giving `Error from tool`)
  - `testAssistantSectionIsFilledIn`, `testPartnerActionGetsRuntimeDialog`, `testOtherBundlesGetRuntimeDialog`, `testConsentFocusesTheCardThenTheChat`, `testConsentLeavesFocusInThePage`

  Delete the tests that assume an irreversible action, with a comment saying why.
- [ ] **Step 2:** The tests fail (no `site.js`).
- [ ] **Step 3:** Implement `site.js` from the template, plus the search wiring.
- [ ] **Step 4:** `npm run check:nearshelf && npm test`: everything passes.
- [ ] **Step 5:** Commit `feat(nearshelf): mount the assistant`.

### Task 9: Hosting headers, README and browser check

**Files:** Create `sites/nearshelf/_headers` and `sites/nearshelf/README.md`. Modify the root `README.md`.

- [ ] **Step 1:** Write `_headers` from `references/bundle_and_hosting.md`:
  - CORS `*` on `agent-manifest.json`, `nearshelf.network.json`, `links.json`, `agent-mcp.json`, both `.well-known` files and `directory/neem-chowk.json`
  - the sandbox-worker CSP.
- [ ] **Step 2:** Write the README from the skill's checklist: run command, file list, data flow (messages go to the chosen AI provider), network URL, partners and the consent card, limits.
- [ ] **Step 3: Browser check.** Run `npm run serve:nearshelf` and open `http://127.0.0.1:8080/`.
  - The page renders, `#assistant-status` says the assistant needs a key, and there are no console errors other than the runtime's known messages.
  - The consent-card console snippet (from `bundle_and_hosting.md`) shows the card.
  - A `show_results` call through `engine.actions` fills the board.
- [ ] **Step 4:** Commit `docs(nearshelf): add README and hosting headers`.
