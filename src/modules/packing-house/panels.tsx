import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { localizedName, rpc, useInvalidatePh, type ArrivalRow, type PalletRow } from './api';
import { phErrorMessage } from './phErrors';
import { ACCENT_CLASS, STATUS_STYLE, formatDuration, minutesBetween } from './stages';
import {
  ArrivalCheckForm, HoldForm, LabelForm, MoveForm, Qc1Form, RecheckForm, RegisterPalletForm, RmaForm, SimpleActionForm,
  VehicleExceptionForm, VehicleInspectionForm,
} from './forms';
import { IssueForm } from './production';
import { ActionPanel, ActivityStrip, ErrorBox, Field, StatusPill, When, btnCls, primaryBtnCls, type StripState } from './ui';

type Perms = Map<string, string> | undefined;
const has = (perms: Perms, key: string) => !!perms?.has(key);

function who(name: string | null | undefined, queue: string) {
  return name ?? queue;
}

/** Responsibility strips for one incoming pallet: who acted at each gate, or which role queue it waits on. */
export function palletStrips(p: PalletRow, t: (k: string, o?: Record<string, unknown>) => string): ReactNode {
  const s = p.status;
  const queue = (k: string) => t('ph.queue', { roles: k });
  const passed = (...xs: string[]) => xs.includes(s);
  const dwell = p.precool_in_at ? formatDuration(minutesBetween(p.precool_in_at, p.precool_out_at)) : null;

  const checkState: StripState = p.arrival_check_result === 'pass' ? 'done' : p.arrival_check_result === 'reject' ? 'rejected'
    : s === 'registered' ? 'waiting' : s === 'on_hold' ? 'held' : 'not_reached';
  const precoolState: StripState = p.precool_out_at ? 'done' : s === 'pre_cooling' ? 'active'
    : s === 'registered' && p.arrival_check_result === 'pass' ? 'waiting' : 'not_reached';
  const qaState: StripState = p.rma_code ? (p.rma_result === 'accept' || p.recheck_result === 'accept' ? 'done'
    : s === 'waste' ? 'rejected' : 'active')
    : s === 'awaiting_qa' ? 'waiting' : 'not_reached';
  const storeState: StripState = passed('stored', 'released', 'issued', 'consumed') ? 'done' : s === 'accepted' ? 'waiting'
    : s === 'on_hold' && p.held_from_status === 'stored' ? 'held' : 'not_reached';
  const qc1State: StripState = passed('released', 'issued', 'consumed') ? 'done' : s === 'stored' ? 'waiting' : 'not_reached';
  const prodState: StripState = s === 'consumed' ? 'done' : s === 'issued' ? 'active' : s === 'released' ? 'waiting'
    : p.job_card_codes ? 'done' : 'not_reached';

  return (
    <>
      <ActivityStrip icon="⚖" title={t('ph.strips.registration')} state="done"
        who={who(p.registered_by_name, queue('DEC'))} detail={`${p.net_kg} kg · ${p.scale_code ?? ''}`} attention={p.calibration_flag} />
      <ActivityStrip icon="👁" title={t('ph.strips.arrivalCheck')} state={checkState}
        who={checkState === 'waiting' ? queue('QCI · QAO') : who(p.arrival_checked_by_name, '—')}
        detail={p.arrival_check_result ? t(`ph.g2result.${p.arrival_check_result}`) : undefined} />
      <ActivityStrip icon="❄" title={t('ph.strips.precooling')} state={precoolState}
        who={precoolState === 'waiting' ? queue('PHO · DEC') : precoolState === 'not_reached' ? '—' : t('ph.strips.dwell', { d: dwell ?? '—' })}
        detail={p.dwell_exceeded ? t('ph.strips.dwellExceeded') : undefined} attention={p.dwell_exceeded} />
      <ActivityStrip icon="🔬" title={t('ph.strips.qaAcceptance')} state={qaState}
        who={qaState === 'waiting' ? queue('QAO') : s === 'qa_rejected' ? queue('ENG') : s === 'in_regrade' ? who(p.regraded_by_name, queue('ENG'))
          : s === 'awaiting_recheck' ? queue('QCI · QAO') : who(p.rechecked_by_name ?? p.qa_decided_by_name, '—')}
        detail={s === 'qa_rejected' || s === 'in_regrade' || s === 'awaiting_recheck' ? t(`ph.status.ph_incoming_pallet.${s}`)
          : p.rma_code ? `${p.rma_code}${p.qam_review_flag ? ` · ${t('ph.strips.noTolerance')}` : ''}` : undefined}
        attention={s === 'qa_rejected'} />
      <ActivityStrip icon="▣" title={t('ph.strips.storage')} state={storeState}
        who={storeState === 'waiting' ? queue('PHO') : p.location_code ?? '—'}
        detail={p.lot_code ?? undefined} attention={p.grading_overdue} />
      <ActivityStrip icon="✔" title={t('ph.strips.qc1')} state={qc1State}
        who={qc1State === 'waiting' ? queue('QCI') : who(p.released_by_name, '—')} detail={p.qc1_code ?? undefined} />
      <ActivityStrip icon="▶" title={t('ph.strips.production')} state={prodState}
        who={prodState === 'waiting' ? queue('LL') : p.job_card_codes ?? '—'}
        detail={Number(p.issued_open_kg) > 0 || Number(p.consumed_kg) > 0
          ? t('ph.strips.issuedSummary', { issued: p.issued_open_kg, consumed: p.consumed_kg, available: p.available_kg ?? '0' }) : undefined} />
    </>
  );
}

type PanelAction = { key: string; label: string; perm: string };

function nextActions(p: PalletRow): PanelAction[] {
  switch (p.status) {
    case 'registered': return p.arrival_check_result ? [{ key: 'precool_in', label: 'precoolIn', perm: 'precool.record' }]
      : [{ key: 'arrival_check', label: 'arrivalCheck', perm: 'arrival_check.submit' }];
    case 'pre_cooling': return [{ key: 'precool_out', label: 'precoolOut', perm: 'precool.record' }];
    case 'awaiting_qa': return [{ key: 'rma', label: 'rma', perm: 'rma.decide' }];
    case 'qa_rejected': return [{ key: 'regrade_start', label: 'regradeStart', perm: 'regrade.execute' }];
    case 'in_regrade': return p.regrade_done_at ? [{ key: 'reweigh', label: 'reweigh', perm: 'regrade.reweigh' }]
      : [{ key: 'regrade_complete', label: 'regradeComplete', perm: 'regrade.execute' }];
    case 'awaiting_recheck': return [{ key: 'recheck', label: 'recheck', perm: 'rma.recheck' }];
    case 'accepted': return [{ key: 'move', label: 'moveToStorage', perm: 'stock_move.execute' }, { key: 'move', label: 'moveOverride', perm: 'stock_move.override_placement' }];
    case 'stored': return [{ key: 'qc1_release', label: 'qc1', perm: 'qc1.release' }, { key: 'move', label: 'move', perm: 'stock_move.execute' },
      { key: 'raise_hold', label: 'hold', perm: 'hold.raise' }];
    case 'released': return [{ key: 'issue', label: 'issue', perm: 'job_card.record_inputs' }, { key: 'move', label: 'move', perm: 'stock_move.execute' }];
    case 'issued': return Number(p.available_kg) > 0 ? [{ key: 'issue', label: 'issue', perm: 'job_card.record_inputs' }] : [];
    case 'arrival_rejected': return [{ key: 'record_disposition', label: 'disposition', perm: 'incoming_pallet.record_disposition' }];
    default: return [];
  }
}

export function PalletPanel({ p, all, arrivals, perms }: { p: PalletRow; all: PalletRow[]; arrivals: ArrivalRow[]; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[p.status] ?? { tone: 'grey' as const };
  const attention = p.dwell_exceeded || p.grading_overdue || ['qa_rejected', 'on_hold', 'arrival_rejected'].includes(p.status);
  const accent = attention ? ACCENT_CLASS.red : ACCENT_CLASS[style.tone];
  const actions = nextActions(p).filter((a) => has(perms, a.perm))
    .filter((a, i, list) => list.findIndex((b) => b.key === a.key) === i);
  const close = () => setOpen(null);
  const done = () => { setOpen(null); void invalidate(); };

  async function direct(fn: string, args: Record<string, unknown>) {
    setError(null);
    try { await rpc(fn, args); await invalidate(); } catch (e) { setError(phErrorMessage(t, e)); }
  }

  function start(key: string) {
    if (key === 'precool_in') return void direct('ph_precool_scan', { p_pallet: p.id, p_direction: 'in' });
    if (key === 'precool_out') return void direct('ph_precool_scan', { p_pallet: p.id, p_direction: 'out' });
    if (key === 'regrade_start') return void direct('ph_start_regrade', { p_pallet: p.id });
    setOpen(key);
  }

  const arrival = arrivals.find((a) => a.id === p.arrival_id);
  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${accent}`} aria-label={p.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{p.code}</bdi></h3>
        <Link className={btnCls} to={`/office/packing-house/pallets/${p.id}`}>👁 {t('ph.panel.fullRecord')}</Link>
        {has(perms, 'incoming_pallet.print_label') && <button type="button" className={btnCls} onClick={() => setOpen('label')}>🏷 {t('ph.panel.label')}</button>}
        {actions.map((a) => (
          <button key={a.label} type="button" className={primaryBtnCls} onClick={() => start(a.key)}>{t(`ph.next.${a.label}`)}</button>
        ))}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {p.dwell_exceeded && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">⏱ {t('ph.flags.dwell')}</span>}
          {p.grading_overdue && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">⏰ {t('ph.flags.gradingOverdue')}</span>}
          {p.hold_code && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">⏸ <bdi>{p.hold_code}</bdi></span>}
          <StatusPill status={p.status} workflow="ph_incoming_pallet" />
          <span className="text-xs text-stone-500" title={t('ph.panel.inStageSince')}>⏲ {formatDuration(minutesBetween(p.stage_since))}</span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.arrival')}><bdi>{p.arrival_code}</bdi></Field>
        <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, p.crop_name_ar, p.crop_name_en)}
          {p.variety_name_ar && <span className="text-stone-500"> · {localizedName(i18n.language, p.variety_name_ar, p.variety_name_en)}</span>}</Field>
        <Field label={t('ph.fields.source_id')}><bdi>{p.source_kind === 'own_farm' ? `${p.block_code} / ${p.section_code}` : p.supplier_name}</bdi></Field>
        <Field label={t('ph.fields.box_count')}><bdi>{p.box_count}</bdi></Field>
        <Field label={t('ph.fields.net_kg')}><bdi>{p.net_kg} kg</bdi></Field>
        <Field label={t('ph.fields.location')}><bdi>{p.location_code ?? '—'}</bdi></Field>
        <Field label={t('ph.fields.lot')}>{p.lot_code ? <bdi>{p.lot_code}</bdi> : <span className="text-amber-800">{p.decision_basis?.['OD-02'] ? '—' : t('ph.panel.lotPending')}</span>}</Field>
        <Field label={t('ph.fields.vehicle')}><bdi>{p.vehicle_plate}</bdi> · {p.driver_name}</Field>
        <Field label={t('ph.fields.received_at')}><When iso={p.received_at} /></Field>
        <Field label={t('ph.fields.harvest_at')}><When iso={p.harvest_at} /></Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">{palletStrips(p, t)}</div>
      {error && <div className="px-3 pb-3"><ErrorBox message={error} /></div>}
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.panelTitles.${open}`)} onClose={close}>
            {open === 'label' && <LabelForm pallet={p} onDone={done} onCancel={close} />}
            {open === 'arrival_check' && arrival && <ArrivalCheckForm arrival={arrival} pallets={all} onDone={done} onCancel={close} />}
            {open === 'rma' && <RmaForm pallet={p} candidates={all} onDone={done} onCancel={close} />}
            {open === 'regrade_complete' && <SimpleActionForm fn="ph_complete_regrade" needs={['note']} label={t('ph.next.regradeComplete')}
              args={(v) => ({ p_pallet: p.id, p_note: v.note })} onDone={done} onCancel={close} />}
            {open === 'reweigh' && <SimpleActionForm fn="ph_reweigh" needs={['kg', 'scale']} label={t('ph.next.reweigh')}
              args={(v) => ({ p_pallet: p.id, p_net_kg: Number(v.kg), p_scale: v.scale })} onDone={done} onCancel={close} />}
            {open === 'recheck' && <RecheckForm pallet={p} onDone={done} onCancel={close} />}
            {open === 'move' && <MoveForm pallet={p} canOverride={has(perms, 'stock_move.override_placement')} onDone={done} onCancel={close} />}
            {open === 'qc1_release' && <Qc1Form pallets={all.filter((x) => x.status === 'stored')} onDone={done} onCancel={close} />}
            {open === 'raise_hold' && <HoldForm pallets={[p]} onDone={done} onCancel={close} />}
            {open === 'record_disposition' && <SimpleActionForm fn="ph_record_disposition" needs={['note']} label={t('ph.next.disposition')}
              hint={t(`ph.forms.dispositionHint.${p.reject_destination ?? 'farm_or_supplier'}`)}
              args={(v) => ({ p_pallet: p.id, p_comment: v.note })} onDone={done} onCancel={close} />}
            {open === 'issue' && <IssueForm pallet={p} onDone={done} onCancel={close} />}
          </ActionPanel>
        </div>
      )}
    </article>
  );
}

/** SOP-TR / E-02: PHM, QA and top management each sign a vehicle exception. */
const EXCEPTION_SIGNERS = ['PHM', 'QAM', 'TOP'];

export function ArrivalPanel({ a, pallets, perms }: { a: ArrivalRow; pallets: PalletRow[]; perms: Perms }) {
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<string[]>([]);
  const close = () => setOpen(null);
  const done = () => { setOpen(null); void invalidate(); };
  const tone = a.status === 'vehicle_hold' || a.status === 'not_accepted' ? 'red' : a.status === 'submitted' ? 'blue' : 'grey';
  const sigs = a.exception_signatures ?? [];
  const signed = (role: string) => sigs.find((s) => s.role === role);
  // A person signs a vehicle exception once (the database refuses a second signature); offer it only until then.
  const { access } = useAuth();
  const mySigners = (access?.grants ?? []).map((g) => g.roleCode).filter((c) => c.startsWith('ph_'))
    .map((c) => c.slice(3).toUpperCase()).filter((r) => EXCEPTION_SIGNERS.includes(r));
  const mayStillSign = mySigners.length > 0 && !mySigners.some((r) => signed(r));

  async function submit() {
    setError(null);
    try { await rpc('ph_submit_arrival', { p_arrival: a.id }); await invalidate(); } catch (e) { setError(phErrorMessage(t, e)); }
  }

  const buttons: { key: string; perm: string; show: boolean }[] = [
    { key: 'vehicle', perm: 'arrival.vehicle_inspection', show: a.status === 'draft' && !a.vehicle_result },
    { key: 'gate', perm: 'arrival.create', show: a.status === 'draft' && (a.vehicle_result === 'pass' || a.exception_state === 'approved') },
    { key: 'exception', perm: 'arrival.vehicle_exception', show: a.status === 'vehicle_hold' && mayStillSign },
    { key: 'register', perm: 'incoming_pallet.register', show: a.status === 'submitted' },
    { key: 'arrival_check', perm: 'arrival_check.submit', show: a.pallets_awaiting_check > 0 },
  ];
  const vehicleState: StripState = a.vehicle_result === 'pass' ? 'done' : a.vehicle_result === 'fail' ? 'rejected' : 'waiting';
  const gateState: StripState = a.status === 'submitted' || a.status === 'closed' ? 'done' : a.status === 'not_accepted' ? 'rejected'
    : a.status === 'vehicle_hold' ? 'held' : 'waiting';

  return (
    <article className={`rounded-lg border border-stone-200 border-s-4 bg-white shadow-sm ${ACCENT_CLASS[tone]}`} aria-label={a.code}>
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-3 py-2">
        <h3 className="me-1 font-mono text-lg font-bold text-stone-900"># <bdi>{a.code}</bdi></h3>
        {buttons.filter((b) => b.show && has(perms, b.perm)).map((b) => (
          <button key={b.key} type="button" className={primaryBtnCls} onClick={() => (b.key === 'gate' ? void submit() : setOpen(b.key))}>
            {t(`ph.arrivalNext.${b.key}`)}
          </button>
        ))}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {a.late_flag && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900" title={a.late_reason ?? ''}>⏰ {t('ph.flags.late')}</span>}
          <StatusPill status={a.status} workflow="ph_arrival" />
          <span className="text-xs text-stone-500"><When iso={a.arrived_at} /></span>
        </span>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2 sm:grid-cols-4 lg:grid-cols-8">
        <Field label={t('ph.fields.source_id')}><bdi>{a.source_kind === 'own_farm' ? `${a.block_code} / ${a.section_code}` : a.supplier_name}</bdi></Field>
        <Field label={t('ph.fields.variety_id')}>{a.variety_name_ar ? localizedName(i18n.language, a.variety_name_ar, a.variety_name_en) : '—'}</Field>
        <Field label={t('ph.fields.harvest')}><bdi>{a.harvest_date ? `${a.harvest_date} ${a.harvest_time?.slice(0, 5) ?? ''}` : a.supplier_ref ?? '—'}</bdi></Field>
        <Field label={t('ph.fields.harvest_supervisor')}>{a.harvest_supervisor ?? '—'}</Field>
        <Field label={t('ph.fields.vehicle_plate')}><bdi>{a.vehicle_plate}</bdi></Field>
        <Field label={t('ph.fields.driver_name')}>{a.driver_name}</Field>
        <Field label={t('ph.fields.gate_no')}><bdi>{a.gate_no ?? '—'}</bdi></Field>
        <Field label={t('ph.fields.dispatch_note_no')}><bdi>{a.dispatch_note_no ? `${a.dispatch_note_no} · ${a.dispatched_pallets ?? '?'} / ${a.dispatched_boxes ?? '?'}` : t('ph.panel.noDispatchNote')}</bdi></Field>
      </div>
      <div className="flex gap-1.5 overflow-x-auto px-3 pb-3">
        <ActivityStrip icon="🚚" title={t('ph.strips.vehicle')} state={vehicleState}
          who={vehicleState === 'waiting' ? t('ph.queue', { roles: t('ph.pendingOd38') }) : who(a.vehicle_inspected_by_name, '—')}
          detail={a.vehicle_fail_reason ?? a.vehicle_inspection_code ?? undefined} attention={a.vehicle_result === 'fail'} />
        {a.vehicle_result === 'fail' && EXCEPTION_SIGNERS.map((r) => {
          const s = signed(r);
          return <ActivityStrip key={r} icon="✍" title={t('ph.strips.exception', { role: t(`ph.roles.${r}`) })}
            state={!s ? (a.status === 'vehicle_hold' ? 'waiting' : 'not_reached') : s.decision === 'approve' ? 'done' : 'rejected'}
            who={s?.by ?? t('ph.queue', { roles: r })} detail={s ? t(`ph.forms.exception.${s.decision}`) : undefined} />;
        })}
        <ActivityStrip icon="⛩" title={t('ph.strips.gate')} state={gateState} who={gateState === 'waiting' ? t('ph.queue', { roles: 'DEC' }) : t(`ph.status.ph_arrival.${a.status}`)} />
        <ActivityStrip icon="⚖" title={t('ph.strips.registration')} state={a.pallets_registered > 0 ? 'done' : a.status === 'submitted' ? 'waiting' : 'not_reached'}
          who={t('ph.panel.palletsRegistered', { n: a.pallets_registered })} detail={a.pallets_registered > 0 ? `${a.registered_kg} kg` : undefined} />
        <ActivityStrip icon="👁" title={t('ph.strips.arrivalCheck')} state={a.pallets_awaiting_check > 0 ? 'waiting' : a.pallets_registered > 0 ? 'done' : 'not_reached'}
          who={a.pallets_awaiting_check > 0 ? t('ph.panel.awaitingCheck', { n: a.pallets_awaiting_check }) : '—'} />
      </div>
      {registered.length > 0 && (
        <p role="status" className="mx-3 mb-2 rounded bg-green-50 px-3 py-1 text-sm text-green-900">
          {t('ph.panel.justRegistered')} <bdi className="font-mono">{registered.join(', ')}</bdi>
        </p>
      )}
      {error && <div className="px-3 pb-3"><ErrorBox message={error} /></div>}
      {open && (
        <div className="px-3 pb-3">
          <ActionPanel title={t(`ph.panelTitles.${open}`)} onClose={close}>
            {open === 'vehicle' && <VehicleInspectionForm arrival={a} onDone={done} onCancel={close} />}
            {open === 'exception' && <VehicleExceptionForm arrival={a} onDone={done} onCancel={close} />}
            {open === 'register' && <RegisterPalletForm arrival={a} onCancel={close}
              onDone={(code) => { setRegistered([...registered, code]); void invalidate(); }} />}
            {open === 'arrival_check' && <ArrivalCheckForm arrival={a} pallets={pallets} onDone={done} onCancel={close} />}
          </ActionPanel>
        </div>
      )}
    </article>
  );
}
