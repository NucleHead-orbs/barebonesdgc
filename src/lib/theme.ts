import { useLayoutEffect } from 'react';

export type Theme = 'jewel-xi' | null;

/**
 * Sets the skin on <html> so the page background and every token follow the route.
 * null = master (club) brand. Layout effect: applied before paint, no flash of the wrong skin.
 */
export function useTheme(theme: Theme) {
  useLayoutEffect(() => {
    const el = document.documentElement;
    if (theme) el.dataset.theme = theme;
    else delete el.dataset.theme;
  }, [theme]);
}
