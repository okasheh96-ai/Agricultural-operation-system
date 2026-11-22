// Automatic backups of D1 records and R2 originals into a separate private bucket, a restore rehearsal into an
// isolated D1 database (RESTORE_DB) with record-hash and file-checksum comparison, and a portable export.
import { zipSync, strToU8 } from 'fflate';
import type { Env } from './env';
import { HttpError, nowIso, sha256Hex, uid } from './db';

const SKIP = new Set(['d1_migrations', 'guard', 'sqlite_sequence', '_cf_KV', '_cf_METADATA']);

interface SchemaObj { type: string; name: string; tbl_name: string; sql: string }

async function schema(db: D1Database): Promise<SchemaObj[]> {
  const { results } = await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid").all<SchemaObj>();
  return results.filter((o) => !SKIP.has(o.tbl_name));
}

async function tableRows(db: D1Database, table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let last = -1;
  for (;;) {
    const { results } = await db.prepare(`SELECT rowid AS __rowid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT 500`).bind(last).all<Record<string, unknown>>();
    for (const r of results) { last = r.__rowid as number; delete r.__rowid; out.push(r); }
    if (results.length < 500) break;
  }
  return out;
}

function canon(r: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(r).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = r[k]; return o; }, {}));
}

async function tableHash(rows: Record<string, unknown>[]): Promise<string> {
  return sha256Hex(rows.map(canon).sort().join('\n'));
}

export interface Manifest {
  id: string; created_at: string; schema: SchemaObj[];
  tables: { name: string; rows: number; sha256: string; key: string }[];
  originals: { sha256: string; size: number; key: string; copied: boolean }[];
}

export async function runBackup(env: Env, trigger: 'cron' | 'owner'): Promise<Manifest> {
  const id = uid();
  const started = nowIso();
  const prefix = `backups/${started.replace(/[:.]/g, '-')}_${id.slice(0, 8)}/`;
  await env.DB.prepare("INSERT INTO backup_runs(id, started_at, status, trigger, prefix) VALUES (?,?,'running',?,?)").bind(id, started, trigger, prefix).run();
  try {
    const objs = await schema(env.DB);
    const tables: Manifest['tables'] = [];
    for (const t of objs.filter((o) => o.type === 'table')) {
      const rows = await tableRows(env.DB, t.name);
      const key = `${prefix}d1/${t.name}.ndjson`;
      await env.BACKUPS.put(key, rows.map((r) => JSON.stringify(r)).join('\n'), { httpMetadata: { contentType: 'application/x-ndjson' } });
      tables.push({ name: t.name, rows: rows.length, sha256: await tableHash(rows), key });
    }
    const { results: files } = await env.DB.prepare('SELECT DISTINCT sha256, size, r2_key FROM files').all<{ sha256: string; size: number; r2_key: string }>();
    const originals: Manifest['originals'] = [];
    for (const f of files) {
      const key = `originals/${f.sha256}`;
      const head = await env.BACKUPS.head(key);
      if (head) { originals.push({ sha256: f.sha256, size: f.size, key, copied: false }); continue; }
      const obj = await env.ORIGINALS.get(f.r2_key);
      if (!obj) throw new Error(`original missing in storage: ${f.r2_key}`);
      const buf = await obj.arrayBuffer();
      const sum = await sha256Hex(buf);
      if (sum !== f.sha256) throw new Error(`checksum mismatch for ${f.r2_key}`);
      await env.BACKUPS.put(key, buf, { httpMetadata: obj.httpMetadata, customMetadata: { sha256: sum } });
      originals.push({ sha256: f.sha256, size: f.size, key, copied: true });
    }
    const manifest: Manifest = { id, created_at: started, schema: objs, tables, originals };
    await env.BACKUPS.put(`${prefix}manifest.json`, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
    const summary = { tables: tables.map(({ name, rows, sha256 }) => ({ name, rows, sha256 })), originals: originals.length, copied: originals.filter((o) => o.copied).length };
    await env.DB.prepare("UPDATE backup_runs SET status = 'succeeded', finished_at = ?, manifest = ? WHERE id = ?").bind(nowIso(), JSON.stringify(summary), id).run();
    await pruneBackups(env, 35);
    return manifest;
  } catch (e) {
    await env.DB.prepare("UPDATE backup_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").bind(nowIso(), String(e).slice(0, 2000), id).run();
    throw e;
  }
}

async function pruneBackups(env: Env, keep: number) {
  const { results } = await env.DB.prepare("SELECT id, prefix FROM backup_runs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT -1 OFFSET ?").bind(keep).all<{ id: string; prefix: string }>();
  for (const r of results) {
    let cursor: string | undefined;
    do {
      const l = await env.BACKUPS.list({ prefix: r.prefix, cursor });
      if (l.objects.length) await env.BACKUPS.delete(l.objects.map((o) => o.key));
      cursor = l.truncated ? l.cursor : undefined;
    } while (cursor);
  }
}

/** Restore a backup into the isolated RESTORE_DB and compare record hashes and original checksums. */
export async function rehearseRestore(env: Env, backupId: string) {
  const run = await env.DB.prepare("SELECT * FROM backup_runs WHERE id = ? AND status = 'succeeded'").bind(backupId).first<{ prefix: string }>();
  if (!run) throw new HttpError(404, 'backup_not_found');
  const testId = uid();
  await env.DB.prepare("INSERT INTO restore_tests(id, backup_id, started_at, status) VALUES (?,?,?,'running')").bind(testId, backupId, nowIso()).run();
  const report: { tables: { name: string; rows: number; restored: number; hashOk: boolean }[]; files: { sha256: string; ok: boolean }[]; error?: string } = { tables: [], files: [] };
  try {
    const mobj = await env.BACKUPS.get(`${run.prefix}manifest.json`);
    if (!mobj) throw new Error('manifest missing');
    const m = (await mobj.json()) as Manifest;
    const db = env.RESTORE_DB;
    // wipe the isolated destination completely, then rebuild the schema from the backup
    const existing = await schema(db);
    const drops = [...existing].reverse().filter((o) => o.type === 'table').map((o) => db.prepare(`DROP TABLE IF EXISTS "${o.name}"`));
    if (drops.length) await db.batch([db.prepare('PRAGMA defer_foreign_keys = true'), ...drops]);
    const tablesSql = m.schema.filter((o) => o.type === 'table');
    await db.batch(tablesSql.map((o) => db.prepare(o.sql)));
    for (const t of m.tables) {
      const obj = await env.BACKUPS.get(t.key);
      const text = obj ? await obj.text() : '';
      const rows = text ? text.split('\n').map((l) => JSON.parse(l) as Record<string, unknown>) : [];
      if (rows.length) {
        const cols = Object.keys(rows[0]);
        for (let i = 0; i < rows.length; i += 200) {
          const chunk = JSON.stringify(rows.slice(i, i + 200));
          await db.batch([db.prepare('PRAGMA defer_foreign_keys = true'), db.prepare(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(',')}) SELECT ${cols.map((c) => `j.value->>'${c}'`).join(',')} FROM json_each(?) AS j`).bind(chunk)]);
        }
      }
      const restored = await tableRows(db, t.name);
      report.tables.push({ name: t.name, rows: t.rows, restored: restored.length, hashOk: (await tableHash(restored)) === t.sha256 && restored.length === t.rows });
    }
    // indexes and triggers last, so immutability triggers do not block the load
    const rest = m.schema.filter((o) => o.type !== 'table');
    if (rest.length) await db.batch(rest.map((o) => db.prepare(o.sql)));
    for (const o of m.originals) {
      const obj = await env.BACKUPS.get(o.key);
      report.files.push({ sha256: o.sha256, ok: !!obj && (await sha256Hex(await obj.arrayBuffer())) === o.sha256 });
    }
    const passed = report.tables.every((t) => t.hashOk) && report.files.every((f) => f.ok);
    await env.DB.prepare('UPDATE restore_tests SET status = ?, finished_at = ?, report = ? WHERE id = ?').bind(passed ? 'passed' : 'failed', nowIso(), JSON.stringify(report), testId).run();
    return { id: testId, passed, report };
  } catch (e) {
    report.error = String(e).slice(0, 2000);
    await env.DB.prepare("UPDATE restore_tests SET status = 'failed', finished_at = ?, report = ? WHERE id = ?").bind(nowIso(), JSON.stringify(report), testId).run();
    return { id: testId, passed: false, report };
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Portable export: every table as JSON, approved facts as CSV, the schema, and optionally the originals. */
export async function exportZip(env: Env, withOriginals: boolean): Promise<Uint8Array> {
  const objs = await schema(env.DB);
  const files: Record<string, Uint8Array> = {};
  const manifest: { created_at: string; tables: { name: string; rows: number; sha256: string }[]; originals: { name: string; sha256: string }[] } = { created_at: nowIso(), tables: [], originals: [] };
  files['schema.sql'] = strToU8(objs.map((o) => o.sql + ';').join('\n\n'));
  for (const t of objs.filter((o) => o.type === 'table')) {
    const rows = await tableRows(env.DB, t.name);
    files[`tables/${t.name}.json`] = strToU8(JSON.stringify(rows, null, 1));
    manifest.tables.push({ name: t.name, rows: rows.length, sha256: await tableHash(rows) });
    if (t.name === 'facts') {
      const cols = ['shift_date', 'dataset', 'metric', 'qty', 'unit', 'line', 'product', 'grade', 'lot', 'customer', 'order_ref', 'worker', 'reason', 'doc_no', 'ref_doc_no', 'rec_status', 'direction', 'mode', 'at_ms', 'start_ms', 'end_ms', 'source_ref', 'batch_id', 'state', 'approved_at', 'id'];
      const lines = [cols.concat('qty_decimal').join(',')];
      for (const r of rows.filter((x) => x.state === 'current')) lines.push(cols.map((c) => csvCell(r[c])).concat(String((r.qty as number) / 1000)).join(','));
      files['approved_facts.csv'] = strToU8('﻿' + lines.join('\r\n'));
    }
  }
  if (withOriginals) {
    const { results } = await env.DB.prepare('SELECT id, name, sha256, r2_key FROM files').all<{ id: string; name: string; sha256: string; r2_key: string }>();
    let total = 0;
    for (const f of results) {
      const obj = await env.ORIGINALS.get(f.r2_key);
      if (!obj) continue;
      const buf = new Uint8Array(await obj.arrayBuffer());
      total += buf.length;
      if (total > 80 * 1024 * 1024) throw new HttpError(413, 'export_too_large');
      files[`originals/${f.id}_${f.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`] = buf;
      manifest.originals.push({ name: f.name, sha256: f.sha256 });
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  return zipSync(files, { level: 6 });
}
