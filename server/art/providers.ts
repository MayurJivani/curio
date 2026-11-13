export interface Artwork {
  id: string;            // `${provider}:${nativeId}` e.g. "aic:8991"
  provider: 'met' | 'cma' | 'aic';
  title: string;
  artist: string;        // real creator as recorded by the museum; "Unknown artist" if absent
  date?: string;
  imageUrl: string;      // large image (~1600px wide where available)
  thumbnailUrl?: string; // ~600px
  width?: number;        // pixel width of imageUrl if known
  height?: number;
  medium?: string;
  department?: string;
  sourceUrl: string;     // public museum web page for the object
  license: string;
  isPublicDomain: boolean;
}

/** Object kinds a search may return. Default is paintings only. */
export type Kind = 'painting' | 'print' | 'drawing';
export interface SearchOpts { kinds?: Kind[] }

export interface ArtworkProvider {
  name: Artwork['provider'];
  search(query: string, limit: number, opts?: SearchOpts): Promise<Artwork[]>; // only public-domain/CC0 records with images
  get(nativeId: string): Promise<Artwork | null>;
}

const UA = 'curio-ingest/1.0 (futile.studio)';
// AIC's Cloudflare returns a 403 challenge on IIIF images unless this documented header is set.
export const HEADERS = { 'user-agent': UA, 'AIC-User-Agent': UA };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Serial queue: each request starts at least `minDelay` ms after the previous one. Retries 429/5xx twice. */
function limiter(minDelay: number) {
  let chain: Promise<unknown> = Promise.resolve();
  let last = 0;
  return function getJson<T = any>(url: string): Promise<T | null> {
    const run = async (): Promise<T | null> => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + minDelay - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        const res = await fetch(url, { headers: { ...HEADERS, accept: 'application/json' } });
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await res.body?.cancel();
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        if (res.status === 404) { await res.body?.cancel(); return null; }
        if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status} ${url}`); }
        return (await res.json()) as T;
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };
}

const num = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? undefined : Number(v));
const clean = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim() : undefined);

// ---------- Art Institute of Chicago ----------
const AIC_TYPES: Record<Kind, string> = { painting: 'Painting', print: 'Print', drawing: 'Drawing and Watercolor' };
const AIC_FIELDS = 'id,title,artist_title,artist_display,date_display,image_id,thumbnail,medium_display,department_title,is_public_domain,artwork_type_title';

export function normalizeAic(r: any, kinds: Kind[] = ['painting']): Artwork | null {
  if (!r || r.is_public_domain !== true || !r.image_id) return null;
  if (!kinds.some((k) => AIC_TYPES[k] === r.artwork_type_title)) return null;
  const tw = num(r.thumbnail?.width), th = num(r.thumbnail?.height);
  const width = tw ? Math.min(1686, tw) : undefined;
  const iiif = `https://www.artic.edu/iiif/2/${r.image_id}/full`;
  return {
    id: `aic:${r.id}`,
    provider: 'aic',
    title: clean(r.title) ?? 'Untitled',
    artist: clean(r.artist_title) ?? clean(r.artist_display?.split('\n')[0]) ?? 'Unknown artist',
    date: clean(r.date_display),
    imageUrl: `${iiif}/1686,/0/default.jpg`,
    thumbnailUrl: `${iiif}/600,/0/default.jpg`,
    width,
    height: width && tw && th ? Math.round((width * th) / tw) : undefined,
    medium: clean(r.medium_display),
    department: clean(r.department_title),
    sourceUrl: `https://www.artic.edu/artworks/${r.id}`,
    license: 'Public domain (AIC CC0 image)',
    isPublicDomain: true,
  };
}

const aicGet = limiter(250);
export const aic: ArtworkProvider = {
  name: 'aic',
  async search(q, limit, opts) {
    const kinds = opts?.kinds ?? ['painting'];
    const url = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true&limit=${limit}&fields=${AIC_FIELDS}`;
    const j = await aicGet(url);
    return (j?.data ?? []).map((r: any) => normalizeAic(r, kinds)).filter(Boolean) as Artwork[];
  },
  async get(id) {
    const j = await aicGet(`https://api.artic.edu/api/v1/artworks/${id}?fields=${AIC_FIELDS}`);
    return normalizeAic(j?.data, ['painting', 'print', 'drawing']);
  },
};

// ---------- Cleveland Museum of Art ----------
const CMA_TYPES: Record<Kind, string> = { painting: 'Painting', print: 'Print', drawing: 'Drawing' };

export function normalizeCma(r: any, kinds: Kind[] = ['painting']): Artwork | null {
  if (!r || r.share_license_status !== 'CC0' || !r.images?.web?.url) return null;
  if (!kinds.some((k) => CMA_TYPES[k] === r.type)) return null;
  const big = r.images.print?.url ? r.images.print : r.images.web;
  const artist = clean(r.creators?.[0]?.description)?.replace(/\s*\([^)]*\)\s*$/, '');
  return {
    id: `cma:${r.id}`,
    provider: 'cma',
    title: clean(r.title) ?? 'Untitled',
    artist: artist || 'Unknown artist',
    date: clean(r.creation_date),
    imageUrl: big.url,
    thumbnailUrl: r.images.web.url,
    width: num(big.width),
    height: num(big.height),
    medium: clean(r.technique),
    department: clean(r.department),
    sourceUrl: r.url ?? `https://clevelandart.org/art/${r.accession_number}`,
    license: 'CC0',
    isPublicDomain: true,
  };
}

const cmaGet = limiter(150);
export const cma: ArtworkProvider = {
  name: 'cma',
  async search(q, limit, opts) {
    const kinds = opts?.kinds ?? ['painting'];
    const type = kinds.length === 1 ? `&type=${CMA_TYPES[kinds[0]]}` : '';
    const j = await cmaGet(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&cc0=1&has_image=1&limit=${limit}${type}`);
    return (j?.data ?? []).map((r: any) => normalizeCma(r, kinds)).filter(Boolean) as Artwork[];
  },
  async get(id) {
    const j = await cmaGet(`https://openaccess-api.clevelandart.org/api/artworks/${id}`);
    return normalizeCma(j?.data, ['painting', 'print', 'drawing']);
  },
};

// ---------- The Met ----------
// v1 search returns 410; v1.1 search works. Objects are still v1.
const MET_CLASS: Record<Kind, string> = { painting: 'Paintings', print: 'Prints', drawing: 'Drawings' };

export function normalizeMet(r: any, kinds: Kind[] = ['painting']): Artwork | null {
  if (!r || r.isPublicDomain !== true || !clean(r.primaryImage)) return null;
  if (!kinds.some((k) => MET_CLASS[k] === r.classification)) return null;
  return {
    id: `met:${r.objectID}`,
    provider: 'met',
    title: clean(r.title) ?? 'Untitled',
    artist: clean(r.artistDisplayName) ?? 'Unknown artist',
    date: clean(r.objectDate),
    // primaryImage is the original (often >4000px, several MB); primaryImageSmall is web-large (~1000px).
    imageUrl: r.primaryImage,
    thumbnailUrl: clean(r.primaryImageSmall),
    medium: clean(r.medium),
    department: clean(r.department),
    sourceUrl: r.objectURL ?? `https://www.metmuseum.org/art/collection/search/${r.objectID}`,
    license: 'CC0 (Met Open Access)',
    isPublicDomain: true,
  };
}

const metGet = limiter(600); // 120ms and 250ms both tripped the Met's Imperva wall (HTTP 403, ~5 min IP block) after ~100 requests
export const met: ArtworkProvider = {
  name: 'met',
  async search(q, limit, opts) {
    const kinds = opts?.kinds ?? ['painting'];
    // artistOrCulture: queries are matched against the artist field, which keeps object fetches (the costly part) relevant
    const medium = kinds.map((k) => MET_CLASS[k]).join('|');
    const j = await metGet<{ objectIDs?: number[] }>(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=${encodeURIComponent(q)}&hasImages=true&artistOrCulture=true&medium=${encodeURIComponent(medium)}&limit=${limit * 2}`);
    const out: Artwork[] = [];
    for (const id of (j?.objectIDs ?? []).slice(0, limit * 2)) {
      if (out.length >= limit) break;
      const a = normalizeMet(await metGet(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch((e) => { if (String(e.message).startsWith('HTTP 403')) throw e; return null; }), kinds);
      if (a) out.push(a);
    }
    return out;
  },
  async get(id) {
    return normalizeMet(await metGet(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`), ['painting', 'print', 'drawing']);
  },
};

export const providers: ArtworkProvider[] = [aic, cma, met];
