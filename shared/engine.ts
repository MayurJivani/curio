// Curio rules engine: pure, deterministic Modern Art (Knizia) state machine.
// Money is in thousands. The server is the only caller of apply().

export const ARTISTS = ['Vera Lattice', 'Otto Ruckus', 'Lucie Nocturne', 'Agnes Field', 'Juno Flux'] as const;
export const CARDS_PER_ARTIST = [12, 13, 14, 15, 16];
export const MARKERS = [30, 20, 10];
export const START_CASH = 100;
export const ROUNDS = 4;
export const DEAL: Record<number, number[]> = { 3: [10, 6, 6, 0], 4: [9, 4, 4, 0], 5: [8, 3, 3, 0] };

export type AuctionType = 'open' | 'once' | 'hidden' | 'fixed' | 'double';
export const AUCTION_NAMES: Record<AuctionType, string> = {
  open: 'Open auction',
  once: 'Once around',
  hidden: 'Sealed bid',
  fixed: 'Fixed price',
  double: 'Double auction',
};

export interface Card { id: string; artist: number; type: AuctionType }
export interface Player { id: string; name: string; cash: number; hand: Card[]; handCount: number; owned: Card[] }
export interface Bid { seat: number; amount: number }

export type Auction =
  | { type: 'open'; high: Bid | null; passed: number[] }
  | { type: 'once'; high: Bid | null; order: number[]; turn: number }
  | { type: 'hidden'; bids: (number | null)[] }
  | { type: 'fixed'; price: number | null; order: number[]; turn: number };

export type Phase =
  | { kind: 'play'; seat: number }
  | { kind: 'double'; lead: Card; by: number; asking: number; declined: number[] }
  | { kind: 'auction'; lot: Card[]; auctioneer: number; auction: Auction }
  | { kind: 'settle'; round: number }
  | { kind: 'over' };

export interface Sale {
  lot: Card[]; auctioneer: number; winner: number; price: number; type: AuctionType;
  free?: boolean; bids?: (number | null)[]; toBank: boolean;
}
export interface Purchase { seat: number; round: number; cards: Card[]; paid: number; soldFor: number | null }
export interface RoundResult {
  round: number; counts: number[]; ranking: number[]; markers: number[]; values: number[];
  payouts: number[]; cashAfter: number[]; endedBy: number | null;
}
export type LogEvent =
  | { k: 'round'; round: number; starter: number }
  | { k: 'play'; seat: number; card: Card }
  | { k: 'second'; seat: number; card: Card }
  | { k: 'decline'; seat: number }
  | { k: 'bid'; seat: number; amount: number }
  | { k: 'pass'; seat: number }
  | { k: 'price'; seat: number; amount: number }
  | { k: 'sold'; sale: Sale }
  | { k: 'fifth'; seat: number; artist: number }
  | { k: 'empty'; seat: number }
  | { k: 'settle'; result: RoundResult };

export interface Game {
  v: number;
  seed: number;
  players: Player[];
  deck: Card[];
  deckCount: number;
  round: number;
  table: Card[];
  markers: number[][]; // [artist][round-1]
  phase: Phase;
  nextStarter: number;
  lastSale: Sale | null;
  ledger: Purchase[];
  results: RoundResult[];
  log: LogEvent[];
}

export type Action =
  | { t: 'play'; seat: number; card: string }
  | { t: 'second'; seat: number; card: string }
  | { t: 'decline'; seat: number }
  | { t: 'bid'; seat: number; amount: number }
  | { t: 'pass'; seat: number }
  | { t: 'price'; seat: number; amount: number }
  | { t: 'buy'; seat: number }
  | { t: 'close' }
  | { t: 'next' }
  | { t: 'timeout' };

export class RuleError extends Error {}
function fail(msg: string): never { throw new RuleError(msg); }

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], seed: number): T[] {
  const r = rng(seed), a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Doubles: 3 for the two biggest suits, 2 otherwise; the rest dealt round-robin (Krypto's 16 = 4/3/3/3/3).
export function buildDeck(): Card[] {
  const cards: Card[] = [];
  const rest: AuctionType[] = ['open', 'once', 'hidden', 'fixed'];
  CARDS_PER_ARTIST.forEach((n, artist) => {
    const doubles = n >= 15 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const type = i < doubles ? 'double' : rest[(i - doubles) % 4];
      cards.push({ id: `${artist}-${String(i).padStart(2, '0')}`, artist, type });
    }
  });
  return cards;
}

export function newGame(players: { id: string; name: string }[], seed: number): Game {
  if (players.length < 3 || players.length > 5) fail('Curio seats 3 to 5 dealers');
  const g: Game = {
    v: 0, seed,
    players: players.map(p => ({ id: p.id, name: p.name, cash: START_CASH, hand: [], handCount: 0, owned: [] })),
    deck: shuffle(buildDeck(), seed), deckCount: 70,
    round: 0, table: [], markers: ARTISTS.map(() => [0, 0, 0, 0]),
    phase: { kind: 'settle', round: 0 }, nextStarter: 0,
    lastSale: null, ledger: [], results: [], log: [],
  };
  startRound(g);
  sync(g);
  return g;
}

const n = (g: Game) => g.players.length;
const left = (g: Game, seat: number) => (seat + 1) % n(g);
const from = (g: Game, seat: number, includeSelf = true) =>
  Array.from({ length: n(g) }, (_, i) => (seat + (includeSelf ? i : i + 1)) % n(g)).slice(0, includeSelf ? n(g) : n(g) - 1);
const countOf = (g: Game, artist: number) => g.table.filter(c => c.artist === artist).length;
const allEmpty = (g: Game) => g.players.every(p => p.hand.length === 0);
const sync = (g: Game) => { g.players.forEach(p => (p.handCount = p.hand.length)); g.deckCount = g.deck.length; };

function startRound(g: Game) {
  g.round += 1;
  const per = DEAL[n(g)][g.round - 1];
  for (const p of g.players) p.hand.push(...g.deck.splice(0, per));
  g.log.push({ k: 'round', round: g.round, starter: g.nextStarter });
  startTurn(g, g.nextStarter, g.nextStarter);
}

function startTurn(g: Game, seat: number, lastPlayed: number) {
  for (const s of from(g, seat)) {
    if (g.players[s].hand.length) { g.phase = { kind: 'play', seat: s }; return; }
    g.log.push({ k: 'empty', seat: s });
  }
  endRound(g, lastPlayed, null);
}

function takeCard(g: Game, seat: number, id: string): Card {
  const hand = g.players[seat].hand;
  const i = hand.findIndex(c => c.id === id);
  if (i < 0) fail('That painting is not in your hand');
  return hand.splice(i, 1)[0];
}

// Puts a card on the table; returns true when that ends the round (fifth of an artist, or last card in play).
function placeOnTable(g: Game, seat: number, card: Card): boolean {
  g.table.push(card);
  if (countOf(g, card.artist) >= 5) {
    g.log.push({ k: 'fifth', seat, artist: card.artist });
    endRound(g, seat, card.artist);
    return true;
  }
  if (allEmpty(g)) { endRound(g, seat, null); return true; }
  return false;
}

function openAuction(g: Game, lot: Card[], auctioneer: number) {
  const type = lot[lot.length - 1].type;
  const auction: Auction =
    type === 'open' ? { type, high: null, passed: [] }
    : type === 'once' ? { type, high: null, order: from(g, left(g, auctioneer)), turn: -1 }
    : type === 'hidden' ? { type, bids: g.players.map(() => null) }
    : type === 'fixed' ? { type, price: null, order: from(g, auctioneer, false), turn: -1 }
    : fail('A double needs a second painting');
  g.phase = { kind: 'auction', lot, auctioneer, auction };
  if (auction.type === 'once') advanceOnce(g);
}

function advanceOnce(g: Game) {
  const ph = g.phase as Extract<Phase, { kind: 'auction' }>;
  const a = ph.auction as Extract<Auction, { type: 'once' }>;
  for (a.turn++; a.turn < a.order.length; a.turn++) {
    if (g.players[a.order[a.turn]].cash > (a.high?.amount ?? 0)) return;
  }
  award(g, a.high?.seat ?? null, a.high?.amount ?? 0);
}

function advanceFixed(g: Game) {
  const ph = g.phase as Extract<Phase, { kind: 'auction' }>;
  const a = ph.auction as Extract<Auction, { type: 'fixed' }>;
  for (a.turn++; a.turn < a.order.length; a.turn++) {
    if (g.players[a.order[a.turn]].cash >= a.price!) return;
  }
  award(g, ph.auctioneer, a.price!); // nobody bought: the auctioneer must
}

function award(g: Game, winner: number | null, price: number, bids?: (number | null)[]) {
  const ph = g.phase as Extract<Phase, { kind: 'auction' }>;
  const free = winner === null;
  const w = winner ?? ph.auctioneer;
  const pay = free ? 0 : price;
  g.players[w].cash -= pay;
  if (w !== ph.auctioneer) g.players[ph.auctioneer].cash += pay;
  g.players[w].owned.push(...ph.lot);
  g.ledger.push({ seat: w, round: g.round, cards: ph.lot, paid: pay, soldFor: null });
  const sale: Sale = {
    lot: ph.lot, auctioneer: ph.auctioneer, winner: w, price: pay, type: ph.lot[ph.lot.length - 1].type,
    free, bids, toBank: w === ph.auctioneer && pay > 0,
  };
  g.lastSale = sale;
  g.log.push({ k: 'sold', sale });
  startTurn(g, left(g, ph.auctioneer), ph.auctioneer);
}

export function ranking(counts: number[]): number[] {
  return counts.map((c, i) => [c, i]).filter(([c]) => c > 0)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 3).map(([, i]) => i);
}

function endRound(g: Game, lastSeat: number, endedBy: number | null) {
  const counts = ARTISTS.map((_, i) => countOf(g, i));
  const rank = ranking(counts);
  const markers = ARTISTS.map(() => 0);
  rank.forEach((artist, i) => { markers[artist] = MARKERS[i]; g.markers[artist][g.round - 1] = MARKERS[i]; });
  const values = ARTISTS.map((_, a) => (rank.includes(a) ? g.markers[a].reduce((x, y) => x + y, 0) : 0));
  const payouts = g.players.map(p => p.owned.reduce((s, c) => s + values[c.artist], 0));
  g.players.forEach((p, i) => { p.cash += payouts[i]; p.owned = []; });
  for (const l of g.ledger) if (l.round === g.round) l.soldFor = l.cards.reduce((s, c) => s + values[c.artist], 0);
  const result: RoundResult = {
    round: g.round, counts, ranking: rank, markers, values, payouts,
    cashAfter: g.players.map(p => p.cash), endedBy,
  };
  g.results.push(result);
  g.log.push({ k: 'settle', result });
  g.table = [];
  g.nextStarter = left(g, lastSeat);
  g.phase = g.round >= ROUNDS ? { kind: 'over' } : { kind: 'settle', round: g.round };
}

const isInt = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

export function apply(prev: Game, action: Action): Game {
  const g: Game = structuredClone(prev);
  const ph = g.phase;
  const seat = 'seat' in action ? action.seat : -1;
  if (seat !== -1 && !g.players[seat]) fail('Unknown seat');

  switch (action.t) {
    case 'play': {
      if (ph.kind !== 'play' || ph.seat !== seat) fail('It is not your turn to offer a painting');
      const card = takeCard(g, seat, action.card);
      g.log.push({ k: 'play', seat, card });
      if (placeOnTable(g, seat, card)) break;
      if (card.type === 'double') {
        g.phase = { kind: 'double', lead: card, by: seat, asking: seat, declined: [] };
        if (!g.players[seat].hand.length) { g.phase.declined.push(seat); nextAsk(g); }
      } else openAuction(g, [card], seat);
      break;
    }
    case 'second': {
      if (ph.kind !== 'double' || ph.asking !== seat) fail('You cannot add a painting right now');
      const p = g.players[seat];
      const card = p.hand.find(c => c.id === action.card) ?? fail('That painting is not in your hand');
      if (card.artist !== ph.lead.artist) fail(`The second painting must also be by ${ARTISTS[ph.lead.artist]}`);
      if (card.type === 'double') fail('The second painting cannot be another double');
      takeCard(g, seat, card.id);
      g.log.push({ k: 'second', seat, card });
      if (placeOnTable(g, seat, card)) break;
      openAuction(g, [ph.lead, card], seat);
      break;
    }
    case 'decline': {
      if (ph.kind !== 'double' || ph.asking !== seat) fail('Nobody is asking you for a painting');
      g.log.push({ k: 'decline', seat });
      ph.declined.push(seat);
      nextAsk(g);
      break;
    }
    case 'bid': {
      if (ph.kind !== 'auction') fail('There is no auction running');
      const a = ph.auction;
      if (!isInt(action.amount)) fail('Bids are whole thousands');
      if (action.amount > g.players[seat].cash) fail('You cannot bid more than you hold');
      if (a.type === 'open') {
        if (action.amount <= (a.high?.amount ?? 0)) fail('Your bid must beat the current bid');
        a.high = { seat, amount: action.amount };
        a.passed = [];
        g.log.push({ k: 'bid', seat, amount: action.amount });
      } else if (a.type === 'once') {
        if (a.order[a.turn] !== seat) fail('Wait for your turn to bid');
        if (action.amount <= (a.high?.amount ?? 0)) fail('Your bid must beat the current bid');
        a.high = { seat, amount: action.amount };
        g.log.push({ k: 'bid', seat, amount: action.amount });
        advanceOnce(g);
      } else if (a.type === 'hidden') {
        if (a.bids[seat] !== null) fail('Your sealed bid is already in');
        a.bids[seat] = action.amount;
        if (a.bids.every(b => b !== null)) revealHidden(g);
      } else fail('This painting is sold at a fixed price');
      break;
    }
    case 'pass': {
      if (ph.kind !== 'auction') fail('There is no auction running');
      const a = ph.auction;
      if (a.type === 'open') {
        if (a.high?.seat === seat) fail('You hold the high bid');
        if (!a.passed.includes(seat)) a.passed.push(seat);
        g.log.push({ k: 'pass', seat });
        const others = g.players.map((_, i) => i).filter(i => i !== a.high?.seat);
        if (others.every(i => a.passed.includes(i))) award(g, a.high?.seat ?? null, a.high?.amount ?? 0);
      } else if (a.type === 'once' || a.type === 'fixed') {
        if (a.type === 'fixed' && a.price === null) fail('The price is not set yet');
        if (a.order[a.turn] !== seat) fail('Wait for your turn');
        g.log.push({ k: 'pass', seat });
        a.type === 'once' ? advanceOnce(g) : advanceFixed(g);
      } else fail('Sealed bids cannot be passed; bid 0 instead');
      break;
    }
    case 'price': {
      if (ph.kind !== 'auction' || ph.auction.type !== 'fixed') fail('There is no fixed-price sale');
      if (ph.auctioneer !== seat) fail('Only the auctioneer sets the price');
      if (ph.auction.price !== null) fail('The price is already set');
      if (!isInt(action.amount)) fail('Prices are whole thousands');
      if (action.amount > g.players[seat].cash) fail('You cannot ask more than you could pay yourself');
      ph.auction.price = action.amount;
      g.log.push({ k: 'price', seat, amount: action.amount });
      advanceFixed(g);
      break;
    }
    case 'buy': {
      if (ph.kind !== 'auction' || ph.auction.type !== 'fixed' || ph.auction.price === null) fail('Nothing is for sale at a fixed price');
      const a = ph.auction;
      if (a.order[a.turn] !== seat) fail('Wait for your turn');
      award(g, seat, a.price!);
      break;
    }
    case 'close': {
      if (ph.kind !== 'auction' || ph.auction.type !== 'open') fail('No open auction to close');
      award(g, ph.auction.high?.seat ?? null, ph.auction.high?.amount ?? 0);
      break;
    }
    case 'next': {
      if (ph.kind !== 'settle') fail('The round is not over');
      startRound(g);
      break;
    }
    case 'timeout': {
      timeout(g);
      break;
    }
  }
  sync(g);
  g.v = prev.v + 1;
  return g;
}

function nextAsk(g: Game) {
  const ph = g.phase as Extract<Phase, { kind: 'double' }>;
  for (const s of from(g, ph.asking, false)) {
    if (s === ph.by) break;
    if (g.players[s].hand.length) { ph.asking = s; return; }
    ph.declined.push(s);
  }
  // nobody added a second painting: the original auctioneer keeps the double for free
  g.phase = { kind: 'auction', lot: [ph.lead], auctioneer: ph.by, auction: { type: 'open', high: null, passed: [] } };
  award(g, null, 0);
}

function revealHidden(g: Game) {
  const ph = g.phase as Extract<Phase, { kind: 'auction' }>;
  const a = ph.auction as Extract<Auction, { type: 'hidden' }>;
  const bids = a.bids.map(b => b ?? 0);
  const top = Math.max(...bids);
  if (top === 0) return award(g, null, 0, a.bids);
  const winner = from(g, ph.auctioneer).find(s => bids[s] === top)!; // ties: auctioneer first, then clockwise
  award(g, winner, top, a.bids);
}

function timeout(g: Game) {
  const ph = g.phase;
  if (ph.kind === 'play') {
    const hand = g.players[ph.seat].hand;
    const card = hand.find(c => c.type !== 'double') ?? hand[0];
    Object.assign(g, apply(g, { t: 'play', seat: ph.seat, card: card.id }));
  } else if (ph.kind === 'double') {
    Object.assign(g, apply(g, { t: 'decline', seat: ph.asking }));
  } else if (ph.kind === 'auction') {
    const a = ph.auction;
    if (a.type === 'open') award(g, a.high?.seat ?? null, a.high?.amount ?? 0);
    else if (a.type === 'once') { g.log.push({ k: 'pass', seat: a.order[a.turn] }); advanceOnce(g); }
    else if (a.type === 'hidden') { a.bids = a.bids.map(b => b ?? 0); revealHidden(g); }
    else if (a.price === null) {
      a.price = Math.min(10, g.players[ph.auctioneer].cash);
      g.log.push({ k: 'price', seat: ph.auctioneer, amount: a.price });
      advanceFixed(g);
    } else { g.log.push({ k: 'pass', seat: a.order[a.turn] }); advanceFixed(g); }
  } else if (ph.kind === 'settle') startRound(g);
}

// Who the game is waiting on, for timers and UI prompts.
export function waitingOn(g: Game): number[] {
  const ph = g.phase;
  if (ph.kind === 'play') return [ph.seat];
  if (ph.kind === 'double') return [ph.asking];
  if (ph.kind !== 'auction') return [];
  const a = ph.auction;
  if (a.type === 'open') return g.players.map((_, i) => i).filter(i => i !== a.high?.seat && !a.passed.includes(i));
  if (a.type === 'once') return [a.order[a.turn]];
  if (a.type === 'hidden') return a.bids.flatMap((b, i) => (b === null ? [i] : []));
  return a.price === null ? [ph.auctioneer] : [a.order[a.turn]];
}

// Seconds the house waits before acting for whoever is pending.
export function timeLimit(g: Game): number {
  const ph = g.phase;
  if (ph.kind === 'play') return 60;
  if (ph.kind === 'double') return 30;
  if (ph.kind === 'settle') return 45;
  if (ph.kind !== 'auction') return 0;
  const a = ph.auction;
  if (a.type === 'open') return a.high ? 10 : 25;
  if (a.type === 'hidden') return 45;
  return 30;
}

// Market values if the round ended right now.
export function projected(g: Game): number[] {
  const counts = ARTISTS.map((_, a) => g.table.filter(c => c.artist === a).length);
  const rank = ranking(counts);
  return ARTISTS.map((_, a) => {
    const i = rank.indexOf(a);
    return i < 0 ? 0 : g.markers[a].reduce((x, y) => x + y, 0) + MARKERS[i];
  });
}

// What one seat may see. seat = null is the shared table display.
export function view(g: Game, seat: number | null): Game {
  const v: Game = structuredClone(g);
  v.seed = 0;
  v.deck = [];
  v.players.forEach((p, i) => { if (i !== seat) p.hand = []; });
  const ph = v.phase;
  if (ph.kind === 'auction' && ph.auction.type === 'hidden') {
    ph.auction.bids = ph.auction.bids.map((b, i) => (i === seat ? b : b === null ? null : -1)); // -1 = sealed, submitted
  }
  return v;
}
