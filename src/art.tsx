import { useEffect, useState } from 'react';
import type { Card } from '../shared/engine';

export interface Work {
  id: string; title: string; artist: string; date?: string; width?: number; height?: number;
  medium?: string; department?: string; sourceUrl: string; license: string; provider: 'met' | 'cma' | 'aic';
}
export interface Artist { index: number; name: string; works: Work[] }

// The five invented artists of the Curio universe. Real works are only "hung" under their names.
export const ARTIST_META = [
  { name: 'Vera Lattice', color: 'var(--color-cobalt)', hex: '#1f45b0', school: 'Geometric abstraction', line: 'Believes every feeling has a correct angle.' },
  { name: 'Otto Ruckus', color: 'var(--color-vermilion)', hex: '#d63a1c', school: 'Expressive figuration', line: 'Paints people the way they look after an argument.' },
  { name: 'Lucie Nocturne', color: 'var(--color-plum)', hex: '#5d3a62', school: 'Dreams and symbols', line: 'Has never once explained a painting. Will not start now.' },
  { name: 'Agnes Field', color: 'var(--color-mustard)', hex: '#d39b17', school: 'Colour and atmosphere', line: 'Mostly weather. Collectors call it serenity.' },
  { name: 'Juno Flux', color: 'var(--color-forest)', hex: '#2c5a3c', school: 'Graphic experiment', line: 'Prints, posters, woodblocks. Prolific to a fault.' },
];

export const PROVIDERS = { met: 'The Metropolitan Museum of Art', cma: 'The Cleveland Museum of Art', aic: 'Art Institute of Chicago' };

let catalog: Artist[] | null = null;
let works = new Map<string, Work>();
let pending: Promise<void> | null = null;
const load = () => (pending ??= fetch('/api/catalog').then(r => r.json()).then((c: Artist[]) => {
  catalog = c;
  works = new Map(c.flatMap(a => a.works.map(w => [w.id, w] as const)));
}).catch(() => { pending = null; }));

export function useCatalog() {
  const [c, set] = useState(catalog);
  useEffect(() => { if (!c) void load().then(() => set(catalog)); }, [c]);
  return c;
}
export const work = (id?: string) => (id ? works.get(id) : undefined);
export const artFor = (art: Record<string, string>, card: Card) => work(art[card.id]);

export function Painting({ id, size = 'thumb', className = '', fit = 'contain', alt, maxHeight }: {
  id?: string; size?: 'thumb' | 'full'; className?: string; fit?: 'contain' | 'cover'; alt?: string;
  maxHeight?: string; // CSS length: width = maxHeight × ratio, capped at 100%, so the frame always hugs the painting
}) {
  const w = work(id);
  const [state, setState] = useState<'loading' | 'ok' | 'broken'>('loading');
  const [natural, setNatural] = useState(0);
  const ratio = natural || (w?.width && w?.height ? w.width / w.height : 0.8);
  useEffect(() => setState('loading'), [id, size]);
  return (
    <div className={`relative overflow-hidden bg-paper ${className}`} style={fit === 'contain' ? { aspectRatio: String(ratio), width: maxHeight && `calc(${maxHeight} * ${ratio})`, maxWidth: maxHeight && '100%' } : undefined}>
      {w && state !== 'broken' && (
        <img
          src={`/img/${encodeURIComponent(w.id)}/${size}`}
          alt={alt ?? `${w.title}${w.artist ? `, by ${w.artist}` : ''}`}
          loading="lazy" decoding="async" draggable={false}
          onLoad={e => { setState('ok'); setNatural(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); }} onError={() => setState('broken')}
          className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {state === 'loading' && w && <div className="absolute inset-0 animate-pulse bg-stone/40" aria-hidden />}
      {(state === 'broken' || !w) && (
        <div className="absolute inset-0 flex flex-col justify-end p-3 text-left">
          <span className="serif text-sm italic text-charcoal">{w?.title ?? 'Image withheld'}</span>
          <span className="text-xs text-dust">{w ? 'The museum image did not load' : ''}</span>
        </div>
      )}
    </div>
  );
}
