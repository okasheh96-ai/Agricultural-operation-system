/**
 * In-browser demo only. Starts PostgreSQL (PGlite, WebAssembly) in this browser from a snapshot made by
 * scripts/build-browser-demo.mjs: every migration in supabase/migrations, the structure seed, the demo farm and its demo
 * people. On the first visit the time-based demo records (today's tasks, the packing-house day) are created through the
 * same seeds the local stack uses, so their timers start now. The data is kept in this browser (IndexedDB) and never
 * leaves the device; "Reset demo data" starts over from the snapshot.
 */
import { PGlite, type Extension } from '@electric-sql/pglite';
import demoTasksSql from '../../supabase/seed/demo_tasks.sql?raw';
import demoPackingHouseSql from '../../supabase/seed/demo_packing_house.sql?raw';
import { BROWSER_DB_ANON_KEY, setBrowserDbHandler } from './bridge';
import { claimsOf, handleAuth } from './gotrue';
import { handleRest, loadMeta, type SchemaMeta } from './postgrest';

const DB_NAME = 'agri-ph-browser-demo';
const BUILD_FLAG = 'agri.browserDemo.build';
const AUTH_KEY = 'agri.auth';
const FIELD_DB = 'agri-field';

export type BootStep = 'download' | 'start' | 'seed' | 'ready';
export interface BootInfo { persistent: boolean; firstRun: boolean }

declare global {
  interface Window { __AGRI_EMBEDDED_ASSETS__?: Record<string, string> }
}

let db: PGlite | null = null;
let booting: Promise<BootInfo> | null = null;

function fromBase64(b64: string): Blob {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}

/**
 * A file published next to the page, or embedded in the single-file version. Hosts that serve only web file types get
 * the database files as base64 text (`<name>.b64.txt`); the engine itself (.wasm) is served as is.
 */
async function asset(name: string): Promise<Blob> {
  const embedded = window.__AGRI_EMBEDDED_ASSETS__?.[name];
  if (embedded) return fromBase64(embedded);
  const file = name.endsWith('.wasm') ? name : `${name}.b64.txt`;
  const res = await fetch(new URL(file, document.baseURI).href);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return name.endsWith('.wasm') ? res.blob() : fromBase64(await res.text());
}

function readFlag(): string | null {
  try { return localStorage.getItem(BUILD_FLAG); } catch { return null; }
}

function writeFlag(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(BUILD_FLAG); else localStorage.setItem(BUILD_FLAG, value);
  } catch { /* storage blocked: the demo runs without keeping data */ }
}

/** IndexedDB can be missing or blocked (private windows, some embedded views); the demo then runs in memory. */
function indexedDbUsable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('agri-browser-demo-probe');
      const timer = setTimeout(() => resolve(false), 3000);
      req.onsuccess = () => { clearTimeout(timer); req.result.close(); resolve(true); };
      req.onerror = () => { clearTimeout(timer); resolve(false); };
    } catch {
      resolve(false);
    }
  });
}

function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteDemoDatabase(): Promise<void> {
  let names = [`/pglite/${DB_NAME}`];
  try {
    const all = await indexedDB.databases();
    names = [...new Set([...names, ...all.map((d) => d.name ?? '').filter((n) => n.includes(DB_NAME))])];
  } catch { /* older browsers cannot list databases */ }
  for (const n of names) await deleteIdb(n);
}

async function route(meta: SchemaMeta, url: URL, init: RequestInit): Promise<Response> {
  const pg = db;
  if (!pg) return new Response(null, { status: 503 });
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' && init.body !== '' ? (JSON.parse(init.body) as unknown) : undefined;
  const json = (status: number, payload?: unknown, extra: Record<string, string> = {}) =>
    new Response(payload === undefined || status === 204 ? null : JSON.stringify(payload),
      { status, headers: { 'content-type': 'application/json; charset=utf-8', 'x-supabase-api-version': '2024-01-01', ...extra } });

  if (url.pathname.startsWith('/auth/v1/')) {
    const res = await handleAuth(pg, url.pathname.slice('/auth/v1/'.length), url.searchParams, headers, body, BROWSER_DB_ANON_KEY);
    return json(res.status, res.body);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    let claims: Record<string, unknown> | null;
    try {
      claims = claimsOf(headers.get('authorization'), BROWSER_DB_ANON_KEY);
    } catch {
      return json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
    }
    const res = await handleRest(pg, meta, {
      method, path: decodeURIComponent(url.pathname.slice('/rest/v1/'.length)), search: url.searchParams, headers, body,
      role: claims ? 'authenticated' : 'anon', claims: claims ?? { role: 'anon' },
    });
    return json(res.status, res.body, res.headers);
  }
  return json(404, { message: `Not part of the in-browser demo: ${url.pathname}` });
}

async function boot(onStep: (s: BootStep) => void, build: string): Promise<BootInfo> {
  onStep('download');
  const [wasm, fsBundle, btreeGist] = await Promise.all([asset('pglite.wasm'), asset('pglite.data'), asset('btree_gist.tar.gz')]);
  const wasmModule = await WebAssembly.compile(await wasm.arrayBuffer());
  const btreeUrl = new URL(URL.createObjectURL(btreeGist));
  const btree: Extension = { name: 'btree_gist', setup: () => Promise.resolve({ bundlePath: btreeUrl }) };
  const persistent = await indexedDbUsable();
  const firstRun = !persistent || readFlag() !== build;
  if (persistent && firstRun) await deleteDemoDatabase();
  const snapshot = firstRun ? await asset('demo-db.tar.gz') : undefined;

  onStep('start');
  db = await PGlite.create({
    dataDir: persistent ? `idb://${DB_NAME}` : undefined, loadDataDir: snapshot, wasmModule, fsBundle,
    // Every request is written to IndexedDB before it answers, so a reload (or closing the tab) never loses a saved step.
    extensions: { btree_gist: btree }, relaxedDurability: false,
  });
  await db.exec(`set timezone to 'UTC'`);
  if (firstRun) {
    onStep('seed');
    await db.exec(demoTasksSql);
    await db.exec(demoPackingHouseSql);
    await db.syncToFs();
    if (persistent) writeFlag(build);
  }
  const meta = await loadMeta(db);
  setBrowserDbHandler((url, init) => route(meta, url, init));
  onStep('ready');
  return { persistent, firstRun };
}

/** Starts the demo database once; later calls share the same start. */
export function bootBrowserDb(onStep: (s: BootStep) => void, build: string): Promise<BootInfo> {
  booting ??= boot(onStep, build);
  return booting;
}

/** Deletes this browser's demo data (database, device queue, sign-in) and reloads from the snapshot. */
export async function resetBrowserDemo(): Promise<void> {
  try { await db?.close(); } catch { /* already closed */ }
  db = null;
  await deleteDemoDatabase();
  await deleteIdb(FIELD_DB);
  writeFlag(null);
  try { localStorage.removeItem(AUTH_KEY); } catch { /* storage blocked */ }
  window.location.hash = '';
  window.location.reload();
}
