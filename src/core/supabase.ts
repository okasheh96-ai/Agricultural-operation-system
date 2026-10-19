import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BROWSER_DB_ANON_KEY, BROWSER_DB_URL, browserDbFetch } from '@/browser-db/bridge';

// The in-browser demo build (`--mode browserdb`) answers these calls from the demo database in the browser itself.
const url = __BROWSER_DB__ ? BROWSER_DB_URL : (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const anonKey = __BROWSER_DB__ ? BROWSER_DB_ANON_KEY : (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/** null when the environment is not configured; the app then shows a configuration screen, never fake data. */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'agri.auth' },
        ...(__BROWSER_DB__ ? { global: { fetch: browserDbFetch } } : {}),
      })
    : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
