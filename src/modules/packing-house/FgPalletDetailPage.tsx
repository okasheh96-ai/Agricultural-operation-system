import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { db, localizedName, rpc, useFgPallet, useInvalidatePh, useMyPhPermissions, type ActionAvailability } from './api';
import { FgActionForm, fgStrips } from './production';
import { FG_PATH } from './stages';
import { ActionPanel, Field, ReasonNote, StatusPill, When, btnCls, canPrint, plausibilityText, primaryBtnCls } from './ui';

interface HistoryRow { at: string; kind: string; from_status: string | null; to_status: string | null; actor: string | null; comment: string | null;
  permission_basis: string | null }
interface MoveRow { id: string; moved_at: string; group_override_reason: string | null; over_capacity: boolean; permission_basis: string;
  from_code: string | null; to_code: string | null; by_name: string | null }

/** Finished-goods pallet record view (ST-10, ST-12): composition by lot (GEN-05/06), QC-2 and the QC stamp, storage, history. */
export default function FgPalletDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const fg = useFgPallet(id);
  const perms = useMyPhPermissions();
  const [open, setOpen] = useState<string | null>(null);
  const actions = useQuery({
    queryKey: ['ph', 'fg_actions', id, fg.data?.version],
    enabled: !!fg.data,
    queryFn: () => rpc<ActionAvailability[]>('ph_fg_pallet_actions', { p_fg: id }),
  });
  const history = useQuery({
    queryKey: ['ph', 'history', id, fg.data?.version],
    enabled: !!id,
    queryFn: () => rpc<HistoryRow[]>('ph_record_history', { p_entity_type: 'ph_fg_pallets', p_id: id }),
  });
  const moves = useQuery({
    queryKey: ['ph', 'fg_moves', id, fg.data?.version],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('ph_stock_move_log').select('*').eq('fg_pallet_id', id as string).order('moved_at').returns<MoveRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
  const f = fg.data;
  const close = () => setOpen(null);
  // A form that finishes closes itself only, never a form opened after it.
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  // A split or merged pallet was in storage when it closed: the path shows storage as done.
  const idx = !f ? -1 : f.status === 'split_merged' ? FG_PATH.findIndex((s) => s.key === 'in_storage') + 1 : FG_PATH.findIndex((s) => s.statuses.includes(f.status));

  return (
    <QueryState isLoading={fg.isLoading} error={fg.error} isEmpty={!f} emptyText={t('ph.fg.notFound')} onRetry={() => void fg.refetch()}>
      {f && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/office/packing-house?stage=${f.status === 'in_storage' ? 'fg_storage' : 'fg_pallets'}`} className={btnCls}>← {t('ph.backToBoard')}</Link>
            <h1 className="font-mono text-2xl font-bold"># <bdi>{f.code}</bdi></h1>
            <StatusPill status={f.status} workflow="ph_fg_pallet" />
            {canPrint() && <button type="button" className={`${btnCls} ms-auto`} onClick={() => window.print()}>🖨 {t('ph.printRecord')}</button>}
          </div>

          <ol className="flex flex-wrap items-center gap-1 rounded-lg border bg-white p-2" aria-label={t('ph.stepper')}>
            {FG_PATH.map((s, i) => {
              const state = s.milestone ? 'later' : i < idx ? 'done' : i === idx ? 'current' : 'next';
              return (
                <li key={s.key} className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${state === 'current' ? 'bg-brand font-semibold text-white'
                    : state === 'done' ? 'bg-green-100 text-green-900' : state === 'later' ? 'bg-stone-100 text-stone-400' : 'bg-stone-100 text-stone-600'}`}
                    aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-bold text-stone-800">{state === 'done' ? '✓' : i + 1}</span>
                    {t(`ph.fgPath.${s.key}`)}{s.milestone ? ` (${s.milestone})` : ''}
                  </span>
                  {i < FG_PATH.length - 1 && <span aria-hidden="true" className="text-stone-400">›</span>}
                </li>
              );
            })}
          </ol>

          <div className="flex gap-1.5 overflow-x-auto">{fgStrips(f, t)}</div>

          <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.general')}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t('ph.fields.job_card')}><Link className="underline" to={`/office/packing-house/job-cards/${f.job_card_id}`}><bdi>{f.job_card_code}</bdi></Link> · <bdi>{f.line_code}</bdi></Field>
                  <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, f.crop_name_ar, f.crop_name_en)}</Field>
                  <Field label={t('ph.fields.grade')}>{t(`ph.grade.${f.grade}`)}</Field>
                  <Field label={t('ph.fields.box_count')}><bdi>{f.box_count}</bdi></Field>
                  <Field label={t('ph.fields.net_kg')}><bdi>{f.net_kg} kg</bdi></Field>
                  <Field label={t('ph.fields.scale_id')}><bdi>{f.scale_code}</bdi>{f.calibration_flag && <span className="ms-1 text-amber-800">⚠ {t('ph.flags.calibration')}</span>}</Field>
                  <Field label={t('ph.fields.plausibility')} wide>{plausibilityText(t, f.plausibility_note)}</Field>
                  <Field label={t('ph.fields.harvest_at')}><When iso={f.earliest_harvest_at} /></Field>
                  <Field label={t('ph.fields.created')}>{f.created_by_name ?? '—'} · <When iso={f.created_at} /></Field>
                  <Field label={t('ph.fields.location')}><bdi>{f.location_code ?? '—'}</bdi></Field>
                  <Field label={t('ph.fg.qcStamp')}>{f.qc_approved_by_name ?? '—'} · <When iso={f.qc_approved_at} />
                    {f.qc_stamp_from_code && <span className="block text-xs text-stone-600">{t('ph.fg.stampFrom', { code: f.qc_stamp_from_code })}</span>}</Field>
                  <Field label={t('ph.fields.order_line')}>{f.order_line_code ? <bdi>{f.order_line_code} · {f.customer_name}</bdi> : <span className="text-stone-500">{t('ph.order.stock')}</span>}</Field>
                  <Field label={t('ph.fg.validUntil')}><When iso={f.qc_valid_until} /></Field>
                  <Field label={t('ph.fg.labelPrints')}><bdi>{f.label_print_count}</bdi></Field>
                </div>
              </section>

              {(f.parent_codes.length > 0 || f.child_codes.length > 0) && (
                <section className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
                  <h2 className="mb-1 font-semibold">{t('ph.fg.lineage')}</h2>
                  {f.parent_codes.length > 0 && <p>{t('ph.fg.madeFrom')} {f.parent_codes.map((c) => (
                    <Link key={c} className="me-2 font-mono underline" to={`/office/packing-house/trace?ref=${encodeURIComponent(c)}`}><bdi>{c}</bdi></Link>))}</p>}
                  {f.child_codes.length > 0 && <p>{t('ph.fg.becameInto')} {f.child_codes.map((c) => (
                    <Link key={c} className="me-2 font-mono underline" to={`/office/packing-house/trace?ref=${encodeURIComponent(c)}`}><bdi>{c}</bdi></Link>))}</p>}
                </section>
              )}

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.fg.composition')}</h2>
                <p className="mb-2 text-xs text-stone-600">{t('ph.fg.compositionNote')}</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead><tr className="border-b text-stone-500">
                      <th className="p-1 text-start">{t('ph.fields.pallet')}</th><th className="p-1 text-start">{t('ph.fields.lot')}</th>
                      <th className="p-1 text-start">{t('ph.fields.source_id')}</th><th className="p-1 text-start">kg</th>
                      <th className="p-1 text-start">{t('ph.fg.share')}</th><th className="p-1 text-start">{t('ph.fields.attribution')}</th></tr></thead>
                    <tbody>
                      {f.composition.map((c) => (
                        <tr key={c.pallet_id} className="border-b">
                          <td className="p-1 font-mono"><Link className="underline" to={`/office/packing-house/pallets/${c.pallet_id}`}><bdi>{c.pallet}</bdi></Link></td>
                          <td className="p-1 font-mono"><bdi>{c.lot ?? '—'}</bdi></td><td className="p-1"><bdi>{c.source}</bdi></td>
                          <td className="p-1"><bdi>{c.kg}</bdi></td><td className="p-1"><bdi>{(Number(c.share) * 100).toFixed(1)} %</bdi></td>
                          <td className="p-1">{t(`ph.attribution.${c.method}`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.storage')}</h2>
                {(moves.data ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.noMoves')}</p> : (
                  <ol className="flex flex-col gap-1 text-sm">
                    {moves.data?.map((m) => (
                      <li key={m.id} className="flex flex-wrap gap-2 border-b border-stone-100 pb-1">
                        <When iso={m.moved_at} /> · <bdi>{m.from_code ?? '—'} → {m.to_code ?? '—'}</bdi> · {m.by_name}
                        {m.group_override_reason && <span className="text-amber-900">⚠ {t('ph.override')}: {m.group_override_reason}</span>}
                        {m.over_capacity && <span className="text-amber-900">⚠ {t('ph.overCapacity')}</span>}
                        <span className="font-mono text-xs text-stone-500"><bdi>{m.permission_basis}</bdi></span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.history')}</h2>
                <ol className="flex flex-col gap-1.5 text-sm">
                  {history.data?.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-1.5">
                      <When iso={h.at} />
                      <span className="font-semibold">{!h.actor || h.actor === 'system' ? t('ph.system') : h.actor}</span>
                      {h.kind === 'transition'
                        ? <span>{t(`ph.status.ph_fg_pallet.${h.from_status}`)} → <strong>{t(`ph.status.ph_fg_pallet.${h.to_status}`)}</strong></span>
                        : <span className="text-stone-600">{t(`ph.auditAction.${h.kind}`, { defaultValue: h.kind })}</span>}
                      {h.permission_basis && <span className="rounded bg-stone-100 px-1.5 font-mono text-xs"><bdi>{h.permission_basis}</bdi></span>}
                      {h.comment && <span className="text-stone-700">“{h.comment}”</span>}
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="flex min-w-0 flex-col gap-2" aria-label={t('ph.actionsTitle')}>
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.actionsTitle')}</h2>
                <ul className="flex flex-col gap-2">
                  {actions.data?.map((a) => (
                    <li key={a.action} className="flex flex-col gap-1">
                      <button type="button" disabled={!a.allowed} className={a.allowed ? primaryBtnCls : btnCls} onClick={() => setOpen(a.action)}>
                        {t(`ph.fgActions.${a.action}`)}
                      </button>
                      {a.allowed && a.basis && <span className="text-xs text-stone-500">{t('ph.basis', { basis: a.basis })}</span>}
                      {!a.allowed && a.reason && <ReasonNote reason={a.reason} />}
                    </li>
                  ))}
                  {actions.data?.length === 0 && <li className="text-sm text-stone-600">{t('ph.fg.noActions')}</li>}
                </ul>
              </section>
              {open && (
                <ActionPanel title={t(`ph.fgActions.${open}`)} onClose={close}>
                  <FgActionForm action={open} fg={f} canOverride={!!perms.data?.has('stock_move.override_placement')} onDone={() => done(open)} onCancel={close} />
                </ActionPanel>
              )}
            </aside>
          </div>
        </section>
      )}
    </QueryState>
  );
}
