/**
 * Offline score queue (IndexedDB).
 * Rules:
 *  - Every tap is written locally FIRST, then synced. The phone never waits on signal.
 *  - One pending entry per (card token, player, hole); a newer tap replaces an older one.
 *  - A flush only removes the exact entry it sent. A tap made mid-flush survives.
 *  - Network failure: nothing is dropped.
 *  - 'applied' or 'stale' (server already has newer): resolved, removed.
 *  - Any 'rejected_*': moved to the rejected list and shown to the player. Never silent.
 */
import { createStore, get, set, del, entries, type UseStore } from 'idb-keyval';

export type SyncResult = 'applied' | 'stale' | 'rejected_submitted' | 'rejected_not_on_card' | 'rejected_invalid';

export interface QueuedScore {
  token: string;
  playerId: string;
  hole: number;
  strokes: number;
  clientTs: string; // ISO
  deviceId: string;
}

export interface RejectedScore extends QueuedScore {
  result: SyncResult;
  rejectedAt: string;
}

export type SyncFn = (
  token: string,
  items: QueuedScore[],
) => Promise<Array<{ playerId: string; hole: number; clientTs: string; result: SyncResult }>>;

export interface FlushOutcome {
  online: boolean;
  applied: number;
  rejected: RejectedScore[];
  pending: number;
}

const keyOf = (s: Pick<QueuedScore, 'token' | 'playerId' | 'hole'>) => `${s.token}|${s.playerId}|${s.hole}`;

export class ScoreQueue {
  private pendingStore: UseStore;
  private rejectedStore: UseStore;
  private flushing: Promise<FlushOutcome> | null = null;

  constructor(dbPrefix = 'jewel') {
    this.pendingStore = createStore(`${dbPrefix}-pending`, 'scores');
    this.rejectedStore = createStore(`${dbPrefix}-rejected`, 'scores');
  }

  async enqueue(s: QueuedScore): Promise<void> {
    const k = keyOf(s);
    const cur = await get<QueuedScore>(k, this.pendingStore);
    if (cur && cur.clientTs > s.clientTs) return; // an even newer tap is already queued
    await set(k, s, this.pendingStore);
  }

  async pending(): Promise<QueuedScore[]> {
    return (await entries<string, QueuedScore>(this.pendingStore)).map(([, v]) => v);
  }

  async pendingCount(): Promise<number> {
    return (await this.pending()).length;
  }

  async rejected(): Promise<RejectedScore[]> {
    return (await entries<string, RejectedScore>(this.rejectedStore)).map(([, v]) => v);
  }

  async dismissRejected(r: RejectedScore): Promise<void> {
    await del(keyOf(r), this.rejectedStore);
  }

  /** Concurrent callers share one in-flight flush. */
  flush(sync: SyncFn): Promise<FlushOutcome> {
    if (!this.flushing) this.flushing = this.doFlush(sync).finally(() => (this.flushing = null));
    return this.flushing;
  }

  private async doFlush(sync: SyncFn): Promise<FlushOutcome> {
    const items = await this.pending();
    const byToken = new Map<string, QueuedScore[]>();
    for (const it of items) byToken.set(it.token, [...(byToken.get(it.token) ?? []), it]);

    let applied = 0;
    const rejectedNow: RejectedScore[] = [];
    for (const [token, batch] of byToken) {
      let results;
      try {
        results = await sync(token, batch);
      } catch {
        return { online: false, applied, rejected: rejectedNow, pending: await this.pendingCount() };
      }
      for (const sent of batch) {
        const r = results.find((x) => x.playerId === sent.playerId && x.hole === sent.hole && x.clientTs === sent.clientTs);
        if (!r) continue; // no answer for it: keep it for the next flush
        const k = keyOf(sent);
        const cur = await get<QueuedScore>(k, this.pendingStore);
        if (cur && cur.clientTs === sent.clientTs) await del(k, this.pendingStore); // only what we sent
        if (r.result === 'applied') applied++;
        else if (r.result !== 'stale') {
          const rej: RejectedScore = { ...sent, result: r.result, rejectedAt: new Date().toISOString() };
          await set(k, rej, this.rejectedStore);
          rejectedNow.push(rej);
        }
      }
    }
    return { online: true, applied, rejected: rejectedNow, pending: await this.pendingCount() };
  }
}

export function deviceId(): string {
  const K = 'jewel-device-id';
  try {
    let id = localStorage.getItem(K);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(K, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}
