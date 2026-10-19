import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import type { Locale } from '@/core/i18n';
import {
  db, localizedName, rpc, uploadPhoto, useArrivals, useInvalidatePh, useMyPhPermissions, usePallet, usePallets,
  type ActionAvailability,
} from './api';
import {
  ArrivalCheckForm, HoldForm, LabelForm, MoveForm, Qc1Form, RecheckForm, RmaForm, SimpleActionForm,
} from './forms';
import { phErrorMessage } from './phErrors';
import { palletStrips } from './panels';
import { PALLET_PATH, formatDuration, minutesBetween, pathIndex } from './stages';
import { ActionPanel, ErrorBox, Field, ReasonNote, StatusPill, When, auditValue, btnCls, canPrint, inputCls, plausibilityText, primaryBtnCls } from './ui';

interface HistoryRow { at: string; kind: string; from_status: string | null; to_status: string | null; actor: string | null; comment: string | null;
  permission_basis: string | null; decision_basis: string | null; changes: Record<string, { from: unknown; to: unknown }> | null }
interface MoveRow { id: string; moved_at: string; reason: string | null; group_override_reason: string | null; over_capacity: boolean; permission_basis: string;
  from_code: string | null; to_code: string | null; by_name: string | null }
interface AttachmentRow { id: string; kind: string; mime_type: string; size_bytes: number; sha256: string; caption: string | null; created_at: string;
  entity_type: string; by_name: string | null }

const SECTIONS = ['general', 'receiving', 'quality', 'storage', 'photos', 'history'] as const;

function Thumb({ a }: { a: AttachmentRow }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!a.mime_type.startsWith('image/')) return;
    let alive = true;
    void rpc<{ mime_type: string; base64: string } | null>('ph_attachment_content', { p_id: a.id })
      .then((r) => { if (alive && r) setSrc(`data:${r.mime_type};base64,${r.base64}`); });
    return () => { alive = false; };
  }, [a.id, a.mime_type]);
  return src ? <img src={src} alt={a.caption ?? ''} className="h-28 w-40 rounded border object-cover" />
    : <div className="flex h-28 w-40 items-center justify-center rounded border bg-stone-100 text-3xl" aria-hidden="true">📄</div>;
}

export default function PalletDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const pallet = usePallet(id);
  const pallets = usePallets();
  const arrivals = useArrivals();
  const perms = useMyPhPermissions();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');

  const actions = useQuery({
    queryKey: ['ph', 'pallet_actions', id, pallet.data?.version],
    enabled: !!pallet.data,
    queryFn: () => rpc<ActionAvailability[]>('ph_pallet_actions', { p_pallet: id }),
  });
  const history = useQuery({
    queryKey: ['ph', 'history', id, pallet.data?.version],
    enabled: !!id,
    queryFn: () => rpc<HistoryRow[]>('ph_record_history', { p_entity_type: 'ph_incoming_pallets', p_id: id }),
  });
  const moves = useQuery({
    queryKey: ['ph', 'moves', id, pallet.data?.version],
    enabled: !!id,
    queryFn: async () => {
      const { data, error: e } = await db().from('ph_stock_move_log').select('*').eq('pallet_id', id as string).order('moved_at').returns<MoveRow[]>();
      if (e) throw e;
      return data ?? [];
    },
  });
  const attachments = useQuery({
    queryKey: ['ph', 'attachments', id, pallet.data?.version],
    enabled: !!id,
    queryFn: async () => {
      const { data: ip, error: e1 } = await db().from('ph_incoming_pallets').select('arrival_check_id, rma_id, recheck_id, qc1_id').eq('id', id as string)
        .maybeSingle<{ arrival_check_id: string | null; rma_id: string | null; recheck_id: string | null; qc1_id: string | null }>();
      if (e1) throw e1;
      const inspections = [ip?.arrival_check_id, ip?.rma_id, ip?.recheck_id, ip?.qc1_id].filter(Boolean) as string[];
      const { data, error: e2 } = await db().from('ph_attachment_list').select('*')
        .or(`and(entity_type.eq.ph_incoming_pallets,entity_id.eq.${id}),and(entity_type.eq.ph_inspections,entity_id.in.(${inspections.join(',') || '00000000-0000-0000-0000-000000000000'}))`)
        .order('created_at').returns<AttachmentRow[]>();
      if (e2) throw e2;
      return data ?? [];
    },
  });

  const p = pallet.data;
  const close = () => setOpen(null);
  const done = () => { setOpen(null); void invalidate(); };
  async function direct(fn: string, args: Record<string, unknown>) {
    setError(null);
    try { await rpc(fn, args); await invalidate(); } catch (e) { setError(phErrorMessage(t, e)); }
  }
  function start(action: string) {
    if (!p) return;
    if (action === 'precool_in' || action === 'precool_out') return void direct('ph_precool_scan', { p_pallet: p.id, p_direction: action === 'precool_in' ? 'in' : 'out' });
    if (action === 'regrade_start') return void direct('ph_start_regrade', { p_pallet: p.id });
    setOpen(action);
  }
  async function addPhoto(file: File | undefined) {
    if (!file || !p) return;
    setError(null);
    try { await uploadPhoto(file, caption, { type: 'ph_incoming_pallets', id: p.id }); setCaption(''); await invalidate(); }
    catch (e) { setError(phErrorMessage(t, e)); }
  }

  return (
    <QueryState isLoading={pallet.isLoading} error={pallet.error} isEmpty={!p} emptyText={t('ph.notFound')} onRetry={() => void pallet.refetch()}>
      {p && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/office/packing-house?stage=${p.stage}`} className={btnCls}>← {t('ph.backToBoard')}</Link>
            <h1 className="font-mono text-2xl font-bold"># <bdi>{p.code}</bdi></h1>
            <StatusPill status={p.status} workflow="ph_incoming_pallet" />
            {canPrint() && <button type="button" className={`${btnCls} ms-auto`} onClick={() => window.print()}>🖨 {t('ph.printRecord')}</button>}
          </div>

          <ol className="flex flex-wrap items-center gap-1 rounded-lg border bg-white p-2" aria-label={t('ph.stepper')}>
            {PALLET_PATH.map((s, i) => {
              const idx = pathIndex(p);
              const state = s.milestone ? 'later' : i < idx ? 'done' : i === idx ? 'current' : 'next';
              return (
                <li key={s.key} className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${state === 'current' ? 'bg-brand font-semibold text-white'
                    : state === 'done' ? 'bg-green-100 text-green-900' : state === 'later' ? 'bg-stone-100 text-stone-400' : 'bg-stone-100 text-stone-600'}`}
                    aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-bold text-stone-800">{state === 'done' ? '✓' : i + 1}</span>
                    {t(`ph.path.${s.key}`)}{s.milestone ? ` (${t('labels.laterPhase')})` : ''}
                  </span>
                  {i < PALLET_PATH.length - 1 && <span aria-hidden="true" className="text-stone-400">›</span>}
                </li>
              );
            })}
          </ol>

          <div className="flex gap-1.5 overflow-x-auto">{palletStrips(p, t)}</div>

          <div className="grid gap-3 lg:grid-cols-[12rem_1fr_20rem]">
            <nav aria-label={t('ph.sections.label')} className="hidden lg:block">
              <ul className="sticky top-2 flex flex-col gap-1 rounded-lg border bg-white p-2 text-sm">
                {SECTIONS.map((s) => <li key={s}><a className="block rounded px-2 py-1.5 hover:bg-brand-light" href={`#ph-${s}`}>{t(`ph.sections.${s}`)}</a></li>)}
              </ul>
            </nav>

            <div className="flex min-w-0 flex-col gap-3">
              <section id="ph-general" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.general')}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, p.crop_name_ar, p.crop_name_en)} (v{p.crop_version})</Field>
                  <Field label={t('ph.fields.variety_id')}>{p.variety_name_ar ? localizedName(i18n.language, p.variety_name_ar, p.variety_name_en) : '—'}</Field>
                  <Field label={t('ph.fields.source_id')}><bdi>{p.source_code}</bdi> · {localizedName(i18n.language, p.source_name_ar, p.source_name_en)}</Field>
                  <Field label={t('ph.fields.harvest_at')}><When iso={p.harvest_at} /></Field>
                  <Field label={t('ph.fields.box_count')}><bdi>{p.box_count}</bdi></Field>
                  <Field label={t('ph.fields.net_kg')}><bdi>{p.net_kg} kg{p.pre_regrade_net_kg ? ` (${t('ph.beforeRegrade')} ${p.pre_regrade_net_kg})` : ''}</bdi></Field>
                  <Field label={t('ph.fields.scale_id')}><bdi>{p.scale_code}</bdi>{p.calibration_flag && <span className="ms-1 text-amber-800">⚠ {t('ph.flags.calibration')}</span>}</Field>
                  <Field label={t('ph.fields.plausibility')} wide>{plausibilityText(t, p.plausibility_note)}</Field>
                  <Field label={t('ph.fields.lot')}>{p.lot_code ? <bdi>{p.lot_code}</bdi> : <span className="text-amber-800">{t('ph.panel.lotPending')}</span>}</Field>
                  <Field label={t('ph.fields.location')}><bdi>{p.location_code ?? '—'}</bdi></Field>
                  <Field label={t('ph.fields.received_at')}><When iso={p.received_at} /></Field>
                  <Field label={t('ph.fields.registered_by')}>{p.registered_by_name ?? '—'}</Field>
                  <Field label={t('ph.fields.age')}><bdi>{formatDuration(minutesBetween(p.received_at))}</bdi>{p.grading_overdue && <span className="ms-1 text-red-800">⏰ {t('ph.flags.gradingOverdue')}</span>}</Field>
                </div>
                {Object.keys(p.decision_basis ?? {}).length > 0 && (
                  <div className="mt-3 rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                    <div className="font-semibold">{t('ph.decisionBasis')}</div>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {Object.entries(p.decision_basis).map(([k, v]) => (
                        <li key={k} className={`rounded px-2 py-0.5 font-mono text-xs ${String(v).startsWith('demo:') ? 'bg-yellow-200' : 'bg-white'}`}><bdi>{k}: {String(v)}</bdi></li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              <section id="ph-receiving" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.receiving')}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t('ph.fields.arrival')}><bdi>{p.arrival_code}</bdi></Field>
                  <Field label={t('ph.fields.arrived_at')}><When iso={p.arrived_at} /></Field>
                  <Field label={t('ph.fields.gate_no')}><bdi>{p.gate_no ?? '—'}</bdi></Field>
                  <Field label={t('ph.fields.vehicle_plate')}><bdi>{p.vehicle_plate}</bdi></Field>
                  <Field label={t('ph.fields.driver_name')}>{p.driver_name}</Field>
                  <Field label={t('ph.fields.harvest_supervisor')}>{p.harvest_supervisor ?? '—'}</Field>
                </div>
              </section>

              <section id="ph-quality" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.quality')}</h2>
                <table className="w-full text-sm">
                  <thead><tr className="border-b text-stone-500"><th className="p-1 text-start">{t('ph.gate')}</th><th className="p-1 text-start">{t('common.code')}</th>
                    <th className="p-1 text-start">{t('ph.result')}</th><th className="p-1 text-start">{t('ph.by')}</th><th className="p-1 text-start">{t('ph.at')}</th></tr></thead>
                  <tbody>
                    <tr className="border-b"><td className="p-1">G2 · {t('ph.strips.arrivalCheck')}</td><td className="p-1 font-mono"><bdi>{p.arrival_check_code ?? '—'}</bdi></td>
                      <td className="p-1">{p.arrival_check_result ? t(`ph.g2result.${p.arrival_check_result}`) : t('ph.pending')}{p.reject_destination ? ` → ${t(`ph.destination.${p.reject_destination}`)}` : ''}</td>
                      <td className="p-1">{p.arrival_checked_by_name ?? '—'}</td><td className="p-1"><When iso={p.arrival_check_at} /></td></tr>
                    <tr className="border-b"><td className="p-1">ST-04 · {t('ph.strips.precooling')}</td><td className="p-1">—</td>
                      <td className="p-1">{p.dwell_minutes ? t('ph.strips.dwell', { d: formatDuration(Math.round(Number(p.dwell_minutes))) }) : '—'}{p.dwell_exceeded ? ` · ${t('ph.flags.dwell')}` : ''}</td>
                      <td className="p-1">—</td><td className="p-1"><When iso={p.precool_in_at} /></td></tr>
                    <tr className="border-b"><td className="p-1">G3 · {t('ph.strips.qaAcceptance')}</td><td className="p-1 font-mono"><bdi>{p.rma_code ?? '—'}</bdi></td>
                      <td className="p-1">{p.rma_result ? t(`ph.rmaResult.${p.rma_result}`) : t('ph.pending')}{p.qam_review_flag ? ` · ${t('ph.strips.noTolerance')}` : ''}{p.rma_status === 'cosigned' ? ` · ${t('ph.cosigned')}` : ''}
                        {p.qa_reject_reason && <div className="text-red-800">{p.qa_reject_reason}</div>}</td>
                      <td className="p-1">{p.qa_decided_by_name ?? '—'}</td><td className="p-1"><When iso={p.rma_at} /></td></tr>
                    {(p.regraded_by_name || p.recheck_code) && (
                      <tr className="border-b"><td className="p-1">E-04 · {t('ph.regradeLoop')}</td><td className="p-1 font-mono"><bdi>{p.recheck_code ?? '—'}</bdi></td>
                        <td className="p-1">{p.recheck_result ? t(`ph.rmaResult.${p.recheck_result}`) : t('ph.pending')}</td>
                        <td className="p-1">{[p.regraded_by_name, p.reweighed_by_name, p.rechecked_by_name].filter(Boolean).join(' · ')}</td>
                        <td className="p-1"><When iso={p.regrade_done_at} /></td></tr>
                    )}
                    <tr className="border-b"><td className="p-1">G4 · {t('ph.strips.qc1')}</td><td className="p-1 font-mono"><bdi>{p.qc1_code ?? '—'}</bdi></td>
                      <td className="p-1">{p.qc1_code ? t('ph.released') : t('ph.pending')}</td><td className="p-1">{p.released_by_name ?? '—'}</td>
                      <td className="p-1"><When iso={p.qc1_at} /></td></tr>
                    {p.hold_code && (
                      <tr><td className="p-1">X-01 · {t('ph.holds.title')}</td><td className="p-1 font-mono"><bdi>{p.hold_code}</bdi></td>
                        <td className="p-1">{t(`ph.holdType.${p.hold_type}`)} · {t(`ph.status.ph_hold.${p.hold_status}`)}</td><td className="p-1">—</td><td className="p-1">—</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              <section id="ph-storage" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.storage')}</h2>
                {(moves.data ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.noMoves')}</p> : (
                  <ol className="flex flex-col gap-1 text-sm">
                    {moves.data?.map((m) => (
                      <li key={m.id} className="flex flex-wrap gap-2 border-b border-stone-100 pb-1">
                        <When iso={m.moved_at} /> · <bdi>{m.from_code ?? '—'} → {m.to_code ?? t('ph.awaitingQaArea')}</bdi> · {m.by_name}
                        {m.group_override_reason && <span className="text-amber-900">⚠ {t('ph.override')}: {m.group_override_reason}</span>}
                        {m.over_capacity && <span className="text-amber-900">⚠ {t('ph.overCapacity')}</span>}
                        <span className="font-mono text-xs text-stone-500"><bdi>{m.permission_basis}</bdi></span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section id="ph-photos" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.photos')}</h2>
                <div className="flex flex-wrap gap-3">
                  {attachments.data?.map((a) => (
                    <figure key={a.id} className="flex w-40 flex-col gap-1 text-xs">
                      <Thumb a={a} />
                      <figcaption>{a.caption ?? '—'}<br /><span className="text-stone-500">{a.by_name} · <When iso={a.created_at} /></span>
                        <br /><span className="font-mono text-[10px] text-stone-400" title="SHA-256"><bdi>{a.sha256.slice(0, 16)}…</bdi></span></figcaption>
                    </figure>
                  ))}
                  {(attachments.data ?? []).length === 0 && <p className="text-sm text-stone-600">{t('ph.noPhotos')}</p>}
                </div>
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-sm"><span>{t('ph.fields.caption')}</span>
                    <input className={inputCls} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
                  <label className={`${btnCls} cursor-pointer`}>📷 {t('ph.addPhoto')}
                    <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf" capture="environment" className="sr-only"
                      onChange={(e) => void addPhoto(e.target.files?.[0])} /></label>
                </div>
                <p className="mt-1 text-xs text-stone-500">{t('ph.photoStorageNote')}</p>
              </section>

              <section id="ph-history" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.history')}</h2>
                <ol className="flex flex-col gap-1.5 text-sm">
                  {history.data?.map((h, i) => (
                    <li key={i} className="border-b border-stone-100 pb-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <When iso={h.at} />
                        <span className="font-semibold">{!h.actor || h.actor === 'system' ? t('ph.system') : h.actor}</span>
                        {h.kind === 'transition'
                          ? <span>{t(`ph.status.ph_incoming_pallet.${h.from_status}`)} → <strong>{t(`ph.status.ph_incoming_pallet.${h.to_status}`)}</strong></span>
                          : <span className="text-stone-600">{t(`ph.auditAction.${h.kind}`, { defaultValue: h.kind })}</span>}
                        {h.permission_basis && <span className="rounded bg-stone-100 px-1.5 font-mono text-xs"><bdi>{h.permission_basis}</bdi></span>}
                        {h.decision_basis && <span className={`rounded px-1.5 font-mono text-xs ${h.decision_basis.startsWith('demo:') ? 'bg-yellow-200' : 'bg-sky-100'}`}><bdi>{h.decision_basis}</bdi></span>}
                      </div>
                      {h.comment && <div className="text-stone-700">“{h.comment}”</div>}
                      {h.changes && Object.keys(h.changes).length > 0 && (
                        <div className="text-xs text-stone-600">
                          {Object.entries(h.changes).map(([k, v]) => (
                            <span key={k} className="me-3">{t(`ph.fields.${k}`, { defaultValue: k })}: <bdi>{auditValue(v.from, i18n.language as Locale)} → {auditValue(v.to, i18n.language as Locale)}</bdi></span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="flex flex-col gap-2" aria-label={t('ph.actionsTitle')}>
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.actionsTitle')}</h2>
                <ErrorBox message={error} />
                <ul className="flex flex-col gap-2">
                  {actions.data?.map((a) => (
                    <li key={a.action} className="flex flex-col gap-1">
                      <button type="button" disabled={!a.allowed} className={a.allowed ? primaryBtnCls : btnCls} onClick={() => start(a.action)}>
                        {t(`ph.availableActions.${a.action}`)}
                      </button>
                      {a.allowed && a.basis && <span className="text-xs text-stone-500">{t('ph.basis', { basis: a.basis })}</span>}
                      {!a.allowed && a.reason && <ReasonNote reason={a.reason} />}
                    </li>
                  ))}
                  {actions.data?.length === 0 && <li className="text-sm text-stone-600">{t('ph.noActions')}</li>}
                </ul>
              </section>
              {open && (
                <ActionPanel title={t(`ph.panelTitles.${open}`)} onClose={close}>
                  {open === 'print_label' && <LabelForm pallet={p} onDone={done} onCancel={close} />}
                  {open === 'arrival_check' && (() => { const a = arrivals.data?.find((x) => x.id === p.arrival_id);
                    return a ? <ArrivalCheckForm arrival={a} pallets={pallets.data ?? []} onDone={done} onCancel={close} /> : null; })()}
                  {open === 'rma' && <RmaForm pallet={p} candidates={pallets.data ?? []} onDone={done} onCancel={close} />}
                  {open === 'regrade_complete' && <SimpleActionForm fn="ph_complete_regrade" needs={['note']} label={t('ph.next.regradeComplete')}
                    args={(v) => ({ p_pallet: p.id, p_note: v.note })} onDone={done} onCancel={close} />}
                  {open === 'reweigh' && <SimpleActionForm fn="ph_reweigh" needs={['kg', 'scale']} label={t('ph.next.reweigh')}
                    args={(v) => ({ p_pallet: p.id, p_net_kg: Number(v.kg), p_scale: v.scale })} onDone={done} onCancel={close} />}
                  {open === 'recheck' && <RecheckForm pallet={p} onDone={done} onCancel={close} />}
                  {open === 'move' && <MoveForm pallet={p} canOverride={!!perms.data?.has('stock_move.override_placement')} onDone={done} onCancel={close} />}
                  {open === 'qc1_release' && <Qc1Form pallets={[p]} onDone={done} onCancel={close} />}
                  {open === 'raise_hold' && <HoldForm pallets={[p]} onDone={done} onCancel={close} />}
                  {open === 'record_disposition' && <SimpleActionForm fn="ph_record_disposition" needs={['note']} label={t('ph.next.disposition')}
                    hint={t(`ph.forms.dispositionHint.${p.reject_destination ?? 'farm_or_supplier'}`)}
                    args={(v) => ({ p_pallet: p.id, p_comment: v.note })} onDone={done} onCancel={close} />}
                  {open === 'edit_weight' && <SimpleActionForm fn="ph_edit_pallet_weight" needs={['kg', 'note']} label={t('ph.availableActions.edit_weight')}
                    args={(v) => ({ p_pallet: p.id, p_net_kg: Number(v.kg), p_reason: v.note })} onDone={done} onCancel={close} />}
                  {open === 'void_request' && <SimpleActionForm fn="ph_request_void" needs={['note']} label={t('ph.availableActions.void_request')}
                    args={(v) => ({ p_pallet: p.id, p_reason: v.note })} onDone={done} onCancel={close} />}
                  {open === 'void_approve' && <SimpleActionForm fn="ph_approve_void" needs={['note']} label={t('ph.availableActions.void_approve')}
                    hint={p.void_request_reason ?? undefined} args={(v) => ({ p_pallet: p.id, p_comment: v.note })} onDone={done} onCancel={close} />}
                </ActionPanel>
              )}
            </aside>
          </div>
        </section>
      )}
    </QueryState>
  );
}
