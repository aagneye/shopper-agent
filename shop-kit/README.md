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
| `api/shop-api.mjs` | The shop's stock API: live bands, holds until closing (checked before anyone types details, then collected or released), counter sales, missed demand. It uses no Node built-ins, so it can run in a serverless function |
| `api/memory-store.mjs` | An in-memory store. The local server uses `tools/file-store.mjs` |
| `lib/network.mjs` | Builds the shop's agent network and manifest. The grounding, partner and presentation rules are copied word for word from the agentify-website template |
| `template/` | The shop site |
| `generate.mjs` | Profile + export → site, then builds the network |
| `tests/` | Tests for the search, the API and the server |

The rules every shop follows:
- **Stock** shows as in stock, few left or out of stock, never exact counts.
- **Names and phones** for holds stay with the shop, and the dashboard masks them.
- **Prescription medicines** can be held, and the pharmacist checks the prescription at the counter.
- **Schedule X medicines** are never held.
