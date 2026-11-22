import { Hono, type Context } from 'hono';
import type { Env } from './env';
import { authenticate, authorize } from './auth';
import { HttpError, auditStmt, bumpVersionStmt, jsonChunks, nowIso, refCodes, settings, sha256Hex, uid, rowToFact, type FactRow } from './db';
import { approveBatch, contentHash, getBatch, reviewBatch } from './review';
import { buildDashboard, type DashFilters } from './dashboard';
import { exportZip, rehearseRestore, runBackup } from './backup';
import { emptyPlan, shiftPlan, validatePlan } from '../shared/plan';
import { parseQuantity } from '../shared/num';
import { parseTimeText, shiftTimeToUtcMs } from '../shared/time';
import type { Me, PlanData, PlanJob } from '../shared/types';
import { measureKey, type RowVals } from '../shared/rows';

type C = Context<{ Bindings: Env; Variables: { me: Me } }>;
const app = new Hono<{ Bindings: Env; Variables: { me: Me } }>();

const MAX_FILE = 25 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, detail: err.detail ?? null }, err.status as 400);
  console.error(err);
  const msg = String(err);
  if (msg.includes('frozen') || msg.includes('immutable') || msg.includes('no hard deletes')) return c.json({ error: 'forbidden_change', detail: msg }, 409);
  if (msg.includes('UNIQUE constraint')) return c.json({ error: 'duplicate', detail: msg }, 409);
  return c.json({ error: 'server_error' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// Every other /api route: verified identity, then authorization from D1 on every request.
app.use('/api/*', async (c, next) => {
  c.header('cache-control', 'no-store');
  c.header('x-content-type-options', 'nosniff');
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('x-requested-with') !== 'shift-ops') throw new HttpError(403, 'csrf');
  const email = await authenticate(c.req.raw, c.env);
  if (!email) throw new HttpError(401, 'not_authenticated');
  // Snapshot links are authorized by their own token and recipient list, not by a live grant.
  if (c.req.path.startsWith('/api/s/')) { c.set('me', { email, role: 'viewer', show_workers: false }); return next(); }
  const me = await authorize(email, c.env);
  if (!me) throw new HttpError(403, 'no_access', { email });
  c.set('me', me);
  return next();
});

function owner(c: C): Me {
  const me = c.get('me');
  if (me.role !== 'owner') throw new HttpError(403, 'owner_only');
  return me;
}
async function body<T>(c: C): Promise<T> {
  try { return (await c.req.json()) as T; } catch { throw new HttpError(400, 'bad_json'); }
}
function need(cond: unknown, code: string, detail?: unknown): asserts cond {
  if (!cond) throw new HttpError(400, code, detail);
}

// ------------------------------------------------------------------ identity & live refresh
app.get('/api/me', async (c) => c.json({ ...c.get('me'), owner_configured: !!c.env.OWNER_EMAIL }));
app.get('/api/version', async (c) => {
  const r = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'data_version'").first<{ value: string }>();
  return c.json({ v: Number(r?.value ?? 0) });
});

// ------------------------------------------------------------------ settings & reference data
app.get('/api/settings', async (c) => {
  owner(c);
  const db = c.env.DB;
  const [ref, convs, rules, lots, mappings] = await Promise.all([
    db.prepare('SELECT * FROM ref_items ORDER BY kind, code').all(),
    db.prepare('SELECT * FROM conversions ORDER BY active DESC, product, from_unit').all(),
    db.prepare('SELECT * FROM metric_rules ORDER BY dataset, metric').all(),
    db.prepare('SELECT * FROM lots ORDER BY updated_at DESC LIMIT 200').all(),
    db.prepare('SELECT * FROM mappings ORDER BY updated_at DESC').all(),
  ]);
  return c.json({ settings: await settings(c.env), ref: ref.results, conversions: convs.results, metric_rules: rules.results, lots: lots.results, mappings: mappings.results, units: [...(await refCodes(c.env)).units] });
});

// Reference lists visible to viewers too (names for display only).
app.get('/api/ref', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT kind, code, name_ar, name_en, attrs, active FROM ref_items ORDER BY kind, code').all();
  return c.json({ ref: results, units: [...(await refCodes(c.env)).units] });
});

const SETTING_KEYS: Record<string, (v: unknown) => boolean> = {
  timezone: (v) => typeof v === 'string' && v.length < 64,
  lot_tol_abs_kg: (v) => typeof v === 'number' && v >= 0,
  lot_tol_pct: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  pace_tol_pct: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  rate_tol_pct: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  ai_enabled: (v) => typeof v === 'boolean',
  ai_monthly_call_limit: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100000,
  show_workers_to_viewers: (v) => typeof v === 'boolean',
  default_shift_start: (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v),
  ocr_threshold: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  guide_dismissed: (v) => typeof v === 'boolean',
};
app.put('/api/settings', async (c) => {
  const me = owner(c);
  const b = await body<Record<string, unknown>>(c);
  const stmts = [];
  for (const [k, v] of Object.entries(b)) {
    need(SETTING_KEYS[k], 'unknown_setting', k);
    need(SETTING_KEYS[k](v), 'bad_setting', k);
    stmts.push(c.env.DB.prepare('INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(k, JSON.stringify(v), nowIso()));
  }
  need(stmts.length, 'nothing_to_save');
  stmts.push(auditStmt(c.env, me.email, 'update', 'settings', null, b), bumpVersionStmt(c.env));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

const REF_KINDS = ['product', 'grade', 'line', 'unit', 'customer', 'downtime_reason', 'currency'];
app.post('/api/ref', async (c) => {
  const me = owner(c);
  const b = await body<{ kind: string; code: string; name_ar?: string; name_en?: string; attrs?: Record<string, string> }>(c);
  need(REF_KINDS.includes(b.kind), 'bad_kind');
  const code = (b.code ?? '').trim();
  need(code && code.length <= 64 && !code.includes('|'), 'bad_code');
  const id = uid();
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO ref_items(id, kind, code, name_ar, name_en, attrs, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.kind, code, (b.name_ar ?? '').trim(), (b.name_en ?? '').trim(), JSON.stringify(b.attrs ?? {}), at, at),
    auditStmt(c.env, me.email, 'create', 'ref_item', id, b), bumpVersionStmt(c.env),
  ]);
  return c.json({ id });
});
app.patch('/api/ref/:id', async (c) => {
  const me = owner(c);
  const b = await body<{ name_ar?: string; name_en?: string; active?: boolean; attrs?: Record<string, string> }>(c);
  const cur = await c.env.DB.prepare('SELECT * FROM ref_items WHERE id = ?').bind(c.req.param('id')).first<{ name_ar: string; name_en: string; active: number; attrs: string }>();
  if (!cur) throw new HttpError(404, 'not_found');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE ref_items SET name_ar = ?, name_en = ?, active = ?, attrs = ?, updated_at = ? WHERE id = ?').bind(b.name_ar ?? cur.name_ar, b.name_en ?? cur.name_en, b.active === undefined ? cur.active : b.active ? 1 : 0, b.attrs ? JSON.stringify(b.attrs) : cur.attrs, nowIso(), c.req.param('id')),
    auditStmt(c.env, me.email, 'update', 'ref_item', c.req.param('id'), { before: cur, after: b }), bumpVersionStmt(c.env),
  ]);
  return c.json({ ok: true });
});

app.post('/api/conversions', async (c) => {
  const me = owner(c);
  const b = await body<{ product?: string; grade?: string; from_unit: string; to_unit: string; factor: string; note: string }>(c);
  const { units } = await refCodes(c.env);
  need(units.has(b.from_unit) && units.has(b.to_unit) && b.from_unit !== b.to_unit, 'bad_unit');
  const f = parseQuantity(b.factor);
  need(f.milli && f.milli > 0, 'bad_factor');
  need((b.note ?? '').trim().length > 0, 'source_required'); // a conversion must say where it is documented
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO conversions(id, product, grade, from_unit, to_unit, factor, note, created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, b.product || null, b.grade || null, b.from_unit, b.to_unit, f.milli, b.note.trim(), nowIso()),
    auditStmt(c.env, me.email, 'create', 'conversion', id, b), bumpVersionStmt(c.env),
  ]);
  return c.json({ id });
});
app.patch('/api/conversions/:id', async (c) => {
  const me = owner(c);
  const b = await body<{ active: boolean }>(c);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE conversions SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, c.req.param('id')),
    auditStmt(c.env, me.email, b.active ? 'activate' : 'deactivate', 'conversion', c.req.param('id')), bumpVersionStmt(c.env),
  ]);
  return c.json({ ok: true });
});

app.put('/api/metric-rules', async (c) => {
  const me = owner(c);
  const b = await body<{ dataset: string; metric: string; kind: string; aggregation: string; label_ar?: string; label_en?: string }>(c);
  need(['quantity', 'count', 'rate', 'price', 'balance', 'duration'].includes(b.kind), 'bad_kind');
  need(['sum', 'latest', 'avg'].includes(b.aggregation), 'bad_aggregation');
  need(b.aggregation === 'sum' ? !['rate', 'price', 'balance'].includes(b.kind) : ['rate', 'price', 'balance'].includes(b.kind), 'aggregation_kind_mismatch');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO metric_rules(dataset, metric, kind, aggregation, label_ar, label_en, confirmed, updated_at) VALUES (?,?,?,?,?,?,1,?)
      ON CONFLICT(dataset, metric) DO UPDATE SET kind = excluded.kind, aggregation = excluded.aggregation, label_ar = excluded.label_ar, label_en = excluded.label_en, confirmed = 1, updated_at = excluded.updated_at`)
      .bind(b.dataset, b.metric, b.kind, b.aggregation, b.label_ar ?? '', b.label_en ?? '', nowIso()),
    auditStmt(c.env, me.email, 'confirm', 'metric_rule', `${b.dataset}/${b.metric}`, b), bumpVersionStmt(c.env),
  ]);
  return c.json({ ok: true });
});

app.put('/api/lots/:lot', async (c) => {
  const me = owner(c);
  const b = await body<{ closed: boolean; note?: string }>(c);
  const lot = c.req.param('lot');
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO lots(lot, closed_at, note, updated_at) VALUES (?,?,?,?) ON CONFLICT(lot) DO UPDATE SET closed_at = excluded.closed_at, note = excluded.note, updated_at = excluded.updated_at').bind(lot, b.closed ? at : null, b.note ?? '', at),
    auditStmt(c.env, me.email, b.closed ? 'close' : 'reopen', 'lot', lot, b), bumpVersionStmt(c.env),
  ]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ import mappings
app.post('/api/mappings', async (c) => {
  const me = owner(c);
  const b = await body<{ id?: string; name: string; dataset: string; signature?: string; config: unknown }>(c);
  need((b.name ?? '').trim(), 'name_required');
  need(b.dataset && /^(production|labour|receiving|waste|carryover|downtime|order|dispatch|invoice|credit|plan|mixed|custom:[a-z0-9_]{1,40})$/.test(b.dataset), 'bad_dataset');
  const at = nowIso();
  const id = b.id ?? uid();
  if (b.id) {
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE mappings SET name = ?, dataset = ?, signature = ?, config = ?, updated_at = ? WHERE id = ?').bind(b.name.trim(), b.dataset, b.signature ?? '', JSON.stringify(b.config), at, id),
      auditStmt(c.env, me.email, 'update', 'mapping', id, { name: b.name }),
    ]);
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO mappings(id, name, dataset, signature, config, created_at, updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, b.name.trim(), b.dataset, b.signature ?? '', JSON.stringify(b.config), at, at),
      auditStmt(c.env, me.email, 'create', 'mapping', id, { name: b.name }),
    ]);
  }
  return c.json({ id });
});
app.get('/api/mappings', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM mappings WHERE active = 1 ORDER BY updated_at DESC').all();
  return c.json({ mappings: results });
});

// ------------------------------------------------------------------ original files (owner only)
app.post('/api/files', async (c) => {
  const me = owner(c);
  const name = decodeURIComponent(c.req.header('x-file-name') ?? '').slice(0, 200) || 'upload';
  const mime = (c.req.header('content-type') ?? 'application/octet-stream').split(';')[0];
  const kind = /^image\/(jpeg|png|heic|heif|webp)$/.test(mime) ? 'image'
    : /(spreadsheetml|ms-excel|text\/csv|csv|octet-stream)/.test(mime) && /\.(xlsx|xlsm|csv)$/i.test(name) ? 'sheet' : null;
  need(kind, 'unsupported_type', { mime, name });
  const buf = await c.req.arrayBuffer();
  need(buf.byteLength > 0, 'empty_file');
  if (buf.byteLength > MAX_FILE) throw new HttpError(413, 'file_too_large');
  const sha = await sha256Hex(buf);
  const claimed = c.req.header('x-sha256');
  if (claimed && claimed !== sha) throw new HttpError(400, 'checksum_mismatch');
  const key = `originals/${sha}`;
  if (!(await c.env.ORIGINALS.head(key))) await c.env.ORIGINALS.put(key, buf, { httpMetadata: { contentType: mime }, customMetadata: { sha256: sha } });
  const prior = await c.env.DB.prepare("SELECT f.id AS file_id, f.name, b.id AS batch_id, b.status FROM files f LEFT JOIN batches b ON b.file_id = f.id WHERE f.sha256 = ? ORDER BY f.uploaded_at").bind(sha).all<{ file_id: string; name: string; batch_id: string | null; status: string | null }>();
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO files(id, sha256, name, mime, size, r2_key, kind, uploaded_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, sha, name, mime, buf.byteLength, key, kind, nowIso()),
    auditStmt(c.env, me.email, 'upload', 'file', id, { name, sha256: sha, size: buf.byteLength }),
  ]);
  return c.json({ id, sha256: sha, kind, size: buf.byteLength, previous: prior.results });
});
app.get('/api/files/:id', async (c) => {
  owner(c);
  const f = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(c.req.param('id')).first<{ r2_key: string; mime: string; name: string }>();
  if (!f) throw new HttpError(404, 'not_found');
  const obj = await c.env.ORIGINALS.get(f.r2_key);
  if (!obj) throw new HttpError(404, 'object_missing');
  return new Response(obj.body, { headers: { 'content-type': f.mime, 'cache-control': 'private, no-store', 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'x-content-type-options': 'nosniff' } });
});
app.get('/api/files', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM files ORDER BY uploaded_at DESC LIMIT 200').all();
  return c.json({ files: results });
});

// ------------------------------------------------------------------ batches: stage, review, correct, approve
interface NewBatch { source: 'sheet' | 'photo' | 'manual'; file_id?: string; mapping_id?: string; sheet?: string; dataset: string; shift_date: string; total_rows: number; reading_mode?: string; config?: Record<string, unknown>; supersedes_batch_id?: string }
app.post('/api/batches', async (c) => {
  const me = owner(c);
  const b = await body<NewBatch>(c);
  need(['sheet', 'photo', 'manual'].includes(b.source), 'bad_source');
  need(DATE_RE.test(b.shift_date ?? ''), 'bad_date');
  need(/^(production|labour|receiving|waste|carryover|downtime|order|dispatch|invoice|credit|plan|mixed|custom:[a-z0-9_]{1,40})$/.test(b.dataset ?? ''), 'bad_dataset');
  need(Number.isInteger(b.total_rows) && b.total_rows > 0 && b.total_rows <= 20000, 'bad_total');
  need(!b.reading_mode || ['interval', 'cumulative', 'event'].includes(b.reading_mode), 'bad_mode');
  let duplicateOf: string | null = null;
  if (b.file_id) {
    const f = await c.env.DB.prepare('SELECT sha256 FROM files WHERE id = ?').bind(b.file_id).first<{ sha256: string }>();
    need(f, 'file_not_found');
    const d = await c.env.DB.prepare("SELECT b.id FROM batches b JOIN files f ON f.id = b.file_id WHERE f.sha256 = ? AND b.status = 'approved' AND COALESCE(b.sheet,'') = COALESCE(?, '') AND b.dataset = ? LIMIT 1").bind(f.sha256, b.sheet ?? null, b.dataset).first<{ id: string }>();
    duplicateOf = d?.id ?? null;
  }
  if (b.supersedes_batch_id) {
    const s = await c.env.DB.prepare("SELECT status FROM batches WHERE id = ?").bind(b.supersedes_batch_id).first<{ status: string }>();
    need(s?.status === 'approved', 'supersede_target_not_approved');
  }
  const id = uid();
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO batches(id, source, file_id, mapping_id, sheet, dataset, shift_date, status, total_rows, duplicate_of, supersedes_batch_id, reading_mode, config, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,'receiving',?,?,?,?,?,?,?)`).bind(id, b.source, b.file_id ?? null, b.mapping_id ?? null, b.sheet ?? null, b.dataset, b.shift_date, b.total_rows, duplicateOf, b.supersedes_batch_id ?? null, b.reading_mode ?? 'interval', JSON.stringify(b.config ?? {}), at, at),
    auditStmt(c.env, me.email, 'create', 'batch', id, { dataset: b.dataset, shift_date: b.shift_date, file_id: b.file_id, sheet: b.sheet, total_rows: b.total_rows }),
  ]);
  return c.json({ id, duplicate_of: duplicateOf });
});

app.post('/api/batches/:id/rows', async (c) => {
  owner(c);
  const id = c.req.param('id');
  const batch = await getBatch(c.env, id);
  need(batch.status === 'receiving', 'not_receiving');
  const b = await body<{ rows: { idx: number; source_ref?: string; raw: unknown; vals: RowVals }[] }>(c);
  need(Array.isArray(b.rows) && b.rows.length <= 500, 'bad_rows');
  const at = nowIso();
  const items = b.rows.map((r) => {
    need(Number.isInteger(r.idx) && r.idx >= 0 && r.idx < batch.total_rows, 'bad_idx');
    need(r.vals && Array.isArray(r.vals.measures) && typeof r.vals.dims === 'object', 'bad_vals');
    return { id: uid(), idx: r.idx, source_ref: r.source_ref ?? null, raw: JSON.stringify(r.raw ?? null), vals: JSON.stringify({ ...r.vals, attrs: r.vals.attrs ?? {} }) };
  });
  const stmts = jsonChunks(items).map((chunk) => c.env.DB.prepare(`INSERT INTO staged_rows(id, batch_id, idx, source_ref, raw, vals, updated_at)
    SELECT j.value->>'id', ?, j.value->>'idx', j.value->>'source_ref', j.value->>'raw', j.value->>'vals', ? FROM json_each(?) AS j WHERE true
    ON CONFLICT(batch_id, idx) DO UPDATE SET source_ref = excluded.source_ref, raw = excluded.raw, vals = excluded.vals, updated_at = excluded.updated_at`).bind(id, at, chunk));
  stmts.push(c.env.DB.prepare('UPDATE batches SET received_rows = (SELECT COUNT(*) FROM staged_rows WHERE batch_id = ?), updated_at = ? WHERE id = ?').bind(id, at, id));
  await c.env.DB.batch(stmts);
  const nb = await getBatch(c.env, id);
  if (nb.received_rows === nb.total_rows) {
    const { results } = await c.env.DB.prepare('SELECT vals FROM staged_rows WHERE batch_id = ?').bind(id).all<{ vals: string }>();
    await c.env.DB.prepare("UPDATE batches SET status = 'staged', content_hash = ?, updated_at = ? WHERE id = ? AND status = 'receiving'").bind(await contentHash(nb.dataset, nb.shift_date, results), nowIso(), id).run();
  }
  return c.json({ received: nb.received_rows, total: nb.total_rows });
});

app.get('/api/batches/:id/missing', async (c) => {
  owner(c);
  const id = c.req.param('id');
  const batch = await getBatch(c.env, id);
  const { results } = await c.env.DB.prepare('SELECT idx FROM staged_rows WHERE batch_id = ?').bind(id).all<{ idx: number }>();
  const have = new Set(results.map((r) => r.idx));
  const missing: number[] = [];
  for (let i = 0; i < batch.total_rows; i++) if (!have.has(i)) missing.push(i);
  return c.json({ batch, missing });
});

app.get('/api/batches', async (c) => {
  owner(c);
  const status = c.req.query('status');
  const { results } = await c.env.DB.prepare(`SELECT b.*, f.name AS file_name, f.sha256 AS file_sha256, (SELECT COUNT(*) FROM facts WHERE batch_id = b.id AND state = 'current') AS facts_current
    FROM batches b LEFT JOIN files f ON f.id = b.file_id ${status ? 'WHERE b.status = ?' : ''} ORDER BY b.created_at DESC LIMIT 200`).bind(...(status ? [status] : [])).all();
  return c.json({ batches: results });
});

app.get('/api/batches/:id', async (c) => {
  owner(c);
  return c.json(await reviewBatch(c.env, c.req.param('id')));
});

app.get('/api/batches/:id/edits', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM row_edits WHERE batch_id = ? ORDER BY at').bind(c.req.param('id')).all();
  return c.json({ edits: results });
});

app.patch('/api/batches/:id/rows/:rowId', async (c) => {
  const me = owner(c);
  const id = c.req.param('id');
  const batch = await getBatch(c.env, id);
  need(batch.status === 'staged', 'not_editable');
  const row = await c.env.DB.prepare('SELECT * FROM staged_rows WHERE id = ? AND batch_id = ?').bind(c.req.param('rowId'), id).first<{ vals: string; excluded: number; resolution: string | null; exclude_reason: string | null }>();
  if (!row) throw new HttpError(404, 'row_not_found');
  const b = await body<{ vals?: RowVals; excluded?: boolean; exclude_reason?: string; resolution?: 'supersede' | 'keep_both' | null; reason?: string }>(c);
  const at = nowIso();
  const edits: D1PreparedStatement[] = [];
  const log = (field: string, oldV: unknown, newV: unknown) => edits.push(c.env.DB.prepare('INSERT INTO row_edits(id, row_id, batch_id, field, old_value, new_value, reason, at, actor) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(uid(), c.req.param('rowId'), id, field, oldV === undefined ? null : JSON.stringify(oldV), newV === undefined ? null : JSON.stringify(newV), b.reason ?? '', at, me.email));
  let vals = JSON.parse(row.vals) as RowVals;
  if (b.vals) {
    need(Array.isArray(b.vals.measures) && typeof b.vals.dims === 'object', 'bad_vals');
    const o = vals;
    const n = b.vals;
    for (const k of new Set([...Object.keys(o.dims), ...Object.keys(n.dims)])) if ((o.dims as Record<string, string>)[k] !== (n.dims as Record<string, string>)[k]) log(k, (o.dims as Record<string, string>)[k], (n.dims as Record<string, string>)[k]);
    for (const k of ['date', 'time', 'start_time', 'end_time', 'unit', 'mode'] as const) if (o[k] !== n[k]) log(k, o[k], n[k]);
    const om = new Map(o.measures.map((m) => [measureKey(m), m]));
    for (const m of n.measures) { const p = om.get(measureKey(m)); if (!p || p.value !== m.value || p.unit !== m.unit) log(measureKey(m), p ? `${p.value} ${p.unit ?? ''}`.trim() : undefined, `${m.value} ${m.unit ?? ''}`.trim()); }
    if (JSON.stringify(o.confirmed ?? []) !== JSON.stringify(n.confirmed ?? [])) log('confirmed', o.confirmed ?? [], n.confirmed ?? []);
    // a value the owner typed is, by definition, confirmed by the owner (OCR confidence stays as recorded)
    const changed = new Set<string>(n.confirmed ?? []);
    for (const k of new Set([...Object.keys(o.dims), ...Object.keys(n.dims)])) if ((o.dims as Record<string, string>)[k] !== (n.dims as Record<string, string>)[k]) changed.add(k);
    for (const k of ['date', 'time', 'start_time', 'end_time'] as const) if (o[k] !== n[k]) changed.add(k);
    for (const m of n.measures) { const p = om.get(measureKey(m)); if (!p || p.value !== m.value) changed.add(measureKey(m)); }
    vals = { ...n, attrs: n.attrs ?? o.attrs ?? {}, conf: o.conf, confirmed: [...changed] };
  }
  const excluded = b.excluded === undefined ? row.excluded : b.excluded ? 1 : 0;
  if (excluded !== row.excluded) { need(!b.excluded || (b.exclude_reason ?? '').trim(), 'reason_required'); log('excluded', row.excluded === 1, excluded === 1); }
  const resolution = b.resolution === undefined ? row.resolution : b.resolution;
  if (resolution !== row.resolution) log('resolution', row.resolution, resolution);
  need(edits.length, 'no_change');
  edits.push(c.env.DB.prepare('UPDATE staged_rows SET vals = ?, excluded = ?, exclude_reason = ?, resolution = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(vals), excluded, excluded ? b.exclude_reason ?? row.exclude_reason : null, resolution, at, c.req.param('rowId')));
  edits.push(c.env.DB.prepare('UPDATE batches SET updated_at = ? WHERE id = ?').bind(at, id));
  await c.env.DB.batch(edits);
  return c.json(await reviewBatch(c.env, id));
});

app.post('/api/batches/:id/supersede', async (c) => {
  const me = owner(c);
  const id = c.req.param('id');
  const b = await body<{ target_batch_id: string | null }>(c);
  const batch = await getBatch(c.env, id);
  need(batch.status === 'staged', 'not_editable');
  if (b.target_batch_id) {
    const t = await getBatch(c.env, b.target_batch_id);
    need(t.status === 'approved' && t.dataset === batch.dataset && t.id !== id, 'bad_target');
  }
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE batches SET supersedes_batch_id = ?, updated_at = ? WHERE id = ?').bind(b.target_batch_id, nowIso(), id),
    auditStmt(c.env, me.email, 'set_supersedes', 'batch', id, b),
  ]);
  return c.json(await reviewBatch(c.env, id));
});

app.post('/api/batches/:id/approve', async (c) => {
  const me = owner(c);
  const b = await body<{ acknowledge?: boolean; expect_updated_at?: string }>(c);
  const r = await approveBatch(c.env, c.req.param('id'), me.email, { acknowledge: b.acknowledge, expectUpdatedAt: b.expect_updated_at });
  return c.json(r);
});

app.post('/api/batches/:id/reject', async (c) => {
  const me = owner(c);
  const b = await body<{ reason: string }>(c);
  need((b.reason ?? '').trim(), 'reason_required');
  const id = c.req.param('id');
  const batch = await getBatch(c.env, id);
  need(['receiving', 'staged'].includes(batch.status), 'not_rejectable');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE batches SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ? AND status IN ('receiving','staged')").bind(b.reason.trim(), nowIso(), id),
    auditStmt(c.env, me.email, 'reject', 'batch', id, b),
  ]);
  return c.json({ ok: true });
});

// A timestamped update typed on the phone during the shift: staged like any import, then approved.
app.post('/api/quick', async (c) => {
  const me = owner(c);
  const b = await body<{ shift_date: string; dataset: string; mode: 'interval' | 'cumulative'; time: string; shift_start?: string; dims: RowVals['dims']; measures: RowVals['measures']; start_time?: string; end_time?: string }>(c);
  need(DATE_RE.test(b.shift_date ?? ''), 'bad_date');
  need(['production', 'labour', 'waste', 'downtime', 'dispatch', 'receiving', 'carryover'].includes(b.dataset), 'bad_dataset');
  need(Array.isArray(b.measures), 'bad_measures');
  const id = uid();
  const at = nowIso();
  const vals: RowVals = { dims: b.dims ?? {}, time: b.time, start_time: b.start_time, end_time: b.end_time, mode: b.dataset === 'production' ? b.mode : undefined, measures: b.measures.map((m) => ({ ...m, role: 'actual' as const })), attrs: {} };
  const rowsJson = JSON.stringify(vals);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO batches(id, source, dataset, shift_date, status, total_rows, received_rows, reading_mode, config, content_hash, created_at, updated_at) VALUES (?,?,?,?,'staged',1,1,?,?,?,?,?)`)
      .bind(id, 'manual', b.dataset, b.shift_date, b.mode === 'cumulative' ? 'cumulative' : 'interval', JSON.stringify({ shift_start: b.shift_start ?? '00:00' }), await contentHash(b.dataset, b.shift_date, [{ vals: rowsJson }]), at, at),
    c.env.DB.prepare('INSERT INTO staged_rows(id, batch_id, idx, source_ref, raw, vals, updated_at) VALUES (?,?,0,?,?,?,?)').bind(uid(), id, `manual:${at}`, JSON.stringify(b), rowsJson, at),
    auditStmt(c.env, me.email, 'create', 'batch', id, { source: 'manual', dataset: b.dataset }),
  ]);
  return c.json(await reviewBatch(c.env, id));
});

// ------------------------------------------------------------------ approved records (drill-down)
app.post('/api/facts/query', async (c) => {
  const me = c.get('me');
  const b = await body<{ ids?: string[]; dataset?: string; from?: string; to?: string; q?: string; sort?: string; dir?: 'asc' | 'desc'; offset?: number; limit?: number; batch_id?: string; include_superseded?: boolean }>(c);
  const where: string[] = [];
  const binds: unknown[] = [];
  if (!(b.include_superseded && me.role === 'owner')) where.push("state = 'current'");
  if (b.ids) {
    need(Array.isArray(b.ids) && b.ids.length <= 5000, 'bad_ids');
    where.push('id IN (SELECT value FROM json_each(?))');
    binds.push(JSON.stringify(b.ids));
  }
  if (b.dataset) { where.push('dataset = ?'); binds.push(b.dataset); }
  if (b.batch_id && me.role === 'owner') { where.push('batch_id = ?'); binds.push(b.batch_id); }
  if (b.from) { where.push('shift_date >= ?'); binds.push(b.from); }
  if (b.to) { where.push('shift_date <= ?'); binds.push(b.to); }
  if (b.q) {
    const cols = ['line', 'product', 'grade', 'lot', 'customer', 'order_ref', 'reason', 'doc_no', 'metric', 'unit', 'dataset', ...(me.show_workers ? ['worker'] : [])];
    where.push(`(${cols.map((x) => `${x} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) binds.push(`%${b.q}%`);
  }
  const SORTS = ['shift_date', 'at_ms', 'line', 'product', 'grade', 'lot', 'qty', 'dataset', 'metric', 'customer', 'approved_at'];
  const sort = SORTS.includes(b.sort ?? '') ? b.sort : 'shift_date';
  const dir = b.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(b.limit ?? 50, 1), 200);
  const offset = Math.max(b.offset ?? 0, 0);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM facts ${w} ORDER BY ${sort} ${dir}, at_ms DESC, id LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM facts ${w}`).bind(...binds).first<{ n: number }>(),
  ]);
  const out = (rows.results as unknown as FactRow[]).map((r) => {
    const f = rowToFact(r) as unknown as Record<string, unknown>;
    if (!me.show_workers) f.worker = f.worker ? '•••' : null;
    if (me.role !== 'owner') { delete f.row_id; }
    return f;
  });
  return c.json({ rows: out, total: count?.n ?? 0, offset, limit });
});

// ------------------------------------------------------------------ plans
interface VersionRow { id: string; plan_id: string; n: number; status: string; data: string; effective_at: string | null; reason: string | null; published_at: string | null; created_at: string; updated_at: string; based_on: string | null }
async function planFor(env: Env, date: string) {
  return env.DB.prepare('SELECT * FROM plans WHERE shift_date = ?').bind(date).first<{ id: string; shift_date: string }>();
}
app.get('/api/plans', async (c) => {
  const me = c.get('me');
  const date = c.req.query('date') ?? '';
  need(DATE_RE.test(date), 'bad_date');
  const plan = await planFor(c.env, date);
  if (!plan) return c.json({ plan: null, versions: [] });
  const { results } = await c.env.DB.prepare(`SELECT * FROM plan_versions WHERE plan_id = ? ${me.role === 'owner' ? '' : "AND status = 'published'"} ORDER BY n`).bind(plan.id).all<VersionRow>();
  return c.json({ plan, versions: results.map((v) => ({ ...v, data: JSON.parse(v.data) })) });
});
app.get('/api/plans/recent', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare("SELECT p.shift_date, MAX(v.n) AS n FROM plans p JOIN plan_versions v ON v.plan_id = p.id AND v.status = 'published' GROUP BY p.shift_date ORDER BY p.shift_date DESC LIMIT 30").all();
  return c.json({ plans: results });
});

app.post('/api/plans/draft', async (c) => {
  const me = owner(c);
  const b = await body<{ date: string; from: 'empty' | 'current' | 'date'; source_date?: string; shift_start?: string }>(c);
  need(DATE_RE.test(b.date ?? ''), 'bad_date');
  const at = nowIso();
  let plan = await planFor(c.env, b.date);
  const stmts: D1PreparedStatement[] = [];
  if (!plan) {
    plan = { id: uid(), shift_date: b.date };
    stmts.push(c.env.DB.prepare('INSERT INTO plans(id, shift_date, created_at) VALUES (?,?,?)').bind(plan.id, b.date, at));
  }
  const versions = (await c.env.DB.prepare('SELECT * FROM plan_versions WHERE plan_id = ? ORDER BY n').bind(plan.id).all<VersionRow>()).results;
  const draft = versions.find((v) => v.status === 'draft');
  if (draft) return c.json({ id: draft.id, existing: true });
  const published = versions.filter((v) => v.status === 'published');
  let data: PlanData = emptyPlan(b.shift_start ?? String((await settings(c.env)).default_shift_start ?? '06:00'));
  let basedOn: string | null = null;
  if (b.from === 'current') {
    const cur = published[published.length - 1];
    need(cur, 'nothing_published');
    data = JSON.parse(cur.data);
    basedOn = cur.id;
  } else if (b.from === 'date') {
    need(DATE_RE.test(b.source_date ?? ''), 'bad_source_date');
    const sp = await planFor(c.env, b.source_date!);
    const sv = sp && (await c.env.DB.prepare("SELECT * FROM plan_versions WHERE plan_id = ? AND status = 'published' ORDER BY n DESC LIMIT 1").bind(sp.id).first<VersionRow>());
    need(sv, 'source_has_no_published_plan');
    data = shiftPlan(JSON.parse(sv.data), b.source_date!, b.date, uid);
  }
  const id = uid();
  const n = (versions[versions.length - 1]?.n ?? 0) + 1;
  stmts.push(c.env.DB.prepare("INSERT INTO plan_versions(id, plan_id, n, status, data, based_on, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?)").bind(id, plan.id, n, JSON.stringify(data), basedOn, at, at));
  stmts.push(auditStmt(c.env, me.email, 'create_draft', 'plan_version', id, { date: b.date, from: b.from, source_date: b.source_date, n }));
  await c.env.DB.batch(stmts);
  return c.json({ id, n });
});

app.put('/api/plans/versions/:id', async (c) => {
  const me = owner(c);
  const b = await body<{ data: PlanData; updated_at?: string }>(c);
  const v = await c.env.DB.prepare('SELECT * FROM plan_versions WHERE id = ?').bind(c.req.param('id')).first<VersionRow>();
  if (!v) throw new HttpError(404, 'not_found');
  need(v.status === 'draft', 'not_a_draft');
  if (b.updated_at && b.updated_at !== v.updated_at) throw new HttpError(409, 'draft_changed');
  const issues = validatePlan(b.data, false).filter((i) => i.severity === 'block');
  need(!issues.length, 'invalid_plan', issues);
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE plan_versions SET data = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(JSON.stringify(b.data), at, v.id),
    auditStmt(c.env, me.email, 'save_draft', 'plan_version', v.id, { jobs: b.data.jobs.length, sales: b.data.sales.length }),
  ]);
  return c.json({ ok: true, updated_at: at });
});

app.post('/api/plans/versions/:id/publish', async (c) => {
  const me = owner(c);
  const b = await body<{ effective_at?: string; reason?: string }>(c);
  const v = await c.env.DB.prepare('SELECT * FROM plan_versions WHERE id = ?').bind(c.req.param('id')).first<VersionRow>();
  if (!v) throw new HttpError(404, 'not_found');
  need(v.status === 'draft', 'not_a_draft');
  const { units } = await refCodes(c.env);
  const issues = validatePlan(JSON.parse(v.data), true, units).filter((i) => i.severity === 'block');
  need(!issues.length, 'invalid_plan', issues);
  const prior = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM plan_versions WHERE plan_id = ? AND status = 'published'").bind(v.plan_id).first<{ n: number }>();
  const isRevision = (prior?.n ?? 0) > 0;
  if (isRevision) {
    need(b.effective_at && !Number.isNaN(Date.parse(b.effective_at)), 'effective_at_required');
    need((b.reason ?? '').trim(), 'reason_required');
  }
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE plan_versions SET status = 'published', published_at = ?, effective_at = ?, reason = ?, updated_at = ? WHERE id = ? AND status = 'draft'")
      .bind(at, isRevision ? new Date(b.effective_at!).toISOString() : null, isRevision ? b.reason!.trim() : null, at, v.id),
    auditStmt(c.env, me.email, isRevision ? 'publish_revision' : 'publish_baseline', 'plan_version', v.id, { effective_at: b.effective_at, reason: b.reason, n: v.n }),
    bumpVersionStmt(c.env),
  ]);
  return c.json({ ok: true, revision: isRevision });
});

app.post('/api/plans/versions/:id/discard', async (c) => {
  const me = owner(c);
  const v = await c.env.DB.prepare('SELECT status FROM plan_versions WHERE id = ?').bind(c.req.param('id')).first<{ status: string }>();
  need(v?.status === 'draft', 'not_a_draft');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE plan_versions SET status = 'discarded', updated_at = ? WHERE id = ? AND status = 'draft'").bind(nowIso(), c.req.param('id')),
    auditStmt(c.env, me.email, 'discard_draft', 'plan_version', c.req.param('id')),
  ]);
  return c.json({ ok: true });
});

// Plan rows imported from a reviewed sheet or photo become jobs in the date's draft.
app.post('/api/batches/:id/to-plan', async (c) => {
  const me = owner(c);
  const rv = await reviewBatch(c.env, c.req.param('id'));
  need(rv.batch.status === 'staged', 'not_staged');
  const cfg = JSON.parse(rv.batch.config || '{}') as { shift_start?: string };
  const shiftStart = cfg.shift_start ?? '06:00';
  const st = await settings(c.env);
  const tz = String(st.timezone ?? 'Asia/Amman');
  const { units } = await refCodes(c.env);
  const jobs: PlanJob[] = [];
  const problems: { idx: number; code: string }[] = [];
  for (const r of rv.rows.filter((x) => !x.excluded)) {
    const v = r.vals;
    const st0 = parseTimeText(v.start_time);
    const en0 = parseTimeText(v.end_time);
    const target = v.measures.find((m) => m.metric === 'target' || m.role === 'plan');
    const crew = v.measures.find((m) => m.metric === 'crew');
    const tq = target ? parseQuantity(target.value) : null;
    const unit = target?.unit || v.unit || '';
    if (!v.dims.line || !v.dims.product || !st0 || !en0 || !tq?.milli || !units.has(unit)) { problems.push({ idx: r.idx, code: 'incomplete_plan_row' }); continue; }
    if (r.issues.some((i) => i.code === 'uncertain_ocr' || i.code === 'ambiguous_number')) { problems.push({ idx: r.idx, code: 'unconfirmed_value' }); continue; }
    const s = shiftTimeToUtcMs(rv.batch.shift_date, st0, shiftStart, tz);
    let e = shiftTimeToUtcMs(rv.batch.shift_date, en0, shiftStart, tz);
    if (e <= s) e += 86400000;
    const cq = crew ? parseQuantity(crew.value) : null;
    jobs.push({ id: uid(), line: v.dims.line, product: v.dims.product, grade: v.dims.grade || null, customer: v.dims.customer || null, order_ref: v.dims.order_ref || null, start: new Date(s).toISOString(), end: new Date(e).toISOString(), target: tq.milli, unit, crew: cq?.milli ? Math.round(cq.milli / 1000) : 0 });
  }
  need(!problems.length, 'plan_rows_incomplete', problems);
  let plan = await planFor(c.env, rv.batch.shift_date);
  const at = nowIso();
  const stmts: D1PreparedStatement[] = [];
  if (!plan) { plan = { id: uid(), shift_date: rv.batch.shift_date }; stmts.push(c.env.DB.prepare('INSERT INTO plans(id, shift_date, created_at) VALUES (?,?,?)').bind(plan.id, plan.shift_date, at)); }
  const versions = (await c.env.DB.prepare('SELECT * FROM plan_versions WHERE plan_id = ? ORDER BY n').bind(plan.id).all<VersionRow>()).results;
  const draft = versions.find((v) => v.status === 'draft');
  let draftId: string;
  if (draft) {
    const d = JSON.parse(draft.data) as PlanData;
    d.jobs.push(...jobs);
    draftId = draft.id;
    stmts.push(c.env.DB.prepare("UPDATE plan_versions SET data = ?, updated_at = ? WHERE id = ? AND status = 'draft'").bind(JSON.stringify(d), at, draft.id));
  } else {
    const lastPub = versions.filter((v) => v.status === 'published').pop();
    const d: PlanData = lastPub ? JSON.parse(lastPub.data) : emptyPlan(shiftStart);
    d.jobs.push(...jobs);
    draftId = uid();
    stmts.push(c.env.DB.prepare("INSERT INTO plan_versions(id, plan_id, n, status, data, based_on, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?)").bind(draftId, plan.id, (versions[versions.length - 1]?.n ?? 0) + 1, JSON.stringify(d), lastPub?.id ?? null, at, at));
  }
  stmts.push(c.env.DB.prepare("UPDATE batches SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'staged'").bind(at, at, rv.batch.id));
  stmts.push(auditStmt(c.env, me.email, 'import_to_plan', 'plan_version', draftId, { batch: rv.batch.id, jobs: jobs.length }));
  await c.env.DB.batch(stmts);
  return c.json({ draft_id: draftId, jobs: jobs.length });
});

// ------------------------------------------------------------------ dashboard
function dashQuery(c: C): DashFilters {
  const q = c.req.query();
  need(DATE_RE.test(q.date ?? ''), 'bad_date');
  if (q.from) need(DATE_RE.test(q.from) && DATE_RE.test(q.to ?? ''), 'bad_range');
  return { date: q.date, compare: q.compare === 'baseline' ? 'baseline' : 'current', line: q.line || undefined, product: q.product || undefined, grade: q.grade || undefined, customer: q.customer || undefined, from: q.from || undefined, to: q.to || undefined };
}
app.get('/api/dashboard', async (c) => {
  const me = c.get('me');
  const nowQ = c.req.query('now');
  const now = nowQ && c.env.AUTH_MODE === 'dev' ? Date.parse(nowQ) : undefined; // fixed clock for local tests only
  return c.json(await buildDashboard(c.env, dashQuery(c), { showWorkers: me.show_workers, now }));
});

// ------------------------------------------------------------------ access management
app.get('/api/access', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM access_grants ORDER BY revoked_at IS NOT NULL, granted_at DESC').all();
  return c.json({ grants: results, owner: c.env.OWNER_EMAIL });
});
app.post('/api/access', async (c) => {
  const me = owner(c);
  const b = await body<{ email: string; display_name?: string; show_workers?: boolean }>(c);
  const email = (b.email ?? '').trim().toLowerCase();
  need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'bad_email');
  need(email !== (c.env.OWNER_EMAIL ?? '').toLowerCase(), 'is_owner');
  const at = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO access_grants(email, display_name, show_workers, granted_at) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, show_workers = excluded.show_workers, granted_at = excluded.granted_at, revoked_at = NULL')
      .bind(email, (b.display_name ?? '').trim(), b.show_workers ? 1 : 0, at),
    auditStmt(c.env, me.email, 'grant', 'access', email, { show_workers: !!b.show_workers }),
  ]);
  return c.json({ ok: true });
});
app.patch('/api/access/:email', async (c) => {
  const me = owner(c);
  const email = decodeURIComponent(c.req.param('email')).toLowerCase();
  const b = await body<{ revoke?: boolean; show_workers?: boolean }>(c);
  const stmts: D1PreparedStatement[] = [];
  if (b.revoke) stmts.push(c.env.DB.prepare('UPDATE access_grants SET revoked_at = ? WHERE email = ? AND revoked_at IS NULL').bind(nowIso(), email));
  if (b.show_workers !== undefined) stmts.push(c.env.DB.prepare('UPDATE access_grants SET show_workers = ? WHERE email = ?').bind(b.show_workers ? 1 : 0, email));
  need(stmts.length, 'no_change');
  stmts.push(auditStmt(c.env, me.email, b.revoke ? 'revoke' : 'update', 'access', email, b));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ frozen snapshots
function b64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
app.post('/api/snapshots', async (c) => {
  const me = owner(c);
  const b = await body<{ title: string; filters: DashFilters; sections: string[]; expires_at: string; recipients?: string[]; include_workers?: boolean }>(c);
  need((b.title ?? '').trim(), 'title_required');
  need(b.expires_at && Date.parse(b.expires_at) > Date.now(), 'bad_expiry');
  need(Array.isArray(b.sections) && b.sections.length, 'sections_required');
  const recipients = (b.recipients ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  need(recipients.every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)), 'bad_email');
  need(DATE_RE.test(b.filters?.date ?? ''), 'bad_date');
  const dash = await buildDashboard(c.env, { ...b.filters, compare: b.filters.compare === 'baseline' ? 'baseline' : 'current' }, { showWorkers: !!b.include_workers });
  const ids = [...new Set(JSON.stringify(dash).match(/"factIds":\[[^\]]*\]/g)?.flatMap((m) => JSON.parse(m.slice(10)) as string[]) ?? [])];
  const facts: Record<string, unknown>[] = [];
  for (const chunk of jsonChunks(ids, 200_000)) {
    const { results } = await c.env.DB.prepare('SELECT * FROM facts WHERE id IN (SELECT value FROM json_each(?))').bind(chunk).all();
    for (const r of results as unknown as FactRow[]) { const f = rowToFact(r) as unknown as Record<string, unknown>; if (!b.include_workers) f.worker = f.worker ? '•••' : null; delete f.row_id; facts.push(f); }
  }
  const token = b64url(crypto.getRandomValues(new Uint8Array(24)));
  const id = uid();
  const data = { dashboard: dash, facts, sections: b.sections, frozen_at: nowIso() };
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO snapshots(id, token_hash, title, recipients, params, data, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, await sha256Hex(token), b.title.trim(), JSON.stringify(recipients), JSON.stringify({ filters: b.filters, sections: b.sections }), JSON.stringify(data), nowIso(), new Date(b.expires_at).toISOString()),
    auditStmt(c.env, me.email, 'create', 'snapshot', id, { title: b.title, expires_at: b.expires_at, recipients, sections: b.sections }),
  ]);
  return c.json({ id, token, path: `/s/${token}` });
});
app.get('/api/snapshots', async (c) => {
  owner(c);
  const { results } = await c.env.DB.prepare('SELECT id, title, recipients, params, created_at, expires_at, revoked_at FROM snapshots ORDER BY created_at DESC').all();
  return c.json({ snapshots: results });
});
app.post('/api/snapshots/:id/revoke', async (c) => {
  const me = owner(c);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE snapshots SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(), c.req.param('id')),
    auditStmt(c.env, me.email, 'revoke', 'snapshot', c.req.param('id')),
  ]);
  return c.json({ ok: true });
});
app.get('/api/s/:token', async (c) => {
  const email = c.get('me').email;
  const s = await c.env.DB.prepare('SELECT * FROM snapshots WHERE token_hash = ?').bind(await sha256Hex(c.req.param('token'))).first<{ title: string; recipients: string; data: string; expires_at: string; revoked_at: string | null; created_at: string }>();
  if (!s) throw new HttpError(404, 'snapshot_not_found');
  if (s.revoked_at) throw new HttpError(410, 'snapshot_revoked');
  if (Date.parse(s.expires_at) <= Date.now()) throw new HttpError(410, 'snapshot_expired');
  const rec = JSON.parse(s.recipients) as string[];
  const isOwner = email === (c.env.OWNER_EMAIL ?? '').toLowerCase();
  if (rec.length && !rec.includes(email) && !isOwner) throw new HttpError(403, 'not_a_recipient');
  return c.json({ title: s.title, created_at: s.created_at, expires_at: s.expires_at, ...JSON.parse(s.data) });
});

// ------------------------------------------------------------------ audit, backups, export
app.get('/api/audit', async (c) => {
  owner(c);
  const before = Number(c.req.query('before') ?? '0') || Number.MAX_SAFE_INTEGER;
  const entity = c.req.query('entity_id');
  const { results } = await c.env.DB.prepare(`SELECT * FROM audit_log WHERE id < ? ${entity ? 'AND entity_id = ?' : ''} ORDER BY id DESC LIMIT 100`).bind(before, ...(entity ? [entity] : [])).all();
  return c.json({ entries: results });
});
app.get('/api/backups', async (c) => {
  owner(c);
  const [runs, tests] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 40').all(),
    c.env.DB.prepare('SELECT * FROM restore_tests ORDER BY started_at DESC LIMIT 20').all(),
  ]);
  const last = await c.env.DB.prepare("SELECT * FROM backup_runs WHERE status = 'succeeded' ORDER BY started_at DESC LIMIT 1").first();
  return c.json({ runs: runs.results, tests: tests.results, last_success: last ?? null });
});
app.post('/api/backups/run', async (c) => {
  const me = owner(c);
  const m = await runBackup(c.env, 'owner');
  await auditStmt(c.env, me.email, 'backup', 'backup_run', m.id, { tables: m.tables.length, originals: m.originals.length }).run();
  return c.json({ id: m.id, tables: m.tables.map(({ name, rows }) => ({ name, rows })), originals: m.originals.length });
});
app.post('/api/backups/:id/rehearse', async (c) => {
  const me = owner(c);
  const r = await rehearseRestore(c.env, c.req.param('id'));
  await auditStmt(c.env, me.email, 'restore_rehearsal', 'backup_run', c.req.param('id'), { passed: r.passed }).run();
  return c.json(r);
});
app.get('/api/export.zip', async (c) => {
  const me = owner(c);
  const z = await exportZip(c.env, c.req.query('originals') === '1');
  await auditStmt(c.env, me.email, 'export', 'all', null, { originals: c.req.query('originals') === '1', bytes: z.length }).run();
  return new Response(z as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="shift-ops-export-${new Date().toISOString().slice(0, 10)}.zip"`, 'cache-control': 'no-store' } });
});

// ------------------------------------------------------------------ optional Workers AI second pass (off by default)
app.post('/api/ai/transcribe', async (c) => {
  const me = owner(c);
  const st = await settings(c.env);
  if (st.ai_enabled !== true) throw new HttpError(403, 'ai_disabled');
  if (!c.env.AI) throw new HttpError(501, 'ai_binding_missing');
  const month = new Date().toISOString().slice(0, 7);
  const limit = Number(st.ai_monthly_call_limit ?? 0);
  const used = await c.env.DB.prepare('SELECT calls FROM ai_usage WHERE month = ?').bind(month).first<{ calls: number }>();
  if ((used?.calls ?? 0) >= limit) throw new HttpError(429, 'ai_limit_reached', { used: used?.calls ?? 0, limit });
  const b = await body<{ file_id: string }>(c);
  const f = await c.env.DB.prepare("SELECT * FROM files WHERE id = ? AND kind = 'image'").bind(b.file_id).first<{ r2_key: string; mime: string }>();
  need(f, 'file_not_found');
  need(['image/jpeg', 'image/png'].includes(f.mime), 'ai_needs_jpeg_or_png');
  const obj = await c.env.ORIGINALS.get(f.r2_key);
  if (!obj) throw new HttpError(404, 'object_missing');
  const bytes = new Uint8Array(await obj.arrayBuffer());
  // count the call before making it, so a failure cannot exceed the owner's limit
  await c.env.DB.prepare('INSERT INTO ai_usage(month, calls) VALUES (?,1) ON CONFLICT(month) DO UPDATE SET calls = calls + 1').bind(month).run();
  const model = '@cf/meta/llama-3.2-11b-vision-instruct';
  const prompt = 'Transcribe this packing-house report exactly. Return only rows of text, one table row per line, cells separated by " | ". Write "?" for any character you cannot read. Do not guess or calculate.';
  const ask = () => c.env.AI!.run(model, { image: [...bytes], prompt, max_tokens: 1500 });
  let out: unknown;
  try { out = await ask(); } catch (e) {
    if (!String(e).toLowerCase().includes('agree')) throw e;
    await c.env.AI.run(model, { prompt: 'agree' });
    out = await ask();
  }
  await auditStmt(c.env, me.email, 'ai_transcribe', 'file', b.file_id, { model, month }).run();
  return c.json({ text: (out as { response?: string }).response ?? '', model, calls_used: (used?.calls ?? 0) + 1, limit });
});

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runBackup(env, 'cron').then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
