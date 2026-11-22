// Batch review and approval. Review is recomputed from staged rows plus the current approved facts every time,
// so what the owner sees is what approval will check. Approval is one atomic D1 batch: either every fact of
// the batch is published (and anything it supersedes is retired) or nothing changes.
import type { Env } from './env';
import { HttpError, auditStmt, bumpVersionStmt, closedLots, conversions, currentFacts, jsonChunks, nowIso, refCodes, settings, uid } from './db';
import { blocking, validateRow, type FactDraft, type Issue, type RowVals } from '../shared/rows';
import { reconcileLots, type LotReconciliation } from '../shared/calc';
import { formatMilli } from '../shared/num';
import type { Fact } from '../shared/types';

export interface BatchRow {
  id: string; batch_id: string; idx: number; source_ref: string | null; raw: string; vals: string; excluded: number; exclude_reason: string | null;
  resolution: 'supersede' | 'keep_both' | null; updated_at: string;
}
export interface Batch {
  id: string; source: string; file_id: string | null; mapping_id: string | null; sheet: string | null; dataset: string; shift_date: string;
  status: string; total_rows: number; received_rows: number; content_hash: string | null; duplicate_of: string | null;
  supersedes_batch_id: string | null; superseded_by: string | null; reading_mode: Fact['mode']; config: string; note: string;
  created_at: string; updated_at: string; approved_at: string | null; reject_reason: string | null;
}

export async function getBatch(env: Env, id: string): Promise<Batch> {
  const b = await env.DB.prepare('SELECT * FROM batches WHERE id = ?').bind(id).first<Batch>();
  if (!b) throw new HttpError(404, 'batch_not_found');
  return b;
}

export interface ReviewedRow {
  id: string; idx: number; source_ref: string | null; vals: RowVals; raw: unknown; excluded: boolean; exclude_reason: string | null;
  resolution: BatchRow['resolution']; issues: Issue[]; drafts: FactDraft[];
}
export interface Review {
  batch: Batch;
  rows: ReviewedRow[];
  lots: LotReconciliation[];
  batchIssues: Issue[];
  counts: { rows: number; excluded: number; blocked: number; review: number; warn: number; facts: number };
  diff: { added: number; removed: number; changed: number; same: number; changes: { key: string; before: string | null; after: string | null }[] } | null;
  canApprove: boolean;
  needsAck: boolean;
}

/** Stable hash of a batch's normalized content: detects renamed or re-saved copies of the same report. */
export async function contentHash(dataset: string, shiftDate: string, rows: { vals: string }[]): Promise<string> {
  const norm = rows.map((r) => r.vals).sort().join('\n');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${dataset}\n${shiftDate}\n${norm}`));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function reviewBatch(env: Env, id: string): Promise<Review> {
  const batch = await getBatch(env, id);
  const { results: rows } = await env.DB.prepare('SELECT * FROM staged_rows WHERE batch_id = ? ORDER BY idx').bind(id).all<BatchRow>();
  const st = await settings(env);
  const cfg = JSON.parse(batch.config || '{}') as { shift_start?: string; default_time?: string; ocr_threshold?: number };
  const { by, units } = await refCodes(env);
  const ctx = {
    dataset: batch.dataset, shiftDate: batch.shift_date, shiftStart: cfg.shift_start ?? '00:00', tz: String(st.timezone ?? env.TIMEZONE ?? 'Asia/Amman'),
    defaultTime: cfg.default_time ?? null, defaultMode: batch.reading_mode, knownUnits: units,
    knownCodes: { line: by.line, product: by.product, grade: by.grade, customer: by.customer }, ocrThreshold: cfg.ocr_threshold ?? 80,
  };
  const reviewed: ReviewedRow[] = rows.map((r) => {
    const vals = JSON.parse(r.vals) as RowVals;
    const { issues, drafts } = validateRow(vals, ctx, r.source_ref);
    return { id: r.id, idx: r.idx, source_ref: r.source_ref, vals, raw: JSON.parse(r.raw), excluded: r.excluded === 1, exclude_reason: r.exclude_reason, resolution: r.resolution, issues, drafts };
  });
  const batchIssues: Issue[] = [];
  if (batch.status === 'receiving') batchIssues.push({ code: 'incomplete_upload', severity: 'block', expected: String(batch.total_rows), reported: String(batch.received_rows) });

  // Same file or same content already imported.
  if (batch.duplicate_of) batchIssues.push({ code: 'duplicate_file', severity: 'block', ref: batch.duplicate_of });
  if (batch.content_hash) {
    const dup = await env.DB.prepare("SELECT id FROM batches WHERE content_hash = ? AND id <> ? AND status = 'approved' LIMIT 1").bind(batch.content_hash, id).first<{ id: string }>();
    if (dup && dup.id !== batch.duplicate_of) batchIssues.push({ code: 'duplicate_content', severity: 'block', ref: dup.id });
  }

  // Overlaps with current approved facts from other batches (manual entries, photos, sheets alike).
  const live = reviewed.filter((r) => !r.excluded);
  const keys = [...new Set(live.flatMap((r) => r.drafts.map((d) => d.natural_key)))];
  const existing = new Map<string, Array<{ id: string; batch_id: string; qty: number; unit: string }>>();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT id, batch_id, natural_key, qty, unit FROM facts WHERE state = 'current' AND batch_id <> ? AND natural_key IN (${part.map(() => '?').join(',')})`)
      .bind(id, ...part).all<{ id: string; batch_id: string; natural_key: string; qty: number; unit: string }>();
    for (const f of results) existing.set(f.natural_key, [...(existing.get(f.natural_key) ?? []), f]);
  }
  const seen = new Map<string, number>();
  for (const r of live) {
    for (const d of r.drafts) {
      const prevIdx = seen.get(d.natural_key);
      if (prevIdx !== undefined) r.issues.push({ code: 'duplicate_in_batch', severity: 'block', field: d.metric, ref: String(prevIdx) });
      seen.set(d.natural_key, r.idx);
      const ex = (existing.get(d.natural_key) ?? []).filter((e) => e.batch_id !== batch.supersedes_batch_id);
      for (const e of ex) {
        const same = e.qty === d.qty && e.unit === d.unit;
        if (r.resolution === 'supersede' || (r.resolution === 'keep_both' && !same)) continue;
        r.issues.push({
          code: same ? 'already_approved' : 'conflicts_with_approved', severity: 'block', field: `${d.dataset}.${d.metric}`, ref: e.batch_id,
          expected: `${formatMilli(e.qty)} ${e.unit}`, reported: `${formatMilli(d.qty)} ${d.unit}`, difference: same ? '0' : formatMilli(d.qty - e.qty),
        });
      }
    }
  }

  // Lot reconciliation: this batch's facts plus current facts for the same lots, minus what it would supersede.
  const lotsTouched = new Set(live.flatMap((r) => r.drafts.map((d) => d.lot).filter((x): x is string => !!x)));
  let lots: LotReconciliation[] = [];
  if (lotsTouched.size) {
    const convs = await conversions(env);
    const closed = await closedLots(env);
    const supersededKeys = new Set(live.filter((r) => r.resolution === 'supersede').flatMap((r) => r.drafts.map((d) => d.natural_key)));
    const others = (await currentFacts(env)).filter((f) => f.lot && lotsTouched.has(f.lot) && f.batch_id !== id && f.batch_id !== batch.supersedes_batch_id && !supersededKeys.has(f.natural_key));
    const mine: Fact[] = live.flatMap((r) => r.drafts.map((d, k) => ({ ...d, id: `${r.id}:${k}`, batch_id: id, source_ref: r.source_ref })));
    lots = reconcileLots([...others, ...mine], { convs, closedLots: closed, tolAbsKg: Number(st.lot_tol_abs_kg ?? 0), tolPct: Number(st.lot_tol_pct ?? 0) });
    for (const l of lots) {
      if (l.missingConversion) batchIssues.push({ code: 'lot_conversion_missing', severity: 'review', detail: l.lot });
      if (!l.flagged) continue;
      batchIssues.push({
        code: 'lot_gap', severity: 'review', detail: l.lot,
        expected: formatMilli(l.input!), reported: formatMilli(l.output!), difference: formatMilli(l.gap!),
        source_ref: l.sources.map((s) => `${s.role}:${s.source_ref ?? s.factId}`).join(' · '),
      });
    }
  }

  // Compare with the batch this one revises.
  let diff: Review['diff'] = null;
  if (batch.supersedes_batch_id) {
    const { results: old } = await env.DB.prepare("SELECT natural_key, qty, unit FROM facts WHERE batch_id = ? AND state = 'current'").bind(batch.supersedes_batch_id).all<{ natural_key: string; qty: number; unit: string }>();
    const before = new Map(old.map((o) => [o.natural_key, `${formatMilli(o.qty)} ${o.unit}`]));
    const after = new Map(live.flatMap((r) => r.drafts.map((d) => [d.natural_key, `${formatMilli(d.qty)} ${d.unit}`] as const)));
    diff = { added: 0, removed: 0, changed: 0, same: 0, changes: [] };
    for (const [k, v] of after) {
      const b = before.get(k);
      if (b === undefined) { diff.added++; diff.changes.push({ key: k, before: null, after: v }); }
      else if (b !== v) { diff.changed++; diff.changes.push({ key: k, before: b, after: v }); }
      else diff.same++;
    }
    for (const [k, v] of before) if (!after.has(k)) { diff.removed++; diff.changes.push({ key: k, before: v, after: null }); }
  }

  const counts = { rows: reviewed.length, excluded: reviewed.filter((r) => r.excluded).length, blocked: 0, review: 0, warn: 0, facts: 0 };
  for (const r of live) {
    if (blocking(r.issues).length) counts.blocked++;
    if (r.issues.some((i) => i.severity === 'warn')) counts.warn++;
    if (!blocking(r.issues).length) counts.facts += r.drafts.length;
  }
  counts.review = batchIssues.filter((i) => i.severity === 'review').length;
  const batchBlocked = batchIssues.some((i) => i.severity === 'block');
  const canApprove = batch.status === 'staged' && !batchBlocked && counts.blocked === 0 && counts.facts > 0 && batch.dataset !== 'plan';
  return { batch, rows: reviewed, lots, batchIssues, counts, diff, canApprove, needsAck: counts.review > 0 };
}

export async function approveBatch(env: Env, id: string, actor: string, opts: { acknowledge?: boolean; expectUpdatedAt?: string }) {
  const rv = await reviewBatch(env, id);
  if (opts.expectUpdatedAt && rv.batch.updated_at !== opts.expectUpdatedAt) throw new HttpError(409, 'batch_changed');
  if (!rv.canApprove) throw new HttpError(409, 'not_approvable', { batchIssues: rv.batchIssues, counts: rv.counts, status: rv.batch.status });
  if (rv.needsAck && !opts.acknowledge) throw new HttpError(409, 'acknowledge_required', { batchIssues: rv.batchIssues });
  const nonce = uid();
  const at = nowIso();
  const live = rv.rows.filter((r) => !r.excluded);
  const facts = live.flatMap((r) => r.drafts.map((d) => ({
    id: uid(), batch_id: id, row_id: r.id, dataset: d.dataset, shift_date: d.shift_date, at_ms: d.at_ms, start_ms: d.start_ms, end_ms: d.end_ms,
    line: d.line, product: d.product, grade: d.grade, lot: d.lot, customer: d.customer, order_ref: d.order_ref, worker: d.worker, reason: d.reason,
    doc_no: d.doc_no, ref_doc_no: d.ref_doc_no, rec_status: d.status, direction: d.direction, mode: d.mode, metric: d.metric, qty: d.qty, unit: d.unit,
    source_ref: d.source_ref, attrs: d.attrs ? JSON.stringify(d.attrs) : null, natural_key: d.natural_key,
  })));
  const supersedeKeys = [...new Set(live.filter((r) => r.resolution === 'supersede').flatMap((r) => r.drafts.map((d) => d.natural_key)))];
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("UPDATE batches SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'staged'").bind(nonce, at, id),
    env.DB.prepare('INSERT INTO guard(ok) SELECT NULL WHERE NOT EXISTS (SELECT 1 FROM batches WHERE id = ? AND approved_at = ?)').bind(id, nonce),
  ];
  if (rv.batch.supersedes_batch_id) {
    stmts.push(env.DB.prepare("UPDATE facts SET state = 'superseded', superseded_by_batch = ? WHERE batch_id = ? AND state = 'current'").bind(id, rv.batch.supersedes_batch_id));
    stmts.push(env.DB.prepare("UPDATE batches SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ? AND status = 'approved'").bind(id, at, rv.batch.supersedes_batch_id));
  }
  for (const chunk of jsonChunks(supersedeKeys)) {
    stmts.push(env.DB.prepare("UPDATE facts SET state = 'superseded', superseded_by_batch = ? WHERE state = 'current' AND batch_id <> ? AND natural_key IN (SELECT value FROM json_each(?))").bind(id, id, chunk));
  }
  for (const chunk of jsonChunks(facts)) {
    stmts.push(env.DB.prepare(`INSERT INTO facts (id, batch_id, row_id, dataset, shift_date, at_ms, start_ms, end_ms, line, product, grade, lot, customer, order_ref, worker, reason, doc_no, ref_doc_no, rec_status, direction, mode, metric, qty, unit, source_ref, attrs, natural_key, state, approved_at)
      SELECT j.value->>'id', j.value->>'batch_id', j.value->>'row_id', j.value->>'dataset', j.value->>'shift_date', j.value->>'at_ms', j.value->>'start_ms', j.value->>'end_ms',
        j.value->>'line', j.value->>'product', j.value->>'grade', j.value->>'lot', j.value->>'customer', j.value->>'order_ref', j.value->>'worker', j.value->>'reason',
        j.value->>'doc_no', j.value->>'ref_doc_no', j.value->>'rec_status', j.value->>'direction', j.value->>'mode', j.value->>'metric', j.value->>'qty', j.value->>'unit',
        j.value->>'source_ref', j.value->>'attrs', j.value->>'natural_key', 'current', ? FROM json_each(?) AS j`).bind(at, chunk));
  }
  // set the real approval time after the guard passed
  stmts.push(env.DB.prepare('UPDATE batches SET approved_at = ? WHERE id = ?').bind(at, id));
  stmts.push(auditStmt(env, actor, 'approve', 'batch', id, { facts: facts.length, superseded_batch: rv.batch.supersedes_batch_id, superseded_keys: supersedeKeys.length, acknowledged: rv.batchIssues.filter((i) => i.severity === 'review') }));
  stmts.push(bumpVersionStmt(env));
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('NOT NULL')) throw new HttpError(409, 'already_approved');
    throw e;
  }
  return { facts: facts.length, superseded_keys: supersedeKeys.length };
}
