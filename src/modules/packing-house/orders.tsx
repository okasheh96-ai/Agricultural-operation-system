import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { localizedName, rpc, useInvalidatePh, type OrderRow } from './api';
import { Buttons, ConfirmForm, ResultChoice, useApproved, useSubmit, type Lookup } from './forms';
import { ACCENT_CLASS, STATUS_STYLE, formatDuration, minutesBetween } from './stages';
import { ActionPanel, ActivityStrip, ErrorBox, Field, Labelled, StatusPill, When, btnCls, inputCls, primaryBtnCls, type StripState } from './ui';

type Perms = Map<string, string> | undefined;
const has = (perms: Perms, key: string) => !!perms?.has(key);
const GRADES = ['premium', 'gr1', 'gr2'] as const;
const MARKETS = ['export', 'local', 'retail', 'lss'] as const;

interface CropRow extends Lookup { superseded_at: string | null; allowed_lines: string[] }
interface LineRow { id: string; code: string; name_ar: string; name_en: string | null; kind: string; verification_status: string }

const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''));

// ---------------------------------------------------------------------------------------------
// ST-00 / FR-PL-01: Sales enters an order line; the customer is the name Sales gives (no customer master yet).
export function CreateOrderLineForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useApproved<CropRow>('crops_order', 'ph_crops', 'id, code, name_ar, name_en, verification_status, superseded_at, allowed_lines');
  const [f, setF] = useState({ customer_name: '', customer_spec_ref: '', crop_id: '', grade: '', pack_spec: '', quantity: '', quantity_unit: 'kg',
    required_date: '', market_type: '', forecast_ref: '', notes: '' });
  const s = useSubmit((rid) => rpc('ph_create_order_line', { p: clean(f), p_request_id: rid }), () => onDone());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('ph.order.notice')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label={t('ph.fields.customer_name')} required><input required className={inputCls} value={f.customer_name} onChange={set('customer_name')} /></Labelled>
        <Labelled label={t('ph.fields.customer_spec_ref')} hint={t('ph.order.specHint')}><input className={inputCls} value={f.customer_spec_ref} onChange={set('customer_spec_ref')} /></Labelled>
        <Labelled label={t('ph.fields.crop_id')} required>
          <select required className={inputCls} value={f.crop_id} onChange={set('crop_id')}>
            <option value="">—</option>
            {(crops.data ?? []).filter((c) => !c.superseded_at).map((c) => <option key={c.id} value={c.id}>{localizedName(i18n.language, c.name_ar, c.name_en)}</option>)}
          </select></Labelled>
        <Labelled label={t('ph.fields.grade')} required>
          <select required className={inputCls} value={f.grade} onChange={set('grade')}>
            <option value="">—</option>
            {GRADES.map((g) => <option key={g} value={g}>{t(`ph.grade.${g}`)}</option>)}
          </select></Labelled>
        <Labelled label={t('ph.fields.pack_spec')} required hint={t('ph.order.packHint')}><input required className={inputCls} value={f.pack_spec} onChange={set('pack_spec')} /></Labelled>
        <div className="flex min-w-0 gap-2">
          <Labelled label={t('ph.fields.quantity')} required>
            <input required type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={f.quantity} onChange={set('quantity')} /></Labelled>
          <Labelled label={t('ph.fields.quantity_unit')} required>
            <select required className={inputCls} value={f.quantity_unit} onChange={set('quantity_unit')}>
              <option value="kg">{t('ph.order.unit.kg')}</option><option value="pc">{t('ph.order.unit.pc')}</option>
            </select></Labelled>
        </div>
        <Labelled label={t('ph.fields.required_date')} required>
          <input required type="date" dir="ltr" className={inputCls} value={f.required_date} onChange={set('required_date')} /></Labelled>
        <Labelled label={t('ph.fields.market_type')} required>
          <select required className={inputCls} value={f.market_type} onChange={set('market_type')}>
            <option value="">—</option>
            {MARKETS.map((m) => <option key={m} value={m}>{t(`ph.market.${m}`)}</option>)}
          </select></Labelled>
        <Labelled label={t('ph.fields.forecast_ref')}><input className={inputCls} value={f.forecast_ref} onChange={set('forecast_ref')} /></Labelled>
        <Labelled label={t('ph.fields.notes')}><input className={inputCls} value={f.notes} onChange={set('notes')} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.order.create')} onCancel={onCancel} />
    </form>
  );
}

function DecideOrderForm({ o, onDone, onCancel }: { o: OrderRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const s = useSubmit(() => rpc('ph_decide_order_line', { p_line: o.id, p_decision: decision, p_reason: reason.trim() || null }), () => onDone());
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.order.decideHint')}</p>
      <ResultChoice value={decision} onChange={setDecision} options={[
        { key: 'accept', label: t('ph.order.accept'), good: true }, { key: 'reject', label: t('ph.order.reject'), good: false }]} />
      <Labelled label={t('ph.fields.reason')} required={decision === 'reject'}>
        <input required={decision === 'reject'} className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || !decision} label={t('ph.orderActions.decide')} onCancel={onCancel} />
    </form>
  );
}

function AmendOrderForm({ o, onDone, onCancel }: { o: OrderRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ quantity: o.quantity, required_date: o.required_date, pack_spec: o.pack_spec, grade: o.grade as string, notes: '' });
  const [reason, setReason] = useState('');
  const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => v.trim() !== '' && v !== String((o as unknown as Record<string, unknown>)[k] ?? '')));
  const s = useSubmit(() => rpc('ph_amend_order_line', { p_line: o.id, p: changed, p_reason: reason.trim() }), () => onDone());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.order.amendHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Labelled label={`${t('ph.fields.quantity')} (${t(`ph.order.unit.${o.quantity_unit}`)})`}>
          <input type="number" min={0.01} step="0.01" dir="ltr" className={inputCls} value={f.quantity} onChange={set('quantity')} /></Labelled>
        <Labelled label={t('ph.fields.required_date')}><input type="date" dir="ltr" className={inputCls} value={f.required_date} onChange={set('required_date')} /></Labelled>
        <Labelled label={t('ph.fields.pack_spec')}><input className={inputCls} value={f.pack_spec} onChange={set('pack_spec')} /></Labelled>
        <Labelled label={t('ph.fields.grade')}>
          <select className={inputCls} value={f.grade} onChange={set('grade')}>{GRADES.map((g) => <option key={g} value={g}>{t(`ph.grade.${g}`)}</option>)}</select></Labelled>
      </div>
      <Labelled label={t('ph.fields.reason')} required><input required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} /></Labelled>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy || Object.keys(changed).length === 0} label={t('ph.orderActions.amend')} onCancel={onCancel} />
    </form>
  );
}

/** Plans a Job Card for an accepted line: crop and grade come from the line (V-10); the PHM approves the Job Card as usual. */
export function PlanForOrderForm({ o, onDone, onCancel }: { o: OrderRow; onDone: (id: string) => void; onCancel: () => void }) {
  const { t, i18n } = useTranslation();
  const crops = useApproved<CropRow>('crops_order', 'ph_crops', 'id, code, name_ar, name_en, verification_status, superseded_at, allowed_lines');
  const lines = useApproved<LineRow>('lines', 'ph_lines', 'id, code, name_ar, name_en, kind, verification_status');
  const crop = crops.data?.find((c) => c.id === o.crop_id);
  const choices = (lines.data ?? []).filter((l) => l.kind !== 'washer' && (!crop || crop.allowed_lines.length === 0 || crop.allowed_lines.includes(l.code)))
    .sort((a, b) => a.code.localeCompare(b.code));
  const [f, setF] = useState({ line_id: '', planned_date: '', notes: '' });
  const s = useSubmit((rid) => rpc<{ id: string }>('ph_create_job_card_for_order', { p_line: o.id, p: clean(f), p_request_id: rid }), (r) => onDone(r.id));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => void s.submit(e)} className="flex flex-col gap-3">
      <p className="text-sm text-stone-700">{t('ph.order.planHint', { crop: localizedName(i18n.language, o.crop_name_ar, o.crop_name_en), grade: t(`ph.grade.${o.grade}`) })}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Labelled label={t('ph.fields.line')} required>
          <select required className={inputCls} value={f.line_id} onChange={set('line_id')}>
            <option value="">—</option>
            {choices.map((l) => <option key={l.id} value={l.id}>{localizedName(i18n.language, l.name_ar, l.name_en)}</option>)}
          </select></Labelled>
        <Labelled label={t('ph.fields.planned_date')} hint={t('ph.jc.todayDefault')}>
          <input type="date" dir="ltr" className={inputCls} value={f.planned_date} onChange={set('planned_date')} /></Labelled>
        <Labelled label={t('ph.fields.notes')}><input className={inputCls} value={f.notes} onChange={set('notes')} /></Labelled>
      </div>
      <ErrorBox message={s.error} />
      <Buttons busy={s.busy} label={t('ph.jc.create')} onCancel={onCancel} />
    </form>
  );
}

export function OrderActionForm({ action, o, onDone, onCancel }: { action: string; o: OrderRow; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const p = { onDone, onCancel };
  switch (action) {
    case 'decide': return <DecideOrderForm o={o} {...p} />;
    case 'amend': return <AmendOrderForm o={o} {...p} />;
    case 'cancel': return <ConfirmForm fn="ph_cancel_order_line" comment="required" args={(c) => ({ p_line: o.id, p_reason: c })}
      label={t('ph.orderActions.cancel')} hint={t('ph.order.cancelHint')} {...p} />;
    case 'shortage': return <ConfirmForm fn="ph_flag_shortage" comment="required" args={(c) => ({ p_line: o.id, p_note: c })}
      label={t('ph.orderActions.shortage')} hint={t('ph.order.shortageHint', { hours: o.market_type === 'export' ? 48 : 24 })} {...p} />;
    case 'plan': return <PlanForOrderForm o={o} onDone={(id) => { onDone(); navigate(`/office/packing-house/job-cards/${id}`); }} onCancel={onCancel} />;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Responsibility strips and the board panel
export function orderStrips(o: OrderRow, t: (k: string, opts?: Record<string, unknown>) => string): ReactNode {
  const queue = (k: string) => t('ph.queue', { roles: k });
  const decision: StripState = o.status === 'pending_acceptance' ? 'waiting' : o.status === 'rejected' ? 'rejected' : o.decided_at ? 'done' : 'not_reached';
  const production: StripState = o.job_cards > 0 ? 'done' : o.status === 'accepted' ? 'waiting' : 'not_reached';
  const packed: StripState = o.fg_pallets > 0 ? 'active' : o.job_cards > 0 ? 'waiting' : 'not_reached';
  return (
    <>
      <ActivityStrip icon="📝" title={t('ph.orderStrips.entered')} state="done" who={o.created_by_name ?? '—'}
        detail={`${t(`ph.market.${o.market_type}`)} · ${o.required_date}`} />
      <ActivityStrip icon="✍" title={t('ph.orderStrips.decision')} state={decision}
        who={decision === 'waiting' ? queue('PHM') : o.decided_by_name ?? '—'} detail={o.decision_reason ?? undefined} />
      <ActivityStrip icon="📋" title={t('ph.orderStrips.production')} state={production}
        who={o.job_card_codes ?? (production === 'waiting' ? queue('PE · PHM') : '—')} />
      <ActivityStrip icon="▦" title={t('ph.orderStrips.packed')} state={packed}
        who={o.fg_pallets > 0 ? t('ph.order.packedSummary', { n: o.fg_pallets, boxes: o.fg_boxes, kg: o.fg_kg }) : '—'}
        detail={t('ph.order.ordered', { q: o.quantity, unit: t(`ph.order.unit.${o.quantity_unit}`) })} />
      {o.shortage_at && (
        <ActivityStrip icon="⚠" title={t('ph.orderStrips.shortage')} state="done" attention={o.shortage_in_window === false}
          who={o.shortage_by_name ?? '—'} detail={o.shortage_in_window ? t('ph.order.inWindow') : t('ph.order.lateNotice')} />
      )}
      <ActivityStrip icon="🚚" title={t('ph.orderStrips.dispatch')} state="later" who={t('ph.laterIncrement', { m: 'M3' })} />
    </>
  );
}

type PanelAction = { key: string; perm: string };

function orderNext(o: OrderRow): PanelAction[] {
  switch (o.status) {
    case 'pending_acceptance': return [{ key: 'decide', perm: 'customer_order.accept' }, { key: 'amend', perm: 'customer_order.amend' },
      { key: 'cancel', perm: 'customer_order.amend' }];
    case 'accepted': return [{ key: 'plan', perm: 'job_card.create' }, { key: 'shortage', perm: 'customer_order.accept' },
      { key: 'amend', perm: 'customer_order.amend' }, { key: 'cancel', perm: 'customer_order.amend' }];
    default: return [];
  }
}

export function OrderPanel({ o, perms }: { o: OrderRow; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const style = STATUS_STYLE[o.status] ?? { tone: 'grey' as const };
  const actions = orderNext(o).filter((a) => has(perms, a.perm));
  const close = () => setOpen(null);
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${o.status === 'pending_acceptance' ? ACCENT_CLASS.amber : ACCENT_CLASS[style.tone]}`} aria-label={o.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{o.code}</bdi></h3>
        <Link className={btnCls} to={`/office/packing-house/trace?ref=${encodeURIComponent(o.code)}`}>🔎 {t('ph.order.trace')}</Link>
        {actions.map((a) => <button key={a.key} type="button" className={primaryBtnCls} onClick={() => setOpen(a.key)}>{t(`ph.orderActions.${a.key}`)}</button>)}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          <StatusPill status={o.status} workflow="ph_order_line" />
          <span className="text-xs text-stone-500" title={t('ph.panel.inStageSince')}>⏲ {formatDuration(minutesBetween(o.stage_since))}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.customer_name')}>{o.customer_name}</Field>
        <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, o.crop_name_ar, o.crop_name_en)}</Field>
        <Field label={t('ph.fields.grade')}>{t(`ph.grade.${o.grade}`)}</Field>
        <Field label={t('ph.fields.pack_spec')}>{o.pack_spec}</Field>
        <Field label={t('ph.fields.quantity')}><bdi>{o.quantity} {t(`ph.order.unit.${o.quantity_unit}`)}</bdi></Field>
        <Field label={t('ph.fields.required_date')}><bdi>{o.required_date}</bdi></Field>
        <Field label={t('ph.fields.market_type')}>{t(`ph.market.${o.market_type}`)}</Field>
        <Field label={t('ph.fields.customer_spec_ref')}>{o.customer_spec_ref ?? <span className="text-amber-800">{t('ph.jc.noSpec')}</span>}</Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">{orderStrips(o, t)}</div>
      {o.shortage_note && <p className="px-3 pb-2 text-sm text-amber-900">⚠ {o.shortage_note} · <When iso={o.shortage_at} /></p>}
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.orderActions.${open}`)} onClose={close}>
            <OrderActionForm action={open} o={o} onDone={() => done(open)} onCancel={close} />
          </ActionPanel>
        </div>
      )}
    </article>
  );
}
