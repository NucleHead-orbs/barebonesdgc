/**
 * TD data access. Thin wrappers only: reads go through RLS (public read / TD write),
 * writes go through td_import_players and td_publish_round. Every call returns
 * { data } or { error } — nothing here throws into the UI.
 */
import { supabase } from '../supabase';
import type { BuilderPlayer, BuilderSettings, Card, Wave } from '../cards/generate';
import type { ImportRow } from '../import/dgs';
import type { ExistingPlayer, PublishCard, PublishedCard } from './builder';

export const EVENT_SLUG = 'jewel-xi-2026';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };
const list = <T>(r: { data: T[] | null; error: unknown }): T[] => must(r) ?? [];

export interface EventRef { id: string; name: string; holeCount: number; divOrder: string[] }

export const loadEvent = () => wrap(async (): Promise<EventRef> => {
  const ev = must(await supabase.from('events').select('id, name').eq('slug', EVENT_SLUG).maybeSingle());
  if (!ev) throw new Error(`Event ${EVENT_SLUG} is not in the database. Apply the seed migration.`);
  const [holes, divs] = await Promise.all([
    supabase.from('holes').select('n', { count: 'exact', head: true }).eq('event_id', ev.id),
    supabase.from('divisions').select('code, sort').eq('event_id', ev.id).order('sort'),
  ]);
  if (holes.error) throw holes.error;
  return { id: ev.id, name: ev.name, holeCount: holes.count ?? 0, divOrder: list(divs).map((d) => d.code) };
});

export const loadPlayers = (eventId: string) => wrap(async (): Promise<ExistingPlayer[]> =>
  list(await supabase.from('players').select('id, name, div_code, rating, pdga, reg_order').eq('event_id', eventId).order('reg_order', { nullsFirst: false })));

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
