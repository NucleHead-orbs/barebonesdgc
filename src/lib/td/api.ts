/**
 * TD data access. Thin wrappers only: reads go through RLS (public read / TD write),
 * writes go through td_import_players and td_publish_round. Every call returns
 * { data } or { error } — nothing here throws into the UI.
 */
import { supabase } from '../supabase';
import { shrink } from '../gallery/api';
import type { HoleTee } from '../proofs/teeSigns';
import type { BuilderPlayer, BuilderSettings, Card, Wave } from '../cards/generate';
import type { ImportRow } from '../import/dgs';
import type { ExistingPlayer, PublishCard, PublishedCard } from './builder';
import type { DivisionRow, EventConfig, HoleRow } from './setup';
import type { DivisionConfig, FinishStatus, PrizeSettings } from '../prizes/payout';
import type { TeamPayoutConfig } from '../prizes/winners';
import type { Announcement, Contact, CrewMember, RaffleSale, Role } from '../crew/crew';
import type { Half, Slot, Station } from '../crew/stations';
import type { Poll, PollOption, PollVote } from '../votes/votes';
import { summarize, toLayoutPayload, type LayoutHole, type LibCourse, type LibLayout } from '../courses/courses';
import { filePath, nextVersion, type DesignAsset, type DesignFile, type DesignStatus, type NewTask, type PrepTask } from '../prep/prep';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };
const list = <T>(r: { data: T[] | null; error: unknown }): T[] => must(r) ?? [];

// ---------- events (build menu) ----------
const EVENT_COLS = 'id, slug, name, club_name, starts_on, ends_on, skin, palette, rounds, waves, use_checkin, use_sponsors, archived, course_layout_id, r1_format, r2_format, dubs_style, kind, tag_pool_id';

/** Events this account can run (super admin: all). */
export const myEvents = () => wrap(async (): Promise<EventConfig[]> =>
  list((await supabase.rpc('td_my_events').select(EVENT_COLS)) as { data: EventConfig[] | null; error: unknown }));

export interface EventSetup { event: EventConfig; holes: HoleRow[]; divisions: Array<DivisionRow & { sort: number }>; tds: string[] }

export const loadEventSetup = (eventId: string) => wrap(async (): Promise<EventSetup> => {
  const [ev, holes, divs, tds] = await Promise.all([
    supabase.from('events').select(EVENT_COLS).eq('id', eventId).maybeSingle(),
    supabase.from('holes').select('n, par, dist_ft, ob, ctp_prize').eq('event_id', eventId).order('n'),
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

export type EventPatch = Partial<Pick<EventConfig, 'name' | 'club_name' | 'starts_on' | 'ends_on' | 'palette' | 'rounds' | 'waves' | 'use_checkin' | 'use_sponsors' | 'archived' | 'r1_format' | 'r2_format' | 'dubs_style'>>;
/** Event or league (and the league's tag set). */
export const setLeague = (eventId: string, kind: 'event' | 'league', poolId: string | null) =>
  wrap(async () => { must(await supabase.rpc('td_set_league', { p_event: eventId, p_kind: kind, p_pool: poolId })); });
/** Hole n pays a closest-to-the-pin prize (blank = not a CTP). */
export const setCtp = (eventId: string, n: number, prize: string) =>
  wrap(async () => { must(await supabase.rpc('td_set_ctp', { p_event: eventId, p_n: n, p_prize: prize })); });
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
  list(await supabase.from('players').select('id, name, div_code, rating, pdga, reg_order, checked_in, finish_status, shirt_size').eq('event_id', eventId).order('reg_order', { nullsFirst: false })));

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
  tee_id: string | null; // null = the hole's main tee sign; else an extra tee pad's sign (hole_tees)
}
const SPONSOR_COLS = 'id, name, tier, hole, logo_url, sort, source_name, hidden, tee_id';

/** As the TD, RLS returns hidden (unapproved) sponsors too. */
export const loadSponsors = (eventId: string) => wrap(async (): Promise<Sponsor[]> =>
  list(await supabase.from('sponsors').select(SPONSOR_COLS).eq('event_id', eventId).order('sort')) as Sponsor[]);

/** Adds hole sponsors found in a DGS file. Never overwrites TD edits; new ones land hidden. */
export const importSponsors = (eventId: string, names: string[]) => wrap(async (): Promise<{ inserted: number; existing: number }> =>
  must(await supabase.rpc('td_import_sponsors', { p_event_id: eventId, p_names: names })) as { inserted: number; existing: number });

export type SponsorPatch = Partial<Pick<Sponsor, 'name' | 'tier' | 'hole' | 'logo_url' | 'sort' | 'hidden' | 'tee_id'>>;
export const updateSponsor = (id: string, patch: SponsorPatch) => wrap(async (): Promise<Sponsor> =>
  must(await supabase.from('sponsors').update(patch).eq('id', id).select(SPONSOR_COLS).single()) as Sponsor);

/** Hand-added sponsor (not from DGS, e.g. the presenting sponsor). Starts hidden like imports. */
export const addSponsor = (eventId: string, name: string, sort: number) => wrap(async (): Promise<Sponsor> =>
  must(await supabase.from('sponsors').insert({ event_id: eventId, name, sort, hidden: true }).select(SPONSOR_COLS).single()) as Sponsor);

export const deleteSponsor = (id: string) => wrap(async () => { must(await supabase.from('sponsors').delete().eq('id', id)); });

// ---------- extra tee pads (hole_tees): each one is its own tee sign ----------
const TEE_COLS = 'id, n, label, dist_ft, par, sort';
export const loadTees = (eventId: string) => wrap(async (): Promise<HoleTee[]> =>
  list(await supabase.from('hole_tees').select(TEE_COLS).eq('event_id', eventId).order('n').order('sort')) as HoleTee[]);
export const addTee = (eventId: string, n: number, label: string, sort: number) => wrap(async (): Promise<HoleTee> =>
  must(await supabase.from('hole_tees').insert({ event_id: eventId, n, label: label.trim(), sort }).select(TEE_COLS).single()) as HoleTee);
export type TeePatch = Partial<Pick<HoleTee, 'n' | 'label' | 'dist_ft' | 'par' | 'sort'>>;
export const updateTee = (id: string, patch: TeePatch) => wrap(async (): Promise<void> => { must(await supabase.from('hole_tees').update(patch).eq('id', id)); });
export const deleteTee = (id: string) => wrap(async (): Promise<void> => { must(await supabase.from('hole_tees').delete().eq('id', id)); });

export const LOGO_BUCKET = 'sponsor-logos';
/** Upload to the public logo bucket; returns the public URL to store on the sponsor. */
/** Any size in: the browser shrinks it to <= 1200 px WebP (transparency kept) so it fits the bucket's 2 MB cap. */
export const LOGO_EDGE = 1200;
export const uploadLogo = (eventId: string, sponsorId: string, file: File) => wrap(async (): Promise<string> => {
  const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!EXT[file.type]) throw new Error('Logo must be a PNG, JPG or WebP.');
  let blob: Blob = file;
  for (const edge of [LOGO_EDGE, 900, 640]) { blob = await shrink(file, edge); if (blob.size <= 2 * 1024 * 1024) break; }
  if (blob.size > 2 * 1024 * 1024) throw new Error('That image is still over 2 MB after shrinking. Try a smaller export.');
  const path = `${eventId}/${sponsorId}-${Date.now()}.${EXT[blob.type] ?? 'webp'}`;
  must(await supabase.storage.from(LOGO_BUCKET).upload(path, blob, { contentType: blob.type, upsert: false }));
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
});

// ---------- card requests, private tags, keep-apart (TD-only tables) ----------
export type RequestStatus = 'new' | 'approved' | 'declined';
export interface CardRequest {
  id: string; status: RequestStatus; source: 'player' | 'td' | 'crew'; note: string | null; created_at: string;
  requester: string | null; players: string[]; // requester first
}

export const loadRequests = (eventId: string) => wrap(async (): Promise<CardRequest[]> => {
  const rows = list(await supabase.from('card_requests')
    .select('id, status, source, note, created_at, card_request_players(player_id, is_requester)')
    .eq('event_id', eventId).order('created_at')) as Array<Omit<CardRequest, 'requester' | 'players'> & {
      card_request_players: Array<{ player_id: string; is_requester: boolean }> }>;
  return rows.map(({ card_request_players: m, ...r }) => {
    const req = m.find((x) => x.is_requester)?.player_id ?? null;
    return { ...r, requester: req, players: [...(req ? [req] : []), ...m.filter((x) => x.player_id !== req).map((x) => x.player_id)] };
  });
});

export const setRequestStatus = (id: string, status: RequestStatus) => wrap(async () => {
  must(await supabase.from('card_requests').update({ status, decided_at: status === 'new' ? null : new Date().toISOString() }).eq('id', id));
});
export const deleteRequest = (id: string) => wrap(async () => { must(await supabase.from('card_requests').delete().eq('id', id)); });
export const addRequest = (eventId: string, playerIds: string[], note: string) => wrap(async (): Promise<string> =>
  must(await supabase.rpc('td_add_card_request', { p_event_id: eventId, p_players: playerIds, p_note: note || null })) as string);

export interface PrivateInfo { vibe: Record<string, 'star' | 'easy'>; apart: Array<[string, string]> }
export const loadPrivate = (eventId: string) => wrap(async (): Promise<PrivateInfo> => {
  const [tags, pairs] = await Promise.all([
    supabase.from('player_private').select('player_id, vibe').eq('event_id', eventId),
    supabase.from('keep_apart').select('player_a, player_b').eq('event_id', eventId),
  ]);
  const vibe: PrivateInfo['vibe'] = {};
  for (const t of list(tags) as Array<{ player_id: string; vibe: 'star' | 'easy' | null }>) if (t.vibe) vibe[t.player_id] = t.vibe;
  return { vibe, apart: (list(pairs) as Array<{ player_a: string; player_b: string }>).map((p) => [p.player_a, p.player_b]) };
});

export const setVibe = (eventId: string, playerId: string, vibe: 'star' | 'easy' | null) => wrap(async () => {
  if (vibe) must(await supabase.from('player_private').upsert({ player_id: playerId, event_id: eventId, vibe, updated_at: new Date().toISOString() }));
  else must(await supabase.from('player_private').delete().eq('player_id', playerId));
});
const ordered = (a: string, b: string) => (a < b ? [a, b] : [b, a]);
export const addApart = (eventId: string, a: string, b: string) => wrap(async () => {
  const [x, y] = ordered(a, b);
  must(await supabase.from('keep_apart').upsert({ event_id: eventId, player_a: x, player_b: y }, { onConflict: 'player_a,player_b', ignoreDuplicates: true }));
});
export const removeApart = (a: string, b: string) => wrap(async () => {
  const [x, y] = ordered(a, b);
  must(await supabase.from('keep_apart').delete().eq('player_a', x).eq('player_b', y));
});

// ---------- Winners Circle (event_prize + division_payouts are TD-only; winners_posts is public) ----------
export interface PrizeSetup {
  settings: PrizeSettings;
  configs: Record<string, DivisionConfig>;
  playoffs: Record<string, string>;        // div -> winner player id
  teamConfigs: Partial<Record<1 | 2, TeamPayoutConfig>>; // doubles rounds (round_payouts)
  post: { payload: WinnersPayload; posted_at: string } | null;
}
export interface WinnersPayload {
  event: string; credit_label: string; mode: 'official' | 'live';
  divisions: Array<{ div: string; currency: 'cash' | 'credit'; rows: Array<{ place: string; name: string; total: number; amount: number }> }>;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export const loadPrizeSetup = (eventId: string) => wrap(async (): Promise<PrizeSetup> => {
  const [p, d, o, w, rp] = await Promise.all([
    supabase.from('event_prize').select('added_total, credit_round, credit_label').eq('event_id', eventId).maybeSingle(),
    supabase.from('division_payouts').select('div_code, currency, entry_fee, payback_pct, added_override, paid_places, pcts').eq('event_id', eventId),
    supabase.from('playoffs').select('div_code, winner_player_id').eq('event_id', eventId),
    supabase.from('winners_posts').select('payload, posted_at').eq('event_id', eventId).maybeSingle(),
    supabase.from('round_payouts').select('round, currency, entry_fee, payback_pct, added_override, paid_places, pcts').eq('event_id', eventId),
  ]);
  const teamConfigs: PrizeSetup['teamConfigs'] = {};
  for (const r of list(rp) as Array<{ round: 1 | 2; currency: 'cash' | 'credit'; entry_fee: number; payback_pct: number; added_override: number | null; paid_places: number | null; pcts: number[] | null }>) {
    teamConfigs[r.round] = { round: r.round, currency: r.currency, entryFee: Number(r.entry_fee), paybackPct: Number(r.payback_pct),
      addedOverride: num(r.added_override), paidPlaces: r.paid_places, pcts: r.pcts ? r.pcts.map(Number) : null };
  }
  const prize = must(p) as { added_total: number; credit_round: 1 | 5; credit_label: string } | null;
  const configs: Record<string, DivisionConfig> = {};
  for (const r of list(d) as Array<{ div_code: string; currency: 'cash' | 'credit'; entry_fee: number; payback_pct: number; added_override: number | null; paid_places: number | null; pcts: number[] | null }>) {
    configs[r.div_code] = {
      div: r.div_code, currency: r.currency, entryFee: Number(r.entry_fee), paybackPct: Number(r.payback_pct),
      addedOverride: num(r.added_override), paidPlaces: r.paid_places, pcts: r.pcts ? r.pcts.map(Number) : null,
    };
  }
  return {
    settings: { addedTotal: Number(prize?.added_total ?? 0), creditRound: prize?.credit_round ?? 1, creditLabel: prize?.credit_label ?? 'prize credit' },
    configs,
    playoffs: Object.fromEntries((list(o) as Array<{ div_code: string; winner_player_id: string }>).map((x) => [x.div_code, x.winner_player_id])),
    post: (must(w) as PrizeSetup['post']) ?? null,
    teamConfigs,
  };
});

export const savePrizeSettings = (eventId: string, s: PrizeSettings) => wrap(async () => {
  must(await supabase.from('event_prize').upsert({
    event_id: eventId, added_total: s.addedTotal, credit_round: s.creditRound, credit_label: s.creditLabel.trim() || 'prize credit', updated_at: new Date().toISOString(),
  }));
});
export const saveDivisionPayout = (eventId: string, c: DivisionConfig) => wrap(async () => {
  must(await supabase.from('division_payouts').upsert({
    event_id: eventId, div_code: c.div, currency: c.currency, entry_fee: c.entryFee, payback_pct: c.paybackPct,
    added_override: c.addedOverride, paid_places: c.paidPlaces, pcts: c.pcts, updated_at: new Date().toISOString(),
  }));
});
export const saveRoundPayout = (eventId: string, c: TeamPayoutConfig) => wrap(async () => {
  must(await supabase.from('round_payouts').upsert({
    event_id: eventId, round: c.round, currency: c.currency, entry_fee: c.entryFee, payback_pct: c.paybackPct,
    added_override: c.addedOverride, paid_places: c.paidPlaces, pcts: c.pcts, updated_at: new Date().toISOString(),
  }));
});
export const setFinishStatus = (playerId: string, status: FinishStatus | null) => wrap(async () => {
  must(await supabase.from('players').update({ finish_status: status }).eq('id', playerId));
});
export const setPlayoffWinner = (eventId: string, div: string, playerId: string | null) => wrap(async () => {
  if (playerId) must(await supabase.from('playoffs').upsert({ event_id: eventId, div_code: div, winner_player_id: playerId, recorded_at: new Date().toISOString() }));
  else must(await supabase.from('playoffs').delete().eq('event_id', eventId).eq('div_code', div));
});
export const postWinners = (eventId: string, payload: WinnersPayload) => wrap(async (): Promise<string> => {
  const posted_at = new Date().toISOString();
  must(await supabase.from('winners_posts').upsert({ event_id: eventId, payload, posted_at }));
  return posted_at;
});

// ---------- event prep (TD-only: prep_tasks, shirt_order, design_assets/files, event-assets bucket) ----------
const PREP_BUCKET = 'event-assets';
const TASK_COLS = 'id, title, category, due_offset_days, assignee, notes, done_at, done_by, sort, crew_id';
const FILE_COLS = 'id, asset_id, version, path, file_name, mime, bytes, uploaded_by, uploaded_at';
const ASSET_COLS = `id, category, title, status, notes, updated_at, proof, proof_opts, crew_visible, design_files(${FILE_COLS})`;
export interface ShirtOrder { extras: Record<string, number>; vendor: string | null; notes: string | null; ordered_at: string | null }
export interface PrepData { tasks: PrepTask[]; order: ShirtOrder; assets: DesignAsset[]; creditLabel: string | null }
type AssetRow = Omit<DesignAsset, 'files'> & { design_files: DesignFile[] };
const toAsset = (a: AssetRow): DesignAsset => {
  const { design_files, ...rest } = a;
  return { ...rest, files: (design_files ?? []).slice().sort((x, y) => y.version - x.version) };
};

export const loadPrep = (eventId: string) => wrap(async (): Promise<PrepData> => {
  const [tasks, order, assets, prize] = await Promise.all([
    supabase.from('prep_tasks').select(TASK_COLS).eq('event_id', eventId).order('sort'),
    supabase.from('shirt_order').select('extras, vendor, notes, ordered_at').eq('event_id', eventId).maybeSingle(),
    supabase.from('design_assets').select(ASSET_COLS).eq('event_id', eventId).order('created_at'),
    supabase.from('event_prize').select('credit_label').eq('event_id', eventId).maybeSingle(),
  ]);
  const o = must(order) as ShirtOrder | null;
  return {
    tasks: list(tasks) as PrepTask[],
    order: o ?? { extras: {}, vendor: null, notes: null, ordered_at: null },
    assets: (list(assets) as AssetRow[]).map(toAsset),
    creditLabel: (must(prize) as { credit_label: string } | null)?.credit_label ?? null,
  };
});

export const addTasks = (eventId: string, rows: NewTask[]) => wrap(async (): Promise<PrepTask[]> =>
  list(await supabase.from('prep_tasks').insert(rows.map((r) => ({ ...r, event_id: eventId }))).select(TASK_COLS)) as PrepTask[]);
export const updateTask = (id: string, patch: Partial<Omit<PrepTask, 'id'>>) => wrap(async (): Promise<PrepTask> =>
  must(await supabase.from('prep_tasks').update(patch).eq('id', id).select(TASK_COLS).single()) as PrepTask);
export const deleteTask = (id: string) => wrap(async () => { must(await supabase.from('prep_tasks').delete().eq('id', id)); });

export const saveShirtOrder = (eventId: string, o: ShirtOrder) => wrap(async () => {
  must(await supabase.from('shirt_order').upsert({ event_id: eventId, ...o, updated_at: new Date().toISOString() }));
});
export const setShirtSize = (playerId: string, size: string | null) => wrap(async () => {
  must(await supabase.from('players').update({ shirt_size: size }).eq('id', playerId));
});

export const createAsset = (eventId: string, category: string, title: string, proof: string | null = null) => wrap(async (): Promise<DesignAsset> =>
  toAsset(must(await supabase.from('design_assets').insert({ event_id: eventId, category, title, proof }).select(ASSET_COLS).single()) as AssetRow));
export const updateAsset = (id: string, patch: { title?: string; status?: DesignStatus; notes?: string | null; category?: string; crew_visible?: boolean; proof_opts?: Record<string, string> }) =>
  wrap(async (): Promise<DesignAsset> =>
    toAsset(must(await supabase.from('design_assets').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select(ASSET_COLS).single()) as AssetRow));
/** Files first, then the row, so nothing is left orphaned in storage. */
export const deleteAsset = (a: DesignAsset) => wrap(async () => {
  // a design with votes on a ballot can't go (votes would block the row after the files were already gone)
  const opts = list(await supabase.from('design_poll_options').select('id').eq('asset_id', a.id)) as Array<{ id: string }>;
  if (opts.length && list(await supabase.from('design_poll_votes').select('id').in('option_id', opts.map((o) => o.id)).limit(1)).length) throw new Error('has_votes');
  if (a.files.length) must(await supabase.storage.from(PREP_BUCKET).remove(a.files.map((f) => f.path)));
  must(await supabase.from('design_assets').delete().eq('id', a.id));
});
/** Uploads the next version. If the row can't be written, the uploaded file is removed again. */
export const uploadVersion = (eventId: string, a: DesignAsset, file: File, email: string) => wrap(async (): Promise<DesignFile> => {
  const version = nextVersion(a.files);
  const path = filePath(eventId, a.category, a.id, version, file.name);
  must(await supabase.storage.from(PREP_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false }));
  const row = await supabase.from('design_files').insert({ asset_id: a.id, version, path, file_name: file.name, mime: file.type || null, bytes: file.size, uploaded_by: email })
    .select(FILE_COLS).single();
  if (row.error) { await supabase.storage.from(PREP_BUCKET).remove([path]); throw row.error; }
  await supabase.from('design_assets').update({ updated_at: new Date().toISOString() }).eq('id', a.id);
  return row.data as DesignFile;
});
export const deleteFile = (f: DesignFile) => wrap(async () => {
  must(await supabase.storage.from(PREP_BUCKET).remove([f.path]));
  must(await supabase.from('design_files').delete().eq('id', f.id));
});
/** Signed links: thumbnails (1 h), downloads, and 7-day share links. */
export const signedUrls = (paths: string[], seconds = 3600) => wrap(async (): Promise<Record<string, string>> => {
  if (!paths.length) return {};
  const r = must(await supabase.storage.from(PREP_BUCKET).createSignedUrls(paths, seconds)) as Array<{ path: string | null; signedUrl: string }>;
  return Object.fromEntries(r.filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl]));
});
export const signedUrl = (path: string, seconds: number, download?: string) => wrap(async (): Promise<string> =>
  (must(await supabase.storage.from(PREP_BUCKET).createSignedUrl(path, seconds, download ? { download } : undefined)) as { signedUrl: string }).signedUrl);
export const downloadFile = (path: string) => wrap(async (): Promise<Blob> =>
  must(await supabase.storage.from(PREP_BUCKET).download(path)) as Blob);

// ---------- course library (public read; any TD writes via RPCs) ----------
type LayoutRow = Omit<LibLayout, 'holes' | 'par' | 'ft'> & { course_holes: Array<{ par: number; dist_ft: number | null }> };
export const loadLibrary = () => wrap(async (): Promise<LibCourse[]> => {
  const rows = list(await supabase.from('courses')
    .select('id, name, city, pdga_url, pdga_holes, notes, course_layouts(id, course_id, name, source, verified_at, verified_by, updated_at, updated_by, course_holes(par, dist_ft))')
    .order('name')) as Array<Omit<LibCourse, 'layouts'> & { course_layouts: LayoutRow[] }>;
  return rows.map(({ course_layouts, ...c }) => ({
    ...c,
    layouts: (course_layouts ?? []).map(({ course_holes, ...l }) => ({ ...l, ...summarize(course_holes ?? []) })),
  }));
});
/** Returns the new course id. */
export const addCourse = (name: string, city: string | null) => wrap(async (): Promise<string> =>
  (must(await supabase.from('courses').insert({ name, city }).select('id').single()) as { id: string }).id);
/** Copies the event's SAVED holes (with rules) into a new or existing layout. */
export const saveLayoutFromEvent = (eventId: string, courseId: string, layoutId: string | null, name: string, source: string | null) =>
  wrap(async (): Promise<string> => {
    const hs = list(await supabase.from('holes').select('n, par, dist_ft, ob, rules').eq('event_id', eventId).order('n')) as LayoutHole[];
    return must(await supabase.rpc('td_save_layout', {
      p_course_id: courseId, p_layout_id: layoutId, p_name: name, p_holes: toLayoutPayload(hs), p_source: source,
    })) as string;
  });
export const applyLayout = (eventId: string, layoutId: string) => wrap(async (): Promise<number> =>
  must(await supabase.rpc('td_apply_layout', { p_event_id: eventId, p_layout_id: layoutId })) as number);
export const verifyLayout = (layoutId: string, on: boolean) => wrap(async () => {
  must(await supabase.rpc('td_verify_layout', { p_layout_id: layoutId, p_on: on }));
});

// ---------- crew (TD side; crew themselves use lib/crew/api.ts with their link) ----------
const CREW_COLS = 'id, name, roles, token, last_seen_at, revoked_at, created_at';
export interface CrewData { crew: CrewMember[]; announcements: Announcement[]; reads: Array<{ announcement_id: string; crew_id: string; read_at: string }> }
export const loadCrew = (eventId: string) => wrap(async (): Promise<CrewData> => {
  const [crew, anns] = await Promise.all([
    supabase.from('crew').select(CREW_COLS).eq('event_id', eventId).order('name'),
    supabase.from('announcements').select('id, title, body, roles, pinned, created_at, updated_at').eq('event_id', eventId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }),
  ]);
  const a = list(anns) as Announcement[];
  const reads = a.length
    ? list(await supabase.from('announcement_reads').select('announcement_id, crew_id, read_at').in('announcement_id', a.map((x) => x.id))) as CrewData['reads']
    : [];
  return { crew: list(crew) as CrewMember[], announcements: a, reads };
});
export const addCrew = (eventId: string, name: string, roles: Role[]) => wrap(async (): Promise<CrewMember> =>
  must(await supabase.from('crew').insert({ event_id: eventId, name, roles }).select(CREW_COLS).single()) as CrewMember);
export const updateCrew = (id: string, patch: { name?: string; roles?: Role[]; revoked_at?: string | null }) => wrap(async (): Promise<CrewMember> =>
  must(await supabase.from('crew').update(patch).eq('id', id).select(CREW_COLS).single()) as CrewMember);
export const removeCrew = (id: string) => wrap(async () => { must(await supabase.from('crew').delete().eq('id', id)); });
export const newCrewLink = (id: string) => wrap(async (): Promise<string> =>
  must(await supabase.rpc('td_new_crew_link', { p_crew: id })) as string);
export const postAnnouncement = (eventId: string, a: { title: string; body: string; roles: Role[]; pinned: boolean }, email: string) =>
  wrap(async (): Promise<Announcement> =>
    must(await supabase.from('announcements').insert({ event_id: eventId, ...a, created_by: email })
      .select('id, title, body, roles, pinned, created_at, updated_at').single()) as Announcement);
export const updateAnnouncement = (id: string, a: { title: string; body: string; roles: Role[]; pinned: boolean }) =>
  wrap(async (): Promise<Announcement> =>
    must(await supabase.from('announcements').update({ ...a, updated_at: new Date().toISOString() }).eq('id', id)
      .select('id, title, body, roles, pinned, created_at, updated_at').single()) as Announcement);
export const deleteAnnouncement = (id: string) => wrap(async () => { must(await supabase.from('announcements').delete().eq('id', id)); });

export const loadRaffle = (eventId: string) => wrap(async (): Promise<RaffleSale[]> =>
  list(await supabase.from('raffle_sales').select('id, buyer, tickets, amount, method, created_at, voided_at, logged_by')
    .eq('event_id', eventId).order('created_at', { ascending: false })) as RaffleSale[]);
export const tdRaffleSale = (eventId: string, s: { buyer: string; tickets: number; amount: number; method: RaffleSale['method'] }, by: string) =>
  wrap(async () => { must(await supabase.from('raffle_sales').insert({ event_id: eventId, logged_by: by, buyer: s.buyer.trim() || null, tickets: s.tickets, amount: s.amount, method: s.method })); });
export const voidSale = (id: string, on: boolean) => wrap(async () => {
  must(await supabase.from('raffle_sales').update({ voided_at: on ? new Date().toISOString() : null }).eq('id', id));
});
/** The TD confirms the raffle total into the Winners added total. */
export const setAddedTotal = (eventId: string, total: number) => wrap(async () => {
  must(await supabase.from('event_prize').upsert({ event_id: eventId, added_total: total, updated_at: new Date().toISOString() }, { onConflict: 'event_id' }));
});

const CONTACT_COLS = 'id, kind, name, org, phone, email, status, amount, notes, crew_id, sponsor_id, created_by, updated_at';
export const loadContacts = (eventId: string) => wrap(async (): Promise<Contact[]> =>
  list(await supabase.from('contacts').select(CONTACT_COLS).eq('event_id', eventId).order('updated_at', { ascending: false })) as Contact[]);
export const saveContact = (eventId: string, c: Partial<Contact> & { id?: string }, email: string) => wrap(async (): Promise<Contact> => {
  const row = { kind: c.kind, name: c.name, org: c.org || null, phone: c.phone || null, email: c.email || null, status: c.status,
    amount: c.amount ?? null, notes: c.notes || null, crew_id: c.crew_id || null, updated_at: new Date().toISOString() };
  return (c.id
    ? must(await supabase.from('contacts').update(row).eq('id', c.id).select(CONTACT_COLS).single())
    : must(await supabase.from('contacts').insert({ ...row, event_id: eventId, created_by: email }).select(CONTACT_COLS).single())) as Contact;
});
export const deleteContact = (id: string) => wrap(async () => { must(await supabase.from('contacts').delete().eq('id', id)); });
export const promoteContact = (id: string) => wrap(async (): Promise<string> =>
  must(await supabase.rpc('td_promote_contact', { p_contact: id })) as string);

export interface TaskNote { id: string; task_id: string; author: string; body: string; created_at: string }
export const loadTaskNotes = (eventId: string) => wrap(async (): Promise<TaskNote[]> =>
  list(await supabase.from('prep_task_notes').select('id, task_id, author, body, created_at').eq('event_id', eventId).order('created_at')) as TaskNote[]);
export const addTaskNote = (eventId: string, taskId: string, author: string, body: string) => wrap(async (): Promise<TaskNote> =>
  must(await supabase.from('prep_task_notes').insert({ event_id: eventId, task_id: taskId, author, body: body.trim() })
    .select('id, task_id, author, body, created_at').single()) as TaskNote);

// ---------- doubles: the draw ----------
/** Saved teams for a doubles round, in team order: [captain, partner | null]. */
export const loadTeams = (eventId: string, round: 1 | 2) => wrap(async (): Promise<Array<[string, string | null]>> =>
  list(await supabase.from('teams').select('team_no, player_a, player_b').eq('event_id', eventId).eq('round', round).order('team_no'))
    .map((t: { player_a: string; player_b: string | null }) => [t.player_a, t.player_b] as [string, string | null]));
/** Replace the draw. The server clears this round's (unscored) cards; refuses once scoring started. */
export const saveTeams = (eventId: string, round: 1 | 2, teams: Array<[string, string | null]>) => wrap(async (): Promise<number> =>
  must(await supabase.rpc('td_set_teams', { p_event_id: eventId, p_round: round, p_teams: teams.map(([a, b]) => (b ? [a, b] : [a])) })) as number);

// ---------- volunteer stations (TD) ----------
export interface StationsData { stations: Station[]; slots: Slot[] }
export const loadStations = (eventId: string) => wrap(async (): Promise<StationsData> => {
  const [st, sl] = await Promise.all([
    supabase.from('stations').select('id, name, need, notes, sort, station_needs(day, half, need)').eq('event_id', eventId).order('sort').order('name'),
    supabase.from('station_slots').select('id, station_id, day, half, crew_id, claimed').eq('event_id', eventId),
  ]);
  const stations = (list(st) as Array<Omit<Station, 'needs'> & { station_needs: Station['needs'] }>)
    .map(({ station_needs, ...s }) => ({ ...s, needs: station_needs ?? [] }));
  return { stations, slots: list(sl) as Slot[] };
});
export const addStations = (eventId: string, rows: Array<{ name: string; need: number; sort: number }>) => wrap(async (): Promise<Station[]> =>
  (list(await supabase.from('stations').insert(rows.map((r) => ({ ...r, event_id: eventId }))).select('id, name, need, notes, sort')) as Omit<Station, 'needs'>[])
    .map((s) => ({ ...s, needs: [] })));
export const updateStation = (id: string, patch: { name?: string; need?: number; notes?: string | null; sort?: number }) => wrap(async () => {
  must(await supabase.from('stations').update(patch).eq('id', id));
});
export const deleteStation = (id: string) => wrap(async () => { must(await supabase.from('stations').delete().eq('id', id)); });
/** null = back to the station default for that shift. */
export const setShiftNeed = (stationId: string, day: number, half: Half, need: number | null) => wrap(async () => {
  must(need == null
    ? await supabase.from('station_needs').delete().eq('station_id', stationId).eq('day', day).eq('half', half)
    : await supabase.from('station_needs').upsert({ station_id: stationId, day, half, need }));
});
export const assignSlot = (eventId: string, stationId: string, day: number, half: Half, crewId: string) => wrap(async (): Promise<Slot> =>
  must(await supabase.from('station_slots').insert({ event_id: eventId, station_id: stationId, day, half, crew_id: crewId })
    .select('id, station_id, day, half, crew_id, claimed').single()) as Slot);
export const removeSlot = (id: string) => wrap(async () => { must(await supabase.from('station_slots').delete().eq('id', id)); });

// ---------- design votes (TD-only tables; votes are read-only here, cast through td_vote) ----------
const POLL_COLS = 'id, event_id, title, question, closes_at, closed_at, winner_option_id, created_by, created_at, design_poll_options!design_poll_options_poll_id_fkey(id, poll_id, asset_id, sort), design_poll_votes!design_poll_votes_poll_id_fkey(id, poll_id, option_id, crew_id, td_email, comment, updated_at)';
type PollRow = Omit<Poll, 'options' | 'votes'> & { design_poll_options: PollOption[]; design_poll_votes: PollVote[] };
const toPoll = ({ design_poll_options, design_poll_votes, ...p }: PollRow): Poll =>
  ({ ...p, options: (design_poll_options ?? []).slice().sort((a, b) => a.sort - b.sort), votes: design_poll_votes ?? [] });
export const loadPolls = (eventId: string) => wrap(async (): Promise<Poll[]> =>
  (list(await supabase.from('design_polls').select(POLL_COLS).eq('event_id', eventId).order('created_at', { ascending: false })) as PollRow[]).map(toPoll));
const reloadPoll = async (id: string) => toPoll(must(await supabase.from('design_polls').select(POLL_COLS).eq('id', id).single()) as PollRow);
/** Poll + its ballot in one go. If the ballot can't be written, the empty poll is removed again. */
export const createPoll = (eventId: string, p: { title: string; question: string | null; closes_at: string | null }, assetIds: string[], email: string) =>
  wrap(async (): Promise<Poll> => {
    const row = must(await supabase.from('design_polls').insert({ event_id: eventId, ...p, created_by: email }).select('id').single()) as { id: string };
    const opts = await supabase.from('design_poll_options').insert(assetIds.map((asset_id, sort) => ({ poll_id: row.id, asset_id, sort })));
    if (opts.error) { await supabase.from('design_polls').delete().eq('id', row.id); throw opts.error; }
    return reloadPoll(row.id);
  });
export const updatePoll = (id: string, patch: { title?: string; question?: string | null; closes_at?: string | null; closed_at?: string | null; winner_option_id?: string | null }) =>
  wrap(async (): Promise<Poll> => { must(await supabase.from('design_polls').update(patch).eq('id', id)); return reloadPoll(id); });
export const deletePoll = (id: string) => wrap(async () => { must(await supabase.from('design_polls').delete().eq('id', id)); });
export const addPollOption = (pollId: string, assetId: string, sort: number) =>
  wrap(async (): Promise<Poll> => { must(await supabase.from('design_poll_options').insert({ poll_id: pollId, asset_id: assetId, sort })); return reloadPoll(pollId); });
export const removePollOption = (pollId: string, optionId: string) =>
  wrap(async (): Promise<Poll> => { must(await supabase.from('design_poll_options').delete().eq('id', optionId)); return reloadPoll(pollId); });
export const tdVote = (pollId: string, optionId: string, comment: string) =>
  wrap(async (): Promise<Poll> => { must(await supabase.rpc('td_vote', { p_poll: pollId, p_option: optionId, p_comment: comment || null })); return reloadPoll(pollId); });
