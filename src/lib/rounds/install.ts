/**
 * The scorecard as a home-screen app. Pure rules here (tested); the hook lives in useInstall.ts.
 * iPhone has no install button for websites: we show the Share → Add to Home Screen steps.
 * Android/Chrome hands us a real install prompt (beforeinstallprompt) once the manifest is on the page.
 */
export type Platform = 'ios' | 'android' | 'other';
export const INSTALL_KEY = 'bb-scorecard-install-hide';
/** How long "Not now" hides the card. */
export const HIDE_DAYS = 14;

export function platformOf(ua: string, maxTouchPoints = 0, platform = ''): Platform {
  if (/iPhone|iPad|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

/** Hidden until this time (ms) or not hidden. Garbage in storage = not hidden. */
export function hiddenUntil(raw: string | null): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export const hideFor = (now: number, days = HIDE_DAYS) => now + days * 864e5;

/**
 * Show the "put it on your home screen" card?
 * Never inside the app itself. Desktop only when the browser offers a real install.
 * `force` (?install=1, from My Tag) ignores "Not now".
 */
export function showInstall(o: { standalone: boolean; platform: Platform; canPrompt: boolean; hiddenUntil: number; now: number; force?: boolean }): boolean {
  if (o.standalone) return false;
  if (o.platform === 'other' && !o.canPrompt) return false;
  return !!o.force || o.hiddenUntil <= o.now;
}

/** The link that carries this phone's identity into the iPhone app (it gets its own storage). */
export const tagLinkFor = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/tag/${token}`;
