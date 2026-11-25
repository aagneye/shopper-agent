# NearShelf shop kit: agentify a shop in 3 steps

The shop kit turns a neighbourhood shop's billing export into an open agentic website. The shop's own agent answers what is on the shelf right now, any agent site can ask it, and it takes holds in the shop's own window. The five Neem Chowk shops in `sites/` were made with it.

## 1. Export the stock from the billing software

Most billing software can export a stock report to CSV. The kit reads two layouts.

**Pharmacy** (`schedule` is `OTC`, `H`, `H1` or `X`):

```csv
code,name,composition,strength,pack,schedule,mrp,qty
SM-1001,Paracetamol Oral Suspension (Paediatric),Paracetamol,120 mg/5 ml,60 ml bottle,OTC,38,2
```

**Vehicle parts** (`type` is `genuine` or `compatible`; `fits` lists models and year ranges):

```csv
part_no,name,fits,type,mrp,qty
VZ125-CLC-1722,Clutch Cable Assembly,Vayu Zip 125 2017-2022,genuine,240,3
```

Save it as `shop-kit/samples/<shop id>.csv`.

## 2. Describe the shop

Add the shop to the area's places directory (`sites/nearshelf/directory/neem-chowk.json`) with its name, address, hours, licence check and agent address. Then write a short profile, `shop-kit/shops/<shop id>.json`:

```json
{
  "id": "shanti_medical",
  "tagline": "The family chemist on Gandhi Road, open till 11 every night.",
  "theme": "#9a3412",
  "partners": ["night_owl_pharmacy"]
}
```

`partners` are the shops its agent may suggest when it is out of an item, always after the visitor agrees.

## 3. Generate the site

```shell
node shop-kit/generate.mjs shanti_medical
```

This writes `sites/shanti_medical/`:
- the shop page, the billing counter and the shopkeeper dashboard;
- the agent network and its manifest, built and checked with the organizers' `build_network.mjs`;
- the website tools, the action bridge and the hold window;
- the browser runtime and the site's tests.

`node shop-kit/generate.mjs --all` regenerates every shop.

Run the site with its live stock API:

```shell
npm run dev                                                    # the whole Neem Chowk area
node tools/serve-shop.mjs sites/shanti_medical --shop shanti_medical --allow-reset   # just one shop
```

## What is in the kit

| Path | What it is |
|---|---|
| `api/stock.mjs` | Reads billing exports. Searches stock the way shoppers ask: "children's paracetamol syrup" finds the paediatric suspension, and part numbers match exactly |
| `api/shop-api.mjs` | The shop's stock API: live bands, holds until closing (checked before anyone types details, then collected or released), counter bills, missed demand. It uses no Node built-ins, so it can run in a serverless function |
| `api/memory-store.mjs` | An in-memory store. The local server uses `tools/file-store.mjs` |
| `lib/network.mjs` | Builds the shop's agent network and manifest. The grounding, partner and presentation rules are copied word for word from the agentify-website template |
| `template/` | The shop site |
| `generate.mjs` | Profile + export → site, then builds the network |
| `tests/` | Tests for the search, the API and the server |

## Where the stock lives

- The billing export (`samples/<shop id>.csv`) is only the starting stock. The first time a shop's server starts, it copies the export into `.data/<shop id>.json`.
- From then on, every page and the shop's agent read and write that one file. A bill at the counter, or a hold marked Collected on the dashboard, lowers the count at once, and the agent's next answer follows.
- **Reset demo stock** on the dashboard (`POST /api/reset`, only with `--allow-reset`) rebuilds the file from the export. Every bill and hold is lost.
- **New stock arrives:** export the stock report from the billing software again and choose it under **Update stock from your billing software** on the dashboard. See below.
- To start from a new export by hand: stop the server, change the CSV, delete `.data/<shop id>.json` and start again.

## Updating stock from a new export

On the dashboard, choose the CSV your billing software exports (the same layout as in step 1):
1. The dashboard shows what would change before anything is saved: counts and prices that change, new items, and items missing from the file. It warns when the file has fewer of an item than are on hold.
2. **Save these changes** saves it; **Cancel** drops it.

The rules:
- Items are matched by **code** (`code` or `part_no`). The file's count and price **replace** the shop's, because the billing software's count is the true one. Uploading the same file twice changes nothing.
- New codes are added, and the shop's agent can find them at once.
- Items missing from the file are kept as they are. Holds are kept.
- A file with any bad line (wrong header, a qty that is not a whole number, a duplicate code) is refused whole, with the line number. Up to 5,000 items per file.
- The export in `samples/` is never changed, so **Reset demo stock** still goes back to it.

## The billing counter

`counter.html` stands in for the shop's billing software:
- Find an item, type how many (one click selects the number, so typing replaces it) and press **Add**. Up to 30 lines, 50 of each.
- Change a line with − / + or by typing; a number larger than what is free turns red and is put back. Typing 0 or pressing × removes a line.
- **Bill** sends every line in one request, `POST /api/bill` with `{lines: [{itemId, qty}]}`. Either the whole bill goes through or nothing changes, for example when a line would take stock that is on hold.

## API routes

| Route | What it does |
|---|---|
| `GET /api/stock?q=` | Bands for a search (in stock, few left, out); logs a miss |
| `GET /api/stock/all` | Every item with exact counts, for the counter and dashboard |
| `POST /api/bill` | Bill several lines at once, all or nothing |
| `POST /api/sale` | Bill one item |
| `POST /api/stock/import` | A new billing export, `{csv, apply}`: without `apply` it only says what would change |
| `GET /api/holds` · `POST /api/holds` | List holds · place a hold |
| `GET /api/holds/check` | Whether a hold could be placed, before anyone types details |
| `POST /api/holds/collect` · `POST /api/holds/release` | Hold picked up (stock drops) · hold given back |
| `GET /api/missed` | What shoppers asked for that the shop didn't have |
| `POST /api/reset` | Back to the billing export (403 unless `--allow-reset`) |

Writes only accept JSON from the shop's own pages; requests from other sites are refused.

The rules every shop follows:
- **Stock** shows as in stock, few left or out of stock, never exact counts.
- **Names and phones** for holds stay with the shop, and the dashboard masks them.
- **Prescription medicines** can be held, and the pharmacist checks the prescription at the counter.
- **Schedule X medicines** are never held.
