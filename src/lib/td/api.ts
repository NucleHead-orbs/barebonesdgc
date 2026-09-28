/**
 * TD data access. Thin wrappers only: reads go through RLS (public read / TD write),
 * writes go through td_import_players and td_publish_round. Every call returns
 * { data } or { error } — nothing here throws into the UI.
 */
import { supabase } from '../supabase';
import type { BuilderPlayer, BuilderSettings, Card, Wave } from '../cards/generate';
import type { ImportRow } from '../import/dgs';
import type { ExistingPlayer, PublishCard, PublishedCard } from './builder';
import type { DivisionRow, EventConfig, HoleRow } from './setup';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };
const list = <T>(r: { data: T[] | null; error: unknown }): T[] => must(r) ?? [];

// ---------- events (build menu) ----------
const EVENT_COLS = 'id, slug, name, club_name, starts_on, ends_on, skin, palette, rounds, waves, use_checkin, use_sponsors, archived';

/** Events this account can run (super admin: all). */
export const myEvents = () => wrap(async (): Promise<EventConfig[]> =>
  list((await supabase.rpc('td_my_events').select(EVENT_COLS)) as { data: EventConfig[] | null; error: unknown }));

export interface EventSetup { event: EventConfig; holes: HoleRow[]; divisions: Array<DivisionRow & { sort: number }>; tds: string[] }

export const loadEventSetup = (eventId: string) => wrap(async (): Promise<EventSetup> => {
  const [ev, holes, divs, tds] = await Promise.all([
    supabase.from('events').select(EVENT_COLS).eq('id', eventId).maybeSingle(),
    supabase.from('holes').select('n, par, dist_ft, ob').eq('event_id', eventId).order('n'),
    supabase.from('divisions').select('code, sort, wave_default').eq('event_id', eventId).order('sort'),
    supabase.from('event_tds').select('email').eq('event_id', eventId).order('added_at'),
  ]);
  const event = must(ev) as EventConfig | null;
  if (!event) throw new Error('That event no longer exists.');
  return {
    event,
    holes: list(holes) as HoleRow[],
    divisions: (list(divs) as Array<{ code: string; sort: number; wave_default: 'AM' | 'PM' }>).map((d) => ({ code: d.code, sort: d.sort, wave: d.wave_default })),
    tds: (list(tds) as Array<{ email: string }>).map((t) => t.email),
  };
});

export interface NewEvent { name: string; club: string; starts: string; ends: string; holeCount: number; divisions: DivisionRow[] }
export const createEvent = (e: NewEvent) => wrap(async (): Promise<{ id: string; slug: string }> =>
  must(await supabase.rpc('td_create_event', {
    p_name: e.name, p_club: e.club, p_starts: e.starts, p_ends: e.ends, p_copy_from: null,
    p_hole_count: e.holeCount, p_divisions: e.divisions,
  })) as { id: string; slug: string });

/** League week 2: same course, format, divisions, card rules and TDs. No players or scores. */
export const duplicateEvent = (fromId: string, e: { name: string; starts: string; ends: string; copyPlayers: boolean }) => wrap(async (): Promise<{ id: string; slug: string }> =>
  must(await supabase.rpc('td_create_event', {
    p_name: e.name, p_club: null, p_starts: e.starts, p_ends: e.ends, p_copy_from: fromId, p_copy_players: e.copyPlayers,
  })) as { id: string; slug: string });

/** Players who are on a card (any round) or have any score: those can't be removed from the list. */
export const lockedPlayerIds = (eventId: string) => wrap(async (): Promise<Set<string>> => {
  const [onCards, scored] = await Promise.all([
    supabase.from('card_players').select('player_id, cards!inner(event_id)').eq('cards.event_id', eventId),
    supabase.from('scores').select('player_id, players!inner(event_id)').eq('players.event_id', eventId),
  ]);
  return new Set([...list(onCards), ...list(scored)].map((r) => (r as { player_id: string }).player_id));
});

export type EventPatch = Partial<Pick<EventConfig, 'name' | 'club_name' | 'starts_on' | 'ends_on' | 'palette' | 'rounds' | 'waves' | 'use_checkin' | 'use_sponsors' | 'archived'>>;
export const updateEvent = (eventId: string, patch: EventPatch) => wrap(async (): Promise<EventConfig> =>
  must(await supabase.rpc('td_update_event', { p_event_id: eventId, p: patch })) as EventConfig);

export const setHoles = (eventId: string, holes: HoleRow[]) => wrap(async () => {
  must(await supabase.rpc('td_set_holes', { p_event_id: eventId, p_holes: holes }));
});
export const setDivisions = (eventId: string, divs: DivisionRow[]) => wrap(async () => {
  must(await supabase.rpc('td_set_divisions', { p_event_id: eventId, p_divs: divs.map((d) => ({ code: d.code, wave: d.wave })) }));
});
export const addTd = (eventId: string, email: string) => wrap(async () => {
  must(await supabase.from('event_tds').insert({ event_id: eventId, email }));
});
export const removeTd = (eventId: string, email: string) => wrap(async () => {
  must(await supabase.from('event_tds').delete().eq('event_id', eventId).eq('email', email));
});
export const deleteEvent = (eventId: string) => wrap(async () => {
  must(await supabase.rpc('td_delete_event', { p_event_id: eventId }));
});

// ---------- players ----------
export const loadPlayers = (eventId: string) => wrap(async (): Promise<ExistingPlayer[]> =>
  list(await supabase.from('players').select('id, name, div_code, rating, pdga, reg_order, checked_in').eq('event_id', eventId).order('reg_order', { nullsFirst: false })));

export const setCheckedIn = (playerId: string, on: boolean) => wrap(async () => {
  must(await supabase.from('players').update({ checked_in: on }).eq('id', playerId));
});

/** Walk-up player. Same RPC as the DGS import, so a repeat name updates instead of duplicating. */
export const quickAddPlayer = (eventId: string, p: { name: string; div_code: string; reg_order: number; checked_in: boolean }) =>
  wrap(async (): Promise<ImportResult> =>
    must(await supabase.rpc('td_import_players', { p_event_id: eventId, p_rows: [{ ...p, rating: null, pdga: null, dgs_id: null }] })) as ImportResult);

/** Remove a player who registered by mistake. Refused (by the UI) once they are on a card or have scores. */
export const removePlayer = (playerId: string) => wrap(async () => {
  must(await supabase.from('players').delete().eq('id', playerId));
});

export const toBuilderPlayers = (ps: ExistingPlayer[]): BuilderPlayer[] =>
  ps.map((p) => ({ id: p.id, name: p.name, div: p.div_code, rating: p.rating, regOrder: p.reg_order }));

/** Official, complete R1 totals (r2_seed view) for R2 seeding. */
export const loadR1Strokes = (eventId: string) => wrap(async (): Promise<Record<string, number>> => {
  const rows = list(await supabase.from('r2_seed').select('player_id, r1_strokes').eq('event_id', eventId));
  return Object.fromEntries(rows.map((r) => [r.player_id as string, r.r1_strokes as number]));
});

export const loadSettings = (eventId: string, round: 1 | 2) => wrap(async (): Promise<unknown> => {
  const row = must(await supabase.from('builder_settings').select('settings').eq('event_id', eventId).eq('round', round).maybeSingle()) as { settings: unknown } | null;
  return row?.settings ?? null;
});

export const saveSettings = (eventId: string, round: 1 | 2, settings: BuilderSettings) => wrap(async () => {
  must(await supabase.from('builder_settings').upsert({ event_id: eventId, round, settings, updated_at: new Date().toISOString() }));
});

/** The round as currently published: cards (with locks) plus the slot tokens (TD-only table). */
export const loadPublished = (eventId: string, round: 1 | 2) => wrap(async (): Promise<{ cards: Card[]; published: PublishedCard[] }> => {
  const [cards, tokens] = await Promise.all([
    supabase.from('cards').select('id, wave, start_hole, group_no, label, locked, card_players(player_id, seat)')
      .eq('event_id', eventId).eq('round', round).order('wave').order('start_hole').order('group_no'),
    supabase.from('card_tokens').select('wave, label, token').eq('event_id', eventId).eq('round', round),
  ]);
  const tok = new Map(list(tokens).map((t) => [`${t.wave}|${t.label}`, t.token as string]));
  const rows = list(cards) as Array<{ id: string; wave: Wave; start_hole: number; group_no: number; label: string; locked: boolean;
    card_players: Array<{ player_id: string; seat: number }> }>;
  const ids = (r: (typeof rows)[number]) => r.card_players.slice().sort((a, b) => a.seat - b.seat).map((p) => p.player_id);
  return {
    cards: rows.map((r) => ({ wave: r.wave, startHole: r.start_hole, groupNo: r.group_no, locked: r.locked, playerIds: ids(r) })),
    published: rows.map((r) => ({ card_id: r.id, wave: r.wave, label: r.label, start_hole: r.start_hole, token: tok.get(`${r.wave}|${r.label}`) ?? '', players: ids(r) })),
  };
});

export interface ImportResult { inserted: number; updated: number; skipped: Array<{ row: unknown; reason: string }> }
export const importPlayers = (eventId: string, rows: ImportRow[]) => wrap(async (): Promise<ImportResult> =>
  must(await supabase.rpc('td_import_players', { p_event_id: eventId, p_rows: rows })) as ImportResult);

export const publishRound = (eventId: string, round: 1 | 2, cards: PublishCard[], force = false) => wrap(async (): Promise<PublishedCard[]> =>
  must(await supabase.rpc('td_publish_round', { p_event_id: eventId, p_round: round, p_cards: cards, p_force: force })) as PublishedCard[]);

// ---------- sponsors (TD) ----------
export interface Sponsor {
  id: string; name: string; tier: string | null; hole: number | null; logo_url: string | null;
  sort: number; source_name: string | null; hidden: boolean;
}
const SPONSOR_COLS = 'id, name, tier, hole, logo_url, sort, source_name, hidden';

/** As the TD, RLS returns hidden (unapproved) sponsors too. */
export const loadSponsors = (eventId: string) => wrap(async (): Promise<Sponsor[]> =>
  list(await supabase.from('sponsors').select(SPONSOR_COLS).eq('event_id', eventId).order('sort')) as Sponsor[]);

/** Adds hole sponsors found in a DGS file. Never overwrites TD edits; new ones land hidden. */
export const importSponsors = (eventId: string, names: string[]) => wrap(async (): Promise<{ inserted: number; existing: number }> =>
  must(await supabase.rpc('td_import_sponsors', { p_event_id: eventId, p_names: names })) as { inserted: number; existing: number });

export type SponsorPatch = Partial<Pick<Sponsor, 'name' | 'tier' | 'hole' | 'logo_url' | 'sort' | 'hidden'>>;
export const updateSponsor = (id: string, patch: SponsorPatch) => wrap(async (): Promise<Sponsor> =>
  must(await supabase.from('sponsors').update(patch).eq('id', id).select(SPONSOR_COLS).single()) as Sponsor);

/** Hand-added sponsor (not from DGS, e.g. the presenting sponsor). Starts hidden like imports. */
export const addSponsor = (eventId: string, name: string, sort: number) => wrap(async (): Promise<Sponsor> =>
  must(await supabase.from('sponsors').insert({ event_id: eventId, name, sort, hidden: true }).select(SPONSOR_COLS).single()) as Sponsor);

export const deleteSponsor = (id: string) => wrap(async () => { must(await supabase.from('sponsors').delete().eq('id', id)); });

export const LOGO_BUCKET = 'sponsor-logos';
/** Upload to the public logo bucket; returns the public URL to store on the sponsor. */
export const uploadLogo = (eventId: string, sponsorId: string, file: File) => wrap(async (): Promise<string> => {
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[file.type];
  if (!ext) throw new Error('Logo must be a PNG, JPG or WebP.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be under 2 MB.');
  const path = `${eventId}/${sponsorId}-${Date.now()}.${ext}`;
  must(await supabase.storage.from(LOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false }));
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
});
