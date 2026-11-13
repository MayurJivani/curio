import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HEADERS, providers, type Artwork, type Kind } from './providers';

// A query string is an artist name: results must have its first and last name in the real artist field.
// Prefix "~" for style queries that accept any artist.
interface Spec { name: string; kinds?: Kind[]; queries: string[] }
const ARTISTS: Spec[] = [
  { name: 'Vera Lattice', kinds: ['painting', 'drawing'], queries: ['Vasily Kandinsky', 'Paul Klee', 'Robert Delaunay', 'Sonia Delaunay', 'Piet Mondrian', 'Kazimir Malevich', 'Lyonel Feininger', 'František Kupka', 'Fernand Léger', 'Juan Gris', 'Albert Gleizes', 'Jean Metzinger', 'Francis Picabia', 'Theo van Doesburg', 'Lyubov Popova', 'August Macke', 'Joseph Stella', 'Alexej von Jawlensky', '~cubist abstraction', '~geometric abstraction'] },
  { name: 'Otto Ruckus', queries: ['Vincent van Gogh', 'Edvard Munch', 'Ernst Ludwig Kirchner', 'Egon Schiele', 'Paula Modersohn-Becker', 'Henri de Toulouse-Lautrec', 'Chaïm Soutine', 'Georges Rouault', 'Oskar Kokoschka', 'Paul Gauguin', 'Emil Nolde', 'Max Pechstein'] },
  { name: 'Lucie Nocturne', kinds: ['painting', 'drawing'], queries: ['Odilon Redon', 'Arnold Böcklin', 'Gustave Moreau', 'Hieronymus Bosch', 'William Blake', 'Henry Fuseli', 'Henri Rousseau', 'Giorgio de Chirico', 'James Ensor', 'Edward Burne-Jones', 'Pierre Puvis de Chavannes', 'Fernand Khnopff', 'Elihu Vedder'] },
  { name: 'Agnes Field', queries: ['Joseph Mallord William Turner', 'Claude Monet', 'James McNeill Whistler', 'George Inness', 'Camille Corot', 'Pierre Bonnard', 'Édouard Vuillard', 'Georges Seurat', 'Paul Signac', 'Henri-Edmond Cross', 'John Henry Twachtman', 'Albert Pinkham Ryder'] },
  { name: 'Juno Flux', kinds: ['print'], queries: ['Katsushika Hokusai', 'Utagawa Hiroshige', 'Kitagawa Utamaro', 'Henri de Toulouse-Lautrec', 'Alphonse Mucha', 'Félix Vallotton', 'Jules Chéret', 'Théophile-Alexandre Steinlen', 'Utagawa Kuniyoshi', 'Kawase Hasui', 'Pierre Bonnard', 'Edvard Munch'] },
];
const TARGET = 26, MIN = 16;
const LIMIT: Record<Artwork['provider'], number> = { aic: 12, cma: 8, met: 4 };
const BAD_TITLE = /\b(frame|verso|recto|fragment|photograph of|back of|study sheet)\b/i;

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameMatch = (artist: string, q: string) => { const a = ` ${norm(artist)} `, t = norm(q).split(' '); return a.includes(` ${t[0]} `) && a.includes(` ${t.at(-1)} `); };

async function imageOk(a: Artwork) {
  try {
    const res = await fetch(a.thumbnailUrl ?? a.imageUrl, { headers: HEADERS });
    await res.body?.cancel();
    return res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('image/');
  } catch { return false; }
}

const seenIds = new Set<string>(), seenImages = new Set<string>(), seenKeys = new Set<string>();
const failed = new Map<string, string>();

async function collect(spec: Spec): Promise<Artwork[]> {
  // one list per (query, provider), then round-robin so no single painter dominates
  const lists: Artwork[][] = [];
  for (const raw of spec.queries) {
    const any = raw.startsWith('~'), q = raw.replace(/^~/, '');
    for (const p of providers) {
      if (failed.get(p.name)?.startsWith('HTTP 403')) continue; // provider's bot wall blocked us; stop hammering it
      try {
        const found = await p.search(q, LIMIT[p.name], { kinds: spec.kinds });
        lists.push(found.filter((a) => any || nameMatch(a.artist, q)));
      } catch (e) {
        failed.set(p.name, String((e as Error).message ?? e));
        console.warn(`[${p.name}] "${q}" failed: ${(e as Error).message}`);
      }
    }
  }
  const out: Artwork[] = [];
  for (let i = 0; out.length < TARGET && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const a = l[i];
      if (!a || out.length >= TARGET) continue;
      const key = `${norm(a.title)}|${norm(a.artist)}`;
      if (seenIds.has(a.id) || seenImages.has(a.imageUrl) || seenKeys.has(key) || BAD_TITLE.test(a.title)) continue;
      if (a.width && a.height && (a.width / a.height < 0.5 || a.width / a.height > 2)) continue;
      seenIds.add(a.id); seenImages.add(a.imageUrl); seenKeys.add(key);
      if (await imageOk(a)) out.push(a);
      else console.warn(`image check failed: ${a.id} ${a.thumbnailUrl ?? a.imageUrl}`);
    }
  }
  return out;
}

const artists = [];
for (const [index, spec] of ARTISTS.entries()) {
  const works = await collect(spec);
  artists.push({ index, name: spec.name, works });
  console.log(`${spec.name}: ${works.length}`);
}

const file = fileURLToPath(new URL('./catalog.json', import.meta.url));
await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), artists }, null, 2) + '\n');

console.log('\nartist            total  aic  cma  met');
const hosts = new Set<string>();
for (const a of artists) {
  const c = (p: string) => String(a.works.filter((w) => w.provider === p).length).padStart(4);
  a.works.forEach((w) => [w.imageUrl, w.thumbnailUrl].forEach((u) => u && hosts.add(new URL(u).hostname)));
  console.log(`${a.name.padEnd(16)} ${String(a.works.length).padStart(6)} ${c('aic')} ${c('cma')} ${c('met')}`);
}
console.log(`total ${artists.reduce((n, a) => n + a.works.length, 0)}; image hosts: ${[...hosts].join(', ')}`);
if (failed.size) console.log('provider errors:', Object.fromEntries(failed));
const short = artists.filter((a) => a.works.length < MIN);
if (short.length) { console.error(`below ${MIN}: ${short.map((a) => a.name).join(', ')}`); process.exitCode = 1; }
