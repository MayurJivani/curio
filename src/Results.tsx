import { motion } from 'motion/react';
import { ARTISTS, type Purchase } from '../shared/engine';
import { navigate } from './App';
import { ARTIST_META, Painting } from './art';
import { act } from './net';
import type { Ctx } from './Saleroom';
import { Icon, Money, money, MUSEUMS, Paddle, ROMAN, Wordmark } from './ui';

const ease = [0.16, 1, 0.3, 1] as const;
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.35, delayChildren: 0.3 } } };
const item = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.7, ease } } };

function Shell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <motion.div role="dialog" aria-modal aria-label={label} className="fixed inset-0 z-50 overflow-y-auto bg-ivory"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-8 sm:py-12">{children}</div>
    </motion.div>
  );
}

export function RoundResults({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { g, s, names } = ctx;
  const r = g.results[g.results.length - 1];
  const before = r.cashAfter.map((c, i) => c - r.payouts[i]);
  const prevValue = (a: number) => g.markers[a].slice(0, r.round - 1).reduce((x, y) => x + y, 0);
  const fallen = ARTISTS.map((_, a) => a).filter(a => !r.ranking.includes(a) && prevValue(a) > 0);
  const surge = r.ranking.filter(a => prevValue(a) > 0);
  const isHost = s.room.host === s.me;
  return (
    <Shell label={`Round ${ROMAN[r.round]} results`}>
      <div className="flex items-center justify-between border-b border-ink pb-3">
        <Wordmark className="text-2xl" />
        <button className="btn btn-ghost min-h-10" onClick={onClose}>See the table</button>
      </div>
      <h1 className="display mt-8 text-[clamp(2.8rem,7vw,5.5rem)]">Round {ROMAN[r.round]}, settled.</h1>
      <p className="serif mt-3 max-w-[56ch] text-lg text-charcoal">
        {r.endedBy !== null ? `A fifth ${ARTISTS[r.endedBy]} closed the round.` : 'The last painting in play closed the round.'} The bank now buys back every painting at the new prices.
      </p>

      <motion.ol variants={stagger} initial="hidden" animate="show" className="mt-10 grid gap-4 md:grid-cols-3">
        {r.ranking.map((a, i) => (
          <motion.li key={a} variants={item} className="border border-ink bg-gallery p-5">
            <p className="num text-sm text-dust">{['First', 'Second', 'Third'][i]} · {r.counts[a]} on the table</p>
            <p className="serif mt-1 flex items-center gap-2 text-3xl"><span className="h-3 w-3" style={{ background: ARTIST_META[a].color }} />{ARTISTS[a]}</p>
            <div className="mt-4 flex items-baseline gap-3">
              <Money value={r.values[a]} className="text-4xl font-semibold" />
              <span className="num text-sm text-forest">+{money(r.markers[a])}</span>
            </div>
            <p className="mt-1 text-xs text-dust">per painting{prevValue(a) ? `, up from ${money(prevValue(a))}` : ''}</p>
          </motion.li>
        ))}
      </motion.ol>

      {(surge.length > 0 || fallen.length > 0) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {surge.map(a => <p key={a}><b>{ARTISTS[a]}</b> compounds: collectors who held on are rewarded.</p>)}
          {fallen.map(a => <p key={a} className="text-vermilion-deep"><b>{ARTISTS[a]}</b> falls out of fashion. Anything bought this round is worthless.</p>)}
        </motion.div>
      )}

      <motion.section initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.2, delayChildren: 1.5 } } }} className="mt-12">
        <h2 className="display border-b border-ink pb-2 text-3xl">The bank pays out</h2>
        <ul className="divide-y hair">
          {g.players.map((p, i) => (
            <motion.li key={p.id} variants={item} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4">
              <Paddle museum={ctx.museumOf(i)} size={26} />
              <div>
                <p className="font-semibold">{names[i]}</p>
                <p className="text-xs text-dust">{money(before[i])} before the sale</p>
              </div>
              <div className="text-right">
                <p className={`num text-sm ${r.payouts[i] ? 'text-forest' : 'text-dust'}`}>{r.payouts[i] ? `+${money(r.payouts[i])}` : 'nothing to sell'}</p>
                <Money value={r.cashAfter[i]} className="text-2xl font-semibold" />
              </div>
            </motion.li>
          ))}
        </ul>
      </motion.section>

      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-ink pt-5">
        {isHost
          ? <button className="btn btn-red" onClick={() => act({ t: 'next' })}><Icon name="gavel" />Open round {ROMAN[r.round + 1]}</button>
          : <p className="text-charcoal">The host opens round {ROMAN[r.round + 1]}. It opens by itself shortly.</p>}
        <p className="text-sm text-dust">New paintings are dealt before rounds II and III. None before IV.</p>
      </div>
    </Shell>
  );
}

const profit = (l: Purchase) => (l.soldFor ?? 0) - l.paid;

export function FinalResults({ ctx }: { ctx: Ctx }) {
  const { g, names, s } = ctx;
  const order = g.players.map((_, i) => i).sort((a, b) => g.players[b].cash - g.players[a].cash);
  const winner = order[0];
  const values = g.markers.map(m => m.reduce((x, y) => x + y, 0));
  const topArtist = values.indexOf(Math.max(...values));
  const paid = g.ledger.filter(l => l.paid > 0 || (l.soldFor ?? 0) > 0);
  const best = paid.slice().sort((a, b) => profit(b) - profit(a))[0];
  const worst = paid.slice().sort((a, b) => profit(a) - profit(b))[0];
  const hall = (label: string, l?: Purchase) => l && (
    <div className="flex gap-4 border-t border-ink pt-4">
      <div className="flex w-24 shrink-0 gap-1">{l.cards.map(c => <div key={c.id} className="hung hung-tight flex-1"><Painting id={s.room.art[c.id]} /></div>)}</div>
      <div>
        <p className="text-sm text-dust">{label}</p>
        <p className="font-semibold">{names[l.seat]}, round {ROMAN[l.round]}</p>
        <p className="num text-sm">{money(l.paid)} → {money(l.soldFor ?? 0)} <span className={profit(l) < 0 ? 'text-vermilion-deep' : 'text-forest'}>({profit(l) < 0 ? '−' : '+'}{money(Math.abs(profit(l)))})</span></p>
      </div>
    </div>
  );

  return (
    <Shell label="Final results">
      <div className="flex items-center justify-between border-b border-ink pb-3">
        <Wordmark className="text-2xl" />
        <button className="btn" onClick={() => navigate('/')}>Leave the auction house</button>
      </div>
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease }} className="py-12 text-center">
        <p className="serif text-lg italic text-charcoal">After four rounds, the richest museum is</p>
        <div className="mt-6 flex justify-center"><Paddle museum={ctx.museumOf(winner)} size={64} raised /></div>
        <h1 className="display mt-4 text-[clamp(3rem,9vw,7rem)]">{names[winner]}</h1>
        <p className="serif text-xl italic">{MUSEUMS[ctx.museumOf(winner)].name}</p>
        <Money value={g.players[winner].cash} className="mt-4 block text-4xl font-semibold" />
      </motion.div>

      <motion.ol variants={stagger} initial="hidden" animate="show" className="divide-y hair border-y border-ink">
        {order.map((i, place) => (
          <motion.li key={i} variants={item} className="grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-4 py-4">
            <span className="num text-lg text-dust">{place + 1}</span>
            <Paddle museum={ctx.museumOf(i)} size={24} />
            <div className="min-w-0">
              <p className="font-semibold">{names[i]}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.ledger.filter(l => l.seat === i).flatMap(l => l.cards).slice(0, 14).map(c => (
                  <div key={c.id} className="h-9 w-7 border border-ink/50 bg-gallery p-[2px]"><Painting id={s.room.art[c.id]} fit="cover" className="h-full w-full" /></div>
                ))}
              </div>
            </div>
            <Money value={g.players[i].cash} className="text-xl font-semibold" />
          </motion.li>
        ))}
      </motion.ol>

      <section className="mt-12 grid gap-8 md:grid-cols-3">
        <div className="border-t border-ink pt-4">
          <p className="text-sm text-dust">Most valuable artist</p>
          <p className="serif flex items-center gap-2 text-2xl"><span className="h-3 w-3" style={{ background: ARTIST_META[topArtist].color }} />{ARTISTS[topArtist]}</p>
          <p className="num text-sm">{money(values[topArtist])} banked across the game</p>
        </div>
        {hall('Best purchase', best)}
        {hall('Most disastrous investment', worst !== best ? worst : undefined)}
      </section>
      <p className="serif mt-14 text-center text-lg italic text-charcoal">The saleroom is closed. Good taste remains optional.</p>
    </Shell>
  );
}
