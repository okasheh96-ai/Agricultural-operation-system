import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { can } from '@/core/rbac/access';
import { BLOCK_REASONS, loadTask, localized, type TaskBoardRow } from '@/core/data/tasks';
import { withDeviceCache } from '@/core/data/cache';
import { nextTransitions, useWorkflow, type WorkflowTransition } from '@/core/data/workflow';
import { useOutbox } from '@/core/offline/useOutbox';
import { provisionalStatus, type InsertItem } from '@/core/offline/outbox';
import { queueInsert, queueTransition, queueUpdate } from '@/core/offline/sync';
import { QueryState } from '@/core/components/QueryState';
import { StatusBadge } from '@/core/components/StatusBadge';

const EDITABLE = ['assigned', 'in_progress', 'blocked'];
const big = 'min-h-[56px] rounded-lg px-4 text-lg font-semibold';
const input = 'min-h-touch rounded border border-stone-300 px-3';

interface Named { id: string; code: string; name_ar: string; name_en: string | null }
interface LabourRow { id: string; hours: number; headcount: number | null; workers: { full_name: string } | null; crews: { name_ar: string; name_en: string | null } | null }
interface MachineRow { id: string; hours: number | null; km: number | null; assets: Named | null }
interface MaterialRow { id: string; planned_qty: number | null; actual_qty: number | null; version: number; items: Named | null; units: { code: string } | null }
interface CrewMemberRow { workers: { id: string; code: string; full_name: string } | null }

function useCached<T>(key: unknown[], load: () => Promise<T>, enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => withDeviceCache(key.join(':'), load), enabled, networkMode: 'always' });
}

async function select<T>(build: (db: ReturnType<typeof requireSupabase>) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await build(requireSupabase());
  if (error) throw error;
  return data as T;
}

/** One task, executed from the field: ≤ 3 taps to start, stop with a reason, or finish with a quantity. */
export default function TaskExecutePage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const wf = useWorkflow('task');
  const outbox = useOutbox();
  const task = useQuery({ queryKey: ['task', id], queryFn: () => loadTask(id), networkMode: 'always' });
  const [form, setForm] = useState<WorkflowTransition | null>(null);
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const tk = task.data;
  const pending = provisionalStatus(outbox.data ?? [], id);
  const status = pending ?? tk?.status ?? '';
  const conflicts = (outbox.data ?? []).filter((o) => o.entityId === id && o.state === 'conflict');

  // UI mirror of the server's rule choice; several rules may lead to the same status (one button each).
  const actions = tk
    ? nextTransitions(wf.data, tk.workflow_version_id, status)
        .filter(
          (tr) =>
            can(access, 'task', tr.required_action, { departmentId: tk.department_id, locationPath: tk.location_path ?? [], state: status }) &&
            (tr.guard !== 'task_requires_verification' || tk.requires_verification) &&
            (tr.guard !== 'task_no_verification' || !tk.requires_verification) &&
            (tr.guard !== 'task_assignee_is_actor' || tk.supervisor_id === access?.userId) &&
            tr.to_status !== 'cancelled',
        )
        .filter((tr, i, all) => all.findIndex((x) => x.to_status === tr.to_status) === i)
    : [];

  async function run(tr: WorkflowTransition) {
    if (!tk || !access) return;
    const fields: Record<string, unknown> = {};
    if (tr.to_status === 'blocked') {
      fields.blocked_reason = reason;
      if (note) fields.blocked_note = note;
    }
    if ((tr.to_status === 'pending_verification' || tr.to_status === 'completed') && qty) {
      fields.actual_quantity = Number(qty);
      fields.quantity_unit_id = tk.quantity_unit_id;
      if (note) fields.completion_note = note;
    }
    setBusy(true);
    await queueTransition(qc, {
      entityType: 'tasks',
      entityId: tk.id,
      payload: { toStatus: tr.to_status, fields, comment: note || undefined },
    });
    setBusy(false);
    setForm(null);
    setReason('');
    setNote('');
    setQty('');
    setMessage(navigator.onLine ? null : t('work.queued'));
  }

  function choose(tr: WorkflowTransition) {
    const needsForm = tr.to_status === 'blocked' || tr.required_fields.includes('comment')
      || ((tr.to_status === 'pending_verification' || tr.to_status === 'completed') && tk?.quantity_unit_id);
    if (needsForm) setForm(tr);
    else void run(tr);
  }

  function label(tr: WorkflowTransition): string {
    if (tr.from_status === 'blocked' && tr.to_status === 'in_progress') return t('work.actions.resume');
    if (tr.from_status === 'pending_verification' && tr.to_status === 'in_progress') return t('work.actions.reject');
    if ((tr.from_status === 'verified' || tr.from_status === 'completed') && tr.to_status === 'in_progress') return t('work.actions.reopen');
    return t(`work.actions.${tr.to_status}`, tr.to_status);
  }

  return (
    <QueryState isLoading={task.isLoading} error={task.error} isEmpty={!tk} emptyText={t('work.taskNotFound')} onRetry={() => void task.refetch()}>
      {tk && (
        <article className="flex flex-col gap-4">
          <header>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold">{tk.title}</h1>
              <StatusBadge workflow={wf.data} versionId={tk.workflow_version_id} status={status} pending={!!pending} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-stone-700">
              <dt className="text-sm">{t('common.code')}</dt><dd><bdi>{tk.code}</bdi></dd>
              <dt className="text-sm">{t('work.location')}</dt><dd>{localized(i18n.language, tk.location_name_ar, tk.location_name_en)}</dd>
              <dt className="text-sm">{t('work.crew')}</dt><dd>{localized(i18n.language, tk.crew_name_ar, tk.crew_name_en)}</dd>
              <dt className="text-sm">{t('work.type')}</dt><dd>{localized(i18n.language, tk.task_type_name_ar, tk.task_type_name_en)}</dd>
            </dl>
            {tk.instructions && <p className="mt-2 rounded bg-stone-100 p-3">{tk.instructions}</p>}
            {tk.rejection_count > 0 && <p className="mt-2 text-amber-800">{t('work.rejectionCount', { count: tk.rejection_count })}</p>}
            {status === 'blocked' && tk.blocked_reason && !pending && (
              <p className="mt-2 text-red-800">⛔ {t(`work.reasons.${tk.blocked_reason}`)}{tk.blocked_note ? ` — ${tk.blocked_note}` : ''}</p>
            )}
          </header>

          {conflicts.map((c) => (
            <p key={c.idempotencyKey} role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-900">
              {t('work.conflict')}: {c.conflictReason}
            </p>
          ))}
          {message && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{message}</p>}

          {/* Actions */}
          {!form && (
            <div className="flex flex-col gap-2">
              {actions.length === 0 && <p className="text-stone-600">{t('work.noActions')}</p>}
              {actions.map((tr) => (
                <button key={tr.to_status} type="button" disabled={busy} onClick={() => choose(tr)}
                  className={`${big} ${tr.to_status === 'blocked' ? 'border-2 border-red-600 text-red-800' : 'bg-brand text-white'} disabled:opacity-60`}>
                  {label(tr)}
                </button>
              ))}
            </div>
          )}
          {form && (
            <form className="flex flex-col gap-3 rounded-lg border bg-white p-4" onSubmit={(e) => { e.preventDefault(); void run(form); }}>
              <h2 className="font-semibold">{label(form)}</h2>
              {form.to_status === 'blocked' && (
                <fieldset className="grid grid-cols-2 gap-2">
                  <legend className="mb-1">{t('work.blockReason')}</legend>
                  {BLOCK_REASONS.map((r) => (
                    <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)}
                      className={`min-h-touch rounded border-2 px-2 ${reason === r ? 'border-red-600 bg-red-50 font-semibold' : 'border-stone-300'}`}>
                      {t(`work.reasons.${r}`)}
                    </button>
                  ))}
                </fieldset>
              )}
              {(form.to_status === 'pending_verification' || form.to_status === 'completed') && tk.quantity_unit_id && (
                <label className="flex flex-col gap-1"><span>{t('work.actualQuantity')}</span>
                  <input inputMode="decimal" dir="ltr" className={input} value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
              )}
              <label className="flex flex-col gap-1">
                <span>{form.required_fields.includes('comment') ? t('work.comment') : form.to_status === 'blocked' ? t('work.blockNote') : t('work.completionNote')}</span>
                <textarea className="rounded border border-stone-300 p-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || (form.to_status === 'blocked' && !reason) || (form.required_fields.includes('comment') && !note.trim())}
                  className={`${big} flex-1 bg-brand text-white disabled:opacity-60`}>{t('common.save')}</button>
                <button type="button" onClick={() => setForm(null)} className={`${big} border`}>{t('common.cancel')}</button>
              </div>
            </form>
          )}

          <Link to={`/field/report?task=${tk.id}`} className="min-h-touch rounded border-2 border-amber-500 px-4 py-3 text-center font-semibold text-amber-900">
            ⚠ {t('work.reportProblemHere')}
          </Link>

          <Entries task={tk} status={status} />
        </article>
      )}
    </QueryState>
  );
}

function Entries({ task, status }: { task: TaskBoardRow; status: string }) {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const outbox = useOutbox();
  const editable = EDITABLE.includes(status) && can(access, 'task', 'execute', { departmentId: task.department_id, locationPath: task.location_path ?? [] });
  const [hours, setHours] = useState('');
  const [worker, setWorker] = useState('');
  const [asset, setAsset] = useState('');
  const [mHours, setMHours] = useState('');

  const labour = useCached(['labour', task.id], () => select<LabourRow[]>((db) =>
    db.from('labour_entries').select('id, hours, headcount, workers(full_name), crews(name_ar, name_en)').eq('task_id', task.id).is('voided_at', null)));
  const machines = useCached(['machines', task.id], () => select<MachineRow[]>((db) =>
    db.from('machine_entries').select('id, hours, km, assets(id, code, name_ar, name_en)').eq('task_id', task.id).is('voided_at', null)));
  const materials = useCached(['materials', task.id], () => select<MaterialRow[]>((db) =>
    db.from('material_consumptions').select('id, planned_qty, actual_qty, version, items(id, code, name_ar, name_en), units(code)').eq('task_id', task.id).is('voided_at', null)));
  const crew = useCached(['crew', task.crew_id ?? 'none'], () => select<CrewMemberRow[]>((db) =>
    db.from('crew_members').select('workers(id, code, full_name)').eq('crew_id', task.crew_id as string).is('voided_at', null).is('valid_to', null)), !!task.crew_id);
  const assets = useCached(['assets'], () => select<Named[]>((db) => db.from('assets').select('id, code, name_ar, name_en').is('voided_at', null).order('code')));

  const items = useCached(['items'], () => select<(Named & { base_unit_id: string })[]>((db) =>
    db.from('items').select('id, code, name_ar, name_en, base_unit_id').is('voided_at', null).order('code')));
  const units = useCached(['units'], () => select<{ id: string; code: string }[]>((db) => db.from('units').select('id, code').is('voided_at', null)));
  const [item, setItem] = useState('');
  const [itemQty, setItemQty] = useState('');
  const pendingInserts = (outbox.data ?? []).filter((o): o is InsertItem => o.kind === 'insert' && o.entityId === task.id && o.state === 'pending');

  // Material used but not planned (field reality); recorded in the item's base unit, locked after completion.
  async function addMaterial() {
    const it = items.data?.find((i) => i.id === item);
    if (!access || !it || !itemQty) return;
    await queueInsert(qc, { table: 'material_consumptions', entityId: task.id,
      row: { id: crypto.randomUUID(), farm_id: access.farmId, task_id: task.id, item_id: it.id, unit_id: it.base_unit_id, actual_qty: Number(itemQty) } });
    setItem('');
    setItemQty('');
  }
  const crewSize = crew.data?.length ?? 0;

  async function addLabour() {
    if (!access || !hours) return;
    const row = worker
      ? { id: crypto.randomUUID(), farm_id: access.farmId, task_id: task.id, worker_id: worker, hours: Number(hours) }
      : { id: crypto.randomUUID(), farm_id: access.farmId, task_id: task.id, crew_id: task.crew_id, headcount: crewSize, hours: Number(hours) };
    await queueInsert(qc, { table: 'labour_entries', entityId: task.id, row });
    setHours('');
    setWorker('');
  }

  async function addMachine() {
    if (!access || !asset || !mHours) return;
    await queueInsert(qc, { table: 'machine_entries', entityId: task.id,
      row: { id: crypto.randomUUID(), farm_id: access.farmId, task_id: task.id, asset_id: asset, hours: Number(mHours) } });
    setAsset('');
    setMHours('');
  }

  return (
    <div className="flex flex-col gap-4">
      {!editable && EDITABLE.indexOf(status) === -1 && <p className="text-stone-600">{t('work.entriesLocked')}</p>}

      <section className="rounded-lg border bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('work.labour')}</h2>
        <ul className="mb-2 flex flex-col gap-1">
          {labour.data?.map((l) => (
            <li key={l.id}><bdi>{l.hours}</bdi> {t('work.hours')} — {l.workers?.full_name ?? `${localized(i18n.language, l.crews?.name_ar, l.crews?.name_en)} × ${l.headcount}`}</li>
          ))}
          {pendingInserts.filter((p) => p.table === 'labour_entries').map((p) => (
            <li key={p.idempotencyKey} className="text-amber-800"><bdi>{String(p.row.hours)}</bdi> {t('work.hours')} ({t('work.pendingSync')})</li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1"><span>{t('work.worker')}</span>
              <select className={input} value={worker} onChange={(e) => setWorker(e.target.value)}>
                {task.crew_id && <option value="">{t('work.wholeCrew')} ({crewSize})</option>}
                {!task.crew_id && <option value="">—</option>}
                {crew.data?.map((m) => m.workers && <option key={m.workers.id} value={m.workers.id}>{m.workers.full_name}</option>)}
              </select></label>
            <label className="flex w-24 flex-col gap-1"><span>{t('work.hours')}</span>
              <input inputMode="decimal" dir="ltr" className={input} value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            <button type="button" disabled={!hours || (!worker && !task.crew_id)} onClick={() => void addLabour()}
              className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('work.addLabour')}</button>
          </div>
        )}
      </section>

      <section className="rounded-lg border bg-white p-3">
        <h2 className="mb-2 font-semibold">{t('work.machines')}</h2>
        <ul className="mb-2 flex flex-col gap-1">
          {machines.data?.map((m) => <li key={m.id}><bdi>{m.assets?.code}</bdi> — <bdi>{m.hours ?? m.km}</bdi> {m.hours ? t('work.hours') : t('work.km')}</li>)}
          {pendingInserts.filter((p) => p.table === 'machine_entries').map((p) => (
            <li key={p.idempotencyKey} className="text-amber-800"><bdi>{String(p.row.hours)}</bdi> {t('work.hours')} ({t('work.pendingSync')})</li>
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1"><span>{t('work.machine')}</span>
              <select className={input} value={asset} onChange={(e) => setAsset(e.target.value)}>
                <option value="">—</option>
                {assets.data?.map((a) => <option key={a.id} value={a.id}>{a.code} · {localized(i18n.language, a.name_ar, a.name_en)}</option>)}
              </select></label>
            <label className="flex w-24 flex-col gap-1"><span>{t('work.hours')}</span>
              <input inputMode="decimal" dir="ltr" className={input} value={mHours} onChange={(e) => setMHours(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
            <button type="button" disabled={!asset || !mHours} onClick={() => void addMachine()}
              className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('work.addMachine')}</button>
          </div>
        )}
      </section>

      {((materials.data?.length ?? 0) > 0 || editable) && (
        <section className="rounded-lg border bg-white p-3">
          <h2 className="mb-2 font-semibold">{t('work.materials')}</h2>
          <ul className="mb-2 flex flex-col gap-2">
            {materials.data?.map((m) => <MaterialLine key={m.id} line={m} editable={editable}
              onSave={(v) => queueUpdate(qc, { table: 'material_consumptions', entityId: task.id, rowId: m.id, patch: { actual_qty: v }, expectedVersion: m.version })} />)}
            {pendingInserts.filter((p) => p.table === 'material_consumptions').map((p) => (
              <li key={p.idempotencyKey} className="text-amber-800">
                {localized(i18n.language, items.data?.find((i) => i.id === p.row.item_id)?.name_ar, items.data?.find((i) => i.id === p.row.item_id)?.name_en)}
                {' '}<bdi>{String(p.row.actual_qty)}</bdi> ({t('work.pendingSync')})
              </li>
            ))}
          </ul>
          {editable && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1"><span>{t('work.item')}</span>
                <select className={input} value={item} onChange={(e) => setItem(e.target.value)}>
                  <option value="">—</option>
                  {items.data?.map((i) => <option key={i.id} value={i.id}>{i.code} · {localized(i18n.language, i.name_ar, i.name_en)}</option>)}
                </select></label>
              <label className="flex w-24 flex-col gap-1"><span>{t('work.quantity')}</span>
                <input inputMode="decimal" dir="ltr" className={input} value={itemQty} onChange={(e) => setItemQty(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
              <span className="pb-3 text-sm"><bdi>{units.data?.find((u) => u.id === items.data?.find((i) => i.id === item)?.base_unit_id)?.code ?? ''}</bdi></span>
              <button type="button" disabled={!item || !itemQty} onClick={() => void addMaterial()}
                className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('work.addMaterial')}</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function MaterialLine({ line, editable, onSave }: { line: MaterialRow; editable: boolean; onSave: (v: number) => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const [v, setV] = useState(line.actual_qty?.toString() ?? '');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="flex-1">{localized(i18n.language, line.items?.name_ar, line.items?.name_en)}</span>
      <span className="text-sm">{t('work.planned')}: <bdi>{line.planned_qty ?? '—'} {line.units?.code}</bdi></span>
      {editable ? (
        <>
          <input aria-label={t('work.actual')} inputMode="decimal" dir="ltr" className={`${input} w-24`} value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))} />
          <button type="button" disabled={v === ''} onClick={() => void onSave(Number(v))} className="min-h-touch rounded border px-3">{t('work.saveActual')}</button>
        </>
      ) : (
        <span className="text-sm">{t('work.actual')}: <bdi>{line.actual_qty ?? '—'}</bdi></span>
      )}
    </li>
  );
}
