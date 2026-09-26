import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { ScoreQueue, type QueuedScore, type SyncFn, type SyncResult } from './queue';

let n = 0;
const fresh = () => new ScoreQueue(`t${n++}`);
const s = (hole: number, strokes: number, ts: string, playerId = 'p1'): QueuedScore =>
  ({ token: 'tok', playerId, hole, strokes, clientTs: ts, deviceId: 'd' });
const answer = (fn: (it: QueuedScore) => SyncResult): SyncFn => async (_t, items) =>
  items.map((it) => ({ playerId: it.playerId, hole: it.hole, clientTs: it.clientTs, result: fn(it) }));

describe('ScoreQueue', () => {
  it('keeps one entry per player+hole, newest tap wins', async () => {
    const q = fresh();
    await q.enqueue(s(3, 4, '2026-11-21T10:00:00Z'));
    await q.enqueue(s(3, 3, '2026-11-21T10:00:05Z'));
    await q.enqueue(s(3, 9, '2026-11-21T09:00:00Z')); // late-arriving older tap
    const p = await q.pending();
    expect(p).toHaveLength(1);
    expect(p[0].strokes).toBe(3);
  });

  it('drops nothing when offline', async () => {
    const q = fresh();
    await q.enqueue(s(1, 3, '2026-11-21T10:00:00Z'));
    await q.enqueue(s(2, 3, '2026-11-21T10:01:00Z'));
    const out = await q.flush(async () => { throw new Error('no signal'); });
    expect(out.online).toBe(false);
    expect(await q.pendingCount()).toBe(2);
  });

  it('clears applied and stale, surfaces rejections', async () => {
    const q = fresh();
    await q.enqueue(s(1, 3, 'a'));
    await q.enqueue(s(2, 3, 'b'));
    await q.enqueue(s(3, 3, 'c'));
    const out = await q.flush(answer((it) => (it.hole === 1 ? 'applied' : it.hole === 2 ? 'stale' : 'rejected_submitted')));
    expect(out).toMatchObject({ online: true, applied: 1, pending: 0 });
    expect(out.rejected.map((r) => r.hole)).toEqual([3]);
    expect((await q.rejected())[0].result).toBe('rejected_submitted');
  });

  it('a tap made during a flush survives it', async () => {
    const q = fresh();
    await q.enqueue(s(5, 3, '2026-11-21T10:00:00Z'));
    const out = await q.flush(async (_t, items) => {
      await q.enqueue(s(5, 4, '2026-11-21T10:00:09Z')); // thumb hits again while request is in flight
      return items.map((it) => ({ playerId: it.playerId, hole: it.hole, clientTs: it.clientTs, result: 'applied' as const }));
    });
    expect(out.pending).toBe(1);
    expect((await q.pending())[0].strokes).toBe(4);
  });

  it('concurrent flushes share one request', async () => {
    const q = fresh();
    await q.enqueue(s(1, 3, 'a'));
    let calls = 0;
    const sync: SyncFn = async (t, items) => { calls++; return answer(() => 'applied')(t, items); };
    await Promise.all([q.flush(sync), q.flush(sync), q.flush(sync)]);
    expect(calls).toBe(1);
  });
});
