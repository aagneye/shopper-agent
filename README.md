# NearShelf

**Your agent asks nearby shops, so you don't have to.**

NearShelf is an entry for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).

- **Each shop has its own agent** on its own website, and it answers from the shop's billing system.
- **A shopper has a personal agent** that runs in their browser. It asks those shop agents whether they have a medicine or a vehicle part, compares the answers, and holds the item for pickup.
- **No calls and no marketplace.** Shops never learn who asked.

The demo is set in **Neem Chowk**, a fictional neighbourhood. Every shop, brand and stock level in it is made up.

## What's here

| Path | What it is |
|---|---|
| `docs/idea.md` | The idea |
| `docs/superpowers/plans/` | Architecture and build plans |
| `sites/nearshelf/` | The shopper's personal agent site ([README](sites/nearshelf/README.md)) |
| `docs/superpowers/plans/2026-11-20-nearshelf-architecture.md` | Architecture for both agents, the shared contracts and the demo plan |
| `vendor/agentify-website/` | The organizers' agentify-website toolkit (browser runtime, build and serve scripts), unchanged |

## Run it

Needs Node.js 22 or newer. There are no npm dependencies.

```shell
npm test                 # run every test
npm run build:nearshelf  # rebuild the shopper agent's network file
npm run serve:nearshelf  # serve it at http://127.0.0.1:8080/
```

## License

Apache-2.0. The vendored toolkit keeps its own Apache-2.0 license (`vendor/agentify-website/LICENSE`).
