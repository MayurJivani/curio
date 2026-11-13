import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import type { AuctionType } from '../shared/engine';

export const MUSEUMS = [
  { name: 'The Vermilion Rooms', short: 'Vermilion', color: '#d63a1c', paddle: 118 },
  { name: 'Cobalt Hall', short: 'Cobalt', color: '#1f45b0', paddle: 243 },
  { name: 'The Mustard Annex', short: 'Mustard', color: '#d39b17', paddle: 307 },
  { name: 'Forest Wing', short: 'Forest', color: '#2c5a3c', paddle: 452 },
  { name: 'The Ink Collection', short: 'Ink', color: '#16140f', paddle: 561 },
];

export const money = (k: number) => `$${(k * 1000).toLocaleString('en-US')}`;
export const ROMAN = ['', 'I', 'II', 'III', 'IV'];

// The museum's bidding paddle: its identity everywhere in the game.
export function Paddle({ museum, size = 40, raised = false, dim = false }: { museum: number; size?: number; raised?: boolean; dim?: boolean }) {
  const m = MUSEUMS[museum] ?? MUSEUMS[0];
  return (
    <motion.svg
      width={size} height={size * 1.45} viewBox="0 0 40 58" aria-hidden
      animate={{ y: raised ? -6 : 0, rotate: raised ? -8 : 0, opacity: dim ? 0.35 : 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      className="shrink-0 overflow-visible"
    >
      <rect x="17" y="34" width="6" height="23" rx="1.5" fill="#6b5a43" />
      <ellipse cx="20" cy="19" rx="18" ry="18" fill={m.color} />
      <ellipse cx="20" cy="19" rx="12.5" ry="12.5" fill="#faf7f0" />
      <text x="20" y="23.5" textAnchor="middle" fontFamily="Spline Sans Mono Variable, monospace" fontSize="11" fontWeight="700" fill="#16140f">{m.paddle}</text>
    </motion.svg>
  );
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, v => money(Math.round(v)));
  useEffect(() => {
    if (reduce) { mv.set(value); return; }
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1] });
    return () => c.stop();
  }, [value, reduce, mv]);
  return <motion.span className={`num ${className}`}>{text}</motion.span>;
}

const paths: Record<AuctionType | 'gavel' | 'info' | 'sound' | 'mute' | 'close' | 'book' | 'chart' | 'frame' | 'log', ReactNode> = {
  open: <><path d="M6 20 14 6l4 2-8 14z" /><path d="M18 20 10 6l-4 2 8 14z" /></>,
  once: <><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4v4h-4" /></>,
  hidden: <><rect x="4" y="7" width="16" height="11" /><path d="m4 7 8 6 8-6" /><circle cx="12" cy="15.5" r="2" fill="currentColor" /></>,
  fixed: <><path d="M4 12V4h8l8 8-8 8z" /><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" /></>,
  double: <><rect x="3" y="7" width="11" height="13" /><rect x="10" y="4" width="11" height="13" /></>,
  gavel: <><path d="m13 4 7 7" /><path d="m9.5 7.5 7 7" /><path d="m11 6 5 5-2 2-5-5z" /><path d="m11 13-7 7" /><path d="M13 21h8" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" /></>,
  sound: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>,
  mute: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="m16 9 5 6M21 9l-5 6" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  book: <><path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z" /><path d="M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z" /></>,
  chart: <><path d="M4 20h16" /><path d="M6 16l4-5 3 3 5-7" /></>,
  frame: <><rect x="4" y="4" width="16" height="16" /><rect x="8" y="8" width="8" height="8" /></>,
  log: <><path d="M5 6h14M5 10h14M5 14h9M5 18h6" /></>,
};
export function Icon({ name, size = 20, className = '' }: { name: keyof typeof paths; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" className={className} aria-hidden>
      {paths[name]}
    </svg>
  );
}

// Remaining seconds on the house clock, corrected for server skew.
export function useCountdown(deadline: number | null, skew = 0) {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now() + skew), 250);
    return () => clearInterval(t);
  }, [deadline, skew]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function Clock({ deadline, skew, total }: { deadline: number | null; skew: number; total: number }) {
  const left = useCountdown(deadline, skew);
  if (left === null || !total) return null;
  const urgent = left <= 5;
  return (
    <div className="flex items-center gap-2" role="timer" aria-label={`${left} seconds left`}>
      <div className="h-[3px] w-24 bg-stone/60">
        <div className="timer-bar h-full transition-transform duration-300 ease-linear"
          style={{ transform: `scaleX(${Math.min(1, left / total)})`, background: urgent ? 'var(--color-vermilion)' : 'var(--color-ink)' }} />
      </div>
      <span className={`num text-xs ${urgent ? 'text-vermilion' : 'text-charcoal'}`}>{left}s</span>
    </div>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`display inline-flex items-baseline ${className}`} aria-label="Curio">
      Curi<span className="relative">o<span className="absolute -right-[0.18em] top-[0.12em] h-[0.2em] w-[0.2em] rounded-full bg-vermilion" /></span>
    </span>
  );
}
