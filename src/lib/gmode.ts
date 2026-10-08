import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

/**
 * G-Mode (Grandpa mode): the light skin for My Tag and the Scorecard (Mike, 2026-10-08).
 * One switch per phone, remembered in localStorage. It lives on <html data-gmode> only while one of those two
 * pages is mounted, so the rest of the site (and the TD tool, which shares td.css) never sees it.
 */
export const GMODE_KEY = 'bb-gmode';
/** Status-bar colour while G-Mode is on: the hunter-green header band. */
export const GMODE_THEME_COLOR = '#1f4a2a';

export const parseGMode = (v: string | null | undefined) => v === '1';
export const readGMode = () => { try { return parseGMode(localStorage.getItem(GMODE_KEY)); } catch { return false; } };
const writeGMode = (on: boolean) => { try { localStorage.setItem(GMODE_KEY, on ? '1' : '0'); } catch { /* private mode: on for this visit only */ } };

/** [on, set]. Applies the skin before paint (no flash) and takes it off when the page unmounts. */
export function useGMode(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readGMode);
  useLayoutEffect(() => {
    if (!on) return;
    const el = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = meta?.content ?? null;
    el.dataset.gmode = '';
    if (meta) meta.content = GMODE_THEME_COLOR;
    return () => { delete el.dataset.gmode; if (meta && prev !== null) meta.content = prev; };
  }, [on]);
  // flipped in another tab (My Tag in one, Scorecard in the other): follow it
  useEffect(() => {
    const f = (e: StorageEvent) => { if (e.key === GMODE_KEY) setOn(parseGMode(e.newValue)); };
    window.addEventListener('storage', f);
    return () => window.removeEventListener('storage', f);
  }, []);
  const set = useCallback((v: boolean) => { writeGMode(v); setOn(v); }, []);
  return [on, set];
}
