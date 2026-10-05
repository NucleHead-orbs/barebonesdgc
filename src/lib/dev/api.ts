/**
 * Skull reporter + Bug Squasher + dev reports: data access. Every call returns { data } or { error }.
 * Reports: anyone (feedback_submit). Photos: shrunk in the browser, uploaded to the private `feedback` bucket under
 * reports/<random>.<ext>, then the report points at it. Everything owner_* is the owner only (the database checks).
 */
import { supabase } from '../supabase';
import { shrink } from '../gallery/api';
import { sortReleases, type Bump, type Draft, type Release, type Report, type ReportKind, type ReportStatus } from './releases';

type Result<T> = { data: T; error?: undefined } | { data?: undefined; error: unknown };
const wrap = async <T>(fn: () => Promise<T>): Promise<Result<T>> => {
  try { return { data: await fn() }; } catch (error) { return { error }; }
};
const must = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw r.error; return r.data; };

export const FEEDBACK_BUCKET = 'feedback';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

let releasesOnce: Promise<Release[]> | null = null;
/** Every published version, newest first. Cached for the page's life (pass fresh after publishing). */
export const loadReleases = (fresh = false) => wrap(async (): Promise<Release[]> => {
  if (fresh || !releasesOnce) {
    releasesOnce = (async () => sortReleases((must(await supabase.from('app_releases').select('id, version, title, body, published_at').limit(200)) ?? []) as Release[]))();
    releasesOnce.catch(() => { releasesOnce = null; });
  }
  return releasesOnce;
});
export const latestRelease = async (): Promise<Release | null> => { const r = await loadReleases(); return r.data?.[0] ?? null; };

export interface NewReport { kind: ReportKind; body: string; name: string; token: string | null; photo: File | null; version: string | null }

/** Send a report from the skull. Returns the report id. */
export const submitReport = (n: NewReport) => wrap(async (): Promise<string> => {
  let photo_path: string | null = null;
  if (n.photo) {
    const blob = await shrink(n.photo, 1600);
    const ext = EXT[blob.type];
    if (!ext) throw new Error('Photos have to be PNG, JPG or WebP.');
    if (blob.size > 6 * 1024 * 1024) throw new Error('That photo is too big (6 MB max).');
    photo_path = `reports/${crypto.randomUUID()}.${ext}`;
    must(await supabase.storage.from(FEEDBACK_BUCKET).upload(photo_path, blob, { contentType: blob.type, upsert: false }));
  }
  return must(await supabase.rpc('feedback_submit', { p: {
    kind: n.kind, body: n.body.trim(), name: n.name.trim() || null, token: n.token, photo_path,
    page_url: `${location.pathname}${location.search}`.slice(0, 500), page_title: document.title.slice(0, 200),
    user_agent: navigator.userAgent.slice(0, 400), app_version: n.version,
  } })) as string;
});

// ---------- owner (Bug Squasher) ----------
export const isOwner = () => wrap(async (): Promise<boolean> => !!must(await supabase.rpc('is_owner')));
export const ownerReports = () => wrap(async (): Promise<Report[]> => (must(await supabase.rpc('owner_feedback')) ?? []) as Report[]);
export const setStatus = (id: string, status: ReportStatus, note: string | null) =>
  wrap(async () => { must(await supabase.rpc('owner_feedback_set', { p_id: id, p_status: status, p_note: note })); });
export const draft = (bump: Bump) => wrap(async (): Promise<Draft> => must(await supabase.rpc('owner_release_draft', { p_bump: bump })) as Draft);
export const publish = (bump: Bump, title: string, body: string) =>
  wrap(async (): Promise<string> => must(await supabase.rpc('owner_release_publish', { p_bump: bump, p_title: title, p_body: body })) as string);
/** Signed links (1 hour) for report photos; the bucket is private. */
export const photoUrls = (paths: string[]) => wrap(async (): Promise<Record<string, string>> => {
  if (!paths.length) return {};
  const r = must(await supabase.storage.from(FEEDBACK_BUCKET).createSignedUrls(paths, 3600)) as Array<{ path: string | null; signedUrl: string }>;
  return Object.fromEntries(r.filter((x) => x.path && x.signedUrl).map((x) => [x.path!, x.signedUrl]));
});
