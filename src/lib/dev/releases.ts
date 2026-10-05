/**
 * Skull reporter + Bug Squasher + dev reports: the pure rules (no network). Source of truth is the database
 * (feedback_reports, app_releases; migration 20261029). The newest app_releases row IS the app's version.
 * Release body markup (what the squasher writes and every home page renders):
 *   "# Heading" = a section heading, "- text" = a bullet, anything else = a paragraph. **double stars** = bold.
 */
export type ReportKind = 'bug' | 'idea' | 'feedback';
export type ReportStatus = 'new' | 'squashed' | 'wontfix' | 'dupe';
export type Bump = 'patch' | 'minor' | 'major';

export interface Release { id: string; version: string; title: string; body: string; published_at: string }
export interface Report {
  id: string; kind: ReportKind; body: string; page_url: string | null; page_title: string | null; user_agent: string | null;
  app_version: string | null; reporter_name: string | null; reporter_email: string | null; member: string | null;
  photo_path: string | null; status: ReportStatus; squash_note: string | null; squashed_at: string | null; version: string | null; created_at: string;
}
export interface DraftItem { id: string; kind: ReportKind; body: string; squash_note: string | null }
export interface Draft { version: string; current: string | null; items: DraftItem[] }

export const KINDS: Array<{ kind: ReportKind; label: string; hint: string }> = [
  { kind: 'bug', label: 'Bug', hint: 'Something is busted' },
  { kind: 'idea', label: 'Idea', hint: 'Make it do this' },
  { kind: 'feedback', label: 'Feedback', hint: 'Love it, hate it, tell us' },
];
export const BODY_MAX = 2000;
export const SEEN_RELEASE_KEY = 'bb-dev-seen';

/** Same math as the database's _next_version: the newest version + the bump. No releases = 1.0.0. */
export function nextVersion(current: string | null, bump: Bump): string {
  if (!current) return '1.0.0';
  const [a, b, c] = current.split('.').map((n) => parseInt(n, 10) || 0);
  return bump === 'major' ? `${a + 1}.0.0` : bump === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

/** Newest first by semver (not by date, so a mistyped clock never reorders versions). */
export function sortReleases(list: Release[]): Release[] {
  const key = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  return list.slice().sort((x, y) => {
    const a = key(x.version), b = key(y.version);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  });
}

const SECTION: Record<ReportKind, string> = { bug: 'Squashed', idea: 'New', feedback: 'Tweaked' };
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

/** The draft dev report: squashed reports grouped Squashed (bugs) / New (ideas) / Tweaked (feedback). The squash note wins over the report text. */
export function draftBody(items: DraftItem[]): string {
  const out: string[] = [];
  for (const kind of ['bug', 'idea', 'feedback'] as ReportKind[]) {
    const rows = items.filter((i) => i.kind === kind);
    if (!rows.length) continue;
    if (out.length) out.push('');
    out.push(`# ${SECTION[kind]}`);
    for (const r of rows) out.push(`- ${clip(r.squash_note || r.body, 140)}`);
  }
  return out.join('\n');
}

export function draftTitle(items: DraftItem[]): string {
  const bugs = items.filter((i) => i.kind === 'bug').length, ideas = items.filter((i) => i.kind !== 'bug').length;
  if (!items.length) return 'Under the hood';
  const parts = [bugs ? `${bugs} bug${bugs === 1 ? '' : 's'} squashed` : '', ideas ? `${ideas} new thing${ideas === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase());
}

export type Block = { kind: 'h'; text: string } | { kind: 'li'; text: string } | { kind: 'p'; text: string };
/** Release body -> blocks (headings, bullets, paragraphs). Blank lines just separate. */
export function releaseBlocks(body: string): Block[] {
  return body.split('\n').map((l) => l.trim()).filter(Boolean).map((l): Block =>
    l.startsWith('# ') ? { kind: 'h', text: l.slice(2).trim() } : /^[-*] /.test(l) ? { kind: 'li', text: l.slice(2).trim() } : { kind: 'p', text: l });
}

export type Group = { kind: 'h' | 'p'; text: string } | { kind: 'ul'; items: string[] };
/** Blocks with neighbouring bullets gathered into one list, ready to render. */
export function groupBlocks(blocks: Block[]): Group[] {
  const out: Group[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.kind === 'li') { if (last?.kind === 'ul') last.items.push(b.text); else out.push({ kind: 'ul', items: [b.text] }); }
    else out.push({ kind: b.kind, text: b.text });
  }
  return out;
}

/** Short teaser for small cards: the first n bullets (or paragraphs if there are none). */
export function teaser(body: string, n = 3): string[] {
  const b = releaseBlocks(body);
  const lis = b.filter((x) => x.kind === 'li');
  return (lis.length ? lis : b.filter((x) => x.kind === 'p')).slice(0, n).map((x) => x.text);
}

/** "iPhone · Safari" from a user agent, for the squasher card. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'Facebook app' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
}

/** Who sent it, for the squasher card. */
export function reporterLabel(r: Pick<Report, 'member' | 'reporter_name' | 'reporter_email'>): string {
  const who = r.member || r.reporter_name;
  if (who && r.reporter_email) return `${who} (${r.reporter_email})`;
  return who || r.reporter_email || 'Anonymous';
}

/** Is there a release newer than the one this browser dismissed? (null seen = never dismissed = yes) */
export const isUnseen = (latest: Release | null | undefined, seen: string | null) => !!latest && latest.version !== seen;

export function reportMessage(e: unknown): string {
  const m = String((e as { message?: string } | null)?.message ?? e ?? '');
  if (/invalid_body/.test(m)) return `Say what happened (up to ${BODY_MAX} characters).`;
  if (/busy/.test(m)) return 'The skull is swamped right now. Try again in a few minutes.';
  if (/photo_missing|photo_used/.test(m)) return 'That photo didn\'t make it. Attach it again.';
  if (/forbidden/.test(m)) return 'Only the Bug Squasher owner can do that.';
  if (/already_released/.test(m)) return 'That one already shipped in a version.';
  if (/duplicate key|unique/.test(m)) return 'That version number is taken. Reload and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'No signal. Try again when you have a connection.';
  return m || 'Something went wrong.';
}
