import { describe, expect, it } from 'vitest';
import { fmtPlays, newClock, parseStats, tick } from './listens';

let n = 0; const mk = () => `p${++n}`;
const run = (c: ReturnType<typeof newClock>, slug: string, times: number[], playing = true) => {
  let logs = 0;
  for (const t of times) { const r = tick(c, slug, t, playing, mk); c = r.clock; if (r.log) logs++; }
  return { c, logs };
};
const secs = (a: number, b: number) => Array.from({ length: (b - a) * 4 + 1 }, (_, i) => a + i / 4);

describe('listen clock', () => {
  it('logs once after 30 s of real listening', () => {
    const { c, logs } = run(newClock('a', 'p0'), 'a', secs(0, 45));
    expect(logs).toBe(1); expect(c.logged).toBe(true);
  });
  it('seeking ahead does not count as listening', () => {
    expect(run(newClock('a', 'p0'), 'a', [0, 5, 100, 200, 290, 300]).logs).toBe(0);
  });
  it('paused time does not count', () => {
    expect(run(newClock('a', 'p0'), 'a', secs(0, 40), false).logs).toBe(0);
  });
  it('a new track or a replay from the top is a new play', () => {
    const first = run(newClock('a', 'p0'), 'a', secs(0, 35)).c;
    const next = tick(first, 'b', 0, true, mk).clock;
    expect(next.slug).toBe('b'); expect(next.playId).not.toBe(first.playId); expect(next.logged).toBe(false);
    const again = tick({ ...first, last: 300 }, 'a', 0.5, true, mk).clock;
    expect(again.playId).not.toBe(first.playId); expect(again.heard).toBe(0);
  });
  it('reads stats defensively', () => {
    expect(parseStats(null)).toEqual({ live: 0, plays: {} });
    expect(parseStats({ live: 3, plays: { a: 2, b: 'x' } })).toEqual({ live: 3, plays: { a: 2 } });
    expect(fmtPlays(1)).toBe('1 play'); expect(fmtPlays(1204)).toBe('1,204 plays');
  });
});
