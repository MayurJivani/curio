import { motion } from 'motion/react';
import { useState } from 'react';
import { ARTIST_META, Painting, PROVIDERS, useCatalog, type Work } from './art';
import { navigate } from './App';
import { remember, send } from './net';
import { AUCTION_NAMES, type AuctionType } from '../shared/engine';
import { Icon, MUSEUMS, Paddle, Wordmark } from './ui';
import { RulesBody } from './Panels';

export function MuseumPicker({ value, onChange, taken = [] }: { value: number; onChange: (i: number) => void; taken?: number[] }) {
  return (
    <div role="radiogroup" aria-label="Your museum" className="grid grid-cols-5 gap-1">
      {MUSEUMS.map((m, i) => {
        const off = taken.includes(i) && i !== value;
        return (
          <button key={m.name} type="button" role="radio" aria-checked={value === i} aria-label={m.name} disabled={off}
            onClick={() => onChange(i)}
            className={`flex flex-col items-center gap-1 border px-1 pb-2 pt-3 transition-colors ${value === i ? 'border-ink bg-gallery' : 'border-transparent hover:bg-paper'} disabled:opacity-30`}>
            <Paddle museum={i} size={28} raised={value === i} />
            <span className="text-[0.7rem] leading-tight">{m.short}</span>
          </button>
        );
      })}
    </div>
  );
}

function Entry() {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState(() => localStorage.getItem('curio:name') ?? '');
  const [code, setCode] = useState('');
  const [museum, setMuseum] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    localStorage.setItem('curio:name', name.trim());
    const res = mode === 'create' ? await send('create', { name, museum }) : await send('join', { code: code.trim(), name, museum });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    remember(res.code, res.id, res.token);
    navigate(`/r/${res.code}`);
  }

  return (
    <form onSubmit={submit} className="border border-ink bg-gallery p-5 shadow-[var(--shadow-hang)] sm:p-6" id="enter">
      <div className="mb-5 flex border-b border-ink" role="tablist">
        {(['create', 'join'] as const).map(m => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(''); }}
            className={`-mb-px flex-1 border-b-2 pb-2 text-left font-semibold ${mode === m ? 'border-vermilion' : 'border-transparent text-dust hover:text-ink'}`}>
            {m === 'create' ? 'Open a saleroom' : 'Join a sale'}
          </button>
        ))}
      </div>
      {mode === 'join' && (
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-charcoal">Room code</span>
          <input className="field num uppercase tracking-[0.3em]" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            placeholder="KDRT" inputMode="text" autoCapitalize="characters" autoComplete="off" required minLength={4} />
        </label>
      )}
      <label className="mb-4 block">
        <span className="mb-1 block text-sm text-charcoal">Your name, as the catalogue will print it</span>
        <input className="field" value={name} onChange={e => setName(e.target.value)} maxLength={18} required placeholder="e.g. Peggy" autoComplete="nickname" />
      </label>
      <div className="mb-5">
        <span className="mb-1 block text-sm text-charcoal">Your museum</span>
        <MuseumPicker value={museum} onChange={setMuseum} />
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-vermilion-deep">{error}</p>}
      <button className="btn btn-red w-full" disabled={busy}>
        <Icon name="gavel" /> {mode === 'create' ? 'Open the saleroom' : 'Take a seat'}
      </button>
      <p className="mt-3 text-xs text-dust">3 to 5 dealers. Phones work as private paddles; any laptop or TV can show the table.</p>
    </form>
  );
}

const pick = (works: Work[][], n: number) => Array.from({ length: n }, (_, i) => works[i % 5]?.[Math.floor(i / 5) + 1]).filter(Boolean) as Work[];

export function Landing() {
  const catalog = useCatalog();
  const hang = catalog ? pick(catalog.map(a => a.works.filter(w => (w.width ?? 1) / (w.height ?? 1) < 1.6)), 10) : [];
  const featured = catalog?.[0]?.works[0];

  return (
    <main className="mx-auto max-w-[1400px] px-4 sm:px-8">
      <header className="flex items-center justify-between border-b border-ink py-4">
        <Wordmark className="text-3xl" />
        <nav className="flex items-center gap-5 text-sm">
          <a href="#rules" className="hover:text-vermilion">How it works</a>
          <a href="#artists" className="hidden hover:text-vermilion sm:inline">The artists</a>
          <a href="#enter" className="font-semibold underline">Enter</a>
        </nav>
      </header>

      <section className="grid gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14 lg:py-16">
        <div className="flex flex-col justify-between gap-10">
          <div>
            <h1 className="display text-[clamp(3.2rem,8vw,6rem)] text-balance">Good taste. Terrible investments.</h1>
            <p className="serif mt-6 max-w-[34ch] text-xl leading-snug text-charcoal">
              Five artists. Four rounds. One very expensive question: what is art actually worth?
            </p>
            <p className="mt-4 max-w-[52ch] text-[0.95rem] leading-relaxed text-charcoal">
              Curio is a multiplayer auction after Reiner Knizia's <i>Modern Art</i>. You run a museum, put paintings under the hammer,
              buy what you think the market will love, and sell it back when the round closes. Everyone else is doing the same, with your money in mind.
            </p>
          </div>
          <Entry />
        </div>

        <div className="relative" aria-label="A salon hang of paintings from the catalogue">
          <div className="columns-2 gap-3 sm:columns-3 [&>*]:mb-3">
            {hang.map((w, i) => (
              <motion.figure key={w.id} className="hung hung-tight break-inside-avoid"
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
                <Painting id={w.id} />
              </motion.figure>
            ))}
            {!catalog && Array.from({ length: 8 }, (_, i) => <div key={i} className="hung hung-tight"><div className="bg-stone/40" style={{ aspectRatio: i % 2 ? '3/4' : '4/3' }} /></div>)}
          </div>
        </div>
      </section>

      {featured && (
        <section className="grid gap-8 border-t border-ink py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center">
          <div className="hung mx-auto w-full max-w-[560px]"><Painting id={featured.id} size="full" /></div>
          <div>
            <h2 className="display text-5xl">Real paintings. Invented painters.</h2>
            <p className="mt-4 max-w-[56ch] leading-relaxed text-charcoal">
              Every card is a real public-domain work from an open museum collection. In Curio it hangs under one of five fictional artists,
              chosen for its visual language. The real maker is always one tap away.
            </p>
            <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t hair pt-4 text-sm">
              <dt className="text-dust">In Curio</dt><dd className="font-semibold">{ARTIST_META[0].name}</dd>
              <dt className="text-dust">Real title</dt><dd className="serif italic">{featured.title}</dd>
              <dt className="text-dust">Real artist</dt><dd>{featured.artist}{featured.date ? `, ${featured.date}` : ''}</dd>
              <dt className="text-dust">Collection</dt><dd><a className="underline" href={featured.sourceUrl} target="_blank" rel="noreferrer">{PROVIDERS[featured.provider]}</a> · {featured.license}</dd>
            </dl>
          </div>
        </section>
      )}

      <section id="artists" className="border-t border-ink py-12">
        <h2 className="display mb-8 text-5xl">This season's names</h2>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {ARTIST_META.map((a, i) => (
            <li key={a.name} className="flex flex-col gap-3">
              <div className="hung hung-tight">{catalog?.[i]?.works[2] ? <Painting id={catalog[i].works[2].id} fit="cover" className="aspect-[4/5]" /> : <div className="aspect-[4/5] bg-stone/40" />}</div>
              <div className="flex items-center gap-2"><span className="h-3 w-3" style={{ background: a.color }} /><h3 className="serif text-xl">{a.name}</h3></div>
              <p className="text-sm text-charcoal"><span className="font-semibold">{a.school}.</span> {a.line}</p>
              <p className="num text-xs text-dust">{[12, 13, 14, 15, 16][i]} works in circulation</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="rules" className="grid gap-10 border-t border-ink py-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <h2 className="display text-5xl">How a sale works</h2>
          <ul className="mt-6 space-y-3">
            {(Object.keys(AUCTION_NAMES) as AuctionType[]).map(t => (
              <li key={t} className="flex items-center gap-3"><Icon name={t} /><span>{AUCTION_NAMES[t]}</span></li>
            ))}
          </ul>
        </div>
        <RulesBody />
      </section>

      <footer className="flex flex-col gap-2 border-t border-ink py-6 text-xs text-dust sm:flex-row sm:justify-between">
        <span>Curio is a <a href="https://lab.futile.studio" className="underline">Futile Studio</a> experiment. After <i>Modern Art</i> by Reiner Knizia; not affiliated.</span>
        <span>Images: The Met, Cleveland Museum of Art and Art Institute of Chicago open access (CC0 / public domain).</span>
      </footer>
    </main>
  );
}
