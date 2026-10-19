import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  localizedName, rpc, uploadPhoto, useInvalidatePh, useLookup,
  type ArrivalRow, type PalletRow,
} from './api';
import { phErrorMessage, phReason, type PhReason } from './phErrors';
import { ErrorBox, Labelled, WarningList, btnCls, canPrint, inputCls, primaryBtnCls } from './ui';

interface Lookup { id: string; code: string; name_ar: string; name_en: string | null; verification_status: string }
interface SourceRow extends Lookup { kind: 'own_farm' | 'supplier' }
interface VarietyRow extends Lookup { crop_code: string }
interface CropRow extends Lookup { version_no: number; boxes_per_pallet: number | null; superseded_at: string | null; nominal_kg_per_pallet: string | null }
interface ScaleRow extends Lookup { calibration_due_on: string | null; kind: string }
interface LocationRow { id: string; code: string; name_ar: string; name_en: string | null; purpose: string; capacity_pallets: number | null;
  occupancy: number; storage_group_code: string | null; storage_group_name_ar: string | null; storage_group_name_en: string | null; verification_status: string }
interface TemplateRow { id: string; inspection_type: string; version_no: number; items: { code: string; en: string; ar: string }[]; note: string | null; evidence: string }

function useSubmit<T>(fn: () => Promise<T>, onDone: (r: T) => void) {
  const { t } = useTranslation();
  const invalidate = useInvalidatePh();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<PhReason | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setReason(null);
    try {
      const r = await fn();
      await invalidate();
      onDone(r);
    } catch (err) {
      setReason(phReason(err));
      setError(phErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }
  return { submit, error, reason, busy };
}

function useApproved<T extends Lookup>(key: string, table: string, select: string) {
  return useLookup<T>(key, table, select, (q) => q.eq('verification_status', 'verified'));
}

export function useTemplate(type: string) {
  const q = useLookup<TemplateRow>(`template_${type}`, 'ph_inspection_templates', 'id, inspection_type, version_no, items, note, evidence',
    (x) => x.eq('inspection_type', type));
  return q.data?.find((r) => r.inspection_type === type) ?? null;
}

/** Checklist per template: OK / Not OK / N/A for each documented item. */
function Checklist({ type, value, onChange }: { type: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const { t, i18n } = useTranslation();
  const tpl = useTemplate(type);
  if (!tpl) return <p className="text-sm text-stone-500">{t('common.loading')}</p>;
  return (
    <fieldset className="rounded border border-stone-200 p-2">
      <legend className="px-1 text-sm font-semibold">{t('ph.forms.checklist')} <span className="text-xs font-normal text-stone-500">
        ({t('ph.forms.templateVersion', { v: tpl.version_no })})</span></legend>
      {tpl.note && <p className="mb-1 text-xs text-stone-600">{tpl.note}</p>}
      <div className="grid gap-1 sm:grid-cols-2">
        {tpl.items.map((it) => (
          <div key={it.code} className="flex items-center justify-between gap-2 border-b border-stone-100 py-1 text-sm">
            <span>{i18n.language === 'en' ? it.en : it.ar}</span>
            <span className="flex gap-1" role="radiogroup" aria-label={i18n.language === 'en' ? it.en : it.ar}>
              {(['ok', 'not_ok', 'na'] as const).map((v) => (
                <button key={v} type="button" role="radio" aria-checked={value[it.code] === v}
                  onClick={() => onChange({ ...value, [it.code]: v })}
                  className={`rounded border px-2 py-0.5 text-xs ${value[it.code] === v
                    ? v === 'ok' ? 'border-green-600 bg-green-600 text-white' : v === 'not_ok' ? 'border-red-600 bg-red-600 text-white' : 'border-stone-600 bg-stone-600 text-white'
                    : 'border-stone-300 bg-white'}`}>{t(`ph.forms.check.${v}`)}</button>
              ))}
            </span>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function PhotoInput({ files, onChange, required = false }: { files: File[]; onChange: (f: File[]) => void; required?: boolean }) {
  const { t } = useTranslation();
  return (
    <Labelled label={t('ph.forms.photos')} required={required} hint={t('ph.forms.photosHint')}>
      <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,application/pdf" multiple capture="environment"
        className="text-sm" onChange={(e) => onChange(Array.from(e.target.files ?? []))} />
      {files.length > 0 && <span className="text-xs text-stone-600">{t('ph.forms.photosSelected', { n: files.length })}</span>}
    </Labelled>
  );
}

function Buttons({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={busy} className={primaryBtnCls}>{busy ? t('ph.forms.saving') : label}</button>
      <button type="button" className={btnCls} onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-01 Arrival
export function CreateArrivalForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const sources = useApproved<SourceRow>('sources', 'ph_sources', 'id, code, name_ar, name_en, kind, verification_status');
  const varieties = useApproved<VarietyRow>('varieties', 'ph_varieties', 'id, code, name_ar, name_en, crop_code, verification_status');
  const [f, setF] = useState({ source_id: '', variety_id: '', harvest_date: '', harvest_time: '', harvest_supervisor: '', supplier_ref: '',
    vehicle_plate: '', driver_name: '', gate_no: '', dispatch_note_no: '', dispatched_pallets: '', dispatched_boxes: '', late_reason: '', remarks: '' });
  const src = sources.data?.find((s) => s.id === f.source_id);
  const s = useSubmit(() => rpc('ph_create_arrival', { p: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')) }), () => onDone());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={t('ph.fields.source_id')} required>
          <select required className={inputCls} value={f.source_id} onChange={set('source_id')}>
            <option value="">—</option>
            {sources.data?.map((o) => <option key={o.id} value={o.id}>{o.code} — {localizedName(i18n.language, o.name_ar, o.name_en)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.variety_id')} required={src?.kind === 'own_farm'}>
          <select required={src?.kind === 'own_farm'} className={inputCls} value={f.variety_id} onChange={set('variety_id')}>
            <option value="">—</option>
            {varieties.data?.map((o) => <option key={o.id} value={o.id}>{localizedName(i18n.language, o.name_ar, o.name_en)} ({o.crop_code})</option>)}
          </select>
        </Labelled>
        {src?.kind === 'supplier' ? (
          <Labelled label={t('ph.fields.supplier_ref')} required><input required className={inputCls} value={f.supplier_ref} onChange={set('supplier_ref')} /></Labelled>
        ) : (
          <>
            <Labelled label={t('ph.fields.harvest_date')} required><input required type="date" dir="ltr" className={inputCls} value={f.harvest_date} onChange={set('harvest_date')} /></Labelled>
            <Labelled label={t('ph.fields.harvest_time')} required><input required type="time" dir="ltr" className={inputCls} value={f.harvest_time} onChange={set('harvest_time')} /></Labelled>
            <Labelled label={t('ph.fields.harvest_supervisor')} required><input required className={inputCls} value={f.harvest_supervisor} onChange={set('harvest_supervisor')} /></Labelled>
          </>
        )}
        <Labelled label={t('ph.fields.vehicle_plate')} required><input required dir="ltr" className={inputCls} value={f.vehicle_plate} onChange={set('vehicle_plate')} /></Labelled>
        <Labelled label={t('ph.fields.driver_name')} required><input required className={inputCls} value={f.driver_name} onChange={set('driver_name')} /></Labelled>
        <Labelled label={t('ph.fields.gate_no')}><input dir="ltr" className={inputCls} value={f.gate_no} onChange={set('gate_no')} /></Labelled>
      </div>
      <fieldset className="rounded border border-sky-200 bg-sky-50/40 p-2">
        <legend className="px-1 text-sm font-semibold">{t('ph.forms.dispatchNote')}</legend>
        <p className="mb-2 text-xs text-stone-600">{t('ph.forms.dispatchNoteHint')}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Labelled label={t('ph.fields.dispatch_note_no')}><input dir="ltr" className={inputCls} value={f.dispatch_note_no} onChange={set('dispatch_note_no')} /></Labelled>
          <Labelled label={t('ph.fields.dispatched_pallets')}><input type="number" min={0} inputMode="numeric" className={inputCls} value={f.dispatched_pallets} onChange={set('dispatched_pallets')} /></Labelled>
          <Labelled label={t('ph.fields.dispatched_boxes')}><input type="number" min={0} inputMode="numeric" className={inputCls} value={f.dispatched_boxes} onChange={set('dispatched_boxes')} /></Labelled>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label={t('ph.fields.late_reason')} hint={t('ph.forms.lateHint')}><input className={inputCls} value={f.late_reason} onChange={set('late_reason')} /></Labelled>
        <Labelled label={t('ph.fields.remarks')}><input className={inputCls} value={f.remarks} onChange={set('remarks')} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.forms.createArrival')} onCancel={onCancel} />
    </form>
  );
}

export function VehicleInspectionForm({ arrival, onDone, onCancel }: { arrival: ArrivalRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [result, setResult] = useState<'pass' | 'fail' | ''>('');
  const [reason, setReason] = useState('');
  const s = useSubmit(() => rpc('ph_record_vehicle_inspection', { p_arrival: arrival.id, p_result: result, p_checklist: checks, p_reason: reason || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <Checklist type="vehicle_in" value={checks} onChange={setChecks} />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ph.forms.result')}>
        {(['pass', 'fail'] as const).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={result === r} onClick={() => setResult(r)}
            className={`${btnCls} ${result === r ? (r === 'pass' ? '!border-green-600 !bg-green-600 !text-white' : '!border-red-600 !bg-red-600 !text-white') : ''}`}>
            {t(`ph.forms.vehicle.${r}`)}</button>
        ))}
      </div>
      {result === 'fail' && (
        <Labelled label={t('ph.fields.reason')} required hint={t('ph.forms.vehicleFailHint')}>
          <input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      )}
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !result} label={t('ph.forms.recordInspection')} onCancel={onCancel} />
    </form>
  );
}

export function VehicleExceptionForm({ arrival, onDone, onCancel }: { arrival: ArrivalRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState<'approve' | 'refuse' | ''>('');
  const [comment, setComment] = useState('');
  const s = useSubmit(() => rpc('ph_vehicle_exception_decide', { p_arrival: arrival.id, p_decision: decision, p_comment: comment }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.forms.exceptionHint')}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ph.forms.decision')}>
        {(['approve', 'refuse'] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)}
            className={`${btnCls} ${decision === d ? (d === 'approve' ? '!border-green-600 !bg-green-600 !text-white' : '!border-red-600 !bg-red-600 !text-white') : ''}`}>
            {t(`ph.forms.exception.${d}`)}</button>
        ))}
      </div>
      <Labelled label={t('ph.fields.comment')} required><input required className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision} label={t('ph.forms.sign')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-02 Registration
export function RegisterPalletForm({ arrival, onDone, onCancel }: { arrival: ArrivalRow; onDone: (code: string) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useApproved<CropRow>('crops', 'ph_crops', 'id, code, name_ar, name_en, version_no, boxes_per_pallet, superseded_at, nominal_kg_per_pallet, verification_status');
  const scales = useApproved<ScaleRow>('scales', 'ph_equipment', 'id, code, name_ar, name_en, kind, calibration_due_on, verification_status');
  const current = (crops.data ?? []).filter((c) => !c.superseded_at);
  const defaultCrop = current.find((c) => c.code === arrival.crop_code);
  const [f, setF] = useState({ crop_id: '', box_count: '', net_kg: '', scale_id: '', confirm_plausibility: false });
  const [warnings, setWarnings] = useState<PhReason[]>([]);
  const cropId = f.crop_id || defaultCrop?.id || '';
  const crop = current.find((c) => c.id === cropId);
  const s = useSubmit(async () => {
    const r = await rpc<{ code: string; warnings: PhReason[] }>('ph_register_pallet', { p_arrival: arrival.id, p: {
      crop_id: cropId || undefined, box_count: f.box_count ? Number(f.box_count) : undefined, net_kg: f.net_kg,
      scale_id: f.scale_id, confirm_plausibility: f.confirm_plausibility } });
    setWarnings(r.warnings ?? []);
    return r;
  }, (r) => { setF({ ...f, net_kg: '', box_count: '' }); onDone(r.code); });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labelled label={t('ph.fields.crop_id')} required>
          <select required className={inputCls} value={cropId} onChange={(e) => setF({ ...f, crop_id: e.target.value })}>
            <option value="">—</option>
            {current.map((c) => <option key={c.id} value={c.id}>{localizedName(i18n.language, c.name_ar, c.name_en)} (v{c.version_no})</option>)}
          </select>
        </Labelled>
        <Labelled label={t('ph.fields.box_count')} hint={crop?.boxes_per_pallet ? t('ph.forms.boxesDefault', { n: crop.boxes_per_pallet }) : undefined}>
          <input type="number" min={1} inputMode="numeric" className={inputCls} value={f.box_count} placeholder={crop?.boxes_per_pallet?.toString() ?? ''}
            onChange={(e) => setF({ ...f, box_count: e.target.value })} />
        </Labelled>
        <Labelled label={t('ph.fields.net_kg')} required hint={crop?.nominal_kg_per_pallet ? t('ph.forms.nominal', { kg: crop.nominal_kg_per_pallet }) : undefined}>
          <input required type="number" min={0.01} step="0.01" inputMode="decimal" dir="ltr" className={inputCls} value={f.net_kg}
            onChange={(e) => setF({ ...f, net_kg: e.target.value })} />
        </Labelled>
        <Labelled label={t('ph.fields.scale_id')} required>
          <select required className={inputCls} value={f.scale_id} onChange={(e) => setF({ ...f, scale_id: e.target.value })}>
            <option value="">—</option>
            {scales.data?.filter((x) => x.kind === 'scale').map((x) => (
              <option key={x.id} value={x.id}>{x.code} — {x.calibration_due_on ? t('ph.forms.calibrationDue', { d: x.calibration_due_on }) : t('ph.forms.calibrationUnknown')}</option>
            ))}
          </select>
        </Labelled>
      </div>
      {s.reason?.key === 'ph.v21' && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.confirm_plausibility}
          onChange={(e) => setF({ ...f, confirm_plausibility: e.target.checked })} /> {t('ph.forms.confirmPlausibility')}</label>
      )}
      <p className="text-xs text-stone-600">{t('ph.forms.weighingNote')}</p>
      <WarningList warnings={warnings} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.forms.register')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-03 Arrival check (G2)
export function ArrivalCheckForm({ arrival, pallets, onDone, onCancel }: { arrival: ArrivalRow; pallets: PalletRow[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const due = pallets.filter((p) => p.arrival_id === arrival.id && p.status === 'registered' && !p.arrival_check_result);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [temp, setTemp] = useState('');
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [res, setRes] = useState<Record<string, { result: 'pass' | 'reject'; destination: string; remarks: string }>>({});
  const s = useSubmit(async () => {
    const ids: string[] = [];
    for (const file of files) ids.push((await uploadPhoto(file, t('ph.forms.arrivalCheckPhoto'))).id);
    return rpc('ph_record_arrival_check', {
      p_arrival: arrival.id, p_checklist: checks, p_product_temp: temp ? Number(temp) : null, p_remarks: remarks || null, p_attachment_ids: ids,
      p_results: Object.entries(res).map(([pallet_id, r]) => ({ pallet_id, result: r.result, destination: r.result === 'reject' ? r.destination : null, remarks: r.remarks || null })),
    });
  }, () => onDone());
  if (due.length === 0) return <p className="text-sm text-stone-600">{t('ph.forms.noneAwaitingCheck')}</p>;
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <Checklist type="arrival" value={checks} onChange={setChecks} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label={t('ph.fields.product_temp_c')}><input type="number" step="0.1" inputMode="decimal" dir="ltr" className={inputCls} value={temp} onChange={(e) => setTemp(e.target.value)} /></Labelled>
        <Labelled label={t('ph.fields.remarks')}><input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Labelled>
      </div>
      <fieldset className="rounded border border-stone-200 p-2">
        <legend className="px-1 text-sm font-semibold">{t('ph.forms.perPallet')}</legend>
        <ul className="flex flex-col gap-2">
          {due.map((p) => {
            const r = res[p.id];
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-2">
                <span className="min-w-[14rem] font-mono text-sm"><bdi>{p.code}</bdi></span>
                {(['pass', 'reject'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={r?.result === v}
                    onClick={() => setRes({ ...res, [p.id]: { result: v, destination: r?.destination ?? '', remarks: r?.remarks ?? '' } })}
                    className={`${btnCls} ${r?.result === v ? (v === 'pass' ? '!border-green-600 !bg-green-600 !text-white' : '!border-red-600 !bg-red-600 !text-white') : ''}`}>
                    {t(`ph.forms.g2.${v}`)}</button>
                ))}
                {r?.result === 'reject' && (
                  <>
                    <select required aria-label={t('ph.fields.destination')} className={`${inputCls} !w-auto`} value={r.destination}
                      onChange={(e) => setRes({ ...res, [p.id]: { ...r, destination: e.target.value } })}>
                      <option value="">{t('ph.fields.destination')}…</option>
                      <option value="farm_or_supplier">{t('ph.destination.farm_or_supplier')}</option>
                      <option value="waste_area">{t('ph.destination.waste_area')}</option>
                    </select>
                    <input aria-label={t('ph.fields.remarks')} placeholder={t('ph.fields.remarks')} className={`${inputCls} !w-auto flex-1`} value={r.remarks}
                      onChange={(e) => setRes({ ...res, [p.id]: { ...r, remarks: e.target.value } })} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <PhotoInput files={files} onChange={setFiles} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || Object.keys(res).length === 0} label={t('ph.forms.recordG2')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-04 Pre-cooling scan (barcode scanner as keyboard, or typing)
export function PrecoolScanBar() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [warnings, setWarnings] = useState<PhReason[]>([]);
  const invalidate = useInvalidatePh();
  async function scan(direction: 'in' | 'out') {
    if (!code.trim()) return;
    setMsg(null);
    setWarnings([]);
    try {
      const r = await rpc<{ code: string; status: string; warnings: PhReason[]; dwell_minutes?: number }>('ph_precool_scan', { p_pallet: code.trim(), p_direction: direction });
      setWarnings(r.warnings ?? []);
      setMsg({ ok: true, text: t(`ph.forms.precool.${direction}Done`, { code: r.code, minutes: r.dwell_minutes ?? '' }) });
      setCode('');
      await invalidate();
    } catch (e) {
      setMsg({ ok: false, text: phErrorMessage(t, e) });
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void scan('in'); }} className="flex flex-col gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Labelled label={t('ph.forms.precool.scan')} hint={t('ph.forms.precool.scanHint')}>
          <input autoComplete="off" dir="ltr" className={`${inputCls} font-mono sm:w-80`} value={code} onChange={(e) => setCode(e.target.value)} />
        </Labelled>
        <button type="submit" className={primaryBtnCls}>❄ {t('ph.forms.precool.in')}</button>
        <button type="button" className={btnCls} onClick={() => void scan('out')}>{t('ph.forms.precool.out')}</button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-800' : 'text-red-800'}`}>{msg.text}</p>}
      <WarningList warnings={warnings} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-05 Raw-material acceptance (G3), regrade loop
export function RmaForm({ pallet, candidates, onDone, onCancel }: { pallet: PalletRow; candidates: PalletRow[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const day = (p: PalletRow) => (p.harvest_at ?? p.received_at).slice(0, 10);
  const group = useMemo(() => candidates.filter((p) => p.status === 'awaiting_qa' && p.crop_id === pallet.crop_id && p.source_id === pallet.source_id
    && day(p) === day(pallet)), [candidates, pallet]);
  const [ids, setIds] = useState<string[]>([pallet.id]);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<'accept' | 'reject' | ''>('');
  const [temp, setTemp] = useState('');
  const [sample, setSample] = useState('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const s = useSubmit(async () => {
    const att: string[] = [];
    for (const file of files) att.push((await uploadPhoto(file, t('ph.forms.rmaPhoto'))).id);
    return rpc('ph_submit_rma', { p_pallets: ids, p_decision: decision, p_checklist: checks, p_product_temp: temp ? Number(temp) : null,
      p_sample_note: sample || null, p_reason: reason || null, p_attachment_ids: att });
  }, () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.forms.noToleranceNotice')}</p>
      <fieldset className="rounded border border-stone-200 p-2">
        <legend className="px-1 text-sm font-semibold">{t('ph.forms.rmaPallets')}</legend>
        <div className="flex flex-wrap gap-2">
          {group.map((p) => (
            <label key={p.id} className="flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-sm">
              <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
              <bdi>{p.code}</bdi>
            </label>
          ))}
        </div>
      </fieldset>
      <Checklist type="rma" value={checks} onChange={setChecks} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label={t('ph.fields.product_temp_c')}><input type="number" step="0.1" dir="ltr" className={inputCls} value={temp} onChange={(e) => setTemp(e.target.value)} /></Labelled>
        <Labelled label={t('ph.fields.sample_note')} hint={t('ph.forms.sampleHint')}><input className={inputCls} value={sample} onChange={(e) => setSample(e.target.value)} /></Labelled>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ph.forms.decision')}>
        {(['accept', 'reject'] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)}
            className={`${btnCls} ${decision === d ? (d === 'accept' ? '!border-green-600 !bg-green-600 !text-white' : '!border-red-600 !bg-red-600 !text-white') : ''}`}>
            {t(`ph.forms.rma.${d}`)}</button>
        ))}
      </div>
      {decision === 'reject' && <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>}
      <PhotoInput files={files} onChange={setFiles} required />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision || ids.length === 0} label={t('ph.forms.submitRma')} onCancel={onCancel} />
    </form>
  );
}

export function SimpleActionForm({ fn, args, label, needs, onDone, onCancel, hint }: {
  fn: string; args: (v: { note: string; kg: string; scale: string }) => Record<string, unknown>; label: string;
  needs: ('note' | 'kg' | 'scale')[]; onDone: () => void; onCancel: () => void; hint?: string;
}) {
  const { t } = useTranslation();
  const scales = useApproved<ScaleRow>('scales', 'ph_equipment', 'id, code, name_ar, name_en, kind, calibration_due_on, verification_status');
  const [v, setV] = useState({ note: '', kg: '', scale: '' });
  const s = useSubmit(() => rpc(fn, args(v)), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      {hint && <p className="text-sm text-stone-700">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {needs.includes('kg') && <Labelled label={t('ph.fields.net_kg')} required>
          <input required type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={v.kg} onChange={(e) => setV({ ...v, kg: e.target.value })} /></Labelled>}
        {needs.includes('scale') && <Labelled label={t('ph.fields.scale_id')} required>
          <select required className={inputCls} value={v.scale} onChange={(e) => setV({ ...v, scale: e.target.value })}>
            <option value="">—</option>
            {scales.data?.filter((x) => x.kind === 'scale').map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select></Labelled>}
        {needs.includes('note') && <Labelled label={t('ph.fields.comment')} required>
          <input required className={inputCls} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Labelled>}
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={label} onCancel={onCancel} />
    </form>
  );
}

export function RecheckForm({ pallet, onDone, onCancel }: { pallet: PalletRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<'accept' | 'reject' | ''>('');
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const s = useSubmit(async () => {
    const att: string[] = [];
    for (const file of files) att.push((await uploadPhoto(file, t('ph.forms.recheckPhoto'))).id);
    return rpc('ph_recheck', { p_pallet: pallet.id, p_decision: decision, p_checklist: checks, p_reason: reason || null, p_attachment_ids: att });
  }, () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.forms.recheckHint')}</p>
      <Checklist type="recheck" value={checks} onChange={setChecks} />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('ph.forms.decision')}>
        {(['accept', 'reject'] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={decision === d} onClick={() => setDecision(d)}
            className={`${btnCls} ${decision === d ? (d === 'accept' ? '!border-green-600 !bg-green-600 !text-white' : '!border-red-600 !bg-red-600 !text-white') : ''}`}>
            {t(`ph.forms.recheck.${d}`)}</button>
        ))}
      </div>
      {decision === 'reject' && <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>}
      <PhotoInput files={files} onChange={setFiles} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision} label={t('ph.forms.recordRecheck')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// ST-06 Storage moves
export function MoveForm({ pallet, onDone, onCancel, canOverride }: { pallet: PalletRow; onDone: () => void; onCancel: () => void; canOverride: boolean }) {
  const { t, i18n } = useTranslation();
  const locations = useLookup<LocationRow>('occupancy', 'ph_location_occupancy', '*', undefined, false);
  const choices = (locations.data ?? []).filter((l) => ['harvest_storage', 'sorting'].includes(l.purpose) && l.verification_status === 'verified')
    .sort((a, b) => a.code.localeCompare(b.code));
  const [to, setTo] = useState('');
  const [override, setOverride] = useState('');
  const [warnings, setWarnings] = useState<PhReason[]>([]);
  const s = useSubmit(async () => {
    const r = await rpc<{ warnings: PhReason[] }>('ph_move_pallet', { p_pallet: pallet.id, p_to_location: to, p_override_reason: override || null });
    setWarnings(r.warnings ?? []);
    return r;
  }, () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <Labelled label={t('ph.fields.to_location')} required>
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
// ST-07 QC-1 release
export function Qc1Form({ pallets, onDone, onCancel }: { pallets: PalletRow[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [ids, setIds] = useState<string[]>(pallets.slice(0, 1).map((p) => p.id));
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState('');
  const s = useSubmit(() => rpc('ph_qc1_release', { p_pallets: ids, p_checklist: checks, p_remarks: remarks || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.forms.qc1Notice')}</p>
      <div className="flex flex-wrap gap-2">
        {pallets.map((p) => (
          <label key={p.id} className="flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-sm">
            <input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setIds(e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
            <bdi>{p.code}</bdi>
          </label>
        ))}
      </div>
      <Checklist type="qc1" value={checks} onChange={setChecks} />
      <Labelled label={t('ph.fields.remarks')}><input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || ids.length === 0} label={t('ph.forms.release')} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// X-01 Holds
export function HoldForm({ pallets, onDone, onCancel }: { pallets: PalletRow[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [type, setType] = useState('');
  const [reason, setReason] = useState('');
  const s = useSubmit(() => rpc('ph_raise_hold', { p_type: type, p_reason: reason, p_pallets: pallets.map((p) => p.id) }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <Labelled label={t('ph.fields.hold_type')} required hint={t('ph.forms.holdTypeHint')}>
        <select required className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">—</option>
          {['quality', 'food_safety', 'operational'].map((x) => <option key={x} value={x}>{t(`ph.holdType.${x}`)}</option>)}
        </select>
      </Labelled>
      <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.forms.raiseHold')} onCancel={onCancel} />
    </form>
  );
}

export function HoldStepForm({ holdId, step, holdType, onDone, onCancel }: { holdId: string; step: string; holdType: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [disposition, setDisposition] = useState('');
  const s = useSubmit(() => rpc('ph_hold_step', { p_hold: holdId, p_step: step, p_note: note || null, p_disposition: disposition || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      {step === 'decide' && (
        <Labelled label={t('ph.fields.disposition')} required hint={holdType === 'food_safety' ? t('ph.forms.foodSafetyQam') : undefined}>
          <select required className={inputCls} value={disposition} onChange={(e) => setDisposition(e.target.value)}>
            <option value="">—</option>
            {['release', 'waste', 'regrade', 'rework', 'return', 'concession'].map((d) => (
              <option key={d} value={d} disabled={!['release', 'waste'].includes(d)}>
                {t(`ph.disposition.${d}`)}{['release', 'waste'].includes(d) ? '' : ` — ${t('labels.laterPhase')}`}
              </option>
            ))}
          </select>
        </Labelled>
      )}
      <Labelled label={t('ph.fields.comment')} required={['decide', 'execute', 'cancel'].includes(step)}>
        <input required={['decide', 'execute', 'cancel'].includes(step)} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t(`ph.holdStep.${step}`)} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Receiving label (AT-07): content as printed is what the server logged.
export interface LabelContent {
  pallet_no: string; source: string; block: string | null; section: string | null; supplier: string | null; received_at: string;
  net_kg: string; crop: string; crop_en: string | null; variety: string | null; variety_en: string | null; harvest_at: string | null;
  status: string; barcode: null; barcode_note: string; print_no: number; id_basis: string;
}

export function LabelForm({ pallet, onDone, onCancel }: { pallet: PalletRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [label, setLabel] = useState<LabelContent | null>(null);
  const s = useSubmit(() => rpc<LabelContent>('ph_print_label', { p_pallet: pallet.id, p_reprint_reason: reason || null }), (r) => {
    setLabel(r);
    if (canPrint()) setTimeout(() => window.print(), 50);
  });
  if (label) {
    return (
      <div className="flex flex-col gap-2">
        <div id="ph-label" className="ph-print-area mx-auto w-[22rem] rounded border-2 border-stone-900 bg-white p-3 text-stone-900">
          <div className="text-xs">{t('ph.label.title')} · {t('ph.label.printNo', { n: label.print_no })}</div>
          <div className="font-mono text-2xl font-bold" dir="ltr">{label.pallet_no}</div>
          <dl className="mt-1 grid grid-cols-2 gap-x-2 text-sm">
            <dt>{t('ph.label.crop')}</dt><dd>{label.crop}{label.variety ? ` — ${label.variety}` : ''}</dd>
            <dt>{t('ph.label.source')}</dt><dd><bdi>{label.block ? `${t('ph.label.block')} ${label.block} · ${t('ph.label.section')} ${label.section}` : label.supplier}</bdi></dd>
            <dt>{t('ph.label.received')}</dt><dd><bdi>{label.received_at}</bdi></dd>
            <dt>{t('ph.label.harvest')}</dt><dd><bdi>{label.harvest_at ?? '—'}</bdi></dd>
            <dt>{t('ph.label.weight')}</dt><dd><bdi>{label.net_kg} kg</bdi></dd>
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
      <p className="text-sm text-stone-700">{t('ph.forms.labelHint')}</p>
      {pallet.label_print_count > 0 && <Labelled label={t('ph.fields.reprint_reason')} required>
        <input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>}
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={pallet.label_print_count > 0 ? t('ph.forms.reprint') : t('ph.forms.print')} onCancel={onCancel} />
    </form>
  );
}
