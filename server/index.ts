import express from 'express';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import { RuleError, type Action } from '../shared/engine.ts';
import { cachedImage } from './art/images.ts';
import type { Artwork } from './art/providers.ts';
import { Rooms, type Room } from './rooms.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4431);
const DATA = process.env.DATA_DIR ?? join(root, 'data');
const catalog: { artists: { index: number; name: string; works: Artwork[] }[] } =
  JSON.parse(readFileSync(join(root, 'server/art/catalog.json'), 'utf8'));
const works = new Map(catalog.artists.flatMap(a => a.works.map(w => [w.id, w] as const)));
const rooms = new Rooms(DATA, catalog);

const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => { res.json({ ok: true, rooms: rooms.rooms.size }); });
app.get('/api/catalog', (_req, res) => {
  res.set('cache-control', 'public, max-age=3600');
  res.json(catalog.artists.map(a => ({
    index: a.index, name: a.name,
    works: a.works.map(({ id, title, artist, date, width, height, medium, department, sourceUrl, license, provider }) =>
      ({ id, title, artist, date, width, height, medium, department, sourceUrl, license, provider })),
  })));
});
app.get('/img/:id/:size', async (req, res) => {
  const w = works.get(req.params.id);
  if (!w) { res.status(404).end(); return; }
  try {
    // Museum originals reach 9 MB; the table shows a ~1000-1700px rendition and links to the original record.
    const display = w.provider === 'aic' ? w.imageUrl : w.provider === 'cma' ? w.imageUrl.replace('_print.', '_web.') : w.thumbnailUrl ?? w.imageUrl;
    const { file, type } = await cachedImage(req.params.size === 'thumb' ? w.thumbnailUrl ?? w.imageUrl : display, join(DATA, 'images'));
    res.set({ 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' });
    res.sendFile(file);
  } catch {
    res.status(502).end();
  }
});
const dist = join(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|img|socket\.io).*/, (_req, res) => { res.sendFile(join(dist, 'index.html')); });
}

const http = createServer(app);
const io = new Server(http, { cors: { origin: false }, maxHttpBufferSize: 16_000 });
const live = new Map<string, number>(); // member id -> open sockets

async function broadcast(r: Room) {
  for (const s of await io.in(r.code).fetchSockets()) s.emit('state', rooms.snapshot(r, s.data.member ?? null));
}

function online(r: Room, id: string, delta: number) {
  const n = (live.get(id) ?? 0) + delta;
  n > 0 ? live.set(id, n) : live.delete(id);
  const m = r.members.find(x => x.id === id);
  if (m) m.connected = n > 0;
}

type Ack = (res: { ok: true; [k: string]: unknown } | { ok: false; error: string }) => void;

io.on('connection', (socket: Socket) => {
  let budget = 30;
  const refill = setInterval(() => (budget = Math.min(30, budget + 10)), 1000);

  const bind = (r: Room, member: string | null) => {
    const prev = socket.data.code && rooms.rooms.get(socket.data.code);
    if (prev) {
      if (prev === r && socket.data.member === member) return;
      socket.leave(prev.code);
      if (socket.data.member) online(prev, socket.data.member, -1);
    }
    socket.data.code = r.code;
    socket.data.member = member;
    socket.join(r.code);
    if (member) online(r, member, +1);
  };
  const handle = (event: string, fn: (p: any) => object | Promise<object>) =>
    socket.on(event, async (payload: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => {};
      if (--budget < 0) return reply({ ok: false, error: 'Slow down a little' });
      try {
        reply({ ok: true, ...(await fn(payload ?? {})) });
      } catch (e) {
        reply({ ok: false, error: e instanceof RuleError ? e.message : 'Something went wrong at the house' });
        if (!(e instanceof RuleError)) console.error(event, e);
      }
    });
  const mine = () => {
    const r = rooms.get(socket.data.code);
    const m = r.members.find(x => x.id === socket.data.member);
    if (!m) throw new RuleError('Join the room first');
    return { r, m };
  };

  handle('create', async ({ name, museum }) => {
    const { r, m } = rooms.create(name, museum);
    bind(r, m.id);
    await broadcast(r);
    return { code: r.code, id: m.id, token: m.token };
  });
  handle('join', async ({ code, name, museum }) => {
    const m = rooms.join(code, name, museum);
    const r = rooms.get(code);
    bind(r, m.id);
    await broadcast(r);
    return { code: r.code, id: m.id, token: m.token };
  });
  handle('resume', async ({ code, id, token }) => {
    const { r, m } = rooms.auth(code, id, token);
    bind(r, m.id);
    await broadcast(r);
    return { code: r.code, id: m.id };
  });
  handle('watch', async ({ code }) => {
    const r = rooms.get(code);
    bind(r, null);
    socket.emit('state', rooms.snapshot(r, null));
    return { code: r.code };
  });
  handle('museum', async ({ museum }) => { const { r, m } = mine(); rooms.setMuseum(r, m, museum); await broadcast(r); return {}; });
  handle('host', async ({ to }) => { const { r, m } = mine(); rooms.setHost(r, m, to); await broadcast(r); return {}; });
  handle('start', async () => { const { r, m } = mine(); rooms.start(r, m); await broadcast(r); return {}; });
  handle('leave', async () => {
    const { r, m } = mine();
    rooms.leave(r, m);
    online(r, m.id, -1);
    socket.leave(r.code);
    socket.data.code = socket.data.member = undefined;
    await broadcast(r);
    return {};
  });
  handle('act', async ({ action, nonce }: { action: Action; nonce?: string }) => {
    const { r, m } = mine();
    if (!action || typeof action.t !== 'string') throw new RuleError('Unreadable action');
    if (rooms.act(r, m, action, typeof nonce === 'string' ? nonce.slice(0, 40) : undefined)) await broadcast(r);
    return {};
  });

  socket.on('disconnect', () => {
    clearInterval(refill);
    const { code, member } = socket.data;
    if (!code || !member) return;
    const r = rooms.rooms.get(code);
    if (!r) return;
    online(r, member, -1);
    void broadcast(r);
    setTimeout(() => { if (rooms.rooms.get(code) === r && rooms.migrateHost(r)) void broadcast(r); }, 20_000);
  });
});

setInterval(() => {
  for (const r of rooms.rooms.values()) {
    try { if (rooms.expire(r)) void broadcast(r); } catch (e) { console.error('expire', r.code, e); }
  }
}, 500).unref();

const shutdown = () => { rooms.flush(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

http.listen(PORT, () => console.log(`curio on :${PORT}`));
