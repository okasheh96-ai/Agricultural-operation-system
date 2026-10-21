import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import type { Locale } from '@/core/i18n';
import { localizedName, rpc, useFgPallets, useInvalidatePh, useJobCard, useJobCardParts, type ActionAvailability } from './api';
import { JobCardActionForm, jobCardStrips } from './production';
import { JOB_CARD_PATH } from './stages';
import { ActionPanel, Field, ReasonNote, StatusPill, When, auditValue, btnCls, canPrint, primaryBtnCls } from './ui';

interface HistoryRow { at: string; kind: string; from_status: string | null; to_status: string | null; actor: string | null; comment: string | null;
  permission_basis: string | null; decision_basis: string | null; changes: Record<string, { from: unknown; to: unknown }> | null }

const SECTIONS = ['general', 'inputs', 'quality', 'output', 'history'] as const;

/** Job Card record view (ST-08 … ST-10): plan, inputs and packaging, G5 and QC-2, finished pallets, history; actions come from the server. */
export default function JobCardDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const jc = useJobCard(id);
  const parts = useJobCardParts(id, jc.data?.version);
  const fgs = useFgPallets();
  const [open, setOpen] = useState<string | null>(null);
  const actions = useQuery({
    queryKey: ['ph', 'jc_actions', id, jc.data?.version],
    enabled: !!jc.data,
    queryFn: () => rpc<ActionAvailability[]>('ph_job_card_actions', { p_jc: id }),
  });
  const history = useQuery({
    queryKey: ['ph', 'history', id, jc.data?.version],
    enabled: !!id,
    queryFn: () => rpc<HistoryRow[]>('ph_record_history', { p_entity_type: 'ph_job_cards', p_id: id }),
  });
  const j = jc.data;
  const close = () => setOpen(null);
  // A form that finishes closes itself only, never a form opened after it.
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  const outputs = (fgs.data ?? []).filter((f) => f.job_card_id === id);

  return (
    <QueryState isLoading={jc.isLoading} error={jc.error} isEmpty={!j} emptyText={t('ph.jc.notFound')} onRetry={() => void jc.refetch()}>
      {j && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/office/packing-house?stage=production" className={btnCls}>← {t('ph.backToBoard')}</Link>
            <h1 className="font-mono text-2xl font-bold"># <bdi>{j.code}</bdi></h1>
            <StatusPill status={j.status} workflow="ph_job_card" />
            {canPrint() && <button type="button" className={`${btnCls} ms-auto`} onClick={() => window.print()}>🖨 {t('ph.printRecord')}</button>}
          </div>

          <ol className="flex flex-wrap items-center gap-1 rounded-lg border bg-white p-2" aria-label={t('ph.stepper')}>
            {JOB_CARD_PATH.map((s, i) => {
              const idx = JOB_CARD_PATH.findIndex((x) => x.statuses.includes(j.status));
              const state = s.milestone ? 'later' : i < idx ? 'done' : i === idx ? 'current' : 'next';
              return (
                <li key={s.key} className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${state === 'current' ? 'bg-brand font-semibold text-white'
                    : state === 'done' ? 'bg-green-100 text-green-900' : state === 'later' ? 'bg-stone-100 text-stone-400' : 'bg-stone-100 text-stone-600'}`}
                    aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-bold text-stone-800">{state === 'done' ? '✓' : i + 1}</span>
                    {t(`ph.status.ph_job_card.${s.key}`)}{s.milestone ? ` (${s.milestone})` : ''}
                  </span>
                  {i < JOB_CARD_PATH.length - 1 && <span aria-hidden="true" className="text-stone-400">›</span>}
                </li>
              );
            })}
          </ol>

          <div className="flex gap-1.5 overflow-x-auto">{jobCardStrips(j, t)}</div>

          <div className="grid gap-3 lg:grid-cols-[12rem_1fr_20rem]">
            <nav aria-label={t('ph.sections.label')} className="hidden lg:block">
              <ul className="sticky top-2 flex flex-col gap-1 rounded-lg border bg-white p-2 text-sm">
                {SECTIONS.map((s) => <li key={s}><a className="block rounded px-2 py-1.5 hover:bg-brand-light" href={`#jc-${s}`}>{t(`ph.jcSections.${s}`)}</a></li>)}
              </ul>
            </nav>

            <div className="flex min-w-0 flex-col gap-3">
              <section id="jc-general" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.jcSections.general')}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t('ph.fields.line')}>{localizedName(i18n.language, j.line_name_ar, j.line_name_en)}</Field>
                  <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, j.crop_name_ar, j.crop_name_en)}</Field>
                  <Field label={t('ph.fields.grade_target')}>{t(`ph.grade.${j.grade_target}`)}</Field>
                  <Field label={t('ph.fields.planned_date')}><bdi>{j.planned_date}</bdi></Field>
                  <Field label={t('ph.fields.customer_spec_ref')}>{j.customer_spec_ref ?? <span className="text-amber-800">{t('ph.jc.noSpec')}</span>}</Field>
                  <Field label={t('ph.fields.attribution')}>{t(`ph.attribution.${j.attribution_method}`)}</Field>
                  <Field label={t('ph.fields.created')}>{j.created_by_name ?? '—'} · <When iso={j.created_at} /></Field>
                  <Field label={t('ph.fields.approved_by')}>{j.approved_by_name ?? '—'}</Field>
                  <Field label={t('ph.fields.started_by')}>{j.started_by_name ?? '—'}</Field>
                  <Field label={t('ph.fields.notes')} wide>{j.notes ?? '—'}</Field>
                </div>
                {Object.keys(j.decision_basis ?? {}).length > 0 && (
                  <div className="mt-3 rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                    <div className="font-semibold">{t('ph.decisionBasis')}</div>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {Object.entries(j.decision_basis).map(([k, v]) => <li key={k} className="rounded bg-white px-2 py-0.5 font-mono text-xs"><bdi>{k}: {String(v)}</bdi></li>)}
                    </ul>
                  </div>
                )}
              </section>

              <section id="jc-inputs" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.jcSections.inputs')}</h2>
                {(parts.data?.inputs ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.jc.noInputs')}</p> : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead><tr className="border-b text-stone-500">
                        <th className="p-1 text-start">{t('ph.fields.pallet')}</th><th className="p-1 text-start">{t('ph.fields.lot')}</th>
                        <th className="p-1 text-start">{t('ph.fields.issued_kg')}</th><th className="p-1 text-start">{t('ph.fields.consumed_kg')}</th>
                        <th className="p-1 text-start">{t('ph.fields.returned_kg')}</th><th className="p-1 text-start">{t('ph.by')}</th><th className="p-1 text-start">{t('ph.at')}</th></tr></thead>
                      <tbody>
                        {parts.data?.inputs.map((x) => (
                          <tr key={x.id} className="border-b">
                            <td className="p-1 font-mono"><Link className="underline" to={`/office/packing-house/pallets/${x.pallet_id}`}><bdi>{x.pallet_code}</bdi></Link></td>
                            <td className="p-1 font-mono"><bdi>{x.lot_code ?? '—'}</bdi></td><td className="p-1"><bdi>{x.issued_kg}</bdi></td>
                            <td className="p-1"><bdi>{x.consumed_kg ?? '—'}</bdi></td><td className="p-1"><bdi>{x.returned_kg ?? '—'}</bdi></td>
                            <td className="p-1">{x.issued_by_name ?? '—'}</td><td className="p-1"><When iso={x.created_at} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <h3 className="mt-3 font-semibold">{t('ph.jc.packaging')}</h3>
                {(parts.data?.packaging ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.jc.noPackaging')}</p> : (
                  <ul className="text-sm">
                    {parts.data?.packaging.map((k) => <li key={k.id}>{k.description} · <bdi>{k.quantity} {k.unit_code}</bdi> · {k.issued_by_name} · <When iso={k.created_at} /></li>)}
                  </ul>
                )}
              </section>

              <section id="jc-quality" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.jcSections.quality')}</h2>
                {(parts.data?.inspections ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.jc.noInspections')}</p> : (
                  <ol className="flex flex-col gap-2 text-sm">
                    {parts.data?.inspections.map((x) => (
                      <li key={x.id} className="border-b border-stone-100 pb-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono"><bdi>{x.code}</bdi></span>
                          <span>{x.inspection_type === 'line_start' ? 'G5 · ' + t('ph.jcStrips.lineStart') : `G6 · ${t('ph.jcStrips.qc2')} · ${t(`ph.qc2Stage.${x.qc2_stage}`)}`}</span>
                          <span className={`rounded px-1.5 text-xs font-semibold ${x.result === 'pass' ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>{t(`ph.inspectionResult.${x.result}`)}</span>
                          <span>{x.by_name}</span><When iso={x.event_at} />
                          {x.tolerance_basis === 'no_tolerance_set' && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">{t('ph.strips.noTolerance')}</span>}
                        </div>
                        {x.reason && <div className="text-red-800">{x.reason}</div>}
                        {x.sample_note && <div className="text-stone-700">{t('ph.fields.sample_note')}: {x.sample_note}</div>}
                        {x.template_source && <div className="text-xs text-stone-500">{t('ph.jc.checklistFrom', { source: x.template_source, evidence: x.template_evidence })}</div>}
                        {Object.keys(x.checklist ?? {}).length > 0 && (
                          <div className="text-xs text-stone-600">{Object.entries(x.checklist).map(([k, v]) => <span key={k} className="me-2"><bdi>{k}: {t(`ph.forms.check.${v}`, { defaultValue: String(v) })}</bdi></span>)}</div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section id="jc-output" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.jcSections.output')}</h2>
                {outputs.length === 0 ? <p className="text-sm text-stone-600">{t('ph.jc.noOutput')}</p> : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {outputs.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2">
                        <Link className="font-mono underline" to={`/office/packing-house/fg-pallets/${f.id}`}><bdi>{f.code}</bdi></Link>
                        <span>{t(`ph.grade.${f.grade}`)} · <bdi>{f.box_count} · {f.net_kg} kg</bdi></span>
                        <StatusPill status={f.status} workflow="ph_fg_pallet" /><bdi>{f.location_code ?? ''}</bdi>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section id="jc-history" className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.jcSections.history')}</h2>
                <ol className="flex flex-col gap-1.5 text-sm">
                  {history.data?.map((h, i) => (
                    <li key={i} className="border-b border-stone-100 pb-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <When iso={h.at} />
                        <span className="font-semibold">{!h.actor || h.actor === 'system' ? t('ph.system') : h.actor}</span>
                        {h.kind === 'transition'
                          ? <span>{t(`ph.status.ph_job_card.${h.from_status}`)} → <strong>{t(`ph.status.ph_job_card.${h.to_status}`)}</strong></span>
                          : <span className="text-stone-600">{t(`ph.auditAction.${h.kind}`, { defaultValue: h.kind })}</span>}
                        {h.permission_basis && <span className="rounded bg-stone-100 px-1.5 font-mono text-xs"><bdi>{h.permission_basis}</bdi></span>}
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

            <aside className="flex min-w-0 flex-col gap-2" aria-label={t('ph.actionsTitle')}>
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.actionsTitle')}</h2>
                <ul className="flex flex-col gap-2">
                  {actions.data?.map((a) => (
                    <li key={a.action} className="flex flex-col gap-1">
                      <button type="button" disabled={!a.allowed} className={a.allowed ? primaryBtnCls : btnCls} onClick={() => setOpen(a.action)}>
                        {t(`ph.jcActions.${a.action}`)}
                      </button>
                      {a.allowed && a.basis && <span className="text-xs text-stone-500">{t('ph.basis', { basis: a.basis })}</span>}
                      {!a.allowed && a.reason && <ReasonNote reason={a.reason} />}
                    </li>
                  ))}
                  {actions.data?.length === 0 && <li className="text-sm text-stone-600">{t('ph.jc.noActions')}</li>}
                </ul>
              </section>
              {open && (
                <ActionPanel title={t(`ph.jcActions.${open}`)} onClose={close}>
                  <JobCardActionForm action={open} jc={j} inputs={parts.data?.inputs ?? []} onDone={() => done(open)} onCancel={close} />
                </ActionPanel>
              )}
            </aside>
          </div>
        </section>
      )}
    </QueryState>
  );
}
