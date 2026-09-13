// The site theme as the document carries it: data-bt, set before paint by index.html and on
// every OS change by App. Components that pick a per-theme asset read it here.
import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const read = (): Theme => (typeof document !== 'undefined' && document.documentElement.getAttribute('data-bt') === 'dark' ? 'dark' : 'light');

export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bt'] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

// A product capture is the OPPOSITE theme of the page it sits on, so the frame contrasts with
// the paper: the graphite app on the light site, the light-theme app on the dark site (George,
// 2026-09-08). Every capture ships in both themes under public/shots/<name>-<dark|light>.jpg.
export function shotFor(name: string, theme: Theme): string {
  return `/shots/${name}-${theme === 'dark' ? 'light' : 'dark'}.jpg`;
}

/** the hero's demo: a real first run recorded on the app, one video and one poster per theme
 *  (public/demo-<name>-<dark|light>.{mp4,jpg}), the opposite theme of the page like every capture */
export function demoFor(name: string, theme: Theme): { src: string; poster: string } {
  const t = theme === 'dark' ? 'light' : 'dark';
  return { src: `/demo-${name}-${t}.mp4`, poster: `/demo-${name}-${t}.jpg` };
}
