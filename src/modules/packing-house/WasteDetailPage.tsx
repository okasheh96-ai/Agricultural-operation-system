import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { db, localizedName, rpc, useInvalidatePh, useWaste, type ActionAvailability } from './api';
import { WASTE_PATH } from './stages';
import { ActionPanel, Field, ReasonNote, StatusPill, Thumb, When, btnCls, canPrint, primaryBtnCls, type AttachmentRow } from './ui';
import { WasteActionForm, wasteSourceLink, wasteStrips } from './waste';

interface HistoryRow { at: string; kind: string; from_status: string | null; to_status: string | null; actor: string | null; comment: string | null;
  permission_basis: string | null }

/** Waste record view (ST-11, SM-WR): source, QC label (G7), weight (V-16), route and sign-offs (V-17, SoD-03), ERP and disposal. */
export default function WasteDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const invalidate = useInvalidatePh();
  const waste = useWaste(id);
  const [open, setOpen] = useState<string | null>(null);
  const actions = useQuery({
    queryKey: ['ph', 'waste_actions', id, waste.data?.version],
    enabled: !!waste.data,
    queryFn: () => rpc<ActionAvailability[]>('ph_waste_actions', { p_waste: id }),
  });
  const history = useQuery({
    queryKey: ['ph', 'history', id, waste.data?.version],
    enabled: !!id,
    queryFn: () => rpc<HistoryRow[]>('ph_record_history', { p_entity_type: 'ph_waste_records', p_id: id }),
  });
  const photos = useQuery({
    queryKey: ['ph', 'attachments', id, waste.data?.version],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db().from('ph_attachment_list').select('*').eq('entity_type', 'ph_waste_records').eq('entity_id', id as string)
        .order('created_at').returns<AttachmentRow[]>();
      if (error) throw error;
      return data ?? [];
    },
  });
  const w = waste.data;
  const close = () => setOpen(null);
  // A form that finishes closes itself only, never a form opened after it.
  const done = (key: string) => { setOpen((cur) => (cur === key ? null : cur)); void invalidate(); };
  const idx = w ? WASTE_PATH.findIndex((s) => s.statuses.includes(w.status)) : -1;
  const src = w ? wasteSourceLink(w) : null;

  return (
    <QueryState isLoading={waste.isLoading} error={waste.error} isEmpty={!w} emptyText={t('ph.waste.notFound')} onRetry={() => void waste.refetch()}>
      {w && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/office/packing-house?stage=waste" className={btnCls}>← {t('ph.backToBoard')}</Link>
            <h1 className="font-mono text-2xl font-bold"># <bdi>{w.code}</bdi></h1>
            <StatusPill status={w.status} workflow="ph_waste" />
            {canPrint() && <button type="button" className={`${btnCls} ms-auto`} onClick={() => window.print()}>🖨 {t('ph.printRecord')}</button>}
          </div>

          <ol className="flex flex-wrap items-center gap-1 rounded-lg border bg-white p-2" aria-label={t('ph.stepper')}>
            {WASTE_PATH.map((s, i) => {
              const state = i < idx ? 'done' : i === idx ? 'current' : 'next';
              return (
                <li key={s.key} className="flex items-center gap-1">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ${state === 'current' ? 'bg-brand font-semibold text-white'
                    : state === 'done' ? 'bg-green-100 text-green-900' : 'bg-stone-100 text-stone-600'}`} aria-current={state === 'current' ? 'step' : undefined}>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/80 text-xs font-bold text-stone-800">{state === 'done' ? '✓' : i + 1}</span>
                    {t(`ph.wastePath.${s.key}`)}
                  </span>
                  {i < WASTE_PATH.length - 1 && <span aria-hidden="true" className="text-stone-400">›</span>}
                </li>
              );
            })}
          </ol>

          <div className="flex gap-1.5 overflow-x-auto">{wasteStrips(w, t)}</div>

          <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
            <div className="flex min-w-0 flex-col gap-3">
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.general')}</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label={t('ph.fields.category')}>{t(`ph.wasteCategory.${w.category}`)}</Field>
                  <Field label={t('ph.fields.source')}>{src ? <Link className="underline" to={src}><bdi>{w.source_code}</bdi></Link> : <bdi>{w.source_code ?? '—'}</bdi>}
                    {w.source_type ? ` · ${t(`ph.wasteSource.${w.source_type}`)}` : ''}</Field>
                  <Field label={t('ph.fields.crop_id')}>{localizedName(i18n.language, w.crop_name_ar, w.crop_name_en) || '—'}</Field>
                  <Field label={t('ph.fields.reference_kg')}><bdi>{w.reference_kg ? `${w.reference_kg} kg` : '—'}</bdi></Field>
                  <Field label={t('ph.fields.net_kg')}><bdi>{w.net_kg ? `${w.net_kg} kg` : '—'}</bdi>{w.calibration_flag && <span className="ms-1 text-amber-800">⚠ {t('ph.flags.calibration')}</span>}</Field>
                  <Field label={t('ph.fields.bags')}><bdi>{w.bags ?? '—'}</bdi></Field>
                  <Field label={t('ph.fields.route')}>{w.route ? t(`ph.wasteRoute.${w.route}`) : '—'}</Field>
                  <Field label={t('ph.fields.route_basis')} wide><bdi>{w.route_basis ?? '—'}</bdi></Field>
                  <Field label={t('ph.fields.erp_ref')}><bdi>{w.erp_ref ?? '—'}</bdi></Field>
                  <Field label={t('ph.fields.created')}>{w.created_by_name ?? t('ph.system')} · <When iso={w.created_at} /></Field>
                  <Field label={t('ph.fields.origin')} wide>{w.origin}</Field>
                  <Field label={t('ph.fields.notes')} wide>{w.notes ?? '—'}</Field>
                </div>
              </section>

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.waste.signoffs')}</h2>
                <p className="mb-2 text-xs text-stone-600">{t('ph.waste.signoffNote')}</p>
                {(w.signoffs ?? []).length === 0 ? <p className="text-sm text-stone-600">{t('ph.waste.noSignoffs')}</p> : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {w.signoffs.map((x, i) => <li key={i}><span className="rounded bg-stone-100 px-1.5 font-mono text-xs">{x.role}</span> {x.by ?? '—'} · <When iso={x.at} />{x.comment ? ` — “${x.comment}”` : ''}</li>)}
                  </ul>
                )}
                {w.required_signers && w.required_signers.length > 0 && (
                  <p className="mt-2 text-sm">{t('ph.waste.required', { roles: w.required_signers.join(' · ') })}</p>
                )}
              </section>

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.photos')}</h2>
                <div className="flex flex-wrap gap-3">
                  {photos.data?.map((a) => (
                    <figure key={a.id} className="flex w-40 flex-col gap-1 text-xs">
                      <Thumb a={a} />
                      <figcaption>{a.caption ?? '—'}<br /><span className="text-stone-500">{a.by_name} · <When iso={a.created_at} /></span></figcaption>
                    </figure>
                  ))}
                  {(photos.data ?? []).length === 0 && <p className="text-sm text-stone-600">{t('ph.noPhotos')}</p>}
                </div>
              </section>

              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.sections.history')}</h2>
                <ol className="flex flex-col gap-1.5 text-sm">
                  {history.data?.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-1.5">
                      <When iso={h.at} />
                      <span className="font-semibold">{!h.actor || h.actor === 'system' ? t('ph.system') : h.actor}</span>
                      {h.kind === 'transition'
                        ? <span>{t(`ph.status.ph_waste.${h.from_status}`)} → <strong>{t(`ph.status.ph_waste.${h.to_status}`)}</strong></span>
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
                        {t(`ph.wasteActions.${a.action}`)}
                      </button>
                      {a.allowed && a.basis && <span className="text-xs text-stone-500">{t('ph.basis', { basis: a.basis })}</span>}
                      {!a.allowed && a.reason && <ReasonNote reason={a.reason} />}
                    </li>
                  ))}
                  {actions.data?.length === 0 && <li className="text-sm text-stone-600">{t('ph.waste.noActions')}</li>}
                </ul>
              </section>
              {open && (
                <ActionPanel title={t(`ph.wasteActions.${open}`)} onClose={close}>
                  <WasteActionForm action={open} w={w} onDone={() => done(open)} onCancel={close} />
                </ActionPanel>
              )}
            </aside>
          </div>
        </section>
      )}
    </QueryState>
  );
}
