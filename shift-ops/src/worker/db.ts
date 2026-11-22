import type { Env } from './env';
import type { Conversion, Fact } from '../shared/types';
import { BUILTIN_UNITS } from '../shared/rows';

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

export class HttpError extends Error {
  constructor(public status: number, public code: string, public detail?: unknown) { super(code); }
}

export async function settings(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const o: Record<string, unknown> = {};
  for (const r of results) { try { o[r.key] = JSON.parse(r.value); } catch { o[r.key] = r.value; } }
  return o;
}

export function auditStmt(env: Env, actor: string, action: string, entity: string, entityId: string | null, detail: unknown = {}) {
  return env.DB.prepare('INSERT INTO audit_log(at, actor, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
    .bind(nowIso(), actor, action, entity, entityId, JSON.stringify(detail));
}

export function bumpVersionStmt(env: Env) {
  return env.DB.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = ? WHERE key = 'data_version'").bind(nowIso());
}

export interface FactRow {
  id: string; batch_id: string; row_id: string | null; dataset: string; shift_date: string; at_ms: number | null; start_ms: number | null; end_ms: number | null;
  line: string | null; product: string | null; grade: string | null; lot: string | null; customer: string | null; order_ref: string | null;
  worker: string | null; reason: string | null; doc_no: string | null; ref_doc_no: string | null; rec_status: string | null; direction: string | null;
  mode: Fact['mode']; metric: string; qty: number; unit: string; source_ref: string | null; attrs: string | null; natural_key: string; approved_at: string;
}

export function rowToFact(r: FactRow): Fact & { natural_key: string; approved_at: string } {
  return { ...r, status: r.rec_status, attrs: r.attrs ? JSON.parse(r.attrs) : null };
}

export async function currentFacts(env: Env, q: { from?: string; to?: string; datasets?: string[] } = {}): Promise<Array<Fact & { natural_key: string; approved_at: string }>> {
  const where = ["state = 'current'"];
  const binds: unknown[] = [];
  if (q.from) { where.push('shift_date >= ?'); binds.push(q.from); }
  if (q.to) { where.push('shift_date <= ?'); binds.push(q.to); }
  if (q.datasets?.length) { where.push(`dataset IN (${q.datasets.map(() => '?').join(',')})`); binds.push(...q.datasets); }
  const { results } = await env.DB.prepare(`SELECT * FROM facts WHERE ${where.join(' AND ')}`).bind(...binds).all<FactRow>();
  return results.map(rowToFact);
}

export async function conversions(env: Env): Promise<Conversion[]> {
  const { results } = await env.DB.prepare('SELECT product, grade, from_unit, to_unit, factor, note FROM conversions WHERE active = 1').all<Conversion>();
  return results;
}

export async function closedLots(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare('SELECT lot FROM lots WHERE closed_at IS NOT NULL').all<{ lot: string }>();
  return new Set(results.map((r) => r.lot));
}

export async function refCodes(env: Env) {
  const { results } = await env.DB.prepare('SELECT kind, code FROM ref_items WHERE active = 1').all<{ kind: string; code: string }>();
  const by: Record<string, Set<string>> = {};
  for (const r of results) (by[r.kind] ??= new Set()).add(r.code);
  const units = new Set<string>([...BUILTIN_UNITS, ...(by.unit ?? []), ...(by.currency ?? [])]);
  return { by, units };
}

/** Run D1 statements atomically, chunked JSON inserts keep each statement under the bound-parameter limit. */
export function jsonChunks<T>(items: T[], maxBytes = 800_000): string[] {
  const out: string[] = [];
  let cur: T[] = [];
  let size = 2;
  for (const it of items) {
    const s = JSON.stringify(it).length + 1;
    if (cur.length && size + s > maxBytes) { out.push(JSON.stringify(cur)); cur = []; size = 2; }
    cur.push(it);
    size += s;
  }
  if (cur.length) out.push(JSON.stringify(cur));
  return out;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array<ArrayBuffer> | string): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
