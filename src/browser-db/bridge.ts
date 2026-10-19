/**
 * In-browser demo build only (`vite build --mode browserdb`). The Supabase client sends its HTTP calls here; they are
 * answered by the demo database running in this browser (see ./engine.ts) once it has started. Kept free of imports so
 * that normal builds, which never call it, carry no database engine.
 */
export const BROWSER_DB_URL = 'https://browser-demo.invalid';
export const BROWSER_DB_ANON_KEY = 'browser-demo-anon-key';

type Handler = (url: URL, init: RequestInit) => Promise<Response>;

let resolveHandler: (h: Handler) => void = () => undefined;
const handler = /* @__PURE__ */ new Promise<Handler>((resolve) => { resolveHandler = resolve; });

export function setBrowserDbHandler(h: Handler): void {
  resolveHandler(h);
}

/** `fetch` for the Supabase client: calls to the demo address wait for the database, everything else goes out as usual. */
export async function browserDbFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== BROWSER_DB_URL) return fetch(input, init);
  const merged: RequestInit = input instanceof Request
    ? { method: input.method, headers: input.headers, body: init.body ?? (input.method === 'GET' || input.method === 'HEAD' ? undefined : await input.text()), ...init }
    : init;
  return (await handler)(url, merged);
}
