import { useSyncExternalStore } from 'react';

// Synthesised, so there is nothing to download and nothing ever autoplays: sounds follow game events only.
let ctx: AudioContext | null = null;
let on = localStorage.getItem('curio:sound') !== 'off';
const subs = new Set<() => void>();

export const useSound = () => useSyncExternalStore(cb => (subs.add(cb), () => subs.delete(cb)), () => on);
export function toggleSound() {
  on = !on;
  localStorage.setItem('curio:sound', on ? 'on' : 'off');
  subs.forEach(f => f());
  if (on) play('bid');
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number, bend = 1) {
  const c = ctx!, o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + at);
  o.frequency.exponentialRampToValueAtTime(freq * bend, c.currentTime + at + dur);
  g.gain.setValueAtTime(0.0001, c.currentTime + at);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + at);
  o.stop(c.currentTime + at + dur + 0.05);
}

export type Sfx = 'bell' | 'gavel' | 'bid' | 'win' | 'reveal' | 'turn';
export function play(s: Sfx) {
  if (!on) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (s === 'bell') { tone(1318, 0, 1.4, 'sine', 0.08); tone(2637, 0, 0.9, 'sine', 0.025); }
    if (s === 'gavel') { tone(180, 0, 0.12, 'triangle', 0.35, 0.5); tone(140, 0.16, 0.14, 'triangle', 0.28, 0.5); }
    if (s === 'bid') tone(880, 0, 0.09, 'triangle', 0.08, 1.2);
    if (s === 'turn') { tone(660, 0, 0.12, 'sine', 0.06); tone(990, 0.1, 0.16, 'sine', 0.05); }
    if (s === 'win') [523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.5, 'sine', 0.06));
    if (s === 'reveal') [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.14, 0.7, 'triangle', 0.05));
  } catch { /* audio is a nicety; never break the table for it */ }
}
