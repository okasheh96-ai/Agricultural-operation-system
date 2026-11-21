import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BROWSER_DB_ANON_KEY, BROWSER_DB_URL, browserDbFetch } from '@/browser-db/bridge';

// The in-browser demo build (`--mode browserdb`) answers these calls from the demo database in the browser itself.
// 'same-origin': the packhouse server serves the app and the API from one address (scripts/packhouse.sh).
const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const url = __BROWSER_DB__ ? BROWSER_DB_URL : configuredUrl === 'same-origin' ? window.location.origin : configuredUrl;
const anonKey = __BROWSER_DB__ ? BROWSER_DB_ANON_KEY : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

// Packhouse server: when the server ends a session (revoked, account suspended or archived), the next API call answers 401;
// the device then signs out locally so the sign-in page appears instead of failing screens.
let onSessionEnded: (() => void) | null = null;
const packhouseFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  if (res.status === 401 && String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).includes('/rest/v1/')) {
    onSessionEnded?.();
  }
  return res;
};

/** null when the environment is not configured; the app then shows a configuration screen, never fake data. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'agri.auth' },
        ...(__BROWSER_DB__ ? { global: { fetch: browserDbFetch } } : __PACKHOUSE_SERVER__ ? { global: { fetch: packhouseFetch } } : {}),
      })
    : null;
onSessionEnded = () => { void supabase?.auth.signOut({ scope: 'local' }); };

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
