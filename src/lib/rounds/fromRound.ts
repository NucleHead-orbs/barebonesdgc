/**
 * START THE CARD from a scheduled round (migration 20261120): /scorecard?from=casual:<id> | challenge:<id>, or a
 * check-in round (migration 20261122): /scorecard?from=night:<id>, where the scorer picks the card from who's checked in.
 * Reads the round through the player's own My Tag token (tag_casuals / tag_rounds), so only people on it get a card.
 */
import * as tagApi from '../tags/api';
import type { RoundSource } from './rounds';
import { nightFree } from '../tags/board';

const short = (p: { name: string; nickname: string | null }) => (p.nickname?.trim() || p.name);

/** The round as a card source, or a plain-words reason it can't be opened. */
export async function loadRoundSource(token: string, from: string): Promise<RoundSource | string> {
  const m = /^(casual|challenge|night):([0-9a-f-]{36})$/.exec(from);
  if (!m) return "That round link doesn't look right. Start the card from My Tag → MATCHUPS.";
  const [, kind, id] = m;
  if (kind === 'night') {
    const r = await tagApi.nights(token);
    const n = r.data?.find((x) => x.id === id);
    if (!n) return "That night isn't on My Tag anymore (called off, or it's been a while).";
    if (n.closed) return `${n.title} is closed: the tags already went up. Start a regular card instead.`;
    if (!n.open) return `Check-in for ${n.title} opens 3 hours before the start.`;
    if (n.format === 'dubs') return `${n.title} is dubs tonight: no Scorecard cards. ${n.host_me ? 'Post the team results on My Tag → MATCHUPS at the end.' : 'The host posts the results at the end.'}`;
    if (!n.me_in) return `Check in to ${n.title} first (My Tag → MATCHUPS), then start the card.`;
    if (n.my_card) return "You're already on a saved card tonight. Confirm it in My Tag → MY ROUNDS.";
    return {
      source: from, label: n.title, course: n.course, courseId: n.course_id, night: n.id, players: [],
      pick: nightFree(n).map((p) => ({ memberId: p.id, name: short(p), guest: p.guest })),
    };
  }
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
export const cardLink = (kind: 'casual' | 'challenge' | 'night', id: string) => `/scorecard?from=${kind}:${id}`;
export const cardTime = (tee: string | null, now: number) => !!tee && now >= new Date(tee).getTime() - 3 * 3600e3;
