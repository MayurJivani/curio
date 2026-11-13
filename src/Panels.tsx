import { motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { ARTISTS, AUCTION_NAMES, MARKERS, projected, ranking, type Card, type Game } from '../shared/engine';
import { ARTIST_META, Painting, PROVIDERS, useCatalog, work } from './art';
import { Icon, Money, money, MUSEUMS, Paddle, ROMAN } from './ui';

export function Sheet({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', key);
    return () => { removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-end bg-ink/30 sm:items-stretch" onClick={onClose}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={title} onClick={e => e.stopPropagation()}
        className={`flex max-h-[92dvh] w-full flex-col border-ink bg-ivory outline-none sm:max-h-none sm:border-l ${wide ? 'sm:max-w-[1100px]' : 'sm:max-w-[720px]'}`}
        initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
        <div className="flex items-center justify-between border-b border-ink px-5 py-3">
          <h2 className="display text-3xl">{title}</h2>
          <button className="btn btn-ghost min-h-10 px-2" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </motion.div>
    </motion.div>
  );
}

const cumulative = (g: Game, a: number) => g.markers[a].reduce((x, y) => x + y, 0);

export function Market({ g }: { g: Game }) {
  const catalog = useCatalog();
  const counts = ARTISTS.map((_, a) => g.table.filter(c => c.artist === a).length);
  const rank = ranking(counts);
  const proj = projected(g);
  const order = ARTISTS.map((_, a) => a).sort((x, y) => counts[y] - counts[x] || x - y);
  const peak = Math.max(30, ...ARTISTS.map((_, a) => cumulative(g, a) + 30));
  return (
    <div>
      <p className="serif mb-6 max-w-[60ch] text-charcoal">
        Round {ROMAN[g.round]}. Paintings on the table decide the order; at the close the top three earn 30, 20 and 10 thousand, added to anything they earned before.
        Fall out of the top three and your paintings are worth nothing this round, however famous the name.
      </p>
      <ol className="divide-y hair border-y border-ink">
        {order.map(a => {
          const r = rank.indexOf(a);
          return (
            <motion.li layout key={a} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 py-4 sm:grid-cols-[84px_minmax(0,1fr)_200px]">
              <div className="hung hung-tight self-start">{catalog?.[a]?.works[0] ? <Painting id={catalog[a].works[0].id} fit="cover" className="aspect-square" /> : <div className="aspect-square bg-stone/40" />}</div>
              <div className="min-w-0">
                <div className="flex items-baseline gap-3">
                  <span className="num w-6 text-sm text-dust">{r >= 0 ? ['1st', '2nd', '3rd'][r] : '—'}</span>
                  <h3 className="serif truncate text-xl">{ARTISTS[a]}</h3>
                </div>
                <p className="ml-9 text-xs text-dust">{ARTIST_META[a].school}</p>
                <div className="ml-9 mt-2 flex items-center gap-3 text-sm">
                  <span className="flex gap-0.5" aria-label={`${counts[a]} of 5 played this round`}>
                    {Array.from({ length: 5 }, (_, i) => <span key={i} className="h-3 w-3" style={{ background: i < counts[a] ? ARTIST_META[a].color : 'var(--color-stone)' }} />)}
                  </span>
                  <span className="text-charcoal">{counts[a]} this round</span>
                </div>
              </div>
              <div className="col-span-2 flex items-end justify-between gap-4 sm:col-span-1 sm:flex-col sm:items-end">
                <div className="flex h-14 items-end gap-1" aria-label="Value earned per round">
                  {g.markers[a].map((m, i) => (
                    <div key={i} className="flex w-7 flex-col items-center gap-0.5">
                      <motion.div className="w-full" initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} style={{ height: `${(m / 30) * 40}px`, background: i + 1 === g.round ? 'var(--color-ink)' : ARTIST_META[a].color, originY: 1 }} />
                      <span className="num text-[0.6rem] text-dust">{ROMAN[i + 1]}</span>
                    </div>
                  ))}
                </div>
                <div className="text-right">
                  <p className="text-xs text-dust">Banked value</p>
                  <Money value={cumulative(g, a)} className="text-lg font-semibold" />
                  <p className="text-xs">{proj[a] ? <>If it closed now: <span className="num font-semibold" style={{ color: ARTIST_META[a].color }}>{money(proj[a])}</span></> : <span className="text-dust">Worthless if it closed now</span>}</p>
                </div>
              </div>
              <div className="col-span-2 h-px sm:col-span-3" style={{ background: `linear-gradient(90deg, ${ARTIST_META[a].hex} ${(cumulative(g, a) / peak) * 100}%, transparent 0)` }} aria-hidden />
            </motion.li>
          );
        })}
      </ol>
      <p className="mt-4 text-xs text-dust">Ties on the table go to the artist listed first in the catalogue order: {ARTISTS.join(', ')}.</p>
    </div>
  );
}

export function Museums({ g, art, museumOf, seat, onInfo }: { g: Game; art: Record<string, string>; museumOf: (i: number) => number; seat: number | null; onInfo: (c: Card) => void }) {
  const proj = projected(g);
  const paidFor = new Map(g.ledger.filter(l => l.round === g.round && l.soldFor === null).flatMap(l => l.cards.map(c => [c.id, l.paid / l.cards.length] as const)));
  return (
    <div className="flex flex-col gap-10">
      {g.players.map((p, i) => {
        const settled = g.ledger.filter(l => l.seat === i && l.soldFor !== null);
        const realised = settled.reduce((s, l) => s + l.soldFor! - l.paid, 0);
        const valuation = p.owned.reduce((s, c) => s + proj[c.artist], 0);
        return (
          <section key={p.id}>
            <div className="mb-3 flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-ink pb-2">
              <div className="flex items-center gap-3">
                <Paddle museum={museumOf(i)} size={26} />
                <div>
                  <h3 className="serif text-2xl leading-none">{p.name}{i === seat && <span className="ml-2 text-sm text-dust">you</span>}</h3>
                  <p className="text-xs italic text-charcoal">{MUSEUMS[museumOf(i)].name}</p>
                </div>
              </div>
              <dl className="ml-auto grid grid-cols-3 gap-x-5 text-right text-xs">
                <dt className="text-dust">Cash</dt><dt className="text-dust">Wall, if sold now</dt><dt className="text-dust">Realised P/L</dt>
                <dd><Money value={p.cash} className="text-base font-semibold" /></dd>
                <dd className="num text-base">{money(valuation)}</dd>
                <dd className={`num text-base ${realised < 0 ? 'text-vermilion-deep' : 'text-forest'}`}>{realised < 0 ? '−' : '+'}{money(Math.abs(realised))}</dd>
              </dl>
            </div>
            {p.owned.length ? (
              <ul className="flex flex-wrap items-end gap-4 bg-paper/60 px-4 py-5">
                {p.owned.map(c => (
                  <li key={c.id} className="w-28 sm:w-32">
                    <button className="hung hung-tight block w-full cursor-zoom-in" onClick={() => onInfo(c)}><Painting id={art[c.id]} /></button>
                    <p className="mt-2 truncate text-xs font-semibold">{ARTISTS[c.artist]}</p>
                    <p className="num text-xs text-dust">paid {money(paidFor.get(c.id) ?? 0)} · now {money(proj[c.artist])}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="serif bg-paper/60 px-4 py-5 italic text-dust">Bare walls this round.</p>}
            {settled.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-charcoal">Sold to the bank so far ({settled.length})</summary>
                <ul className="mt-2 divide-y hair">
                  {settled.map((l, k) => (
                    <li key={k} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="truncate">Round {ROMAN[l.round]} · {l.cards.map(c => ARTISTS[c.artist]).join(' + ')}</span>
                      <span className="num shrink-0">{money(l.paid)} → {money(l.soldFor!)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ArtInfo({ card, art, onClose }: { card: Card; art: Record<string, string>; onClose: () => void }) {
  const w = work(art[card.id]);
  return (
    <Sheet title="Catalogue entry" onClose={onClose} wide>
      <div className="grid gap-8 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="hung self-start justify-self-center"><Painting id={w?.id} size="full" maxHeight="72vh" /></div>
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm text-charcoal">In Curio, hung as</p>
            <p className="serif flex items-center gap-2 text-2xl"><span className="h-3 w-3" style={{ background: ARTIST_META[card.artist].color }} />{ARTISTS[card.artist]}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm"><Icon name={card.type} size={16} />{AUCTION_NAMES[card.type]}</p>
            <p className="mt-2 text-xs text-dust">{ARTIST_META[card.artist].name} is an invented artist. The painting below is real and belongs to the person who made it.</p>
          </div>
          {w ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 border-t border-ink pt-4 text-sm">
              <dt className="text-dust">Title</dt><dd className="serif italic">{w.title}</dd>
              <dt className="text-dust">Artist</dt><dd className="font-semibold">{w.artist}</dd>
              {w.date && <><dt className="text-dust">Date</dt><dd>{w.date}</dd></>}
              {w.medium && <><dt className="text-dust">Medium</dt><dd>{w.medium}</dd></>}
              {w.department && <><dt className="text-dust">Department</dt><dd>{w.department}</dd></>}
              <dt className="text-dust">Collection</dt><dd>{PROVIDERS[w.provider]}</dd>
              <dt className="text-dust">Rights</dt><dd>{w.license}</dd>
              <dt className="text-dust">Record</dt><dd><a className="underline" href={w.sourceUrl} target="_blank" rel="noreferrer">View at the museum</a></dd>
            </dl>
          ) : <p className="text-dust">The catalogue record is still loading.</p>}
        </div>
      </div>
    </Sheet>
  );
}

export function RulesBody() {
  const rows: [string, string][] = [
    ['Open auction', 'Anyone, the auctioneer included, bids in any order and as often as they like. The hammer falls when everyone else is out or ten seconds pass without a raise.'],
    ['Once around', 'Starting left of the auctioneer, each dealer gets one chance to bid higher or pass. The auctioneer goes last.'],
    ['Sealed bid', 'Everyone writes one secret bid. All are revealed together. Ties go to the auctioneer, then clockwise from them.'],
    ['Fixed price', 'The auctioneer names a price they could afford. Clockwise, the first dealer to accept buys it. If nobody does, the auctioneer must.'],
    ['Double auction', 'Offered with a second painting by the same artist, which may not be another double. Its symbol sets the sale. If the auctioneer will not add one, each dealer to the left in turn may; whoever adds it runs the sale, keeps the money, and play continues to their left. If nobody adds one, the auctioneer keeps the double for free.'],
  ];
  return (
    <div className="flex max-w-[70ch] flex-col gap-6 text-[0.95rem] leading-relaxed">
      <div className="space-y-3">
        <p>Each dealer starts with <b className="num">$100,000</b>. On your turn, put one painting from your hand up for sale. Whoever buys it pays you; if you buy your own painting, you pay the bank. If nobody bids, you keep it for free.</p>
        <p>The round ends the moment a <b>fifth painting by one artist</b> is played. That painting is not sold, but it counts. The three artists with the most paintings on the table earn <span className="num">{MARKERS.map(m => money(m)).join(' / ')}</span>, ties going to the artist listed first. Their value adds to whatever they earned in earlier rounds, but only if they placed again this round.</p>
        <p>Everything bought this round is then sold to the bank at those values. Everything else is worth nothing. Hands carry over; new cards are dealt before rounds II and III. After round IV, the richest museum wins.</p>
      </div>
      <dl className="divide-y hair border-y border-ink">
        {rows.map(([t, d], i) => (
          <div key={t} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
            <dt className="flex items-center gap-2 font-semibold"><Icon name={(['open', 'once', 'hidden', 'fixed', 'double'] as const)[i]} />{t}</dt>
            <dd className="text-charcoal">{d}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-dust">Out of paintings? You sit out your turn but can still bid. The house clock acts for anyone who takes too long: it plays your first card, passes, or seals a bid of zero.</p>
    </div>
  );
}
