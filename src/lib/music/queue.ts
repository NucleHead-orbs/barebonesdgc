/**
 * Music player queue: pure logic, no audio. The queue is every playable track in page order
 * (EP first, then singles); coming-soon tracks (no audio) are never in it.
 * `order` is the play order over queue indexes (identity, or shuffled with the current track first).
 */
export type Repeat = 'off' | 'all' | 'one';
export interface QueueState { order: number[]; pos: number; repeat: Repeat; shuffle: boolean }

export const REPEAT_NEXT: Record<Repeat, Repeat> = { off: 'all', all: 'one', one: 'off' };

/** Restart the current track instead of going back when more than this many seconds in. */
export const PREV_RESTART_S = 3;

export const identity = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Fisher–Yates over the other tracks; `first` stays at the front so the current song keeps playing. */
export function shuffled(n: number, first: number, rand: () => number = Math.random): number[] {
  const rest = identity(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return n ? [first, ...rest] : [];
}

export const initQueue = (n: number): QueueState => ({ order: identity(n), pos: 0, repeat: 'off', shuffle: false });
export const currentIndex = (s: QueueState) => s.order[s.pos] ?? 0;

/** Jump to a queue index (a tapped row). Shuffle re-deals so the rest of the set still follows. */
export function pick(s: QueueState, index: number, rand?: () => number): QueueState {
  if (s.shuffle) return { ...s, order: shuffled(s.order.length, index, rand), pos: 0 };
  return { ...s, pos: Math.max(0, s.order.indexOf(index)) };
}

export function toggleShuffle(s: QueueState, rand?: () => number): QueueState {
  const cur = currentIndex(s);
  return s.shuffle
    ? { ...s, shuffle: false, order: identity(s.order.length), pos: cur }
    : { ...s, shuffle: true, order: shuffled(s.order.length, cur, rand), pos: 0 };
}

/**
 * Where to go next. 'auto' = the track ended; 'next' / 'prev' = buttons.
 * Returns the new state plus `play` (false = the set is over: stop on the first track).
 * Repeat one only loops on 'auto'; the buttons always move.
 */
export function advance(s: QueueState, how: 'auto' | 'next' | 'prev'): { state: QueueState; play: boolean } {
  const n = s.order.length;
  if (!n) return { state: s, play: false };
  if (how === 'auto' && s.repeat === 'one') return { state: s, play: true };
  if (how === 'prev') return { state: { ...s, pos: s.pos > 0 ? s.pos - 1 : s.repeat === 'all' ? n - 1 : 0 }, play: true };
  if (s.pos < n - 1) return { state: { ...s, pos: s.pos + 1 }, play: true };
  // Past the last track: back to the top, and keep going only on repeat all.
  return { state: { ...s, pos: 0 }, play: s.repeat === 'all' };
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
