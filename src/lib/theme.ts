import { useLayoutEffect } from 'react';

/** null = master (club) brand · 'jewel-xi' = Jewel skin · 'event' = neutral skin for any club's event. */
export type Theme = 'jewel-xi' | 'event' | null;

/**
 * Sets the skin (and optional accent palette) on <html> so the page background and every token follow
 * the route. Layout effect: applied before paint, no flash of the wrong skin.
 */
export function useTheme(theme: Theme, palette?: string | null) {
  useLayoutEffect(() => {
    const el = document.documentElement;
    if (theme) el.dataset.theme = theme;
    else delete el.dataset.theme;
    if (palette) el.dataset.palette = palette;
    else delete el.dataset.palette;
  }, [theme, palette]);
}
