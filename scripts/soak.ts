// Multi-client soak test against a running server: real Socket.IO clients play whole games.
// Usage: tsx scripts/soak.ts [url] [games]
import { io, type Socket } from 'socket.io-client';
import type { Game } from '../shared/engine.ts';

const URL = process.argv[2] ?? 'http://localhost:4431';
const GAMES = Number(process.argv[3] ?? 3);
const assert = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };

interface Snap { seat: number | null; me: string | null; game: Game | null; waiting: number[]; room: { code: string; host: string; members: { id: string; connected: boolean }[] } }
class Client {
  s: Socket; snap: Snap | null = null; id = ''; token = ''; code = '';
  constructor(public name: string) {
    this.s = io(URL, { transports: ['websocket'], forceNew: true });
    this.s.on('state', (x: Snap) => (this.snap = x));
  }
  call(ev: string, p: object = {}): Promise<any> { return new Promise(r => this.s.emit(ev, p, r)); }
  act(action: object, nonce = Math.random().toString(36)) { return this.call('act', { action, nonce }); }
  reconnect() {
    this.s.disconnect();
    this.s = io(URL, { transports: ['websocket'], forceNew: true });
    this.s.on('state', (x: Snap) => (this.snap = x));
    return this.call('resume', { code: this.code, id: this.id, token: this.token });
  }
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (fn: () => boolean, ms = 3000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await wait(10); } };
const rnd = (n: number) => Math.floor(Math.random() * n);

async function game(n: number, g: number) {
  const cs = Array.from({ length: n }, (_, i) => new Client(`Bot${g}_${i}`));
  const tableView = new Client('table');
  const r0 = await cs[0].call('create', { name: cs[0].name, museum: 0 });
  assert(r0.ok, `create: ${r0.error}`);
  Object.assign(cs[0], { id: r0.id, token: r0.token, code: r0.code });
  for (const c of cs.slice(1)) {
    const r = await c.call('join', { code: r0.code, name: c.name, museum: 9 });
    assert(r.ok, `join: ${r.error}`);
    Object.assign(c, { id: r.id, token: r.token, code: r0.code });
  }
  assert(!(await cs[1].call('start')).ok, 'non-host could start');
  await tableView.call('watch', { code: r0.code });
  assert((await cs[0].call('start')).ok, 'start');
  await until(() => cs.every(c => c.snap?.game));
  const late = new Client('late');
  assert(!(await late.call('join', { code: r0.code, name: 'late', museum: 0 })).ok, 'joined a running sale');
  late.s.disconnect();

  let steps = 0, reconnects = 0, dupes = 0, sealedChecks = 0, rejected = 0;
  const kinds = new Set<string>();
  while (cs[0].snap!.game!.phase.kind !== 'over') {
    if (++steps > 4000) throw new Error('game did not finish');
    await wait(110); // stay under the per-socket rate limit (10 actions/s)
    const v = cs[0].snap!.game!.v;
    // Every client must agree on public state and see only its own hand.
    await until(() => cs.every(c => c.snap!.game!.v === v) && tableView.snap?.game?.v === v);
    for (const c of cs) {
      const gg = c.snap!.game!;
      gg.players.forEach((p, j) => assert(j === c.snap!.seat || p.hand.length === 0, 'hand leaked'));
      assert(JSON.stringify(gg.players.map(p => p.cash)) === JSON.stringify(cs[0].snap!.game!.players.map(p => p.cash)), 'cash desync');
      assert(gg.deck.length === 0 && gg.seed === 0, 'deck leaked');
    }
    assert(tableView.snap!.game!.players.every(p => p.hand.length === 0), 'table saw a hand');
    const gs = cs[0].snap!.game!;
    const ph = gs.phase;
    const seatC = (i: number) => cs.find(c => c.snap!.seat === i)!;
    const own = (i: number) => seatC(i).snap!.game!.players[i];

    if (ph.kind === 'settle') { assert((await cs[0].act({ t: 'next' })).ok, 'next'); continue; }
    if (ph.kind === 'play') {
      const c = seatC(ph.seat);
      const hand = own(ph.seat).hand;
      // A wrong seat must be refused.
      const other = cs.find(x => x !== c)!;
      if ((await other.act({ t: 'play', card: hand[0].id })).ok) throw new Error('out-of-turn play accepted');
      rejected++;
      const r = await c.act({ t: 'play', card: hand[rnd(hand.length)].id });
      assert(r.ok, `play: ${r.error}`);
      continue;
    }
    if (ph.kind === 'double') {
      kinds.add('double');
      const me = own(ph.asking);
      const m = me.hand.find(x => x.artist === ph.lead.artist && x.type !== 'double');
      const r = m && Math.random() < 0.7 ? await seatC(ph.asking).act({ t: 'second', card: m.id }) : await seatC(ph.asking).act({ t: 'decline' });
      assert(r.ok, `double: ${r.error}`);
      continue;
    }
    if (ph.kind !== 'auction') continue;
    const a = ph.auction;
    kinds.add(a.type);
    if (a.type === 'open') {
      const who = cs[0].snap!.waiting[rnd(cs[0].snap!.waiting.length)];
      if (who === undefined) { await wait(50); continue; }
      const c = seatC(who);
      const high = a.high?.amount ?? 0;
      if (high < 35 && Math.random() < 0.5 && own(who).cash > high) {
        const nonce = 'n' + Math.random();
        const [x, y] = await Promise.all([c.act({ t: 'bid', amount: high + 1 + rnd(4) }, nonce), c.act({ t: 'bid', amount: high + 1 }, nonce)]);
        assert(x.ok && y.ok, 'duplicate request errored');
        dupes++;
      } else assert((await c.act({ t: 'pass' })).ok, 'pass');
    } else if (a.type === 'once') {
      const who = a.order[a.turn], c = seatC(who), high = a.high?.amount ?? 0;
      const r = high < 35 && Math.random() < 0.5 ? await c.act({ t: 'bid', amount: high + 1 + rnd(3) }) : await c.act({ t: 'pass' });
      assert(r.ok, `once: ${r.error}`);
    } else if (a.type === 'hidden') {
      const waiting = cs[0].snap!.waiting.slice();
      // First bidder seals, then drops and reconnects mid-auction: the bid must survive and stay hidden.
      const first = seatC(waiting[0]);
      const amt = Math.min(own(waiting[0]).cash, 1 + rnd(30));
      assert((await first.act({ t: 'bid', amount: amt })).ok, 'seal');
      if (waiting.length > 1) {
        await until(() => (cs.find(c => c !== first)!.snap!.game!.phase as any).auction?.bids?.[waiting[0]] === -1);
        const otherBids = (cs.find(c => c !== first)!.snap!.game!.phase as any).auction.bids;
        assert(otherBids[waiting[0]] === -1, 'sealed bid visible to others');
        sealedChecks++;
        await first.reconnect(); reconnects++;
        await until(() => first.snap?.game?.v === cs[0].snap!.game!.v);
        assert((first.snap!.game!.phase as any).auction.bids[waiting[0]] === amt, 'own sealed bid lost on reconnect');
      }
      // Remaining bidders act simultaneously.
      await Promise.all(waiting.slice(1).map(s => seatC(s).act({ t: 'bid', amount: Math.min(own(s).cash, rnd(30)) })));
    } else if (a.price === null) {
      assert((await seatC(ph.auctioneer).act({ t: 'price', amount: Math.min(own(ph.auctioneer).cash, 5 + rnd(20)) })).ok, 'price');
    } else {
      const c = seatC(a.order[a.turn]);
      assert((await (Math.random() < 0.4 ? c.act({ t: 'buy' }) : c.act({ t: 'pass' }))).ok, 'fixed');
    }
  }
  const gs = cs[0].snap!.game!;
  assert(gs.results.length === 4, 'four rounds');
  // Money is conserved apart from bank flows: check against the ledger.
  const bankIn = gs.ledger.reduce((s, l) => s + (gs.log.some(e => e.k === 'sold' && e.sale.toBank && e.sale.lot[0].id === l.cards[0].id) ? l.paid : 0), 0);
  const payouts = gs.results.reduce((s, r) => s + r.payouts.reduce((x, y) => x + y, 0), 0);
  const total = gs.players.reduce((s, p) => s + p.cash, 0);
  assert(total === n * 100 - bankIn + payouts, `money not conserved: ${total} vs ${n * 100 - bankIn + payouts}`);
  console.log(`game ${g}: ${n} players, ${steps} steps, v${gs.v}, auctions ${[...kinds].sort().join('/')}, reconnects ${reconnects}, dup requests ${dupes}, sealed checks ${sealedChecks}, rejected ${rejected}, cash ${gs.players.map(p => p.cash).join(' ')}`);
  [...cs, tableView].forEach(c => c.s.disconnect());
}

for (let i = 0; i < GAMES; i++) await game(3 + (i % 3), i);
console.log('soak ok');
process.exit(0);
