# Curio design system

Curio is an auction house printed on paper. The table is a catalogue spread, every painting hangs in a cream mat with a hairline frame, and the only loud colour is the vermilion of the bidding paddle. It is a Futile Studio experiment: serious about its craft, not about itself.

## Principles

1. **The painting leads.** Artwork is always the largest thing on screen, shown at its own aspect ratio and never stretched (`object-contain` inside a frame sized from the image).
2. **Catalogue, not dashboard.** Hairline rules, ruled lists and editorial type instead of cards, pills and gradients.
3. **Colour means something.** Vermilion marks auction activity and urgency. Each invented artist owns one supporting colour. Nothing else is coloured.
4. **Motion reports state.** Things move because the game changed: a card travels to the table, a bid ticks up, a gavel falls. Nothing loops idly.
5. **Honest attribution.** The invented artist is always labelled as invented; the real maker, title, museum and licence are one tap away.

## Tokens (`src/styles.css`, `@theme`)

| Token | Value | Use |
|---|---|---|
| `ivory` | `#f3eee3` | Page ground (with SVG paper grain) |
| `gallery` | `#faf7f0` | Mats, inputs, raised surfaces |
| `paper` | `#e8e1d2` | Quiet fills, hand tray, empty walls |
| `stone` | `#cfc6b4` | Empty pips, skeletons, dashed placeholders |
| `dust` | `#8f8676` | Secondary text |
| `charcoal` | `#3a362f` | Body text on ivory |
| `ink` | `#16140f` | Headings, rules, primary buttons |
| `vermilion` / `-deep` | `#d63a1c` / `#a92a12` | Auction activity, primary action, urgency, errors |
| `cobalt` | `#1f45b0` | Vera Lattice; focus ring |
| `vermilion` | | Otto Ruckus |
| `plum` | `#5d3a62` | Lucie Nocturne |
| `mustard` | `#d39b17` | Agnes Field |
| `forest` | `#2c5a3c` | Juno Flux; gains |

Shadows: `--shadow-hang` (a framed work on a wall), `--shadow-lift` (a banner held up). Easing: `--ease-out-expo`.

## Type

- **Libre Caslon Display** (`.display`): headlines, artwork titles, winners. Tight leading (0.95), slight negative tracking.
- **Libre Caslon Text** (`.serif`): standfirsts, artist names, italic asides.
- **Schibsted Grotesk**: controls, labels, body.
- **Spline Sans Mono** (`.num`): every amount of money, room codes, lot numbers. Tabular figures.

## Components

- **Hung painting** (`.hung`, `.hung-tight`, `<Painting>`): cream mat, 1px ink frame, hang shadow. `maxHeight` sizes the frame from the image ratio so it always hugs the work. Loading shows a stone shimmer; a broken image shows the title in italic.
- **Paddle** (`<Paddle>`): each museum's identity, a numbered auction paddle. Raises on the winning bid, fades when the player is away.
- **Buttons** (`.btn`, `.btn-red`, `.btn-ink`, `.btn-ghost`): square tickets, 44px min height. Press nudges 1px down.
- **Stepper**: amount in thousands with − / + and +1k/+5k/+10k quick raises; the submit button states the exact amount.
- **Sheet**: right-hand drawer (bottom sheet on phones) for market, collections, rules, catalogue entry. Escape closes, focus returns.
- **Market strip**: five artist cells under the top bar: pips for paintings played this round, banked value.

## Motion (Motion for React)

- Cards share `layoutId` between hand, lot and the buyer's collection, so a sale visibly moves the painting.
- Hand cards lift and tilt on hover, rise and scale when selected (springs).
- Bids roll vertically (`AnimatePresence mode="popLayout"`); money counts with `animate()`.
- The auction type stamps in with a spring; the gavel swings on every sale; sealed bids reveal in a stagger.
- Round results and final results reveal with staggered variants.
- `MotionConfig reducedMotion="user"` and a CSS `prefers-reduced-motion` guard. No animation blocks an action.

## Sound

Synthesised with Web Audio (no files): bell when a lot opens, gavel on a sale, tick on a bid, chime on your turn, arpeggio on reveals. Only plays after game events, never on load; toggle in the top bar, remembered per device.

## Layouts

- **Saleroom, desktop:** players left, lot centre, sale record right, hand tray along the bottom, market strip under the top bar.
- **Saleroom, phone:** players scroll horizontally, lot then controls, hand, and a bottom nav for Market, Collections, Record, Rules.
- **Table display** (`/r/CODE/table`): the same room with no hand and no private controls, for a TV or laptop.
