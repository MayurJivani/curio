# Curio

**Good taste. Terrible investments.**

A multiplayer art auction for 3 to 5 players, after Reiner Knizia's *Modern Art*. Run a museum, put paintings under the hammer, buy what you think the market will love, and sell it back to the bank when the round closes. A [Futile Studio](https://lab.futile.studio) experiment.

Every card is a real public-domain painting from the open-access collections of The Metropolitan Museum of Art, The Cleveland Museum of Art and the Art Institute of Chicago. In the game each work hangs under one of five invented artists; the real title, maker, museum and licence are always shown in the catalogue entry.

## Play

- Open a saleroom, share the four-letter code or link. Phones work as private paddles.
- Open `/r/CODE/table` on a laptop or TV for a shared display with no private information.
- Rules are on the landing page and in the game (Rules).

## Run it

```sh
npm install
npm run dev        # API on :4431, Vite on :5173
npm test           # rules engine + artwork normalisation
npm run build && npm start   # production on :4431
npx tsx scripts/soak.ts http://localhost:4431 6   # real Socket.IO clients play 6 full games
npm run ingest     # rebuild server/art/catalog.json from the museum APIs
```

Node 20+. State is saved as JSON under `DATA_DIR` (default `./data`): rooms survive a restart; museum images are cached there too.

## How it is built

| Layer | Where | Notes |
|---|---|---|
| Rules engine | `shared/engine.ts` | Pure and deterministic: `apply(game, action)` returns a new state or throws `RuleError`. All five auction types, double-auction fallback, round end on the fifth painting, cumulative market values, artist tie order, `view()` that strips other hands, sealed bids and the deck. |
| Multiplayer | `server/rooms.ts`, `server/index.ts` | Express + Socket.IO. The server is the only source of truth: it stamps the seat on every action, rejects anything out of turn, de-duplicates retried requests by nonce, runs the turn clock, migrates the host after a disconnect, and persists rooms to disk. |
| Artwork | `server/art/` | `ArtworkProvider` for each museum, normalised to one `Artwork` model. Ingestion keeps only public-domain / CC0 records with working images, removes duplicates, and verifies each image. Images are proxied and cached server-side from an allowlist of museum hosts. |
| UI | `src/` | React, Tailwind 4, Motion. See [DESIGN.md](DESIGN.md). |

## Rules notes

Card mix per artist (12/13/14/15/16), deal sizes and market values (30/20/10) follow the published game. Where the rulebook is ambiguous Curio chooses: a double auction's second painting can come from the next player who has one; if nobody adds one the auctioneer keeps the double for free and play passes on; a player with no cards is skipped; a round with no cards left anywhere ends without a fifth painting.

Not affiliated with Reiner Knizia or any publisher of *Modern Art*.
