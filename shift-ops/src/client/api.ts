import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

function devHeaders(): Record<string, string> {
  // Local development only: the Worker ignores this header unless it runs in dev mode on localhost.
  try { const e = localStorage.getItem('dev_email'); return e ? { 'x-dev-email': e } : {}; } catch { return {}; }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET'),
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), 'x-requested-with': 'shift-ops', ...devHeaders(), ...opts.headers },
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!r.ok) {
    let j: { error?: string; detail?: unknown } = {};
    try { j = await r.json(); } catch { /* non-JSON (e.g. Access login page) */ }
    throw new ApiError(r.status, j.error ?? (r.status === 401 || r.status === 403 ? 'not_authenticated' : 'generic'), j.detail);
  }
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? r.json() : (r.blob() as unknown)) as T;
}

// ---- live data version: one cheap poll; every view that depends on approved data refetches when it moves
let version = 0;
const vsubs = new Set<() => void>();
let polling = false;
export function startVersionPolling(intervalMs = 15000) {
  if (polling) return;
  polling = true;
  const tick = async () => {
    try {
      const r = await api<{ v: number }>('/api/version');
      if (r.v !== version) { version = r.v; vsubs.forEach((f) => f()); }
    } catch { /* keep the last data; the banner shows connectivity separately */ }
  };
  void tick();
  setInterval(tick, intervalMs);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void tick(); });
}
export function bumpLocalVersion() { version += 0.001; vsubs.forEach((f) => f()); }
export function useDataVersion() {
  return useSyncExternalStore((f) => { vsubs.add(f); return () => vsubs.delete(f); }, () => version);
}

export interface ApiState<T> { data: T | undefined; error: ApiError | undefined; loading: boolean; refreshing: boolean; reload: () => void; updatedAt: number | null }

/** GET with stale-while-revalidate: previous data stays on screen while it refreshes (no scroll or filter reset). */
export function useApi<T>(path: string | null, opts: { live?: boolean } = {}): ApiState<T> {
  const v = useDataVersion();
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean; refreshing: boolean; updatedAt: number | null }>({ loading: !!path, refreshing: false, updatedAt: null });
  const [nonce, setNonce] = useState(0);
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const samePath = last.current === path;
    last.current = path;
    setState((s) => ({ ...s, loading: !samePath || s.data === undefined, refreshing: samePath && s.data !== undefined, error: undefined, data: samePath ? s.data : undefined }));
    api<T>(path).then(
      (data) => alive && setState({ data, loading: false, refreshing: false, updatedAt: Date.now() }),
      (error: ApiError) => alive && setState((s) => ({ ...s, error, loading: false, refreshing: false })),
    );
    return () => { alive = false; };
  }, [path, nonce, opts.live ? v : 0]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, refreshing: state.refreshing, reload, updatedAt: state.updatedAt };
}

// ---- tiny router (history API)
const rsubs = new Set<() => void>();
export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  rsubs.forEach((f) => f());
}
if (typeof window !== 'undefined') window.addEventListener('popstate', () => rsubs.forEach((f) => f()));
export function useLocation() {
  return useSyncExternalStore((f) => { rsubs.add(f); return () => rsubs.delete(f); }, () => location.pathname + location.search);
}
export function useQueryParams(): [URLSearchParams, (p: Record<string, string | null>) => void] {
  const loc = useLocation();
  const params = new URLSearchParams(loc.split('?')[1] ?? '');
  const set = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(p)) { if (v === null || v === '') n.delete(k); else n.set(k, v); }
    const s = n.toString();
    navigate(location.pathname + (s ? `?${s}` : ''), true);
  };
  return [params, set];
}

export async function sha256File(f: Blob): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function todayLocal(tz = 'Asia/Amman'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
