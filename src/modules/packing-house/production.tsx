import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  db, localizedName, rpc, uploadPhoto, useInvalidatePh, useJcBalance, useJobCards, useLookup, usePallets,
  type FgPalletRow, type JcInputRow, type JobCardRow, type PalletRow,
} from './api';
import {
  Buttons, Checklist, ConfirmForm, PhotoInput, ResultChoice, useApproved, useSubmit, type CropRow, type LocationRow, type ScaleRow,
} from './forms';
import { phErrorMessage, type PhReason } from './phErrors';
import { FgMergeForm, FgSplitForm } from './splitmerge';
import { ACCENT_CLASS, STATUS_STYLE, formatDuration, minutesBetween } from './stages';
import { CreateWasteForm } from './waste';
import {
  ActionPanel, ActivityStrip, ErrorBox, Field, Labelled, StatusPill, WarningList, btnCls, canPrint, inputCls, primaryBtnCls,
  type StripState,
} from './ui';

type Perms = Map<string, string> | undefined;
const has = (perms: Perms, key: string) => !!perms?.has(key);
const GRADES = ['premium', 'gr1', 'gr2'] as const;

interface LineRow { id: string; code: string; name_ar: string; name_en: string | null; kind: string; verification_status: string }
interface JcCropRow extends CropRow { allowed_lines: string[] }

// ---------------------------------------------------------------------------------------------
// ST-08 Job Card: create, inputs, packaging
export function CreateJobCardForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useApproved<JcCropRow>('crops_jc', 'ph_crops', 'id, code, name_ar, name_en, verification_status, version_no, boxes_per_pallet, superseded_at, nominal_kg_per_pallet, allowed_lines');
  const lines = useApproved<LineRow>('lines', 'ph_lines', 'id, code, name_ar, name_en, kind, verification_status');
  const [f, setF] = useState({ crop_id: '', line_id: '', grade_target: '', planned_date: '', customer_spec_ref: '', notes: '' });
  const crop = crops.data?.find((c) => c.id === f.crop_id);
  const lineChoices = (lines.data ?? []).filter((l) => l.kind !== 'washer' && (!crop || crop.allowed_lines.length === 0 || crop.allowed_lines.includes(l.code)))
    .sort((a, b) => a.code.localeCompare(b.code));
  const s = useSubmit((rid) => rpc<{ id: string; code: string }>('ph_create_job_card', { p: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), p_request_id: rid }),
    (r) => onDone(r.id));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.jc.gradeNotice')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={t('ph.fields.crop_id')} required hint={t('ph.jc.onlyApproved')}>
          <select required className={inputCls} value={f.crop_id} onChange={(e) => setF({ ...f, crop_id: e.target.value, line_id: '' })}>
            <option value="">—</option>
            {(crops.data ?? []).filter((c) => !c.superseded_at).map((c) => <option key={c.id} value={c.id}>{localizedName(i18n.language, c.name_ar, c.name_en)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.line')} required hint={crop && crop.allowed_lines.length > 0 ? t('ph.jc.route', { lines: crop.allowed_lines.join(', ') }) : undefined}>
          <select required className={inputCls} value={f.line_id} onChange={set('line_id')}>
            <option value="">—</option>
            {lineChoices.map((l) => <option key={l.id} value={l.id}>{localizedName(i18n.language, l.name_ar, l.name_en)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.grade_target')} required>
          <select required className={inputCls} value={f.grade_target} onChange={set('grade_target')}>
            <option value="">—</option>
            {GRADES.map((g) => <option key={g} value={g}>{t(`ph.grade.${g}`)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.planned_date')} hint={t('ph.jc.todayDefault')}>
          <input type="date" dir="ltr" className={inputCls} value={f.planned_date} onChange={set('planned_date')} />
        </Labelled>
        <Labelled label={t('ph.fields.customer_spec_ref')} hint={t('ph.jc.specHint')}>
          <input className={inputCls} value={f.customer_spec_ref} onChange={set('customer_spec_ref')} />
        </Labelled>
        <Labelled label={t('ph.fields.notes')}><input className={inputCls} value={f.notes} onChange={set('notes')} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.jc.create')} onCancel={onCancel} />
    </form>
  );
}

/** Issue an incoming pallet (all or part of its remaining kg) to a Job Card: from the Job Card (pick a pallet) or from the pallet (pick a Job Card). */
export function IssueForm({ jc, pallet, onDone, onCancel }: { jc?: JobCardRow; pallet?: PalletRow; onDone: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const pallets = usePallets();
  const jobCards = useJobCards();
  const palletChoices = (pallets.data ?? []).filter((p) => jc && p.crop_code === jc.crop_code && ['released', 'issued'].includes(p.status) && Number(p.available_kg) > 0);
  const jcChoices = (jobCards.data ?? []).filter((j) => pallet && j.crop_code === pallet.crop_code && ['planned', 'ready', 'in_progress'].includes(j.status));
  const [palletId, setPalletId] = useState(pallet?.id ?? '');
  const [jcId, setJcId] = useState(jc?.id ?? '');
  const [kg, setKg] = useState('');
  const chosen = pallet ?? palletChoices.find((p) => p.id === palletId);
  const s = useSubmit(() => rpc('ph_issue_to_job_card', { p_jc: jcId, p_pallet: chosen?.id ?? palletId, p_kg: kg ? Number(kg) : null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.jc.issueHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {jc ? (
          <Labelled label={t('ph.fields.pallet')} required>
            <select required className={inputCls} value={palletId} onChange={(e) => setPalletId(e.target.value)}>
              <option value="">—</option>
              {palletChoices.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.lot_code ?? '—'} · {t('ph.jc.availableKg', { kg: p.available_kg })}</option>)}
            </select>
            {palletChoices.length === 0 && <span className="text-xs text-amber-800">{t('ph.jc.noReleased', { crop: localizedName(i18n.language, jc.crop_name_ar, jc.crop_name_en) })}</span>}
          </Labelled>
        ) : (
          <Labelled label={t('ph.fields.job_card')} required>
            <select required className={inputCls} value={jcId} onChange={(e) => setJcId(e.target.value)}>
              <option value="">—</option>
              {jcChoices.map((j) => <option key={j.id} value={j.id}>{j.code} · {t(`ph.status.ph_job_card.${j.status}`)}</option>)}
            </select>
            {jcChoices.length === 0 && <span className="text-xs text-amber-800">{t('ph.jc.noJobCard')}</span>}
          </Labelled>
        )}
        <Labelled label={t('ph.fields.issued_kg')} hint={chosen ? t('ph.jc.issueAllHint', { kg: chosen.available_kg }) : undefined}>
          <input type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={kg} onChange={(e) => setKg(e.target.value)} />
        </Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !jcId || !(chosen?.id ?? palletId)} label={t('ph.jc.issue')} onCancel={onCancel} />
    </form>
  );
}

export function PackagingForm({ jc, onDone, onCancel }: { jc: JobCardRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('');
  const s = useSubmit((rid) => rpc('ph_issue_packaging', { p_jc: jc.id, p_description: description, p_quantity: Number(quantity), p_unit: 'pc', p_request_id: rid }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.jc.packagingHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label={t('ph.fields.packaging')} required><input required className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Labelled>
        <Labelled label={t('ph.fields.quantity_pc')} required>
          <input required type="number" min={1} step="1" dir="ltr" className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.jc.issuePackaging')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// G5 line-start check
export function LineStartForm({ jc, onDone, onCancel }: { jc: JobCardRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const s = useSubmit(() => rpc('ph_line_start_check', { p_jc: jc.id, p_result: result, p_checklist: checks, p_reason: reason || null, p_remarks: remarks || null }),
    () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.jc.lineStartHint')}</p>
      <Checklist type="line_start" crop={jc.crop_code} value={checks} onChange={setChecks} />
      <ResultChoice value={result} onChange={setResult} options={[
        { key: 'pass', label: t('ph.jc.lineStartPass'), good: true }, { key: 'fail', label: t('ph.jc.lineStartFail'), good: false }]} />
      {result === 'fail' && <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>}
      <Labelled label={t('ph.fields.remarks')}><input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !result} label={t('ph.jc.recordLineStart')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-09 QC-2 (G6)
export function Qc2Form({ jc, onDone, onCancel }: { jc: JobCardRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState('');
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [sample, setSample] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const s = useSubmit(async () => {
    const att: string[] = [];
    for (const file of files) att.push((await uploadPhoto(file, t('ph.jc.qc2Photo'))).id);
    return rpc('ph_qc2_record', { p_jc: jc.id, p_stage: stage, p_result: result, p_checklist: checks, p_sample_note: sample || null,
      p_reason: reason || null, p_remarks: remarks || null, p_attachment_ids: att });
  }, () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.jc.qc2Notice')}</p>
      <ResultChoice value={stage} onChange={setStage} options={[
        { key: 'online', label: t('ph.qc2Stage.online'), good: true }, { key: 'final', label: t('ph.qc2Stage.final'), good: true }]} />
      <Checklist type="qc2" crop={jc.crop_code} value={checks} onChange={setChecks} />
      <Labelled label={t('ph.fields.sample_note')} hint={t('ph.jc.sampleHint')}><input className={inputCls} value={sample} onChange={(e) => setSample(e.target.value)} /></Labelled>
      <ResultChoice value={result} onChange={setResult} options={[
        { key: 'pass', label: t('ph.jc.qc2Pass'), good: true }, { key: 'fail', label: t('ph.jc.qc2Fail'), good: false }]} />
      {result === 'fail' && (
        <>
          <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
          <p className="text-sm text-stone-700">{t('ph.jc.qc2FailHint')}</p>
        </>
      )}
      <Labelled label={t('ph.fields.remarks')}><input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Labelled>
      <PhotoInput files={files} onChange={setFiles} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !stage || !result} label={t('ph.jc.recordQc2')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-10 Finished-goods pallet
export function FgPalletForm({ jc, onDone, onCancel }: { jc: JobCardRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const scales = useApproved<ScaleRow>('scales', 'ph_equipment', 'id, code, name_ar, name_en, kind, calibration_due_on, verification_status');
  const [f, setF] = useState({ grade: jc.grade_target as string, box_count: '', net_kg: '', scale_id: '' });
  const [created, setCreated] = useState<{ code: string; warnings: PhReason[] } | null>(null);
  const s = useSubmit((rid) => rpc<{ id: string; code: string; warnings: PhReason[] }>('ph_create_fg_pallet', {
    p_jc: jc.id, p: { grade: f.grade, box_count: Number(f.box_count), net_kg: Number(f.net_kg), scale_id: f.scale_id }, p_request_id: rid }), (r) => setCreated(r));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  if (created) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="rounded bg-green-50 px-3 py-2 text-green-900">{t('ph.fg.created')} <bdi className="font-mono font-bold">{created.code}</bdi></p>
        <WarningList warnings={created.warnings ?? []} />
        <div className="flex gap-2">
          <button type="button" className={primaryBtnCls} onClick={() => { setCreated(null); setF({ ...f, box_count: '', net_kg: '' }); }}>＋ {t('ph.fg.another')}</button>
          <button type="button" className={btnCls} onClick={onDone}>{t('ph.forms.done')}</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.fg.createHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labelled label={t('ph.fields.grade')} required hint={t('ph.fg.gradeHint')}>
          <select required className={inputCls} value={f.grade} onChange={set('grade')}>
            {GRADES.map((g) => <option key={g} value={g}>{t(`ph.grade.${g}`)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.box_count')} required>
          <input required type="number" min={1} step="1" dir="ltr" className={inputCls} value={f.box_count} onChange={set('box_count')} /></Labelled>
        <Labelled label={t('ph.fields.net_kg')} required>
          <input required type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={f.net_kg} onChange={set('net_kg')} /></Labelled>
        <Labelled label={t('ph.fields.scale_id')} required>
          <select required className={inputCls} value={f.scale_id} onChange={set('scale_id')}>
            <option value="">—</option>
            {scales.data?.filter((x) => x.kind === 'scale').map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select></Labelled>
      </div>
      <p className="text-xs text-stone-600">{t('ph.fg.compositionHint')}</p>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.fg.create')} onCancel={onCancel} />
    </form>
  );
}

/** Completion: for every issued pallet, kg consumed and kg returned (they must add up to the kg issued). */
export function CompleteJobCardForm({ jc, inputs, onDone, onCancel }: { jc: JobCardRow; inputs: JcInputRow[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const open = inputs.filter((i) => !i.closed_at);
  const [consumed, setConsumed] = useState<Record<string, string>>({});
  const returned = (i: JcInputRow) => (consumed[i.id] === undefined || consumed[i.id] === '' ? '' : (Number(i.issued_kg) - Number(consumed[i.id])).toFixed(2));
  const s = useSubmit(() => rpc('ph_complete_job_card', { p_jc: jc.id, p_closures: open.map((i) => ({
    input_id: i.id, consumed_kg: Number(consumed[i.id]), returned_kg: Number(returned(i)) })) }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.jc.completeHint')}</p>
      <ul className="flex flex-col">
        {open.map((i) => (
          <li key={i.id} className="flex flex-wrap items-end gap-3 border-b border-stone-100 py-2 text-sm">
            <div className="min-w-0 flex-1 basis-40">
              <div className="break-all font-mono font-semibold"><bdi>{i.pallet_code}</bdi></div>
              <div className="text-stone-600">{t('ph.fields.issued_kg')}: <bdi>{i.issued_kg}</bdi></div>
            </div>
            <Labelled label={t('ph.fields.consumed_kg')} required>
              <input required type="number" min={0} max={Number(i.issued_kg)} step="0.01" dir="ltr" className={`${inputCls} sm:w-32`}
                aria-label={`${t('ph.fields.consumed_kg')} ${i.pallet_code}`} value={consumed[i.id] ?? ''} onChange={(e) => setConsumed({ ...consumed, [i.id]: e.target.value })} />
            </Labelled>
            <div className="min-w-[6rem]"><div className="text-xs text-stone-500">{t('ph.fields.returned_kg')}</div><bdi className="font-medium">{returned(i) || '—'}</bdi></div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-600">{t('ph.jc.massBalanceLater')}</p>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || open.length === 0} label={t('ph.jc.complete')} onCancel={onCancel} />
    </form>
  );
}

/**
 * MB-01: the balance is computed by the database from what was recorded (issued − returned = consumed; consumed − finished
 * − weighed waste = variance). Nothing is forced to zero; without an approved tolerance (OD-28) any variance needs a reason.
 */
export function ReconcileForm({ jc, onDone, onCancel }: { jc: JobCardRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const bal = useJcBalance(jc.id, jc.version);
  const [explanation, setExplanation] = useState('');
  const s = useSubmit(() => rpc('ph_reconcile_job_card', { p_jc: jc.id, p_explanation: explanation.trim() || null }), () => onDone());
  const b = bal.data;
  const variance = b ? Number(b.variance_kg) : 0;
  const tol = b?.tolerance_pct === null || b?.tolerance_pct === undefined ? null : Number(b.tolerance_pct);
  const needsReason = !!b && variance !== 0 && (tol === null || Math.abs(Number(b.variance_pct ?? 0)) > tol);
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.mb.hint')}</p>
      {b && <BalanceTable b={b} />}
      {b && b.waste_pending > 0 && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.reasons.mb_wastePending', { count: b.waste_pending })}</p>}
      {tol === null && <p className="text-xs text-stone-600">{t('ph.mb.noTolerance')}</p>}
      <Labelled label={t('ph.fields.explanation')} required={needsReason} hint={needsReason ? t('ph.mb.explainHint') : undefined}>
        <input required={needsReason} className={inputCls} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !b} label={t('ph.jcActions.reconcile')} onCancel={onCancel} />
    </form>
  );
}

/** The MB-01 figures of one Job Card, as recorded. */
export function BalanceTable({ b }: { b: NonNullable<ReturnType<typeof useJcBalance>['data']> }) {
  const { t } = useTranslation();
  const rows: [string, string | number | null][] = [
    ['issued_kg', b.issued_kg], ['returned_kg', b.returned_kg], ['consumed_kg', b.consumed_kg], ['fg_kg', b.fg_kg], ['waste_kg', b.waste_kg],
  ];
  const v = Number(b.variance_kg);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-stone-200 bg-stone-50 p-2 text-sm sm:grid-cols-3">
      {rows.map(([k, val]) => (
        <div key={k} className="flex justify-between gap-2"><dt className="text-stone-600">{t(`ph.mb.${k}`)}</dt><dd className="font-medium"><bdi>{val} kg</bdi></dd></div>
      ))}
      <div className={`flex justify-between gap-2 ${v === 0 ? '' : 'text-amber-900'}`}>
        <dt className="font-semibold">{t('ph.mb.variance')}</dt>
        <dd className="font-bold"><bdi>{b.variance_kg} kg{b.variance_pct !== null ? ` · ${b.variance_pct} %` : ''}</bdi></dd>
      </div>
      <div className="flex justify-between gap-2"><dt className="text-stone-600">{t('ph.mb.tolerance')}</dt>
        <dd>{b.tolerance_pct !== null ? <bdi>{b.tolerance_pct} %</bdi> : <span className="text-amber-800">{t('ph.mb.tolerancePending')}</span>}</dd></div>
      {b.waste_pending > 0 && <div className="flex justify-between gap-2 text-amber-900"><dt>{t('ph.mb.wastePending')}</dt><dd><bdi>{b.waste_pending}</bdi></dd></div>}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// FG label (V-09) and storage moves
interface FgLabelContent {
  pallet_no: string; job_card: string; grade: string; box_count: number; net_kg: string; crop: string; crop_en: string | null;
  varieties: string[]; lots: string[]; sections: string[]; suppliers: string[]; harvest_date: string; packed_on: string; barcode_note: string; print_no: number;
}

export function FgLabelForm({ fg, onDone, onCancel }: { fg: FgPalletRow; onDone: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState<FgLabelContent | null>(null);
  const s = useSubmit(() => rpc<FgLabelContent>('ph_print_fg_label', { p_fg: fg.id, p_reprint_reason: reason || null }), (r) => {
    setLabel(r);
    if (canPrint()) setTimeout(() => window.print(), 50);
  });
  if (label) {
    return (
      <div className="flex flex-col gap-2">
        <div id="ph-label" className="ph-print-area mx-auto w-[22rem] rounded border-2 border-stone-900 bg-white p-3 text-stone-900">
          <div className="text-xs">{t('ph.fg.labelTitle')} · {t('ph.label.printNo', { n: label.print_no })}</div>
          <div className="font-mono text-2xl font-bold" dir="ltr">{label.pallet_no}</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-2 text-sm">
            <dt>{t('ph.label.crop')}</dt><dd>{localizedName(i18n.language, label.crop, label.crop_en)}{label.varieties.length ? ` — ${label.varieties.join('، ')}` : ''}</dd>
            <dt>{t('ph.fields.grade')}</dt><dd>{t(`ph.grade.${label.grade}`)}</dd>
            <dt>{t('ph.label.weight')}</dt><dd><bdi>{label.net_kg} kg · {label.box_count} {t('ph.fg.boxes')}</bdi></dd>
            <dt>{t('ph.fields.lot')}</dt><dd><bdi>{label.lots.join(', ')}</bdi></dd>
            <dt>{t('ph.label.source')}</dt><dd><bdi>{[...label.sections, ...label.suppliers].join(' · ')}</bdi></dd>
            <dt>{t('ph.label.harvest')}</dt><dd><bdi>{label.harvest_date}</bdi></dd>
            <dt>{t('ph.fg.packedOn')}</dt><dd><bdi>{label.packed_on}</bdi></dd>
            <dt>{t('ph.fields.job_card')}</dt><dd><bdi>{label.job_card}</bdi></dd>
          </dl>
          <div className="mt-2 border-t pt-1 text-xs">{t('ph.label.noBarcode')}</div>
        </div>
        <div className="flex gap-2">
          {canPrint()
            ? <button type="button" className={primaryBtnCls} onClick={() => window.print()}>🖨 {t('ph.label.printAgain')}</button>
            : <p className="text-sm text-stone-600">{t('ph.label.noPrintHere')}</p>}
          <button type="button" className={btnCls} onClick={onDone}>{t('ph.forms.done')}</button>
        </div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.fg.labelHint')}</p>
      {fg.label_print_count > 0 && <Labelled label={t('ph.fields.reprint_reason')} required>
        <input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>}
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={fg.label_print_count > 0 ? t('ph.forms.reprint') : t('ph.forms.print')} onCancel={onCancel} />
    </form>
  );
}

export function FgMoveForm({ fg, canOverride, onDone, onCancel }: { fg: FgPalletRow; canOverride: boolean; onDone: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const locations = useLookup<LocationRow>('occupancy', 'ph_location_occupancy', '*', undefined, false);
  const choices = (locations.data ?? []).filter((l) => l.purpose === 'fg_storage' && l.verification_status === 'verified' && l.id !== fg.location_id)
    .sort((a, b) => a.code.localeCompare(b.code));
  const [to, setTo] = useState('');
  const [override, setOverride] = useState('');
  const [warnings, setWarnings] = useState<PhReason[]>([]);
  const s = useSubmit(async () => {
    const r = await rpc<{ warnings: PhReason[] }>('ph_move_fg_pallet', { p_fg: fg.id, p_to_location: to, p_override_reason: override || null });
    setWarnings(r.warnings ?? []);
    return r;
  }, () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <Labelled label={t('ph.fields.to_location')} required hint={t('ph.fg.fridgeHint')}>
        <select required className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">—</option>
          {choices.map((l) => (
            <option key={l.id} value={l.id}>
              {l.code} — {localizedName(i18n.language, l.name_ar, l.name_en)} · {l.storage_group_code ? localizedName(i18n.language, l.storage_group_name_ar, l.storage_group_name_en) : t('ph.forms.noGroup')}
              {l.capacity_pallets ? ` · ${l.occupancy}/${l.capacity_pallets}` : ''}
            </option>
          ))}
        </select>
      </Labelled>
      {(s.reason?.key === 'ph.v07' || override) && (
        canOverride
          ? <Labelled label={t('ph.fields.override_reason')} required hint={t('ph.forms.overrideHint')}>
              <input required className={inputCls} value={override} onChange={(e) => setOverride(e.target.value)} /></Labelled>
          : <p className="text-sm text-stone-700">{t('ph.forms.overrideNeedsPhm')}</p>
      )}
      <WarningList warnings={warnings} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.forms.move')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Forms for one Job Card action key (the same keys as ph_job_card_actions), shared by the board panel and the record view.
export function JobCardActionForm({ action, jc, inputs, onDone, onCancel }: {
  action: string; jc: JobCardRow; inputs: JcInputRow[]; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const p = { onDone, onCancel };
  switch (action) {
    case 'approve': return <ConfirmForm fn="ph_approve_job_card" args={(c) => ({ p_jc: jc.id, p_comment: c || null })} label={t('ph.jcActions.approve')}
      hint={t('ph.jc.approveHint')} {...p} />;
    case 'cancel': return <ConfirmForm fn="ph_cancel_job_card" comment="required" args={(c) => ({ p_jc: jc.id, p_reason: c })} label={t('ph.jcActions.cancel')} {...p} />;
    case 'issue_input': return <IssueForm jc={jc} {...p} />;
    case 'issue_packaging': return <PackagingForm jc={jc} {...p} />;
    case 'mark_ready': return <ConfirmForm fn="ph_mark_job_card_ready" comment="none" args={() => ({ p_jc: jc.id })} label={t('ph.jcActions.mark_ready')}
      hint={t('ph.jc.readyHint')} {...p} />;
    case 'line_start_check': return <LineStartForm jc={jc} {...p} />;
    case 'confirm_start': return <ConfirmForm fn="ph_confirm_line_start" args={(c) => ({ p_jc: jc.id, p_comment: c || null })} label={t('ph.jcActions.confirm_start')}
      hint={t('ph.jc.confirmHint', { by: jc.line_start_by_name ?? '—', code: jc.line_start_code ?? '' })} {...p} />;
    case 'line_corrected': return <ConfirmForm fn="ph_line_check_corrected" comment="required" args={(c) => ({ p_jc: jc.id, p_note: c })}
      label={t('ph.jcActions.line_corrected')} hint={t('ph.jc.correctedHint')} {...p} />;
    case 'pause': return <ConfirmForm fn="ph_pause_job_card" comment="required" args={(c) => ({ p_jc: jc.id, p_reason: c })} label={t('ph.jcActions.pause')} {...p} />;
    case 'resume': return <ConfirmForm fn="ph_resume_job_card" comment="none" args={() => ({ p_jc: jc.id })} label={t('ph.jcActions.resume')} {...p} />;
    case 'qc2': return <Qc2Form jc={jc} {...p} />;
    case 'create_fg': return <FgPalletForm jc={jc} {...p} />;
    case 'complete': return <CompleteJobCardForm jc={jc} inputs={inputs} {...p} />;
    case 'record_waste': return <CreateWasteForm source={{ type: 'job_card', ref: jc.id, label: jc.code }} onDone={() => onDone()} onCancel={onCancel} />;
    case 'reconcile': return <ReconcileForm jc={jc} {...p} />;
    case 'close': return <ConfirmForm fn="ph_close_job_card" args={(c) => ({ p_jc: jc.id, p_comment: c || null })} label={t('ph.jcActions.close')}
      hint={t('ph.jc.closeHint')} {...p} />;
    default: return null;
  }
}

export function FgActionForm({ action, fg, canOverride, onDone, onCancel }: {
  action: string; fg: FgPalletRow; canOverride: boolean; onDone: () => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  switch (action) {
    case 'print_label': return <FgLabelForm fg={fg} onDone={onDone} onCancel={onCancel} />;
    case 'qc_approve': return <ConfirmForm fn="ph_fg_qc_approve" args={(c) => ({ p_fg: fg.id, p_comment: c || null })} label={t('ph.fgActions.qc_approve')}
      hint={t('ph.fg.qcApproveHint')} onDone={onDone} onCancel={onCancel} />;
    case 'move': return <FgMoveForm fg={fg} canOverride={canOverride} onDone={onDone} onCancel={onCancel} />;
    case 'split': return <FgSplitForm fg={fg} onDone={onDone} onCancel={onCancel} />;
    case 'merge': return <FgMergeForm fg={fg} onDone={onDone} onCancel={onCancel} />;
    case 'record_waste': return <CreateWasteForm source={{ type: 'fg_pallet', ref: fg.id, label: fg.code }} onDone={() => onDone()} onCancel={onCancel} />;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Responsibility strips
export function jobCardStrips(j: JobCardRow, t: (k: string, o?: Record<string, unknown>) => string): ReactNode {
  const s = j.status;
  const queue = (k: string) => t('ph.queue', { roles: k });
  const after = (...xs: string[]) => xs.includes(s);
  const running = ['in_progress', 'paused', 'completed', 'reconciled', 'closed'];
  const approval: StripState = s === 'draft' ? 'waiting' : s === 'cancelled' ? 'rejected' : 'done';
  const inputs: StripState = j.inputs_count > 0 ? 'done' : after('planned', 'ready') ? 'waiting' : 'not_reached';
  const packaging: StripState = j.packaging_count > 0 ? 'done' : s === 'planned' ? 'waiting' : 'not_reached';
  const g5: StripState = after(...running) ? 'done' : s === 'line_check_failed' ? 'rejected'
    : s === 'ready' ? (j.line_start_inspection_id ? 'active' : 'waiting') : 'not_reached';
  const finalPass = j.qc2_result === 'pass' && j.qc2_stage === 'final';
  const g6: StripState = !after(...running) ? 'not_reached' : j.qc2_result === 'fail' ? 'rejected' : finalPass ? 'done'
    : j.qc2_result === 'pass' ? 'active' : 'waiting';
  const output: StripState = j.fg_count > 0 ? 'done' : s === 'in_progress' && finalPass ? 'waiting' : 'not_reached';
  const completion: StripState = after('completed', 'reconciled', 'closed') ? 'done' : after('in_progress', 'paused') ? 'waiting' : 'not_reached';
  return (
    <>
      <ActivityStrip icon="📋" title={t('ph.jcStrips.plan')} state="done" who={j.created_by_name ?? '—'}
        detail={`${j.line_code} · ${t(`ph.grade.${j.grade_target}`)}`} />
      <ActivityStrip icon="✍" title={t('ph.jcStrips.approval')} state={approval} who={approval === 'waiting' ? queue('PHM') : j.approved_by_name ?? '—'} />
      <ActivityStrip icon="⚖" title={t('ph.jcStrips.inputs')} state={inputs}
        who={j.inputs_count > 0 ? t('ph.jc.inputsSummary', { n: j.inputs_count, kg: j.issued_kg }) : inputs === 'waiting' ? queue('LL') : '—'} />
      <ActivityStrip icon="📦" title={t('ph.jcStrips.packaging')} state={packaging}
        who={j.packaging_count > 0 ? t('ph.jc.packagingSummary', { n: j.packaging_count }) : packaging === 'waiting' ? queue('STK') : '—'} />
      <ActivityStrip icon="🔧" title={t('ph.jcStrips.lineStart')} state={g5} attention={s === 'line_check_failed'}
        who={g5 === 'waiting' ? queue('QCI · LL') : g5 === 'active' ? t('ph.jc.awaitingConfirm', { by: j.line_start_by_name ?? '—' })
          : g5 === 'rejected' ? queue('LL') : g5 === 'done' ? [j.line_start_by_name, j.started_by_name].filter(Boolean).join(' + ') || '—' : '—'}
        detail={g5 === 'rejected' ? t('ph.jc.lineCheckFailed') : j.line_start_code ?? undefined} />
      <ActivityStrip icon="🔬" title={t('ph.jcStrips.qc2')} state={g6} attention={j.qc2_result === 'fail'}
        who={g6 === 'waiting' ? queue('QCI') : g6 === 'rejected' ? t('ph.jc.resortQueue') : j.qc2_by_name ?? '—'}
        detail={j.qc2_code ? `${j.qc2_code} · ${t(`ph.qc2Stage.${j.qc2_stage}`)}${j.qc2_tolerance_basis === 'no_tolerance_set' ? ` · ${t('ph.strips.noTolerance')}` : ''}` : undefined} />
      <ActivityStrip icon="▦" title={t('ph.jcStrips.output')} state={output}
        who={j.fg_count > 0 ? t('ph.jc.outputSummary', { n: j.fg_count, kg: j.fg_kg }) : output === 'waiting' ? queue('PHO') : '—'} />
      <ActivityStrip icon="■" title={t('ph.jcStrips.completion')} state={completion}
        who={completion === 'waiting' ? queue('LL') : j.completed_by_name ?? '—'}
        detail={completion === 'done' ? t('ph.jc.balanceSummary', { consumed: j.consumed_kg, returned: j.returned_kg }) : undefined} />
      <ActivityStrip icon="⚖" title={t('ph.jcStrips.reconcile')} state={after('reconciled', 'closed') ? 'done' : s === 'completed' ? 'waiting' : 'not_reached'}
        who={after('reconciled', 'closed') ? t('ph.jc.reconciledBy', { by: j.reconciled_by_name ?? '—' }) : s === 'completed' ? queue('PHM') : '—'}
        detail={j.reconciled_basis ? t(`ph.mb.basis.${j.reconciled_basis}`) : undefined} attention={j.reconciled_basis === 'outside_tolerance' || j.reconciled_basis === 'no_tolerance_set'} />
    </>
  );
}

export function fgStrips(f: FgPalletRow, t: (k: string, o?: Record<string, unknown>) => string): ReactNode {
  const queue = (k: string) => t('ph.queue', { roles: k });
  const stamp: StripState = f.status === 'created' ? 'waiting' : 'done';
  const store: StripState = f.status === 'in_storage' ? 'done' : f.status === 'qc_approved' ? 'waiting' : 'not_reached';
  const expired = !!f.qc_valid_until && Date.parse(f.qc_valid_until) < Date.now();
  return (
    <>
      <ActivityStrip icon="▦" title={t('ph.fgStrips.created')} state="done" who={f.created_by_name ?? '—'}
        detail={`${f.box_count} × · ${f.net_kg} kg · ${f.scale_code ?? ''}`} attention={f.calibration_flag} />
      <ActivityStrip icon="🔬" title={t('ph.fgStrips.qc2')} state="done" who={f.qc2_by_name ?? '—'} detail={f.qc2_code ?? undefined} />
      <ActivityStrip icon="🏷" title={t('ph.fgStrips.label')} state={f.label_print_count > 0 ? 'done' : 'waiting'}
        who={f.label_print_count > 0 ? t('ph.fg.printed', { n: f.label_print_count }) : queue('PHO')} />
      <ActivityStrip icon="✔" title={t('ph.fgStrips.stamp')} state={stamp} attention={expired}
        who={stamp === 'waiting' ? queue('QCI') : f.qc_approved_by_name ?? '—'}
        detail={f.qc_valid_until ? `${expired ? t('ph.fg.expired') : t('ph.fg.validUntil')} ${new Date(f.qc_valid_until).toISOString().slice(0, 16).replace('T', ' ')}` : undefined} />
      <ActivityStrip icon="▣" title={t('ph.fgStrips.storage')} state={store} who={store === 'waiting' ? queue('PHO') : f.location_code ?? '—'} />
      <ActivityStrip icon="🚚" title={t('ph.fgStrips.dispatch')} state="later" who={t('ph.laterIncrement', { m: 'M3' })} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Board panels
type PanelAction = { key: string; perm: string };

/** Next steps a Job Card offers on the board; the record view asks the server (ph_job_card_actions), which also checks every call. */
function jobCardNext(j: JobCardRow): PanelAction[] {
  switch (j.status) {
    case 'draft': return [{ key: 'approve', perm: 'job_card.approve' }];
    case 'planned': return [{ key: 'issue_input', perm: 'job_card.record_inputs' }, { key: 'issue_packaging', perm: 'packaging.issue' },
      { key: 'mark_ready', perm: 'job_card.execute' }];
    case 'ready': return [j.line_start_inspection_id ? { key: 'confirm_start', perm: 'line_start.submit' } : { key: 'line_start_check', perm: 'line_start.submit' }];
    case 'line_check_failed': return [{ key: 'line_corrected', perm: 'job_card.execute' }];
    case 'in_progress': return [{ key: 'qc2', perm: 'qc2.submit' }, { key: 'create_fg', perm: 'fg_pallet.create' }, { key: 'record_waste', perm: 'waste.create' },
      { key: 'pause', perm: 'job_card.execute' }, { key: 'complete', perm: 'job_card.execute' }];
    case 'paused': return [{ key: 'resume', perm: 'job_card.execute' }, { key: 'record_waste', perm: 'waste.create' }];
    case 'completed': return [{ key: 'record_waste', perm: 'waste.create' }, { key: 'reconcile', perm: 'job_card.close' }];
    case 'reconciled': return [{ key: 'close', perm: 'job_card.close' }];
    default: return [];
  }
}

export function JobCardPanel({ j, perms }: { j: JobCardRow; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const [inputs, setInputs] = useState<JcInputRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[j.status] ?? { tone: 'grey' as const };
  const attention = j.status === 'line_check_failed' || j.status === 'paused' || (j.status === 'in_progress' && j.qc2_result === 'fail');
  const actions = jobCardNext(j).filter((a) => has(perms, a.perm));
  const close = () => setOpen(null);
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  async function start(key: string) {
    setError(null);
    if (key === 'complete') {
      try {
        const { data, error: e } = await db().from('ph_jc_input_list').select('*').eq('job_card_id', j.id).order('created_at').returns<JcInputRow[]>();
        if (e) throw e;
        setInputs(data ?? []);
      } catch (e) { setError(phErrorMessage(t, e)); return; }
    }
    setOpen(key);
  }
  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${attention ? ACCENT_CLASS.red : ACCENT_CLASS[style.tone]}`} aria-label={j.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{j.code}</bdi></h3>
        <Link className={btnCls} to={`/office/packing-house/job-cards/${j.id}`}>👁 {t('ph.panel.fullRecord')}</Link>
        {actions.map((a) => <button key={a.key} type="button" className={primaryBtnCls} onClick={() => void start(a.key)}>{t(`ph.jcActions.${a.key}`)}</button>)}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {j.qc2_result === 'fail' && j.status === 'in_progress' && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">✕ {t('ph.jc.qc2Failed')}</span>}
          <StatusPill status={j.status} workflow="ph_job_card" />
          <span className="text-xs text-stone-500" title={t('ph.panel.inStageSince')}>⏲ {formatDuration(minutesBetween(j.stage_since))}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.line')}>{localizedName(i18n.language, j.line_name_ar, j.line_name_en)}</Field>
        <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, j.crop_name_ar, j.crop_name_en)}</Field>
        <Field label={t('ph.fields.grade_target')}>{t(`ph.grade.${j.grade_target}`)}</Field>
        <Field label={t('ph.fields.planned_date')}><bdi>{j.planned_date}</bdi></Field>
        <Field label={t('ph.fields.issued_kg')}><bdi>{j.issued_kg} kg</bdi></Field>
        <Field label={t('ph.fields.fg_output')}><bdi>{j.fg_count} · {j.fg_kg} kg</bdi></Field>
        <Field label={t('ph.fields.order_line')}>{j.order_line_code ? <bdi>{j.order_line_code} · {j.customer_name}</bdi> : <span className="text-stone-500">{t('ph.order.stock')}</span>}</Field>
        <Field label={t('ph.fields.customer_spec_ref')}>{j.customer_spec_ref ?? <span className="text-amber-800">{t('ph.jc.noSpec')}</span>}</Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">{jobCardStrips(j, t)}</div>
      {error && <div className="px-3 pb-3"><ErrorBox message={error} /></div>}
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.jcActions.${open}`)} onClose={close}>
            <JobCardActionForm action={open} jc={j} inputs={inputs} onDone={() => done(open)} onCancel={close} />
          </ActionPanel>
        </div>
      )}
    </article>
  );
}

function fgNext(f: FgPalletRow): PanelAction[] {
  switch (f.status) {
    case 'created': return [{ key: 'print_label', perm: 'fg_pallet.create' }, { key: 'qc_approve', perm: 'qc2.submit' }];
    case 'qc_approved': return [{ key: 'move', perm: 'stock_move.execute' }, { key: 'move', perm: 'stock_move.override_placement' }, { key: 'print_label', perm: 'fg_pallet.create' }];
    case 'in_storage': return [{ key: 'move', perm: 'stock_move.execute' }, { key: 'split', perm: 'fg_pallet.split_merge' }, { key: 'merge', perm: 'fg_pallet.split_merge' }];
    default: return [];
  }
}

export function FgPalletPanel({ f, perms }: { f: FgPalletRow; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const style = STATUS_STYLE[f.status] ?? { tone: 'grey' as const };
  const expired = !!f.qc_valid_until && Date.parse(f.qc_valid_until) < Date.now();
  const actions = fgNext(f).filter((a) => has(perms, a.perm)).filter((a, i, list) => list.findIndex((b) => b.key === a.key) === i);
  const close = () => setOpen(null);
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${expired || f.calibration_flag ? ACCENT_CLASS.amber : ACCENT_CLASS[style.tone]}`} aria-label={f.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{f.code}</bdi></h3>
        <Link className={btnCls} to={`/office/packing-house/fg-pallets/${f.id}`}>👁 {t('ph.panel.fullRecord')}</Link>
        {actions.map((a) => <button key={a.key} type="button" className={primaryBtnCls} onClick={() => setOpen(a.key)}>{t(`ph.fgActions.${a.key}`)}</button>)}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {expired && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">⏰ {t('ph.fg.expired')}</span>}
          <StatusPill status={f.status} workflow="ph_fg_pallet" />
          <span className="text-xs text-stone-500" title={t('ph.panel.inStageSince')}>⏲ {formatDuration(minutesBetween(f.stage_since))}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.job_card')}><Link className="underline" to={`/office/packing-house/job-cards/${f.job_card_id}`}><bdi>{f.job_card_code}</bdi></Link></Field>
        <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, f.crop_name_ar, f.crop_name_en)}</Field>
        <Field label={t('ph.fields.grade')}>{t(`ph.grade.${f.grade}`)}</Field>
        <Field label={t('ph.fields.box_count')}><bdi>{f.box_count}</bdi></Field>
        <Field label={t('ph.fields.net_kg')}><bdi>{f.net_kg} kg</bdi></Field>
        <Field label={t('ph.fields.lot')}><bdi>{f.lot_codes || '—'}</bdi></Field>
        <Field label={t('ph.fields.location')}><bdi>{f.location_code ?? '—'}</bdi></Field>
        <Field label={t('ph.fields.order_line')}>{f.order_line_code ? <bdi>{f.order_line_code} · {f.customer_name}</bdi> : <span className="text-stone-500">{t('ph.order.stock')}</span>}</Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">{fgStrips(f, t)}</div>
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.fgActions.${open}`)} onClose={close}>
            <FgActionForm action={open} fg={f} canOverride={has(perms, 'stock_move.override_placement')} onDone={() => done(open)} onCancel={close} />
          </ActionPanel>
        </div>
      )}
    </article>
  );
}
