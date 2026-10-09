/**
 * Cloudflare worker in front of the static site. Only /m/* reaches it (wrangler.jsonc run_worker_first): each
 * player's personal My Tag app manifest. Everything else is served straight from the built assets.
 */
import { myTagManifest } from '../src/lib/tags/appManifest';

interface Env { ASSETS: { fetch: (req: Request) => Promise<Response> } }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/m/')) {
      const m = myTagManifest(url.pathname);
      if (!m) return new Response('Not found', { status: 404 });
      return new Response(JSON.stringify(m), {
        headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-robots-tag': 'noindex' },
      });
    }
    return env.ASSETS.fetch(req);
  },
};
