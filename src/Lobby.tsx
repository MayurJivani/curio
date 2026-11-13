import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { navigate } from './App';
import { MuseumPicker } from './Landing';
import { forget, send, unbind, type Snapshot } from './net';
import { Icon, MUSEUMS, Paddle, Wordmark } from './ui';

export function Lobby({ s }: { s: Snapshot }) {
  const { room } = s;
  const me = room.members.find(m => m.id === s.me);
  const isHost = room.host === s.me;
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}/r/${room.code}`;
  const run = async (event: string, payload?: object) => {
    setError('');
    const r = await send(event, payload);
    if (!r.ok) setError(r.error);
    return r;
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Curio', text: `Join my Curio sale: ${room.code}`, url: link }); return; } catch { /* fall back to copy */ } }
    await navigator.clipboard?.writeText(link);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-[1200px] flex-col px-4 sm:px-8">
      <header className="flex items-center justify-between border-b border-ink py-4">
        <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }}><Wordmark className="text-3xl" /></a>
        <a className="text-sm underline" href={`/r/${room.code}/table`} target="_blank" rel="noreferrer">Open the table display</a>
      </header>

      <section className="grid flex-1 gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm text-charcoal">Room code</p>
            <p className="num text-[clamp(4rem,12vw,8rem)] font-semibold leading-none tracking-[0.12em]">{room.code}</p>
          </div>
          <p className="serif max-w-[40ch] text-lg leading-snug text-charcoal">
            The doors are open. Dealers join at <span className="num text-ink">{location.host}</span> with this code, or by the link.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={share}>{copied ? 'Link copied' : 'Invite dealers'}</button>
            {me && <button className="btn btn-ghost" onClick={async () => { await run('leave'); forget(room.code); unbind(); navigate('/'); }}>Leave the room</button>}
          </div>
          {me && (
            <div className="border-t hair pt-5">
              <p className="mb-2 text-sm text-charcoal">Your museum</p>
              <MuseumPicker value={me.museum} onChange={m => run('museum', { museum: m })} taken={room.members.map(m => m.museum)} />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="flex items-baseline justify-between border-b border-ink pb-2">
            <h1 className="display text-4xl">Dealers present</h1>
            <span className="num text-sm">{room.members.length} / 5</span>
          </div>
          <ul className="divide-y hair">
            <AnimatePresence initial={false}>
              {room.members.map(m => (
                <motion.li key={m.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-4 py-4">
                  <Paddle museum={m.museum} size={34} dim={!m.connected} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{m.name}{m.id === s.me && <span className="ml-2 text-sm font-normal text-dust">you</span>}</p>
                    <p className="serif text-sm italic text-charcoal">{MUSEUMS[m.museum].name}</p>
                  </div>
                  {!m.connected && <span className="text-xs text-dust">away</span>}
                  {room.host === m.id ? <span className="flex items-center gap-1 text-sm"><Icon name="gavel" size={16} />Host</span>
                    : isHost && <button className="btn btn-ghost min-h-9 px-2 text-sm" onClick={() => run('host', { to: m.id })}>Hand over gavel</button>}
                </motion.li>
              ))}
            </AnimatePresence>
            {Array.from({ length: Math.max(0, 3 - room.members.length) }, (_, i) => (
              <li key={`empty${i}`} className="flex items-center gap-4 py-4 text-dust">
                <div className="h-[49px] w-[34px] border border-dashed border-stone" />
                <span className="serif italic">An empty chair</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto border-t border-ink pt-5">
            {error && <p role="alert" className="mb-3 text-sm text-vermilion-deep">{error}</p>}
            {isHost ? (
              <button className="btn btn-red w-full sm:w-auto" disabled={room.members.length < 3} onClick={() => run('start')}>
                <Icon name="gavel" /> {room.members.length < 3 ? `Waiting for ${3 - room.members.length} more` : 'Open the sale'}
              </button>
            ) : (
              <p className="text-charcoal">The host opens the sale once three to five dealers are seated.</p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
