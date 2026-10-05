/** My Tag heat plumbing shared by the page and its cards (hooks + per-device "seen" markers). */
import { useEffect, useState } from 'react';
import * as tagApi from './api';
import type { HeatRow } from './heat';

/** Loads tag_heat for this link (again whenever `rev` changes). */
export function useHeat(token: string, rev: number): HeatRow[] | null {
  const [rows, setRows] = useState<HeatRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.heat(token); if (live && r.data) setRows(r.data); })();
    return () => { live = false; };
  }, [token, rev]);
  return rows;
}

/** What the challenge icon asked to show: a set's challenges. n changes on every tap so it re-triggers. */
export interface HeatFocus { kind: 'challenge'; pool: string; n: number }

/** Last chat message this member has seen in a set, on this device. */
export const chatSeenKey = (pool: string, member: string) => `bb-chat-seen-${pool}-${member}`;
export const readSeen = (key: string) => { try { return Number(localStorage.getItem(key) ?? 0); } catch { return 0; } };
export const writeSeen = (key: string, id: number) => { try { localStorage.setItem(key, String(id)); } catch { /* not remembered: the badge may come back */ } };

