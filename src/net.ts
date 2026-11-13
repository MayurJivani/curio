import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Action, Game } from '../shared/engine';

export interface Member { id: string; name: string; museum: number; connected: boolean }
export interface Snapshot {
  room: { code: string; host: string; deadline: number | null; members: Member[]; art: Record<string, string> };
  me: string | null;
  seat: number | null;
  game: Game | null;
  waiting: number[];
  now: number;
  skew: number;
}
type Reply = { ok: true; [k: string]: any } | { ok: false; error: string };

export const socket = io({ autoConnect: true, transports: ['websocket', 'polling'] });

let snapshot: Snapshot | null = null;
const listeners = new Set<(s: Snapshot | null) => void>();
socket.on('state', (s: Snapshot) => {
  snapshot = { ...s, skew: s.now - Date.now() };
  (window as any).__curio = snapshot; // QA scripts read the client's own view; it holds nothing the page doesn't
  listeners.forEach(fn => fn(snapshot));
});

export function useSnapshot() {
  const [s, set] = useState(snapshot);
  useEffect(() => { listeners.add(set); set(snapshot); return () => void listeners.delete(set); }, []);
  return s;
}

export function useConnected() {
  const [c, set] = useState(socket.connected);
  useEffect(() => {
    const on = () => set(true), off = () => set(false);
    socket.on('connect', on); socket.on('disconnect', off);
    return () => { socket.off('connect', on); socket.off('disconnect', off); };
  }, []);
  return c;
}

export const send = (event: string, payload: object = {}) =>
  new Promise<Reply>(resolve => socket.timeout(8000).emit(event, payload, (err: unknown, res: Reply) =>
    resolve(err ? { ok: false, error: 'The house did not answer. Check your connection.' } : res)));

const key = (code: string) => `curio:seat:${code.toUpperCase()}`;
export const saved = (code: string): { id: string; token: string } | null => {
  try { return JSON.parse(localStorage.getItem(key(code)) ?? 'null'); } catch { return null; }
};
export const remember = (code: string, id: string, token: string) => localStorage.setItem(key(code), JSON.stringify({ id, token }));
export const forget = (code: string) => localStorage.removeItem(key(code));

// The binding is replayed after every reconnect so a dropped phone lands back in its seat.
let bound: { event: string; payload: object } | null = null;
export async function bind(event: 'resume' | 'watch', payload: object) {
  bound = { event, payload };
  return send(event, payload);
}
socket.on('connect', () => { if (bound) void send(bound.event, bound.payload); });
export const unbind = () => { bound = null; snapshot = null; listeners.forEach(fn => fn(null)); };

// Each action carries a nonce so a retried request is applied once.
type PlayerAction = { [K in Action['t']]: Omit<Extract<Action, { t: K }>, 'seat'> }[Action['t']];
export async function act(action: PlayerAction) {
  return send('act', { action, nonce: crypto.randomUUID?.() ?? String(Math.random()) });
}
