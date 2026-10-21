import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizedName, rpc, uploadPhoto, useInvalidatePh, type WasteRow } from './api';
import { Buttons, ConfirmForm, PhotoInput, ResultChoice, useApproved, useSubmit, type Lookup, type ScaleRow } from './forms';
import type { PhReason } from './phErrors';
import { ACCENT_CLASS, STATUS_STYLE, formatDuration, minutesBetween } from './stages';
import {
  ActionPanel, ActivityStrip, ErrorBox, Field, Labelled, StatusPill, WarningList, btnCls, inputCls, primaryBtnCls, type StripState,
} from './ui';

type Perms = Map<string, string> | undefined;
const has = (perms: Perms, key: string) => !!perms?.has(key);

export type WasteSourceType = 'job_card' | 'fg_pallet' | 'incoming_pallet' | 'location';
export interface WasteSource { type: WasteSourceType; ref: string; label: string }

/** Uploads the chosen photos once per form: a retry after a lost answer reuses the ids instead of storing the files again. */
function usePhotoUpload(caption: string) {
  const done = useRef(new Map<File, string>());
  return async (files: File[]) => {
    const ids: string[] = [];
    for (const file of files) {
      let id = done.current.get(file);
      if (!id) {
        id = (await uploadPhoto(file, caption)).id;
        done.current.set(file, id);
      }
      ids.push(id);
    }
    return ids;
  };
}

// ---------------------------------------------------------------------------------------------
// ST-11 record waste (G7 follows: QC labels it before anyone weighs it, V-16)
export function CreateWasteForm({ source, onDone, onCancel }: { source?: WasteSource; onDone: (id: string) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useApproved<Lookup & { superseded_at: string | null }>('crops_waste', 'ph_crops', 'id, code, name_ar, name_en, verification_status, superseded_at');
  const [f, setF] = useState({ category: 'processed', source_type: source?.type ?? ('job_card' as WasteSourceType), source: source?.ref ?? '',
    crop_id: '', reference_kg: '', bags: '', notes: '' });
  const [files, setFiles] = useState<File[]>([]);
  const upload = usePhotoUpload(t('ph.waste.photoCaption'));
  const s = useSubmit(async (rid) => rpc<{ id: string; code: string }>('ph_create_waste_record', {
    p: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== '')), attachment_ids: await upload(files) }, p_request_id: rid,
  }), (r) => onDone(r.id));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.waste.createHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={t('ph.fields.category')} required>
          <select required className={inputCls} value={f.category} onChange={set('category')}>
            <option value="processed">{t('ph.wasteCategory.processed')}</option>
            <option value="long_storage">{t('ph.wasteCategory.long_storage')}</option>
            <option value="packaging" disabled>{t('ph.wasteCategory.packaging')} — {t('ph.waste.packagingLater')}</option>
            <option value="weight_loss" disabled>{t('ph.wasteCategory.weight_loss')} — {t('ph.waste.weightLossOd')}</option>
          </select>
        </Labelled>
        {source ? (
          <Field label={t('ph.fields.source')}><bdi>{source.label}</bdi></Field>
        ) : (
          <>
            <Labelled label={t('ph.fields.source_type')} required>
              <select required className={inputCls} value={f.source_type} onChange={(e) => setF({ ...f, source_type: e.target.value as WasteSourceType })}>
                {(['job_card', 'fg_pallet', 'incoming_pallet', 'location'] as const).map((k) => <option key={k} value={k}>{t(`ph.wasteSource.${k}`)}</option>)}
              </select>
            </Labelled>
            <Labelled label={t('ph.fields.source')} required hint={t(`ph.waste.sourceHint.${f.source_type}`)}>
              <input required dir="ltr" className={`${inputCls} font-mono`} value={f.source} onChange={set('source')} />
            </Labelled>
          </>
        )}
        {f.source_type === 'location' && (
          <Labelled label={t('ph.fields.crop_id')} required>
            <select required className={inputCls} value={f.crop_id} onChange={set('crop_id')}>
              <option value="">—</option>
              {(crops.data ?? []).filter((c) => !c.superseded_at).map((c) => <option key={c.id} value={c.id}>{localizedName(i18n.language, c.name_ar, c.name_en)}</option>)}
            </select>
          </Labelled>
        )}
        <Labelled label={t('ph.fields.reference_kg')} hint={t('ph.waste.referenceHint')}>
          <input type="number" min={0} step="0.01" dir="ltr" className={inputCls} value={f.reference_kg} onChange={set('reference_kg')} />
        </Labelled>
        <Labelled label={t('ph.fields.bags')}>
          <input type="number" min={0} step="1" dir="ltr" className={inputCls} value={f.bags} onChange={set('bags')} />
        </Labelled>
        <Labelled label={t('ph.fields.notes')}><input className={inputCls} value={f.notes} onChange={set('notes')} /></Labelled>
      </div>
      <PhotoInput files={files} onChange={setFiles} required={f.category === 'long_storage'} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || (f.category === 'long_storage' && files.length === 0)} label={t('ph.waste.create')} onCancel={onCancel} />
    </form>
  );
}

/** Submits a waste record the system drafted at receiving or from a hold (photos optional unless long-storage). */
function WasteSubmitForm({ w, onDone, onCancel }: { w: WasteRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const upload = usePhotoUpload(t('ph.waste.photoCaption'));
  const s = useSubmit(async () => rpc('ph_waste_submit', { p_waste: w.id, p_attachment_ids: await upload(files) }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.waste.submitHint')}</p>
      <PhotoInput files={files} onChange={setFiles} required={w.category === 'long_storage'} />
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.wasteActions.submit')} onCancel={onCancel} />
    </form>
  );
}

/** G7: QC approves the waste label or refuses it (the product goes back to the line). */
function WasteQcForm({ w, onDone, onCancel }: { w: WasteRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const s = useSubmit(() => rpc('ph_waste_qc', { p_waste: w.id, p_decision: decision, p_reason: reason || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.waste.qcHint')}</p>
      <ResultChoice value={decision} onChange={setDecision} options={[
        { key: 'approve', label: t('ph.waste.qcApprove'), good: true }, { key: 'refuse', label: t('ph.waste.qcRefuse'), good: false }]} />
      {decision === 'refuse' && (
        <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      )}
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision} label={t('ph.wasteActions.qc_label')} onCancel={onCancel} />
    </form>
  );
}

/** Weighing after the QC label (V-16); routing to the sign-off follows when OD-11 is decided. */
function WasteWeighForm({ w, onDone, onCancel }: { w: WasteRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const scales = useApproved<ScaleRow>('scales', 'ph_equipment', 'id, code, name_ar, name_en, kind, calibration_due_on, verification_status');
  const [kg, setKg] = useState('');
  const [scale, setScale] = useState('');
  const [bags, setBags] = useState(w.bags ? String(w.bags) : '');
  const [result, setResult] = useState<{ warnings: PhReason[]; status: string } | null>(null);
  const s = useSubmit(() => rpc<{ warnings: PhReason[]; status: string }>('ph_waste_weigh', {
    p_waste: w.id, p_net_kg: Number(kg), p_scale: scale, p_bags: bags ? Number(bags) : null }), (r) => setResult(r));
  if (result) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="rounded bg-green-50 px-3 py-2 text-green-900">{t('ph.waste.weighed', { kg })}</p>
        <WarningList warnings={result.warnings ?? []} />
        <div><button type="button" className={btnCls} onClick={onDone}>{t('ph.forms.done')}</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.waste.weighHint')}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Labelled label={t('ph.fields.net_kg')} required>
          <input required type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={kg} onChange={(e) => setKg(e.target.value)} /></Labelled>
        <Labelled label={t('ph.fields.scale_id')} required>
          <select required className={inputCls} value={scale} onChange={(e) => setScale(e.target.value)}>
            <option value="">—</option>
            {scales.data?.filter((x) => x.kind === 'scale').map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}
          </select></Labelled>
        <Labelled label={t('ph.fields.bags')}>
          <input type="number" min={0} step="1" dir="ltr" className={inputCls} value={bags} onChange={(e) => setBags(e.target.value)} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.wasteActions.weigh')} onCancel={onCancel} />
    </form>
  );
}

function WasteErpForm({ w, onDone, onCancel }: { w: WasteRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [ref, setRef] = useState('');
  const [warnings, setWarnings] = useState<PhReason[] | null>(null);
  const s = useSubmit(() => rpc<{ warnings: PhReason[] }>('ph_waste_erp_ref', { p_waste: w.id, p_ref: ref.trim() }), (r) => setWarnings(r.warnings ?? []));
  if (warnings) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="rounded bg-green-50 px-3 py-2 text-green-900">{t('ph.waste.erpSaved', { ref })}</p>
        <WarningList warnings={warnings} />
        <div><button type="button" className={btnCls} onClick={onDone}>{t('ph.forms.done')}</button></div>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.waste.erpHint')}</p>
      <Labelled label={t('ph.fields.erp_ref')} required>
        <input required dir="ltr" className={`${inputCls} font-mono`} value={ref} onChange={(e) => setRef(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.wasteActions.erp_ref')} onCancel={onCancel} />
    </form>
  );
}

/** Forms for one waste action key (the same keys as ph_waste_actions), shared by the board panel and the record view. */
export function WasteActionForm({ action, w, onDone, onCancel }: { action: string; w: WasteRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const p = { onDone, onCancel };
  switch (action) {
    case 'submit': return <WasteSubmitForm w={w} {...p} />;
    case 'qc_label': return <WasteQcForm w={w} {...p} />;
    case 'weigh': return <WasteWeighForm w={w} {...p} />;
    case 'route': return <ConfirmForm fn="ph_waste_route_now" comment="none" args={() => ({ p_waste: w.id })} label={t('ph.wasteActions.route')}
      hint={t('ph.waste.routeHint')} {...p} />;
    case 'top_mgmt': return <ConfirmForm fn="ph_waste_topmgmt" args={(c) => ({ p_waste: w.id, p_comment: c || null })} label={t('ph.wasteActions.top_mgmt')}
      hint={t('ph.waste.topMgmtHint', { kg: w.net_kg ?? '—' })} {...p} />;
    case 'sign_off': return <ConfirmForm fn="ph_waste_signoff" args={(c) => ({ p_waste: w.id, p_comment: c || null })} label={t('ph.wasteActions.sign_off')}
      hint={t('ph.waste.signHint', { route: t(`ph.wasteRoute.${w.route ?? 'small'}`), roles: (w.required_signers ?? []).join(' · ') })} {...p} />;
    case 'erp_ref': return <WasteErpForm w={w} {...p} />;
    case 'dispose': return <ConfirmForm fn="ph_waste_dispose" args={(c) => ({ p_waste: w.id, p_comment: c || null })} label={t('ph.wasteActions.dispose')}
      hint={t('ph.waste.disposeHint')} {...p} />;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Responsibility strips and the board panel
export function wasteStrips(w: WasteRow, t: (k: string, o?: Record<string, unknown>) => string): ReactNode {
  const s = w.status;
  const queue = (k: string) => t('ph.queue', { roles: k });
  const qc: StripState = s === 'draft' ? 'not_reached' : s === 'awaiting_qc' ? 'waiting' : s === 'returned_to_line' ? 'rejected' : 'done';
  const weigh: StripState = w.weighed_at ? 'done' : s === 'qc_approved' ? 'waiting' : 'not_reached';
  const route: StripState = w.route ? 'done' : s === 'weighed' ? 'waiting' : 'not_reached';
  const signed = w.signoffs ?? [];
  const sign: StripState = ['signed_off', 'erp_posted', 'disposed'].includes(s) ? 'done' : s === 'awaiting_sign_off' ? (signed.length > 0 ? 'active' : 'waiting') : 'not_reached';
  const erp: StripState = w.erp_at ? 'done' : s === 'signed_off' ? 'waiting' : 'not_reached';
  const disposal: StripState = w.disposed_at ? 'done' : s === 'erp_posted' ? 'waiting' : 'not_reached';
  const pending = (w.required_signers ?? []).filter((r) => !signed.some((x) => x.role === r));
  return (
    <>
      <ActivityStrip icon="🗑" title={t('ph.wasteStrips.recorded')} state="done" who={w.created_by_name ?? t('ph.system')}
        detail={`${t(`ph.wasteCategory.${w.category}`)} · ${w.source_code ?? '—'}`} />
      <ActivityStrip icon="🏷" title={t('ph.wasteStrips.qc')} state={qc} attention={s === 'returned_to_line'}
        who={qc === 'waiting' ? queue('QCI') : qc === 'not_reached' ? '—' : w.qc_by_name ?? '—'}
        detail={s === 'returned_to_line' ? w.qc_reason ?? undefined : undefined} />
      <ActivityStrip icon="⚖" title={t('ph.wasteStrips.weigh')} state={weigh} attention={w.calibration_flag}
        who={weigh === 'waiting' ? queue('DEC') : w.weighed_by_name ?? '—'} detail={w.net_kg ? `${w.net_kg} kg · ${w.scale_code ?? ''}` : undefined} />
      <ActivityStrip icon="➜" title={t('ph.wasteStrips.route')} state={route} attention={route === 'waiting'}
        who={w.route ? t(`ph.wasteRoute.${w.route}`) : route === 'waiting' ? t('ph.waste.routeBlocked') : '—'} />
      {(w.route === 'top_mgmt' || s === 'awaiting_top_mgmt') && (
        <ActivityStrip icon="🏛" title={t('ph.wasteStrips.topMgmt')} state={w.top_mgmt_at ? 'done' : s === 'awaiting_top_mgmt' ? 'waiting' : 'not_reached'}
          attention={w.top_mgmt_overdue} who={w.top_mgmt_by_name ?? (s === 'awaiting_top_mgmt' ? queue('TOP') : '—')}
          detail={w.top_mgmt_overdue ? t('ph.waste.topMgmtOverdue') : undefined} />
      )}
      <ActivityStrip icon="✍" title={t('ph.wasteStrips.signOff')} state={sign}
        who={sign === 'not_reached' ? '—' : signed.map((x) => `${x.role} ${x.by ?? ''}`.trim()).join(' · ') || queue((w.required_signers ?? []).join(' · '))}
        detail={sign === 'waiting' || sign === 'active' ? t('ph.waste.signersLeft', { roles: pending.join(' · ') || '—' }) : undefined} />
      <ActivityStrip icon="⇄" title={t('ph.wasteStrips.erp')} state={erp} who={erp === 'waiting' ? queue('DEC') : w.erp_by_name ?? '—'} detail={w.erp_ref ?? undefined} />
      <ActivityStrip icon="■" title={t('ph.wasteStrips.disposal')} state={disposal} who={disposal === 'waiting' ? queue('DEC') : w.disposed_by_name ?? '—'} />
    </>
  );
}

type PanelAction = { key: string; perm: string };

/** Next step on the board (a hint; the record view asks the server, which also checks every call). */
function wasteNext(w: WasteRow): PanelAction[] {
  switch (w.status) {
    case 'draft': return [{ key: 'submit', perm: 'waste.create' }];
    case 'awaiting_qc': return [{ key: 'qc_label', perm: 'waste.qc_label' }];
    case 'qc_approved': return [{ key: 'weigh', perm: 'waste.create' }];
    case 'weighed': return [{ key: 'route', perm: 'waste.create' }];
    case 'awaiting_top_mgmt': return [{ key: 'top_mgmt', perm: 'waste.topmgmt' }];
    case 'awaiting_sign_off': return [{ key: 'sign_off', perm: w.route === 'small' ? 'waste.signoff_small' : 'waste.signoff_large' }];
    case 'signed_off': return [{ key: 'erp_ref', perm: 'waste.erp_ref' }];
    case 'erp_posted': return [{ key: 'dispose', perm: 'waste.create' }];
    default: return [];
  }
}

export function wasteSourceLink(w: Pick<WasteRow, 'source_type' | 'source_id'>): string | null {
  if (!w.source_id) return null;
  if (w.source_type === 'job_card') return `/office/packing-house/job-cards/${w.source_id}`;
  if (w.source_type === 'fg_pallet') return `/office/packing-house/fg-pallets/${w.source_id}`;
  if (w.source_type === 'incoming_pallet') return `/office/packing-house/pallets/${w.source_id}`;
  return null;
}

export function WastePanel({ w, perms }: { w: WasteRow; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const style = STATUS_STYLE[w.status] ?? { tone: 'grey' as const };
  const attention = w.top_mgmt_overdue || w.status === 'weighed';
  const actions = wasteNext(w).filter((a) => has(perms, a.perm));
  const close = () => setOpen(null);
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  const src = wasteSourceLink(w);
  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${attention ? ACCENT_CLASS.amber : ACCENT_CLASS[style.tone]}`} aria-label={w.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{w.code}</bdi></h3>
        <Link className={btnCls} to={`/office/packing-house/waste/${w.id}`}>👁 {t('ph.panel.fullRecord')}</Link>
        {actions.map((a) => <button key={a.key} type="button" className={primaryBtnCls} onClick={() => setOpen(a.key)}>{t(`ph.wasteActions.${a.key}`)}</button>)}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {w.top_mgmt_overdue && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">⏰ E-20</span>}
          <StatusPill status={w.status} workflow="ph_waste" />
          <span className="text-xs text-stone-500" title={t('ph.panel.inStageSince')}>⏲ {formatDuration(minutesBetween(w.stage_since))}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.category')}>{t(`ph.wasteCategory.${w.category}`)}</Field>
        <Field label={t('ph.fields.source')}>{src ? <Link className="underline" to={src}><bdi>{w.source_code}</bdi></Link> : <bdi>{w.source_code ?? '—'}</bdi>}</Field>
        <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, w.crop_name_ar, w.crop_name_en) || '—'}</Field>
        <Field label={t('ph.fields.reference_kg')}><bdi>{w.reference_kg ? `${w.reference_kg} kg` : '—'}</bdi></Field>
        <Field label={t('ph.fields.net_kg')}><bdi>{w.net_kg ? `${w.net_kg} kg` : '—'}</bdi></Field>
        <Field label={t('ph.fields.bags')}><bdi>{w.bags ?? '—'}</bdi></Field>
        <Field label={t('ph.fields.route')}>{w.route ? t(`ph.wasteRoute.${w.route}`) : '—'}</Field>
        <Field label={t('ph.sections.photos')}><bdi>{w.attachment_count}</bdi></Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">{wasteStrips(w, t)}</div>
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.wasteActions.${open}`)} onClose={close}>
            <WasteActionForm action={open} w={w} onDone={() => done(open)} onCancel={close} />
          </ActionPanel>
        </div>
      )}
    </article>
  );
}
