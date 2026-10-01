import { describe, expect, it } from 'vitest';
import { advance, currentIndex, fmtTime, initQueue, pick, REPEAT_NEXT, shuffled, toggleShuffle } from './queue';

const seq = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length]; };

describe('music queue', () => {
  it('plays straight through and stops at the end', () => {
    let s = initQueue(3);
    let r = advance(s, 'auto'); expect([currentIndex(r.state), r.play]).toEqual([1, true]); s = r.state;
    r = advance(s, 'auto'); expect([currentIndex(r.state), r.play]).toEqual([2, true]); s = r.state;
    r = advance(s, 'auto'); expect([currentIndex(r.state), r.play]).toEqual([0, false]);
  });
  it('repeat all loops; repeat one loops only when the track ends', () => {
    const last = { ...initQueue(3), pos: 2 };
    expect(advance({ ...last, repeat: 'all' }, 'auto')).toEqual({ state: { ...last, repeat: 'all', pos: 0 }, play: true });
    expect(advance({ ...last, repeat: 'one' }, 'auto').state.pos).toBe(2);
    expect(advance({ ...initQueue(3), repeat: 'one' }, 'next').state.pos).toBe(1);
    expect(REPEAT_NEXT.off).toBe('all'); expect(REPEAT_NEXT.one).toBe('off');
  });
  it('prev stops at the first track unless repeat all', () => {
    expect(advance(initQueue(3), 'prev').state.pos).toBe(0);
    expect(advance({ ...initQueue(3), repeat: 'all' }, 'prev').state.pos).toBe(2);
  });
  it('shuffle keeps the current song first and covers every track once', () => {
    const o = shuffled(6, 4, seq([0.1, 0.9, 0.5, 0.3, 0.7]));
    expect(o[0]).toBe(4); expect([...o].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const s = toggleShuffle({ ...initQueue(6), pos: 4 }, seq([0.2]));
    expect(currentIndex(s)).toBe(4); expect(s.pos).toBe(0);
    const off = toggleShuffle({ ...s, pos: 2 });
    expect(off.shuffle).toBe(false); expect(currentIndex(off)).toBe(s.order[2]);
  });
  it('picking a row jumps there (and re-deals in shuffle)', () => {
    expect(currentIndex(pick(initQueue(5), 3))).toBe(3);
    const sh = pick({ ...initQueue(5), shuffle: true }, 3, seq([0.5]));
    expect(sh.order[0]).toBe(3); expect(sh.pos).toBe(0);
  });
  it('formats time', () => {
    expect(fmtTime(0)).toBe('0:00'); expect(fmtTime(345.6)).toBe('5:45'); expect(fmtTime(NaN)).toBe('0:00');
  });
});
