import { useEffect, useState } from 'react';

/** Light / dark / follow the device. A per-device display preference (not business data), kept in localStorage. */
export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'ops.theme';

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(pref: ThemePref = readThemePref()) {
  if (typeof document === 'undefined') return;
  const t = resolve(pref);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0e17' : '#f5f6fa');
}

export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(readThemePref);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  const set = (p: ThemePref) => {
    try { localStorage.setItem(KEY, p); } catch { /* preference only */ }
    setPref(p);
  };
  return [pref, set];
}
