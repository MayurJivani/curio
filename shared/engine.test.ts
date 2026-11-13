import { describe, expect, it } from 'vitest';
import { apply, buildDeck, newGame, ranking, view, waitingOn, RuleError, type Action, type AuctionType, type Card, type Game } from './engine';

let uid = 0;
const c = (artist: number, type: AuctionType): Card => ({ id: `t${uid++}`, artist, type });
const filler = () => c(4, 'open');

function setup(hands: Card[][], start = 0): Game {
  const g = newGame(hands.map((_, i) => ({ id: `p${i}`, name: `P${i}` })), 7);
  g.players.forEach((p, i) => { p.hand = hands[i]; p.handCount = hands[i].length; });
  g.phase = { kind: 'play', seat: start };
  return g;
}
const run = (g: Game, ...actions: Action[]) => actions.reduce(apply, g);
const rejects = (g: Game, a: Action, msg: RegExp) => expect(() => apply(g, a)).toThrow(msg);
const auction = (g: Game) => { if (g.phase.kind !== 'auction') throw new Error('no auction'); return g.phase.auction; };

describe('deck and setup', () => {
  it('builds 70 cards: 12..16 per artist with every auction type', () => {
    const d = buildDeck();
    expect(d).toHaveLength(70);
    expect(new Set(d.map(x => x.id)).size).toBe(70);
    expect([0, 1, 2, 3, 4].map(a => d.filter(x => x.artist === a).length)).toEqual([12, 13, 14, 15, 16]);
    const krypto = d.filter(x => x.artist === 4);
    expect(['open', 'double', 'fixed', 'hidden', 'once'].map(t => krypto.filter(x => x.type === t).length)).toEqual([4, 3, 3, 3, 3]);
  });
  it('deals 10/9/8 cards and 100k each, deterministically', () => {
    for (const [p, k] of [[3, 10], [4, 9], [5, 8]]) {
      const g = newGame(Array.from({ length: p }, (_, i) => ({ id: `${i}`, name: `${i}` })), 42);
      expect(g.players.every(x => x.hand.length === k && x.cash === 100)).toBe(true);
      expect(g.deck.length).toBe(70 - p * k);
    }
    const a = newGame([1, 2, 3].map(i => ({ id: `${i}`, name: `${i}` })), 9);
    const b = newGame([1, 2, 3].map(i => ({ id: `${i}`, name: `${i}` })), 9);
    expect(a.players[0].hand).toEqual(b.players[0].hand);
  });
  it('rejects 2 or 6 players', () => {
    expect(() => newGame([{ id: 'a', name: 'a' }, { id: 'b', name: 'b' }], 1)).toThrow(RuleError);
  });
});

describe('open auction', () => {
  it('raises until everyone else passes; winner pays auctioneer', () => {
    const card = c(0, 'open');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 5 }, { t: 'bid', seat: 2, amount: 8 }, { t: 'bid', seat: 0, amount: 9 });
    rejects(g, { t: 'bid', seat: 1, amount: 9 }, /beat/);
    g = run(g, { t: 'bid', seat: 1, amount: 12 }, { t: 'pass', seat: 0 }, { t: 'pass', seat: 2 });
    expect(g.lastSale).toMatchObject({ winner: 1, price: 12, auctioneer: 0 });
    expect(g.players.map(p => p.cash)).toEqual([112, 88, 100]);
    expect(g.phase).toEqual({ kind: 'play', seat: 1 });
  });
  it('a new bid clears earlier passes', () => {
    const card = c(0, 'open');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 3 }, { t: 'pass', seat: 2 }, { t: 'bid', seat: 0, amount: 4 });
    expect(auction(g)).toMatchObject({ passed: [] });
  });
  it('nobody bids: auctioneer takes it free', () => {
    const card = c(0, 'open');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'close' });
    expect(g.lastSale).toMatchObject({ winner: 0, price: 0, free: true });
    expect(g.players[0].owned).toHaveLength(1);
  });
  it('auctioneer winning own auction pays the bank', () => {
    const card = c(0, 'open');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 10 }, { t: 'bid', seat: 0, amount: 11 }, { t: 'close' });
    expect(g.players.map(p => p.cash)).toEqual([89, 100, 100]);
    expect(g.lastSale?.toBank).toBe(true);
  });
  it('rejects bids over cash, fractions and negatives', () => {
    const card = c(0, 'open');
    const g = run(setup([[card, filler()], [filler()], [filler()]]), { t: 'play', seat: 0, card: card.id });
    rejects(g, { t: 'bid', seat: 1, amount: 101 }, /more than you hold/);
    rejects(g, { t: 'bid', seat: 1, amount: 2.5 }, /whole/);
    rejects(g, { t: 'bid', seat: 1, amount: -1 }, /whole/);
  });
  it('duplicate identical bid is rejected (replayed request)', () => {
    const card = c(0, 'open');
    const g = run(setup([[card, filler()], [filler()], [filler()]]), { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 5 });
    rejects(g, { t: 'bid', seat: 1, amount: 5 }, /beat/);
  });
});

describe('once around', () => {
  it('goes clockwise from the left, auctioneer last, highest wins', () => {
    const card = c(1, 'once');
    let g = setup([[filler()], [card, filler()], [filler()], [filler()]], 1);
    g = run(g, { t: 'play', seat: 1, card: card.id });
    expect(waitingOn(g)).toEqual([2]);
    rejects(g, { t: 'bid', seat: 3, amount: 5 }, /turn/);
    g = run(g, { t: 'bid', seat: 2, amount: 8 }, { t: 'pass', seat: 3 });
    rejects(g, { t: 'bid', seat: 0, amount: 8 }, /beat/);
    g = run(g, { t: 'bid', seat: 0, amount: 12 });
    expect(waitingOn(g)).toEqual([1]);
    g = run(g, { t: 'bid', seat: 1, amount: 13 });
    expect(g.lastSale).toMatchObject({ winner: 1, price: 13, toBank: true });
    expect(g.players[1].cash).toBe(87);
  });
  it('skips players who cannot beat the high bid; no bids = free to auctioneer', () => {
    const card = c(1, 'once');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g.players[1].cash = 0;
    g = run(g, { t: 'play', seat: 0, card: card.id });
    expect(waitingOn(g)).toEqual([2]);
    g = run(g, { t: 'pass', seat: 2 }, { t: 'pass', seat: 0 });
    expect(g.lastSale).toMatchObject({ winner: 0, free: true, price: 0 });
  });
});

describe('sealed bid', () => {
  it('reveals simultaneously; ties go to auctioneer then clockwise', () => {
    const card = c(2, 'hidden');
    let g = setup([[filler()], [filler()], [card, filler()], [filler()]], 2);
    g = run(g, { t: 'play', seat: 2, card: card.id }, { t: 'bid', seat: 2, amount: 11 }, { t: 'bid', seat: 3, amount: 12 }, { t: 'bid', seat: 1, amount: 12 });
    rejects(g, { t: 'bid', seat: 1, amount: 13 }, /already/);
    g = run(g, { t: 'bid', seat: 0, amount: 0 });
    expect(g.lastSale).toMatchObject({ winner: 3, price: 12, bids: [0, 12, 11, 12] });
    expect(g.players[2].cash).toBe(112);
  });
  it('auctioneer wins a tie', () => {
    const card = c(2, 'hidden');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 7 }, { t: 'bid', seat: 2, amount: 7 }, { t: 'bid', seat: 0, amount: 7 });
    expect(g.lastSale).toMatchObject({ winner: 0, price: 7, toBank: true });
  });
  it('all zero bids: auctioneer takes it free', () => {
    const card = c(2, 'hidden');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 0 }, { t: 'timeout' });
    expect(g.lastSale).toMatchObject({ winner: 0, free: true });
  });
  it('never shows other sealed bids before reveal', () => {
    const card = c(2, 'hidden');
    const g = run(setup([[card, filler()], [filler()], [filler()]]), { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 1, amount: 33 });
    const leak = (s: number | null) => JSON.stringify(view(g, s)).includes('33');
    expect(leak(0)).toBe(false);
    expect(leak(2)).toBe(false);
    expect(leak(null)).toBe(false);
    expect(leak(1)).toBe(true);
    expect((view(g, 0).phase as any).auction.bids).toEqual([null, -1, null]);
  });
});

describe('fixed price', () => {
  it('first player to accept buys at the price', () => {
    const card = c(3, 'fixed');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id });
    rejects(g, { t: 'price', seat: 1, amount: 5 }, /auctioneer/);
    rejects(g, { t: 'price', seat: 0, amount: 101 }, /more than/);
    g = run(g, { t: 'price', seat: 0, amount: 14 }, { t: 'pass', seat: 1 }, { t: 'buy', seat: 2 });
    expect(g.lastSale).toMatchObject({ winner: 2, price: 14 });
    expect(g.players.map(p => p.cash)).toEqual([114, 100, 86]);
  });
  it('no buyers: auctioneer must buy at the announced price', () => {
    const card = c(3, 'fixed');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'price', seat: 0, amount: 20 }, { t: 'pass', seat: 1 }, { t: 'pass', seat: 2 });
    expect(g.lastSale).toMatchObject({ winner: 0, price: 20, toBank: true });
    expect(g.players[0].cash).toBe(80);
  });
  it('skips players who cannot afford the price', () => {
    const card = c(3, 'fixed');
    let g = setup([[card, filler()], [filler()], [filler()]]);
    g.players[1].cash = 5;
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'price', seat: 0, amount: 10 });
    expect(waitingOn(g)).toEqual([2]);
  });
});

describe('double auction', () => {
  it('auctioneer adds a second painting; its type decides the auction; buyer gets both', () => {
    const d = c(0, 'double'), s = c(0, 'fixed');
    let g = setup([[d, s, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: d.id });
    rejects(g, { t: 'second', seat: 0, card: g.players[0].hand[1].id }, /also be by/);
    g = run(g, { t: 'second', seat: 0, card: s.id });
    expect(auction(g).type).toBe('fixed');
    g = run(g, { t: 'price', seat: 0, amount: 30 }, { t: 'buy', seat: 1 });
    expect(g.players[1].owned.map(x => x.id)).toEqual([d.id, s.id]);
    expect(g.players[0].cash).toBe(130);
  });
  it('second painting cannot be a double', () => {
    const d = c(0, 'double'), d2 = c(0, 'double');
    const g = run(setup([[d, d2, filler()], [filler()], [filler()]]), { t: 'play', seat: 0, card: d.id });
    rejects(g, { t: 'second', seat: 0, card: d2.id }, /another double/);
  });
  it('fallback: the next player to the left may add it, runs the auction, takes the money, and play passes to their left', () => {
    const d = c(1, 'double'), s = c(1, 'open');
    let g = setup([[d, filler()], [filler()], [s, filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: d.id }, { t: 'decline', seat: 0 });
    expect(waitingOn(g)).toEqual([1]);
    rejects(g, { t: 'second', seat: 2, card: s.id }, /cannot add/);
    g = run(g, { t: 'decline', seat: 1 }, { t: 'second', seat: 2, card: s.id });
    expect(g.phase).toMatchObject({ kind: 'auction', auctioneer: 2 });
    g = run(g, { t: 'bid', seat: 0, amount: 25 }, { t: 'close' });
    expect(g.players.map(p => p.cash)).toEqual([75, 100, 125, 100]);
    expect(g.phase).toEqual({ kind: 'play', seat: 3 }); // seat 1 effectively lost a turn
  });
  it('nobody adds a second: original auctioneer keeps the double for free', () => {
    const d = c(1, 'double');
    let g = setup([[d, filler()], [filler()], [filler()]]);
    g = run(g, { t: 'play', seat: 0, card: d.id }, { t: 'decline', seat: 0 }, { t: 'decline', seat: 1 }, { t: 'decline', seat: 2 });
    expect(g.lastSale).toMatchObject({ winner: 0, free: true, lot: [d] });
    expect(g.phase).toEqual({ kind: 'play', seat: 1 });
  });
  it('a double that adds the fifth painting ends the round unsold', () => {
    const d = c(2, 'double'), s = c(2, 'open');
    let g = setup([[d, filler()], [s, filler()], [filler()]]);
    g.table = [c(2, 'open'), c(2, 'open'), c(2, 'open')];
    g = run(g, { t: 'play', seat: 0, card: d.id }, { t: 'decline', seat: 0 }, { t: 'second', seat: 1, card: s.id });
    expect(g.phase).toEqual({ kind: 'settle', round: 1 });
    expect(g.results[0].counts[2]).toBe(5);
    expect(g.nextStarter).toBe(2);
  });
});

describe('round end and market', () => {
  it('fifth painting ends the round; it is not auctioned and not sold', () => {
    const fifth = c(0, 'open');
    let g = setup([[fifth, filler()], [filler()], [filler()]]);
    g.table = [c(0, 'open'), c(0, 'open'), c(0, 'open'), c(0, 'open'), c(1, 'open')];
    g.players[1].owned = [g.table[0], g.table[1]];
    g.players[2].owned = [g.table[4]];
    g = run(g, { t: 'play', seat: 0, card: fifth.id });
    const r = g.results[0];
    expect(r.ranking).toEqual([0, 1]);
    expect(r.payouts).toEqual([0, 60, 20]);
    expect(g.players.map(p => p.cash)).toEqual([100, 160, 120]);
    expect(g.players[0].owned).toEqual([]);
    expect(g.nextStarter).toBe(1);
  });
  it('popularity ties break by fixed artist order and only top three score', () => {
    expect(ranking([2, 3, 3, 1, 3])).toEqual([1, 2, 4]);
    expect(ranking([5, 0, 0, 0, 0])).toEqual([0]);
  });
  it('values accumulate only while an artist stays in the top three', () => {
    const g = newGame([0, 1, 2].map(i => ({ id: `${i}`, name: `${i}` })), 3);
    const end = (counts: number[], owned: number[]) => {
      g.players[0].hand = [c(9, 'open')];
      g.table = counts.flatMap((k, a) => Array.from({ length: k }, () => c(a, 'open')));
      g.players[1].owned = owned.map(a => c(a, 'open'));
      g.phase = { kind: 'play', seat: 0 };
      const last = g.table.splice(g.table.findIndex(x => x.artist === counts.indexOf(5)), 1)[0];
      g.players[0].hand = [last, filler()];
      Object.assign(g, apply(g, { t: 'play', seat: 0, card: last.id }));
      const r = g.results[g.results.length - 1];
      if ((g.phase as Game['phase']).kind === 'settle') Object.assign(g, apply(g, { t: 'next' }));
      return r;
    };
    expect(end([5, 2, 1, 0, 1], [0, 1, 2]).values).toEqual([30, 20, 10, 0, 0]);
    // round 2: Lite-Metal-equivalent (0) drops out; its 30 is banked but worth nothing now
    expect(end([1, 3, 2, 5, 0], [0, 1, 2, 3]).values).toEqual([0, 40, 20, 30, 0]);
    // round 3: artist 0 returns and its old marker counts again
    const r3 = end([5, 0, 0, 0, 4], [0, 4]);
    expect(r3.values).toEqual([60, 0, 0, 0, 20]);
    expect(r3.payouts[1]).toBe(80);
  });
  it('deals 6/4/3 new cards in rounds 2 and 3, none in round 4, and ends after round 4', () => {
    let g = newGame([0, 1, 2, 3].map(i => ({ id: `${i}`, name: `${i}` })), 11);
    g.phase = { kind: 'settle', round: 1 };
    const before = g.players[0].hand.length;
    g = apply(g, { t: 'next' });
    expect(g.players[0].hand.length).toBe(before + 4);
    g.round = 4;
    g.table = [c(0, 'open'), c(0, 'open'), c(0, 'open'), c(0, 'open')];
    const p = g.phase.kind === 'play' ? g.phase.seat : 0;
    const last = c(0, 'open');
    g.players[p].hand.push(last);
    g = apply(g, { t: 'play', seat: p, card: last.id });
    expect(g.phase).toEqual({ kind: 'over' });
  });
  it('players out of cards are skipped; last card in play ends the round', () => {
    const a = c(0, 'open'), b = c(1, 'open');
    let g = setup([[a], [], [b]]);
    g = run(g, { t: 'play', seat: 0, card: a.id }, { t: 'close' });
    expect(g.phase).toEqual({ kind: 'play', seat: 2 });
    expect(g.log.some(e => e.k === 'empty' && e.seat === 1)).toBe(true);
    g = run(g, { t: 'play', seat: 2, card: b.id });
    expect(g.phase).toEqual({ kind: 'settle', round: 1 });
    expect(g.results[0].ranking).toEqual([0, 1]);
    expect(g.results[0].payouts).toEqual([30, 0, 0]); // the last card counts but is not sold
  });
  it('fills in purchase profit/loss at settlement', () => {
    const card = c(0, 'open'), fifth = c(0, 'open');
    let g = setup([[card, filler()], [fifth, filler()], [filler()]]);
    g.table = [c(0, 'open'), c(0, 'open'), c(0, 'open')];
    g = run(g, { t: 'play', seat: 0, card: card.id }, { t: 'bid', seat: 2, amount: 22 }, { t: 'close' }, { t: 'play', seat: 1, card: fifth.id });
    expect(g.ledger[0]).toMatchObject({ seat: 2, paid: 22, soldFor: 30 });
  });
});

describe('integrity', () => {
  it('rejects out-of-turn plays and cards not in hand', () => {
    const g = setup([[c(0, 'open')], [c(1, 'open')], [filler()]]);
    rejects(g, { t: 'play', seat: 1, card: g.players[1].hand[0].id }, /not your turn/);
    rejects(g, { t: 'play', seat: 0, card: 'nope' }, /not in your hand/);
  });
  it('does not mutate the previous state and bumps the version', () => {
    const card = c(0, 'open');
    const g = setup([[card, filler()], [filler()], [filler()]]);
    const snap = JSON.stringify(g);
    const next = apply(g, { t: 'play', seat: 0, card: card.id });
    expect(JSON.stringify(g)).toBe(snap);
    expect(next.v).toBe(g.v + 1);
  });
  it('hides other hands and the deck order', () => {
    const g = newGame([0, 1, 2].map(i => ({ id: `${i}`, name: `${i}` })), 5);
    const v = view(g, 1);
    expect(v.players[0].hand).toEqual([]);
    expect(v.players[0].handCount).toBe(10);
    expect(v.players[1].hand).toHaveLength(10);
    expect(v.deck).toEqual([]);
    expect(v.seed).toBe(0);
  });
  it('timeouts always make progress', () => {
    let g = newGame([0, 1, 2, 3, 4].map(i => ({ id: `${i}`, name: `${i}` })), 99);
    for (let i = 0; i < 2000 && g.phase.kind !== 'over'; i++) g = apply(g, { t: 'timeout' });
    expect(g.phase.kind).toBe('over');
    expect(g.results).toHaveLength(4);
  });
});
