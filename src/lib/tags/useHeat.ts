/** My Tag heat plumbing shared by the page and its cards (hooks + per-device "seen" markers). */
import { useEffect, useState } from 'react';
import * as tagApi from './api';
import type { HeatRow } from './heat';
import type { ChallengeRound } from './board';

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

/** A clock that ticks once a minute (keeps countdowns honest without re-rendering every second). */
export function useNow(stepMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), stepMs); return () => window.clearInterval(t); }, [stepMs]);
  return now;
}

/** Challenge rounds this player can see (tag_rounds), again whenever `rev` changes. */
export function useRounds(token: string, rev: number): ChallengeRound[] {
  const [rows, setRows] = useState<ChallengeRound[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => { const r = await tagApi.rounds(token); if (live && r.data) setRows(r.data); })();
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

