import { describe, it, expect } from 'vitest';
import { UPDATES, unseenCount, updatesFor } from './updates';
import { HELP } from './help';

describe('TD updates', () => {
  it('newest first, unique ids, every help link points at a real section', () => {
    const dates = UPDATES.map((u) => u.date);
    expect(dates).toEqual(dates.slice().sort().reverse());
    expect(new Set(UPDATES.map((u) => u.id)).size).toBe(UPDATES.length);
    const ids = new Set(HELP.map((h) => h.id));
    for (const u of UPDATES) if (u.help) expect(ids.has(u.help), `${u.id} -> help ${u.help}`).toBe(true);
  });
  it('filters by who it is for', () => {
    const all = updatesFor(UPDATES, { admin: true, tagAdmin: true }).length;
    const plain = updatesFor(UPDATES, { admin: false, tagAdmin: false });
    expect(plain.length).toBeLessThan(all);
    expect(plain.some((u) => u.who === 'admin' || u.who === 'tags')).toBe(false);
    expect(updatesFor(UPDATES, { admin: false, tagAdmin: true }).some((u) => u.who === 'tags')).toBe(true);
  });
  it('counts what is new since the last one seen', () => {
    const l = UPDATES.slice(0, 4);
    expect(unseenCount(l, null)).toBe(4);
    expect(unseenCount(l, l[0].id)).toBe(0);
    expect(unseenCount(l, l[2].id)).toBe(2);
    expect(unseenCount(l, 'gone')).toBe(4);
  });
});
