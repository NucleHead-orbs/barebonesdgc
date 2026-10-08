import { useLayoutEffect, useSyncExternalStore } from 'react';

/**
 * G-Mode (Grandpa mode): the light skin for My Tag, the Scorecard (Mike, 2026-10-08) and the TD Builder.
 * One switch per phone, remembered in localStorage and shared by every toggle on the page. It lives on
 * <html data-gmode> only while a screen that calls useGModeSkin is mounted, so the rest of the site never sees it.
 */
export const GMODE_KEY = 'bb-gmode';
/** Status-bar colour while G-Mode is on: the hunter-green header band. */
export const GMODE_THEME_COLOR = '#1f4a2a';

export const parseGMode = (v: string | null | undefined) => v === '1';
const read = () => { try { return parseGMode(localStorage.getItem(GMODE_KEY)); } catch { return false; } };

// one value for the whole page, so a toggle in a header and the screen that applies the skin never disagree
let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export function setGMode(on: boolean) {
  try { localStorage.setItem(GMODE_KEY, on ? '1' : '0'); } catch { /* private mode: on for this visit only */ }
  if (on !== current) { current = on; emit(); }
}
const subscribe = (f: () => void) => {
  listeners.add(f);
  // flipped in another tab (My Tag in one, Scorecard in the other): follow it
  const s = (e: StorageEvent) => { if (e.key === GMODE_KEY && parseGMode(e.newValue) !== current) { current = parseGMode(e.newValue); emit(); } };
  window.addEventListener('storage', s);
  return () => { listeners.delete(f); window.removeEventListener('storage', s); };
};

/** [on, set]: read or flip the switch. Doesn't apply anything by itself. */
export function useGMode(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, () => current, () => false), setGMode];
}

/** Call once at the root of a screen that supports G-Mode: applies the skin before paint and takes it off on unmount. */
export function useGModeSkin(): boolean {
  const [on] = useGMode();
  // a tab that sat in the background while another flipped the switch: catch up before paint
  useLayoutEffect(() => { const v = read(); if (v !== current) { current = v; emit(); } }, []);
  useLayoutEffect(() => {
    if (!on) return;
    const el = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prev = meta?.content ?? null;
    el.dataset.gmode = '';
    if (meta) meta.content = GMODE_THEME_COLOR;
    return () => { delete el.dataset.gmode; if (meta && prev !== null) meta.content = prev; };
  }, [on]);
  return on;
}
