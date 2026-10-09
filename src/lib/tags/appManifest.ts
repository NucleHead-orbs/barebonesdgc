/**
 * Personal My Tag app (migration 20261118 / worker/index.ts): each player's home-screen app has its own manifest at
 * /m/<token>.webmanifest, so the icon opens straight to their own My Tag (and iPhone allows push alerts for it).
 * Pure: the Cloudflare worker serves it, the page links it.
 */
export const TOKEN_RE = /^[a-f0-9]{32}$/;
export const manifestPath = (token: string) => `/m/${token}.webmanifest`;

/** The manifest for /m/<token>.webmanifest, or null for anything that isn't a real-looking token. */
export function myTagManifest(path: string): Record<string, unknown> | null {
  const m = /^\/m\/([^/]+)\.webmanifest$/.exec(path);
  if (!m || !TOKEN_RE.test(m[1])) return null;
  const start = `/tag/${m[1]}`;
  return {
    name: 'My Tag · Bare Bones', short_name: 'My Tag', description: 'Your bag tags, challenges, Board and rounds.',
    id: start, start_url: start, scope: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#0e0a16', theme_color: '#0e0a16',
    icons: [
      { src: '/assets/app/mytag-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/assets/app/mytag-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
