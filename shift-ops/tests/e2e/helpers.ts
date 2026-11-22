import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const OWNER = 'owner@example.test';
export const VIEWER = 'viewer@example.test';
export const BASE = 'http://localhost:8788';

export async function as(browser: Browser, email: string | null, opts: Parameters<Browser['newContext']>[0] = {}, lang: 'ar' | 'en' = 'en'): Promise<BrowserContext> {
  const ctx = await browser.newContext(opts);
  if (email) await ctx.addCookies([{ name: 'dev_email', value: email, url: BASE }]);
  await ctx.addInitScript((l) => { try { if (!sessionStorage.getItem('lang-set')) { localStorage.setItem('lang', l); sessionStorage.setItem('lang-set', '1'); } } catch { /* ignore */ } }, lang);
  return ctx;
}

export function api(request: APIRequestContext, email = OWNER) {
  const h = { 'x-dev-email': email, 'x-requested-with': 'shift-ops' };
  const call = async <T = any>(method: string, path: string, body?: unknown, expectStatus = 200): Promise<T> => {
    const r = await request.fetch(BASE + path, { method, headers: h, data: body === undefined ? undefined : body });
    if (r.status() !== expectStatus) throw new Error(`${method} ${path} -> ${r.status()} ${await r.text()}`);
    const ct = r.headers()['content-type'] ?? '';
    return (ct.includes('json') ? r.json() : r.body()) as Promise<T>;
  };
  return {
    get: <T = any>(p: string, s?: number) => call<T>('GET', p, undefined, s),
    post: <T = any>(p: string, b: unknown = {}, s?: number) => call<T>('POST', p, b, s),
    put: <T = any>(p: string, b: unknown, s?: number) => call<T>('PUT', p, b, s),
    patch: <T = any>(p: string, b: unknown, s?: number) => call<T>('PATCH', p, b, s),
  };
}

/** Reference data needed by the scenarios (test fixtures, not farm data). */
export async function seedRef(request: APIRequestContext) {
  const a = api(request);
  const have = await a.get<{ ref: { kind: string; code: string }[] }>('/api/ref');
  const add = async (kind: string, code: string) => { if (!have.ref.some((r) => r.kind === kind && r.code === code)) await a.post('/api/ref', { kind, code, name_ar: `اختبار ${code}`, name_en: `Test ${code}` }); };
  for (const l of ['L1', 'L2', 'L3', 'L4']) await add('line', l);
  for (const p of ['TOM', 'CUC']) await add('product', p);
  for (const g of ['G1', 'G2']) await add('grade', g);
  await add('customer', 'CUST-A');
  await add('currency', 'JOD');
  await add('downtime_reason', 'JAM');
}

/** Run a staged batch through the API: same validation and approval path as the UI. */
export async function stage(request: APIRequestContext, b: { dataset: string; shift_date: string; rows: any[]; reading_mode?: string; config?: any; source?: string }) {
  const a = api(request);
  const r = await a.post<{ id: string }>('/api/batches', { source: b.source ?? 'sheet', dataset: b.dataset, shift_date: b.shift_date, total_rows: b.rows.length, reading_mode: b.reading_mode, config: b.config ?? { shift_start: '06:00' } });
  await a.post(`/api/batches/${r.id}/rows`, { rows: b.rows.map((vals, idx) => ({ idx, source_ref: `T!A${idx + 2}`, raw: {}, vals: { attrs: {}, ...vals } })) });
  return r.id;
}

export function nf(lang: 'ar' | 'en', n: number, digits = 3) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { maximumFractionDigits: digits }).format(n);
}
export function pf(lang: 'ar' | 'en', r: number) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-JO' : 'en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(r);
}

export async function noHorizontalOverflow(page: Page) {
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(ov).toBeLessThanOrEqual(1);
}
