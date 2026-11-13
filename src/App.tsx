import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useCatalog } from './art';
import { Landing, MuseumPicker } from './Landing';
import { Lobby } from './Lobby';
import { bind, forget, remember, saved, send, unbind, useSnapshot } from './net';
import { Saleroom } from './Saleroom';
import { Icon, Wordmark } from './ui';

const subs = new Set<() => void>();
export function navigate(to: string) {
  history.pushState(null, '', to);
  subs.forEach(f => f());
  scrollTo(0, 0);
}
addEventListener('popstate', () => subs.forEach(f => f()));
const usePath = () => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => location.pathname);

export function App() {
  const path = usePath();
  useCatalog();
  const m = path.match(/^\/r\/([A-Za-z]{4})(\/table)?\/?$/);
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        <motion.div key={m ? `room-${m[1]}-${!!m[2]}` : 'home'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {m ? <Room code={m[1].toUpperCase()} table={!!m[2]} /> : <Landing />}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}

function Room({ code, table }: { code: string; table: boolean }) {
  const s = useSnapshot();
  const [status, setStatus] = useState<'binding' | 'guest' | 'ok' | 'missing'>('binding');
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      const seat = saved(code);
      if (!table && seat) {
        const r = await bind('resume', { code, ...seat });
        if (!live) return;
        if (r.ok) return setStatus('ok');
        if (/No sale/.test(r.error)) { forget(code); return setStatus('missing'); }
        forget(code);
      }
      // Not seated (or the table display): watch the public state.
      const r = await bind('watch', { code });
      if (!live) return;
      if (!r.ok) return setStatus('missing');
      setStatus(table ? 'ok' : 'guest');
    })();
    return () => { live = false; unbind(); };
  }, [code, table]);

  if (status === 'missing') return <Notice title="No sale by that code" body="The room may have closed, or the code is mistyped." />;
  if (!s || status === 'binding') return <Notice title="Opening the doors…" />;
  if (status === 'guest' && !s.me) {
    if (s.game) return <Notice title="This sale is under way" body="Seats are taken. You can still watch the table." action={<button className="btn" onClick={() => navigate(`/r/${code}/table`)}>Watch the table</button>} />;
    return <JoinHere code={code} taken={s.room.members.map(m => m.museum)} onJoined={() => setStatus('ok')} error={error} setError={setError} />;
  }
  return s.game ? <Saleroom s={s} /> : <Lobby s={s} />;
}

function JoinHere({ code, taken, onJoined, error, setError }: { code: string; taken: number[]; onJoined: () => void; error: string; setError: (e: string) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('curio:name') ?? '');
  const [museum, setMuseum] = useState(() => [0, 1, 2, 3, 4].find(i => !taken.includes(i)) ?? 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem('curio:name', name.trim());
    unbind();
    const r = await send('join', { code, name, museum });
    if (!r.ok) {
      setError(r.error);
      await bind('watch', { code });
      return;
    }
    remember(code, r.id, r.token);
    await bind('resume', { code, id: r.id, token: r.token });
    onJoined();
  }
  return (
    <Notice title={`Sale ${code}`} body="Take a seat. Your phone becomes your private paddle.">
      <form onSubmit={submit} className="mt-6 w-full max-w-sm space-y-4 text-left">
        <label className="block">
          <span className="mb-1 block text-sm text-charcoal">Your name</span>
          <input className="field" value={name} onChange={e => setName(e.target.value)} maxLength={18} required autoFocus />
        </label>
        <MuseumPicker value={museum} onChange={setMuseum} taken={taken} />
        {error && <p role="alert" className="text-sm text-vermilion-deep">{error}</p>}
        <button className="btn btn-red w-full"><Icon name="gavel" />Take a seat</button>
      </form>
    </Notice>
  );
}

function Notice({ title, body, action, children }: { title: string; body?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <a href="/" onClick={e => { e.preventDefault(); navigate('/'); }} className="mb-10"><Wordmark className="text-4xl" /></a>
      <h1 className="display text-5xl text-balance">{title}</h1>
      {body && <p className="serif mt-3 max-w-[40ch] text-lg text-charcoal">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
      {children}
    </main>
  );
}
