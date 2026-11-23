import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ARTISTS, AUCTION_NAMES, timeLimit, type Card, type Game, type LogEvent, type Sale } from '../shared/engine';
import { ARTIST_META, Painting, work } from './art';
import { act, useConnected, type Snapshot } from './net';
import { ArtInfo, Market, Museums, RulesBody, Sheet } from './Panels';
import { FinalResults, RoundResults } from './Results';
import { play, toggleSound, useSound } from './sound';
import { Clock, Icon, Money, money, Paddle, ROMAN, Wordmark } from './ui';

const spring = { type: 'spring', stiffness: 380, damping: 30 } as const;
type Panel = 'market' | 'museums' | 'rules' | 'log' | null;

interface Ctx { g: Game; s: Snapshot; seat: number | null; names: string[]; museumOf: (seat: number) => number }

export function Saleroom({ s }: { s: Snapshot }) {
  const g = s.game!;
  const seat = s.seat;
  const names = g.players.map(p => p.name);
  const museumOf = (i: number) => s.room.members.find(m => m.id === g.players[i].id)?.museum ?? i;
  const ctx: Ctx = { g, s, seat, names, museumOf };
  const [panel, setPanel] = useState<Panel>(null);
  const [info, setInfo] = useState<Card | null>(null);
  const [dismissed, setDismissed] = useState(0);
  const sound = useSound();
  const connected = useConnected();
  useEventSounds(g, seat, s.waiting);

  const sale = useLatestSale(g);
  const showSettle = g.phase.kind === 'settle' && dismissed !== g.round;

  return (
    <LayoutGroup>
      <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
        <TopBar ctx={ctx} onPanel={setPanel} sound={sound} />
        {!connected && <div role="status" className="bg-ink px-4 py-1.5 text-center text-sm text-gallery">Reconnecting to the saleroom…</div>}

        <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          <aside className="order-1 border-b hair lg:order-none lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <Players ctx={ctx} />
          </aside>
          <section className="order-2 flex min-w-0 flex-col lg:order-none lg:min-h-0">
            <Lot ctx={ctx} onInfo={setInfo} />
          </section>
          <aside className="order-4 hidden border-l hair lg:order-none lg:flex lg:min-h-0 lg:flex-col">
            <h2 className="border-b hair px-4 py-3 text-sm font-semibold">Sale record</h2>
            <EventLog ctx={ctx} className="flex-1 overflow-y-auto px-4 py-3" />
          </aside>
        </div>

        {seat !== null && <Hand ctx={ctx} onInfo={setInfo} />}
        <MobileNav onPanel={setPanel} />
      </div>

      <SoldBanner sale={sale} ctx={ctx} />

      <AnimatePresence>
        {panel === 'market' && <Sheet key="m" title="The Curio Index" onClose={() => setPanel(null)}><Market g={g} /></Sheet>}
        {panel === 'museums' && <Sheet key="c" title="The collections" onClose={() => setPanel(null)}><Museums g={g} art={s.room.art} museumOf={museumOf} seat={seat} onInfo={setInfo} /></Sheet>}
        {panel === 'rules' && <Sheet key="r" title="House rules" onClose={() => setPanel(null)}><RulesBody /></Sheet>}
        {panel === 'log' && <Sheet key="l" title="Sale record" onClose={() => setPanel(null)}><EventLog ctx={ctx} /></Sheet>}
        {info && <ArtInfo key="i" card={info} art={s.room.art} onClose={() => setInfo(null)} />}
        {showSettle && <RoundResults key="settle" ctx={ctx} onClose={() => setDismissed(g.round)} />}
        {g.phase.kind === 'over' && <FinalResults key="over" ctx={ctx} />}
      </AnimatePresence>
    </LayoutGroup>
  );
}
export type { Ctx };

function TopBar({ ctx, onPanel, sound }: { ctx: Ctx; onPanel: (p: Panel) => void; sound: boolean }) {
  const { g, s } = ctx;
  const ph = g.phase;
  const auctioneer = ph.kind === 'auction' ? ph.auctioneer : ph.kind === 'play' ? ph.seat : ph.kind === 'double' ? ph.by : null;
  const values = g.markers.map(m => m.reduce((a, b) => a + b, 0));
  const counts = ARTISTS.map((_, a) => g.table.filter(c => c.artist === a).length);
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink px-4 py-2.5 sm:px-6">
      <Wordmark className="text-2xl" />
      <div className="flex items-baseline gap-2">
        <span className="display text-xl">Round {ROMAN[g.round]}</span>
        <span className="text-sm text-dust">of IV</span>
      </div>
      {auctioneer !== null && (
        <div className="hidden items-center gap-2 text-sm md:flex">
          <span className="text-dust">Auctioneer</span>
          <span className="font-semibold">{ctx.names[auctioneer]}</span>
        </div>
      )}
      <button onClick={() => onPanel('market')} className="order-last flex w-full items-stretch gap-px overflow-x-auto bg-stone/50 text-left" aria-label="Open the market report">
        {ARTISTS.map((name, a) => (
          <div key={name} className="flex min-w-[7.2rem] flex-1 flex-col gap-1 bg-ivory px-2.5 py-1.5 hover:bg-gallery">
            <span className="flex items-center gap-1.5 text-xs font-semibold"><span className="h-2 w-2" style={{ background: ARTIST_META[a].color }} />{name}</span>
            <span className="flex items-center justify-between gap-2">
              <span className="flex gap-0.5" aria-label={`${counts[a]} of 5 this round`}>
                {Array.from({ length: 5 }, (_, i) => <span key={i} className="h-1.5 w-2.5" style={{ background: i < counts[a] ? ARTIST_META[a].color : 'var(--color-stone)' }} />)}
              </span>
              <span className="num text-xs">{values[a] ? money(values[a]) : '—'}</span>
            </span>
          </div>
        ))}
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Clock deadline={s.room.deadline} skew={s.skew} total={timeLimit(g)} />
        <button className="btn btn-ghost hidden min-h-10 px-2.5 lg:inline-flex" onClick={() => onPanel('museums')}><Icon name="frame" />Collections</button>
        <button className="btn btn-ghost hidden min-h-10 px-2.5 lg:inline-flex" onClick={() => onPanel('rules')}><Icon name="book" />Rules</button>
        <button className="btn btn-ghost min-h-10 px-2.5" onClick={toggleSound} aria-label={sound ? 'Mute sounds' : 'Turn sounds on'} aria-pressed={sound}>
          <Icon name={sound ? 'sound' : 'mute'} />
        </button>
      </div>
    </header>
  );
}

function MobileNav({ onPanel }: { onPanel: (p: Panel) => void }) {
  const items: [Panel, string, Parameters<typeof Icon>[0]['name']][] = [['market', 'Market', 'chart'], ['museums', 'Collections', 'frame'], ['log', 'Record', 'log'], ['rules', 'Rules', 'book']];
  return (
    <nav className="sticky bottom-0 z-20 grid grid-cols-4 border-t border-ink bg-ivory pb-[env(safe-area-inset-bottom)] lg:hidden">
      {items.map(([p, label, icon]) => (
        <button key={label} onClick={() => onPanel(p)} className="flex flex-col items-center gap-0.5 py-2 text-[0.7rem] active:bg-paper"><Icon name={icon} />{label}</button>
      ))}
    </nav>
  );
}

function statusOf(ctx: Ctx, i: number): string {
  const { g, s } = ctx;
  const ph = g.phase;
  const away = !s.room.members.find(m => m.id === g.players[i].id)?.connected;
  const waiting = s.waiting.includes(i);
  let t = '';
  if (ph.kind === 'play') t = ph.seat === i ? 'Choosing a lot' : '';
  else if (ph.kind === 'double') t = ph.asking === i ? 'May add a second' : ph.declined.includes(i) ? 'Declined' : '';
  else if (ph.kind === 'auction') {
    const a = ph.auction;
    if (a.type === 'open') t = a.high?.seat === i ? 'Holds the bid' : a.passed.includes(i) ? 'Out' : 'Bidding';
    if (a.type === 'once') t = a.high?.seat === i ? 'Holds the bid' : waiting ? 'Deciding' : '';
    if (a.type === 'hidden') t = waiting ? 'Writing a bid' : 'Sealed';
    if (a.type === 'fixed') t = a.price === null ? (ph.auctioneer === i ? 'Setting price' : '') : waiting ? 'Deciding' : '';
    if (ph.auctioneer === i && !t) t = 'Auctioneer';
  }
  return away ? (t ? `${t} · away` : 'Away') : t;
}

function Players({ ctx }: { ctx: Ctx }) {
  const { g, s } = ctx;
  const ph = g.phase;
  const high = ph.kind === 'auction' && (ph.auction.type === 'open' || ph.auction.type === 'once') ? ph.auction.high?.seat : undefined;
  return (
    <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0 lg:divide-y lg:px-0 lg:py-0 hair">
      {g.players.map((p, i) => {
        const active = s.waiting.includes(i);
        return (
          <motion.li layout key={p.id}
            className={`flex min-w-[9.5rem] items-center gap-3 px-2 py-2 lg:min-w-0 lg:flex-col lg:items-stretch lg:px-4 lg:py-4 ${active ? 'bg-gallery' : ''}`}>
            <div className="flex items-center gap-3">
              <Paddle museum={ctx.museumOf(i)} size={26} raised={high === i} dim={!s.room.members.find(m => m.id === p.id)?.connected} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}{i === ctx.seat && <span className="ml-1.5 text-xs font-normal text-dust">you</span>}</p>
                <Money value={p.cash} className="text-sm" />
              </div>
              <span className="num hidden text-xs text-dust lg:inline" title="Paintings in hand">{p.handCount} in hand</span>
            </div>
            <p className={`text-xs lg:ml-[38px] ${active ? 'text-vermilion' : 'text-dust'}`} aria-live="polite">{statusOf(ctx, i) || '\u00a0'}</p>
            {p.owned.length > 0 && (
              <div className="hidden flex-wrap gap-1 lg:ml-[38px] lg:flex">
                {p.owned.map(c => (
                  <motion.div key={c.id} layoutId={`card-${c.id}`} transition={spring} className="h-10 w-8 border border-ink/60 bg-gallery p-[2px]" title={ARTISTS[c.artist]}>
                    <Painting id={ctx.s.room.art[c.id]} fit="cover" className="h-full w-full" />
                    <div className="-mt-1 h-1" style={{ background: ARTIST_META[c.artist].color }} />
                  </motion.div>
                ))}
              </div>
            )}
          </motion.li>
        );
      })}
    </ul>
  );
}

const lotNumber = (g: Game) => g.log.filter(e => e.k === 'play').length;

function Lot({ ctx, onInfo }: { ctx: Ctx; onInfo: (c: Card) => void }) {
  const { g } = ctx;
  const ph = g.phase;
  const cards = ph.kind === 'auction' ? ph.lot : ph.kind === 'double' ? [ph.lead] : [];
  const type = ph.kind === 'auction' ? ph.auction.type : ph.kind === 'double' ? 'double' : null;
  const artist = cards[0]?.artist;

  return (
    <div className="flex flex-1 flex-col gap-5 px-4 py-5 sm:px-8 lg:min-h-0 lg:overflow-y-auto lg:py-6">
      {cards.length ? (
        <div className="grid flex-1 items-center gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-0 items-center justify-center gap-4">
            {cards.map((c, i) => (
              <motion.button key={c.id} layoutId={`card-${c.id}`} transition={spring} onClick={() => onInfo(c)}
                className="hung group relative min-w-0 cursor-zoom-in text-left [--lot-h:30vh] lg:[--lot-h:min(54vh,620px)]" style={{ maxWidth: cards.length > 1 ? '46%' : '100%', rotate: cards.length > 1 ? (i ? 1.2 : -1.2) : 0 }}
                aria-label={`About this painting: ${work(ctx.s.room.art[c.id])?.title ?? ''}`}>
                <Painting id={ctx.s.room.art[c.id]} size="full" maxHeight={cards.length > 1 ? 'calc(var(--lot-h) * 0.75)' : 'var(--lot-h)'} />
                <span className="absolute right-2 top-2 bg-gallery/90 p-1 opacity-0 transition-opacity group-hover:opacity-100"><Icon name="info" size={16} /></span>
              </motion.button>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between border-b border-ink pb-2">
              <span className="num text-sm">Lot {lotNumber(g)}</span>
              {type && <motion.span key={`${lotNumber(g)}-${type}`} initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}
                className="flex items-center gap-1.5 text-sm font-semibold"><Icon name={type} size={18} />{AUCTION_NAMES[type]}</motion.span>}
            </div>
            <div>
              <p className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5" style={{ background: ARTIST_META[artist].color }} />{ARTISTS[artist]}</p>
              <h1 className="display mt-1 text-[clamp(1.8rem,3.2vw,2.8rem)] text-balance">{work(ctx.s.room.art[cards[cards.length - 1].id])?.title ?? 'Untitled'}</h1>
              {cards.length > 1 && <p className="serif mt-1 italic text-charcoal">with {work(ctx.s.room.art[cards[0].id])?.title}, as one lot</p>}
              <p className="mt-2 text-xs text-dust">Real work by {work(ctx.s.room.art[cards[cards.length - 1].id])?.artist ?? 'unknown'}. Tap the painting for the full record.</p>
            </div>
            <AuctionState ctx={ctx} />
            <Actions ctx={ctx} />
          </div>
        </div>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </div>
  );
}

function Waiting({ ctx }: { ctx: Ctx }) {
  const { g } = ctx;
  const ph = g.phase;
  const last = g.lastSale;
  const mine = ph.kind === 'play' && ph.seat === ctx.seat;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center">
      {last && (
        <div className="flex items-end gap-3 opacity-80">
          {last.lot.map(c => (
            <div key={c.id} className="hung hung-tight w-28 sm:w-36"><Painting id={ctx.s.room.art[c.id]} /></div>
          ))}
        </div>
      )}
      {last && <p className="text-sm text-charcoal">Last lot: {last.free ? `kept by ${ctx.names[last.winner]}, unsold` : `sold to ${ctx.names[last.winner]} for ${money(last.price)}`}</p>}
      <h1 className="display max-w-[18ch] text-[clamp(2rem,4vw,3.4rem)] text-balance">
        {ph.kind === 'play' ? (mine ? 'Your lot. Choose a painting to offer.' : `${ctx.names[ph.seat]} is choosing the next lot.`) : ph.kind === 'settle' ? 'The round has closed.' : 'The sale is over.'}
      </h1>
      {mine && <p className="max-w-[46ch] text-charcoal">The card's symbol decides how it sells. You earn what the buyer pays, unless the buyer is you.</p>}
    </div>
  );
}

function AuctionState({ ctx }: { ctx: Ctx }) {
  const { g } = ctx;
  const ph = g.phase;
  if (ph.kind === 'double') {
    return <p className="bg-paper px-4 py-3 text-sm">A double auction needs a second {ARTISTS[ph.lead.artist]} painting (not another double). <b>{ctx.names[ph.asking]}</b> may add one; its symbol decides the sale, and whoever adds it collects the money.</p>;
  }
  if (ph.kind !== 'auction') return null;
  const a = ph.auction;
  const big = (label: string, value: number | null, who?: number) => (
    <div>
      <p className="text-sm text-charcoal">{label}</p>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p key={value ?? 'none'} initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -18, opacity: 0 }} transition={spring}
          className="num text-[clamp(2.4rem,4.5vw,3.6rem)] font-semibold leading-none">{value === null ? '—' : money(value)}</motion.p>
      </AnimatePresence>
      {who !== undefined && <p className="mt-1 flex items-center gap-2 text-sm"><Paddle museum={ctx.museumOf(who)} size={14} /> {ctx.names[who]}</p>}
    </div>
  );
  if (a.type === 'open') return big(a.high ? 'Current bid' : 'Opening bids, any dealer, any order', a.high?.amount ?? null, a.high?.seat);
  if (a.type === 'once') return (
    <div className="flex flex-col gap-3">
      {big(a.high ? 'Current bid' : 'One bid each, clockwise. Auctioneer last.', a.high?.amount ?? null, a.high?.seat)}
      <ol className="flex flex-wrap gap-1 text-xs">
        {a.order.map((seat, i) => <li key={seat} className={`border px-2 py-1 ${i === a.turn ? 'border-vermilion text-vermilion' : i < a.turn ? 'border-stone text-dust line-through' : 'border-stone'}`}>{ctx.names[seat]}</li>)}
      </ol>
    </div>
  );
  if (a.type === 'hidden') return (
    <div>
      <p className="text-sm text-charcoal">Sealed bids. Revealed together; ties go to the auctioneer, then clockwise.</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {a.bids.map((b, i) => (
          <motion.li key={i} animate={{ rotate: b !== null ? -3 : 0, y: b !== null ? -2 : 0 }} className={`flex items-center gap-1.5 border px-2 py-1 text-xs ${b !== null ? 'border-ink bg-gallery' : 'border-dashed border-stone text-dust'}`}>
            <Icon name="hidden" size={14} />{ctx.names[i]}{i === ctx.seat && b !== null && b >= 0 ? `: ${money(b)}` : ''}
          </motion.li>
        ))}
      </ul>
    </div>
  );
  return a.price === null
    ? <p className="text-sm text-charcoal">{ctx.names[ph.auctioneer]} is setting a price. If nobody buys, the auctioneer must.</p>
    : big('Fixed price', a.price);
}

function Stepper({ min, max, initial, onSubmit, label, tone = 'red' }: { min: number; max: number; initial: number; onSubmit: (n: number) => void; label: (n: number) => string; tone?: 'red' | 'ink' }) {
  const [v, setV] = useState(Math.min(max, Math.max(min, initial)));
  useEffect(() => setV(x => Math.min(max, Math.max(min, x))), [min, max]);
  const can = max >= min;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch border border-ink bg-gallery">
        <button className="w-12 text-xl hover:bg-paper disabled:opacity-30" onClick={() => setV(Math.max(min, v - 1))} disabled={v <= min} aria-label="One thousand less">−</button>
        <label className="flex flex-1 items-center justify-center gap-0.5">
          <span className="num text-lg text-dust">$</span>
          <input className="num w-20 bg-transparent py-2 text-center text-2xl font-semibold outline-none" inputMode="numeric" value={v}
            onChange={e => { const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10); setV(Math.min(max, n)); }} aria-label="Amount in thousands" />
          <span className="num text-lg text-dust">,000</span>
        </label>
        <button className="w-12 text-xl hover:bg-paper disabled:opacity-30" onClick={() => setV(Math.min(max, v + 1))} disabled={v >= max} aria-label="One thousand more">+</button>
      </div>
      <div className="flex gap-1">
        {[1, 5, 10].map(d => <button key={d} className="btn min-h-9 flex-1 px-2 text-sm" disabled={v + d > max} onClick={() => setV(v + d)}>+{d}k</button>)}
      </div>
      <button className={`btn ${tone === 'red' ? 'btn-red' : 'btn-ink'} w-full`} disabled={!can || v < min} onClick={() => onSubmit(v)}>{label(v)}</button>
    </div>
  );
}

function Actions({ ctx }: { ctx: Ctx }) {
  const { g, seat } = ctx;
  const ph = g.phase;
  const [error, setError] = useState('');
  useEffect(() => setError(''), [g.v]);
  // the bid controls sit below the painting on phones and short laptop screens
  const ref = useRef<HTMLDivElement>(null);
  const mine = seat !== null && ctx.s.waiting.includes(seat);
  useEffect(() => { if (mine) ref.current?.scrollIntoView({ block: 'nearest' }); }, [mine, lotNumber(g), ph.kind]);
  if (seat === null) return null;
  const cash = g.players[seat].cash;
  const go = async (a: Parameters<typeof act>[0]) => { const r = await act(a); if (!r.ok) setError(r.error); };
  let body: React.ReactNode = null;

  if (ph.kind === 'double') {
    body = ph.asking === seat
      ? <div className="flex flex-col gap-2"><p className="text-sm">Pick a matching painting in your hand to add it, or pass the chance on.</p><button className="btn" onClick={() => go({ t: 'decline' })}>Decline</button></div>
      : <p className="text-sm text-dust">Waiting for {ctx.names[ph.asking]}.</p>;
  } else if (ph.kind === 'auction') {
    const a = ph.auction;
    if (a.type === 'open') {
      const high = a.high?.amount ?? 0;
      body = a.high?.seat === seat
        ? <p className="bg-paper px-4 py-3 font-semibold">You hold the bid. Hold your nerve.</p>
        : <>
            <Stepper min={high + 1} max={cash} initial={high + 1} label={n => `Bid ${money(n)}`} onSubmit={n => go({ t: 'bid', amount: n })} />
            <button className="btn btn-ghost w-full" disabled={a.passed.includes(seat)} onClick={() => go({ t: 'pass' })}>{a.passed.includes(seat) ? 'You are out, unless you bid again' : 'I’m out'}</button>
          </>;
    } else if (a.type === 'once') {
      const high = a.high?.amount ?? 0;
      body = a.order[a.turn] === seat
        ? <><Stepper min={high + 1} max={cash} initial={high + 1} label={n => `Bid ${money(n)}`} onSubmit={n => go({ t: 'bid', amount: n })} />
            <button className="btn btn-ghost w-full" onClick={() => go({ t: 'pass' })}>Pass</button></>
        : <p className="text-sm text-dust">{a.order.indexOf(seat) > a.turn ? 'Your turn is coming.' : 'You have had your say.'}</p>;
    } else if (a.type === 'hidden') {
      const mine = a.bids[seat];
      body = mine === null
        ? <Stepper min={0} max={cash} initial={0} tone="ink" label={n => `Seal my bid of ${money(n)}`} onSubmit={n => go({ t: 'bid', amount: n })} />
        : <p className="bg-paper px-4 py-3">Your envelope is sealed: <span className="num font-semibold">{money(mine)}</span>.</p>;
    } else {
      if (a.price === null) body = ph.auctioneer === seat
        ? <Stepper min={0} max={cash} initial={Math.min(cash, 15)} tone="ink" label={n => `Ask ${money(n)}`} onSubmit={n => go({ t: 'price', amount: n })} />
        : null;
      else body = a.order[a.turn] === seat
        ? <div className="grid grid-cols-2 gap-2"><button className="btn btn-red" onClick={() => go({ t: 'buy' })}>Buy for {money(a.price)}</button><button className="btn" onClick={() => go({ t: 'pass' })}>Pass</button></div>
        : ph.auctioneer === seat ? <p className="text-sm text-dust">If every dealer passes, you buy it yourself.</p> : null;
    }
  }
  return (
    <div ref={ref} className="flex scroll-mb-20 flex-col gap-2 border-t hair pt-4 lg:scroll-mb-4">
      {body}
      {error && <p role="alert" className="text-sm text-vermilion-deep">{error}</p>}
    </div>
  );
}

function Hand({ ctx, onInfo }: { ctx: Ctx; onInfo: (c: Card) => void }) {
  const { g, seat } = ctx;
  const ph = g.phase;
  const hand = g.players[seat!].hand;
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setSel(null); setError(''); }, [g.v]);
  const myPlay = ph.kind === 'play' && ph.seat === seat;
  const myDouble = ph.kind === 'double' && ph.asking === seat;
  const eligible = (c: Card) => myPlay || (myDouble && c.artist === (ph as { lead: Card }).lead.artist && c.type !== 'double');
  const chosen = hand.find(c => c.id === sel);
  const commit = async () => {
    if (!chosen) return;
    const r = await act(myPlay ? { t: 'play', card: chosen.id } : { t: 'second', card: chosen.id });
    if (!r.ok) setError(r.error);
  };

  return (
    <div className={`relative z-10 border-t border-ink bg-paper/70 ${myPlay || myDouble ? 'shadow-[0_-10px_30px_-12px_rgb(214_58_28/0.45)]' : ''}`}>
      <div className="flex items-center justify-between gap-3 px-4 pt-2 sm:px-6">
        <p className="text-sm"><span className="font-semibold">Your hand</span> <span className="text-dust">· {hand.length} paintings · <Money value={g.players[seat!].cash} /></span></p>
        <AnimatePresence>
          {chosen && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
              <button className="btn btn-ghost min-h-9 px-2 text-sm" onClick={() => onInfo(chosen)}>About it</button>
              <button className="btn btn-red min-h-9 px-3 text-sm" onClick={commit}><Icon name="gavel" size={16} />{myPlay ? (chosen.type === 'double' ? 'Offer as a double' : 'Offer this lot') : 'Add to the lot'}</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p role="alert" className="px-6 text-sm text-vermilion-deep">{error}</p>}
      <ul className="flex gap-3 overflow-x-auto px-4 pb-4 pt-5 sm:px-6" aria-label="Paintings in your hand">
        <AnimatePresence initial={false} mode="popLayout">
          {hand.map((c, i) => {
            const ok = eligible(c);
            const picked = sel === c.id;
            return (
              <motion.li key={c.id} layout initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="shrink-0">
                <motion.button layoutId={`card-${c.id}`} transition={spring}
                  onClick={() => (ok ? setSel(picked ? null : c.id) : onInfo(c))}
                  whileHover={{ y: -10, rotate: i % 2 ? 0.8 : -0.8 }} whileTap={{ scale: 0.97 }}
                  animate={{ y: picked ? -18 : 0, scale: picked ? 1.06 : 1, opacity: (myPlay || myDouble) && !ok ? 0.45 : 1 }}
                  aria-pressed={picked} aria-label={`${ARTISTS[c.artist]}, ${AUCTION_NAMES[c.type]}: ${work(ctx.s.room.art[c.id])?.title ?? ''}`}
                  className={`flex w-[7.5rem] flex-col bg-gallery text-left shadow-[var(--shadow-hang)] outline outline-1 sm:w-[8.75rem] ${picked ? 'outline-2 outline-vermilion' : 'outline-ink/70'}`}>
                  <div className="p-1.5"><Painting id={ctx.s.room.art[c.id]} fit="cover" className="aspect-[4/5] w-full" /></div>
                  <div className="flex items-center justify-between gap-1 border-t hair px-2 py-1.5" style={{ boxShadow: `inset 0 3px 0 ${ARTIST_META[c.artist].hex}` }}>
                    <span className="truncate text-[0.72rem] font-semibold">{ARTISTS[c.artist]}</span>
                    <span title={AUCTION_NAMES[c.type]}><Icon name={c.type} size={16} /></span>
                  </div>
                </motion.button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {!hand.length && <li className="serif py-6 italic text-dust">No paintings left. You can still bid on everyone else's.</li>}
      </ul>
    </div>
  );
}

export function describe(e: LogEvent, names: string[]): string {
  switch (e.k) {
    case 'round': return `Round ${ROMAN[e.round]} opens. ${names[e.starter]} has the first lot.`;
    case 'play': return `${names[e.seat]} offers a ${ARTISTS[e.card.artist]} (${AUCTION_NAMES[e.card.type].toLowerCase()}).`;
    case 'second': return `${names[e.seat]} adds a second ${ARTISTS[e.card.artist]}; sold by ${AUCTION_NAMES[e.card.type].toLowerCase()}.`;
    case 'decline': return `${names[e.seat]} declines to add a painting.`;
    case 'bid': return `${names[e.seat]} bids ${money(e.amount)}.`;
    case 'pass': return `${names[e.seat]} passes.`;
    case 'price': return `${names[e.seat]} asks ${money(e.amount)}.`;
    case 'fifth': return `A fifth ${ARTISTS[e.artist]} reaches the table. The round closes; that painting is not sold.`;
    case 'empty': return `${names[e.seat]} has no paintings and sits out the lot.`;
    case 'settle': return `Round ${ROMAN[e.result.round]} settled. ${e.result.ranking.map((a, i) => `${ARTISTS[a]} ${['first', 'second', 'third'][i]}`).join(', ') || 'No artist ranked'}.`;
    case 'sold': {
      const s = e.sale;
      if (s.free) return `No bids. ${names[s.winner]} keeps the lot for nothing.`;
      return `Sold to ${names[s.winner]} for ${money(s.price)}${s.toBank ? ', paid to the bank' : ''}.${s.bids ? ` Envelopes: ${s.bids.map((b, i) => `${names[i]} ${money(b ?? 0)}`).join(', ')}.` : ''}`;
    }
  }
}

function EventLog({ ctx, className = '' }: { ctx: Ctx; className?: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const events = ctx.g.log;
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [events.length]);
  return (
    <ol ref={ref} className={`space-y-2 text-sm ${className}`} aria-live="polite">
      {events.map((e, i) => (
        <li key={i} className={`leading-snug ${e.k === 'sold' || e.k === 'fifth' ? 'font-semibold text-ink' : e.k === 'round' || e.k === 'settle' ? 'serif border-t hair pt-2 italic' : 'text-charcoal'}`}>
          {describe(e, ctx.names)}
        </li>
      ))}
    </ol>
  );
}

// The most recent sale, surfaced once per sale for the gavel banner.
function useLatestSale(g: Game): { sale: Sale; n: number } | null {
  const n = g.log.filter(e => e.k === 'sold').length;
  return useMemo(() => (g.lastSale && n ? { sale: g.lastSale, n } : null), [n]); // eslint-disable-line react-hooks/exhaustive-deps
}

function SoldBanner({ sale, ctx }: { sale: { sale: Sale; n: number } | null; ctx: Ctx }) {
  const [shown, setShown] = useState(0);
  const first = useRef(sale?.n ?? 0);
  useEffect(() => {
    if (!sale || sale.n === first.current) return;
    setShown(sale.n);
    const t = setTimeout(() => setShown(0), sale.sale.bids ? 3600 : 2400);
    return () => clearTimeout(t);
  }, [sale?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = sale?.sale;
  return (
    <AnimatePresence>
      {s && shown === sale.n && (
        <motion.div key={shown} className="pointer-events-none fixed inset-x-0 top-24 z-40 flex justify-center px-4"
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} role="status">
          <div className="flex max-w-xl items-center gap-4 border border-ink bg-gallery px-5 py-4 shadow-[var(--shadow-lift)]">
            <motion.div initial={{ rotate: -55, originX: 1, originY: 1 }} animate={{ rotate: [-55, 8, 0] }} transition={{ duration: 0.45, times: [0, 0.6, 1], ease: 'easeIn' }}>
              <Icon name="gavel" size={40} />
            </motion.div>
            <div>
              <p className="display text-3xl">{s.free ? 'No sale' : 'Sold'}</p>
              <p className="text-sm">
                {s.free ? `${ctx.names[s.winner]} keeps it, free.` : <>to <b>{ctx.names[s.winner]}</b> · <span className="num">{money(s.price)}</span></>}
              </p>
              {s.bids && (
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {s.bids.map((b, i) => (
                    <motion.li key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.18 }}
                      className={i === s.winner ? 'font-semibold text-vermilion' : 'text-charcoal'}>
                      {ctx.names[i]} <span className="num">{money(b ?? 0)}</span>
                    </motion.li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useEventSounds(g: Game, seat: number | null, waiting: number[]) {
  const seen = useRef(g.log.length);
  const myTurn = seat !== null && waiting.includes(seat) && g.phase.kind !== 'auction';
  useEffect(() => {
    const fresh = g.log.slice(seen.current);
    seen.current = g.log.length;
    for (const e of fresh) {
      if (e.k === 'bid') play('bid');
      if (e.k === 'play' || e.k === 'second') play('bell');
      if (e.k === 'sold') { play(e.sale.bids ? 'reveal' : 'gavel'); if (e.sale.winner === seat && !e.sale.free) setTimeout(() => play('win'), 350); }
      if (e.k === 'settle') play('reveal');
    }
  }, [g.log.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (myTurn) play('turn'); }, [myTurn]);
}
