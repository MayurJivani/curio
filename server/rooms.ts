import { randomBytes, randomInt } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apply, newGame, shuffle, timeLimit, view, waitingOn, CARDS_PER_ARTIST, RuleError, type Action, type Game } from '../shared/engine.ts';
import type { Artwork } from './art/providers.ts';

export const MUSEUMS = 5;
export interface Member { id: string; token: string; name: string; museum: number; connected: boolean }
export interface Room {
  code: string;
  created: number;
  touched: number;
  host: string;
  members: Member[];
  game: Game | null;
  art: Record<string, string>; // card id -> artwork id
  deadline: number | null;
  nonces: Record<string, string[]>;
}

const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const TTL = 24 * 3600_000;
const MAX_ROOMS = 500;
const PLAYER_ACTIONS: Action['t'][] = ['play', 'second', 'decline', 'bid', 'pass', 'price', 'buy'];

export class Rooms {
  rooms = new Map<string, Room>();
  private dir: string;
  private dirty = new Set<string>();

  constructor(dataDir: string, private catalog: { artists: { works: Artwork[] }[] }) {
    this.dir = join(dataDir, 'rooms');
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      try {
        const r: Room = JSON.parse(readFileSync(join(this.dir, f), 'utf8'));
        if (Date.now() - r.touched > TTL) { rmSync(join(this.dir, f)); continue; }
        r.members.forEach(m => (m.connected = false));
        this.rooms.set(r.code, r);
      } catch { /* a half-written file from a crash is skipped */ }
    }
    setInterval(() => this.flush(), 1000).unref();
    setInterval(() => this.sweep(), 3600_000).unref();
  }

  private save(r: Room) { r.touched = Date.now(); this.dirty.add(r.code); }

  flush() {
    for (const code of this.dirty) {
      const r = this.rooms.get(code);
      if (!r) continue;
      const file = join(this.dir, `${code}.json`);
      writeFileSync(file + '.tmp', JSON.stringify(r));
      renameSync(file + '.tmp', file);
    }
    this.dirty.clear();
  }

  private sweep() {
    for (const [code, r] of this.rooms) if (Date.now() - r.touched > TTL) {
      this.rooms.delete(code);
      rmSync(join(this.dir, `${code}.json`), { force: true });
    }
  }

  create(name: string, museum: number) {
    if (this.rooms.size >= MAX_ROOMS) throw new RuleError('The auction house is full. Try again later.');
    let code = '';
    do code = Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    while (this.rooms.has(code));
    const r: Room = { code, created: Date.now(), touched: Date.now(), host: '', members: [], game: null, art: {}, deadline: null, nonces: {} };
    this.rooms.set(code, r);
    try {
      const m = this.join(code, name, museum);
      r.host = m.id;
      return { r, m };
    } catch (e) {
      this.rooms.delete(code);
      throw e;
    }
  }

  get(code: string) {
    const r = this.rooms.get(String(code).toUpperCase());
    if (!r) throw new RuleError('No sale with that room code');
    return r;
  }

  join(code: string, name: string, museum: number) {
    const r = this.get(code);
    if (r.game) throw new RuleError('This sale has already started');
    if (r.members.length >= 5) throw new RuleError('This sale is full (5 dealers)');
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 18);
    if (!clean) throw new RuleError('Enter a name for your museum');
    if (r.members.some(m => m.name.toLowerCase() === clean.toLowerCase())) throw new RuleError('That name is taken in this room');
    const taken = new Set(r.members.map(m => m.museum));
    const mus = Number.isInteger(museum) && museum >= 0 && museum < MUSEUMS && !taken.has(museum)
      ? museum : [0, 1, 2, 3, 4].find(i => !taken.has(i))!;
    const m: Member = { id: randomBytes(6).toString('hex'), token: randomBytes(18).toString('base64url'), name: clean, museum: mus, connected: true };
    r.members.push(m);
    this.save(r);
    return m;
  }

  auth(code: string, id: string, token: string) {
    const r = this.get(code);
    const m = r.members.find(x => x.id === id && x.token === token);
    if (!m) throw new RuleError('This seat belongs to someone else');
    return { r, m };
  }

  setMuseum(r: Room, m: Member, museum: number) {
    if (r.game) throw new RuleError('Museums are fixed once the sale starts');
    if (!(museum >= 0 && museum < MUSEUMS) || r.members.some(x => x !== m && x.museum === museum)) throw new RuleError('That museum is taken');
    m.museum = museum;
    this.save(r);
  }

  leave(r: Room, m: Member) {
    if (r.game) return; // seated players keep their seat for reconnection
    r.members = r.members.filter(x => x !== m);
    if (!r.members.length) { this.rooms.delete(r.code); rmSync(join(this.dir, `${r.code}.json`), { force: true }); return; }
    if (r.host === m.id) r.host = r.members[0].id;
    this.save(r);
  }

  setHost(r: Room, by: Member, to: string) {
    if (r.host !== by.id) throw new RuleError('Only the host can hand over the gavel');
    if (!r.members.some(m => m.id === to)) throw new RuleError('No such dealer');
    r.host = to;
    this.save(r);
  }

  // Host goes quiet: the gavel passes to the next connected dealer.
  migrateHost(r: Room) {
    const host = r.members.find(m => m.id === r.host);
    if (host?.connected) return false;
    const next = r.members.find(m => m.connected);
    if (!next) return false;
    r.host = next.id;
    this.save(r);
    return true;
  }

  start(r: Room, by: Member) {
    if (r.host !== by.id) throw new RuleError('Only the host can open the sale');
    if (r.game) throw new RuleError('The sale is already running');
    if (r.members.length < 3) throw new RuleError('Curio needs at least 3 dealers');
    const seed = randomInt(2 ** 31);
    r.game = newGame(r.members.map(m => ({ id: m.id, name: m.name })), seed);
    r.art = this.assignArt(seed);
    this.arm(r);
    this.save(r);
  }

  private assignArt(seed: number) {
    const art: Record<string, string> = {};
    const all = [...this.catalog.artists.flatMap(a => a.works)];
    this.catalog.artists.forEach((a, artist) => {
      const works = shuffle(a.works, seed + artist);
      const ids = Array.from({ length: CARDS_PER_ARTIST[artist] }, (_, i) => `${artist}-${String(i).padStart(2, '0')}`);
      ids.forEach((id, i) => (art[id] = (works[i] ?? all[i % all.length]).id));
    });
    return art;
  }

  act(r: Room, m: Member | null, action: Action, nonce?: string): boolean {
    if (!r.game) throw new RuleError('The sale has not started');
    const seen = m ? (r.nonces[m.id] ??= []) : [];
    if (nonce && seen.includes(nonce)) return false; // replayed request: already applied
    if (m) {
      const seat = r.game.players.findIndex(p => p.id === m.id);
      if (seat < 0) throw new RuleError('You are not seated at this sale');
      if (action.t === 'next') {
        if (m.id !== r.host) throw new RuleError('The host moves the sale on');
        action = { t: 'next' };
      } else if (PLAYER_ACTIONS.includes(action.t)) {
        const { card, amount } = action as { card?: unknown; amount?: unknown };
        action = { t: action.t, seat, card: String(card ?? ''), amount: Number(amount) } as Action;
      } else throw new RuleError('Only the house can do that');
    }
    r.game = apply(r.game, action);
    if (nonce) { seen.push(nonce); if (seen.length > 40) seen.shift(); }
    this.arm(r);
    this.save(r);
    return true;
  }

  arm(r: Room) {
    const s = r.game ? timeLimit(r.game) : 0;
    r.deadline = s ? Date.now() + s * 1000 : null;
  }

  // Fires the house action for a room whose clock ran out.
  expire(r: Room) {
    if (!r.game || !r.deadline || Date.now() < r.deadline) return false;
    const ph = r.game.phase;
    const isOpen = ph.kind === 'auction' && ph.auction.type === 'open';
    this.act(r, null, isOpen ? { t: 'close' } : { t: 'timeout' });
    return true;
  }

  publicRoom(r: Room) {
    return {
      code: r.code, host: r.host, deadline: r.deadline,
      members: r.members.map(({ id, name, museum, connected }) => ({ id, name, museum, connected })),
      art: r.game ? r.art : {},
    };
  }

  snapshot(r: Room, memberId: string | null) {
    const seat = r.game && memberId ? r.game.players.findIndex(p => p.id === memberId) : -1;
    return {
      room: this.publicRoom(r),
      me: memberId,
      seat: seat >= 0 ? seat : null,
      game: r.game ? view(r.game, seat >= 0 ? seat : null) : null,
      waiting: r.game ? waitingOn(r.game) : [],
      now: Date.now(),
    };
  }
}
