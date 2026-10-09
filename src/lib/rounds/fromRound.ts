/**
 * START THE CARD from a scheduled round (migration 20261120): /scorecard?from=casual:<id> | challenge:<id>.
 * Reads the round through the player's own My Tag token (tag_casuals / tag_rounds), so only people on it get a card.
 */
import * as tagApi from '../tags/api';
import type { RoundSource } from './rounds';

const short = (p: { name: string; nickname: string | null }) => (p.nickname?.trim() || p.name);

/** The round as a card source, or a plain-words reason it can't be opened. */
export async function loadRoundSource(token: string, from: string): Promise<RoundSource | string> {
  const m = /^(casual|challenge):([0-9a-f-]{36})$/.exec(from);
  if (!m) return "That round link doesn't look right. Start the card from My Tag → MATCHUPS.";
  const [, kind, id] = m;
  if (kind === 'casual') {
    const r = await tagApi.casuals(token);
    const x = r.data?.find((c) => c.id === id);
    if (!x) return "That round isn't on your My Tag anymore (called off, or it was a while ago).";
    if (x.mine !== 'in') return "You're not in on that round, so its card isn't yours to start.";
    const players = x.players.filter((p) => p.status === 'in');
    const host = players.find((p) => p.id === x.host.id);
    return {
      source: from, label: x.host_me ? 'Your casual round' : `${short(x.host)}'s round`, course: x.course, courseId: x.course_id,
      players: [...(host ? [host] : []), ...players.filter((p) => p.id !== x.host.id)].map((p) => ({ memberId: p.id, name: short(p) })),
    };
  }
  const r = await tagApi.rounds(token);
  const x = r.data?.find((c) => c.id === id);
  if (!x) return "That challenge round isn't on your My Tag anymore.";
  if (!x.role) return "You're not on that challenge round, so its card isn't yours to start.";
  return {
    source: from, label: `${short(x.challenger)} vs ${short(x.challenged)}`, course: x.course, courseId: x.course_id, onLine: [x.pool_id],
    players: [x.challenger, x.challenged, ...x.joins].map((p) => ({ memberId: p.id, name: short(p) })),
  };
}

/** The scorecard link for a scheduled round, and when to offer it (from 3 hours before tee). */
export const cardLink = (kind: 'casual' | 'challenge', id: string) => `/scorecard?from=${kind}:${id}`;
export const cardTime = (tee: string | null, now: number) => !!tee && now >= new Date(tee).getTime() - 3 * 3600e3;
