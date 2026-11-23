import { createHash } from 'node:crypto';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HEADERS } from './providers';

export const ALLOWED_HOSTS = new Set([
  'www.artic.edu',
  'artic.edu',
  'images.metmuseum.org',
  'openaccess-cdn.clevelandart.org',
]);

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/tiff': 'tif' };
const TYPE = Object.fromEntries(Object.entries(EXT).map(([t, e]) => [e, t]));
const inflight = new Map<string, Promise<{ file: string; type: string }>>();

export async function cachedImage(url: string, cacheDir: string): Promise<{ file: string; type: string }> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
  const key = createHash('sha1').update(url).digest('hex');
  const hit = (await readdir(cacheDir).catch(() => [] as string[])).find((f) => f.startsWith(key + '.'));
  if (hit) return { file: join(cacheDir, hit), type: TYPE[hit.slice(key.length + 1)] };

  let p = inflight.get(key);
  if (!p) {
    p = (async () => {
      let res = await fetch(u, { headers: HEADERS, redirect: 'manual' });
      // AIC answers 307 to a smaller IIIF size for small originals; follow one hop, allowlisted.
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (loc) {
        const next = new URL(loc, u);
        if (next.protocol !== 'https:' || !ALLOWED_HOSTS.has(next.hostname)) throw new Error(`redirect not allowed: ${next.hostname}`);
        res = await fetch(next, { headers: HEADERS, redirect: 'error' });
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !EXT[type]) {
        await res.body?.cancel();
        throw new Error(`bad image response ${res.status} ${type || '(no type)'}`);
      }
      await mkdir(cacheDir, { recursive: true });
      const file = join(cacheDir, `${key}.${EXT[type]}`);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await rename(tmp, file); // atomic: readers never see a partial file
      return { file, type };
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
