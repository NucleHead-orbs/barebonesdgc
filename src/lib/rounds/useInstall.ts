/**
 * Home-screen app plumbing for /scorecard:
 *  - while the scorecard is open, the page carries the scorecard manifest + Apple tags, so
 *    "Add to Home Screen" makes a "Scorecard" icon that opens straight to a new card;
 *  - catches Chrome's install prompt so we can offer a real INSTALL button.
 */
import { useEffect, useState } from 'react';

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; tell(); });
  window.addEventListener('appinstalled', () => { deferred = null; tell(); });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Swap in the scorecard's app identity while mounted; put the site's back after. */
export function useScorecardAppHead() {
  useEffect(() => {
    const added: Element[] = [];
    const put = (tag: 'link' | 'meta', attrs: Record<string, string>) => {
      const el = document.createElement(tag);
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      document.head.appendChild(el); added.push(el);
    };
    const touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    const oldTouch = touch?.getAttribute('href') ?? null;
    if (touch) touch.setAttribute('href', '/assets/app/scorecard-180.png');
    else put('link', { rel: 'apple-touch-icon', href: '/assets/app/scorecard-180.png' });
    put('link', { rel: 'manifest', href: '/scorecard.webmanifest' });
    put('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
    put('meta', { name: 'mobile-web-app-capable', content: 'yes' });
    put('meta', { name: 'apple-mobile-web-app-title', content: 'Scorecard' });
    put('meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black' });
    const oldTitle = document.title;
    document.title = 'Scorecard · Bare Bones';
    return () => {
      added.forEach((el) => el.remove());
      if (touch && oldTouch) touch.setAttribute('href', oldTouch);
      document.title = oldTitle;
    };
  }, []);
}

/** Chrome's install prompt, when it has one. */
export function useInstallPrompt() {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const install = async (): Promise<boolean> => {
    const e = deferred;
    if (!e) return false;
    deferred = null; tell();
    await e.prompt();
    return (await e.userChoice).outcome === 'accepted';
  };
  return { canPrompt: !!deferred, install };
}
