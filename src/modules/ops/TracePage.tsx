import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { requireSupabase } from '@/core/supabase';
import { opsErrorMessage, rpc } from './api';
import { btn, btnPrimary, Card, EmptyState, field, Num, PageTitle, Pill, useFmt } from './ui';

interface TraceEvent { at: string; entity_type: string; entity_id: string; code: string; from: string | null; to: string; comment?: string | null; by: string | null; qty?: string | null }
interface FwdPallet { id: string; code: string; status: string; grade: string; net_kg: string; kg_from_source: string; location: string | null; load_code: string | null;
  customer: string | null; departed_at: string | null }
interface Timeline {
  query: string;
  backward: { pallets: { id: string; code: string; status: string; net_kg: string; lot_code: string | null; source_code: string; crop_code: string }[] | null;
              job_cards: { id: string; code: string; status: string; line: string; issued_kg: string; fg_kg: string; customer: string | null }[];
              fg_pallets: { id: string; code: string; status: string; grade: string; net_kg: string; location: string | null; parents: string[] }[] } | null;
  forward: { fg_pallets: FwdPallet[]; customers: string[]; loads: { code: string; customer: string; departed_at: string | null }[];
             totals: { source_kg: string; dispatched_kg: string; held_kg: string; in_stock_kg: string; on_loads_kg: string } } | null;
  events: TraceEvent[];
  links: { kind: 'split' | 'merge'; parent: string; parent_kg: string; child: string; child_kg: string; change: string; at: string }[];
}

/** Where a movement's source record opens (and Back returns to this same timeline, the code stays in the URL). */
function sourceLink(e: TraceEvent): string | null {
  const type = e.entity_type.replace('created:', '');
  if (type === 'ph_incoming_pallets') return `/office/packing-house/pallets/${e.entity_id}`;
  if (type === 'ph_job_cards') return `/office/packing-house/job-cards/${e.entity_id}`;
  if (type === 'ph_fg_pallets') return `/office/packing-house/fg-pallets/${e.entity_id}`;
  if (type === 'ph_loads') return '/ops/dispatch';
  return null;
}

const WORKFLOW: Record<string, string> = { ph_incoming_pallets: 'ph_incoming_pallet', ph_job_cards: 'ph_job_card', ph_fg_pallets: 'ph_fg_pallet' };
/** A recorded status in the reader's language (workflow labels come from the same keys the packing-house screens use). */
function statusLabel(t: (k: string, o?: Record<string, unknown>) => string, entityType: string, status: string | null): string {
  if (!status) return '—';
  if (entityType === 'ph_loads') return t(`ops.loadStatus.${status}`, { defaultValue: status });
  const wf = WORKFLOW[entityType];
  return wf ? t(`ph.status.${wf}.${status}`, { defaultValue: status }) : status;
}

export default function TracePage() {
  const { t } = useTranslation();
  const fmt = useFmt();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const [text, setText] = useState(q);
  const tl = useQuery({ queryKey: ['ops', 'trace', q], enabled: !!q, retry: false, queryFn: () => rpc<Timeline>('ph_trace_timeline', { p_ref: q }) });
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) setSp({ q: text.trim().toUpperCase() }); };
  const d = tl.data;
  const subject = d?.backward?.fg_pallets?.find((f) => f.code === q) ?? null;
  const ip = d?.backward?.pallets?.find((p) => p.code === q || p.lot_code === q) ?? null;
  const groups = new Map<string, Timeline['links']>();
  for (const l of d?.links ?? []) groups.set(l.change, [...(groups.get(l.change) ?? []), l]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageTitle title={t('ops.trace.title')} sub={t('ops.trace.sub')} />
      <form onSubmit={submit} className="ops-card mb-4 flex flex-wrap gap-2 p-3" role="search">
        <input className={`${field} flex-1`} dir="ltr" value={text} onChange={(e) => setText(e.target.value)} aria-label={t('ops.trace.search')}
          placeholder="FGP-… · IP-… · L-… · ARR-… · JC-… · LD-…" />
        <button type="submit" className={btnPrimary}>{t('ops.trace.go')}</button>
      </form>
      {!q ? <EmptyState>{t('ops.trace.hint')}</EmptyState> : (
        <QueryState isLoading={tl.isLoading} error={null} isEmpty={false}>
          {tl.error ? <p role="alert" className="rounded-ops-sm bg-ops-redbg p-3 text-ops-red">{opsErrorMessage(t, tl.error)}</p> : d && (
            <div className="space-y-4">
              {/* Header: what was searched, its grade, location and disposition */}
              <Card highlight title={<bdi>{q}</bdi>}>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div><dt className="text-ops-muted">{t('ops.trace.kind')}</dt><dd className="font-medium">{subject ? t('ops.trace.fgPallet') : ip ? t('ops.trace.source') : t('ops.trace.chain')}</dd></div>
                  <div><dt className="text-ops-muted">{t('ops.filters.grade')}</dt><dd className="font-medium">{subject ? t(`ops.grades.${subject.grade}`) : '—'}</dd></div>
                  <div><dt className="text-ops-muted">{t('ops.trace.location')}</dt><dd className="font-medium"><bdi>{subject?.location ?? '—'}</bdi></dd></div>
                  <div><dt className="text-ops-muted">{t('ops.trace.disposition')}</dt><dd>{subject ? <Pill tone={subject.status === 'on_hold' ? 'warn' : subject.status === 'dispatched' ? 'good' : 'neutral'}>{t(`ph.status.ph_fg_pallet.${subject.status}`, { defaultValue: subject.status })}</Pill> : ip ? t(`ph.status.ph_incoming_pallet.${ip.status}`, { defaultValue: ip.status }) : '—'}</dd></div>
                </dl>
                {d.forward && (
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-ops-line pt-3 text-sm sm:grid-cols-5">
                    <div><dt className="text-ops-muted">{t('ops.trace.sourceKg')}</dt><dd className="font-semibold"><Num value={d.forward.totals.source_kg} unit="kg" digits={0} /></dd></div>
                    <div><dt className="text-ops-muted">{t('ops.trace.dispatchedKg')}</dt><dd className="font-semibold"><Num value={d.forward.totals.dispatched_kg} unit="kg" digits={1} /></dd></div>
                    <div><dt className="text-ops-muted">{t('ops.trace.onLoadsKg')}</dt><dd className="font-semibold"><Num value={d.forward.totals.on_loads_kg} unit="kg" digits={1} /></dd></div>
                    <div><dt className="text-ops-muted">{t('ops.trace.inStockKg')}</dt><dd className="font-semibold"><Num value={d.forward.totals.in_stock_kg} unit="kg" digits={1} /></dd></div>
                    <div><dt className="text-ops-muted">{t('ops.trace.heldKg')}</dt><dd className={`font-semibold ${Number(d.forward.totals.held_kg) > 0 ? 'text-ops-amber' : ''}`}><Num value={d.forward.totals.held_kg} unit="kg" digits={1} /></dd></div>
                  </dl>
                )}
                {d.forward && d.forward.customers.length > 0 && <p className="mt-2 text-sm">{t('ops.trace.customers')}: <bdi className="font-semibold">{d.forward.customers.join('، ')}</bdi></p>}
              </Card>

              {d.backward?.pallets && (
                <Card title={t('ops.trace.backward')}>
                  <ul className="space-y-1 text-sm">{d.backward.pallets.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2"><Link className="text-ops-accent underline" to={`/office/packing-house/pallets/${p.id}`}><bdi>{p.code}</bdi></Link>
                      <span><bdi>{p.lot_code ?? '—'}</bdi> · <bdi>{p.source_code}</bdi> · <Num value={p.net_kg} unit="kg" digits={0} /></span></li>
                  ))}</ul>
                  {d.backward.job_cards.length > 0 && <p className="mt-2 text-sm text-ops-muted">{t('ops.trace.runs')}: {d.backward.job_cards.map((j) => j.code).join('، ')}</p>}
                </Card>
              )}

              {groups.size > 0 && (
                <Card title={t('ops.trace.splitsMerges')}>
                  {[...groups.entries()].map(([change, ls]) => (
                    <details key={change} className="mb-2 rounded-ops-sm border border-ops-line p-2" open>
                      <summary className="min-h-[44px] cursor-pointer py-2 text-sm font-semibold">{t(`ops.trace.${ls[0]?.kind ?? 'split'}`)} <bdi>{change}</bdi></summary>
                      <ul className="ps-4 text-sm">{ls.map((l) => (
                        <li key={`${l.parent}-${l.child}`}><bdi>{l.parent}</bdi> (<Num value={l.parent_kg} unit="kg" digits={0} />) → <bdi>{l.child}</bdi> (<Num value={l.child_kg} unit="kg" digits={0} />)</li>
                      ))}</ul>
                    </details>
                  ))}
                </Card>
              )}

              {d.forward && d.forward.fg_pallets.length > 0 && (
                <Card title={t('ops.trace.forward')}>
                  <ul className="divide-y divide-ops-line text-sm">{d.forward.fg_pallets.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <Link className="text-ops-accent underline" to={`/office/packing-house/fg-pallets/${f.id}`}><bdi>{f.code}</bdi></Link>
                      <span>{t(`ops.grades.${f.grade}`)} · <Num value={f.kg_from_source} unit="kg" digits={1} /> / <Num value={f.net_kg} unit="kg" digits={0} />
                        {f.load_code && <> · <bdi>{f.load_code}</bdi> → <bdi>{f.customer}</bdi></>}</span>
                      <Pill tone={f.status === 'on_hold' ? 'warn' : f.status === 'dispatched' ? 'good' : 'neutral'}>{t(`ph.status.ph_fg_pallet.${f.status}`, { defaultValue: f.status })}</Pill>
                    </li>
                  ))}</ul>
                  <p className="mt-2 text-xs text-ops-muted">{t('ops.trace.attribution')}</p>
                </Card>
              )}

              <Card title={t('ops.trace.timeline')}>
                <ol className="relative border-s-2 border-ops-line ps-4">
                  {d.events.map((e, i) => {
                    const to = sourceLink(e);
                    return (
                      <li key={`${e.entity_id}-${e.at}-${i}`} className="mb-3">
                        <span className="absolute -start-[7px] mt-1.5 h-3 w-3 rounded-full bg-ops-accent" aria-hidden="true" />
                        <div className="text-xs text-ops-muted">{fmt.dateTime(e.at)}{e.by && <> · {e.by}</>}</div>
                        <div className="text-sm">
                          {to ? <Link to={to} className="font-semibold text-ops-accent underline"><bdi>{e.code}</bdi></Link> : <bdi className="font-semibold">{e.code}</bdi>}
                          {' '}{e.to === 'created' ? t('ops.trace.created') : <>{statusLabel(t, e.entity_type, e.from)} <span aria-hidden="true">{document.dir === 'rtl' ? '←' : '→'}</span> <strong>{statusLabel(t, e.entity_type, e.to)}</strong></>}
                          {e.qty && <> · <Num value={e.qty} unit="kg" digits={0} /></>}
                          {e.comment && <span className="text-ops-muted"> — {e.comment}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </Card>
              <FgHold code={subject?.code} />
            </div>
          )}
        </QueryState>
      )}
    </div>
  );
}

/** QC / QA hold on a finished pallet from the trace (the server checks the role; release only by the quality team). */
function FgHold({ code }: { code: string | undefined }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  if (!code) return null;
  return (
    <Card title={t('ops.trace.holdTitle')}>
      <div className="flex flex-wrap gap-2">
        <input className={`${field} flex-1`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('ops.trace.holdReason')} aria-label={t('ops.trace.holdReason')} />
        <button type="button" className={btn} disabled={!reason.trim()} onClick={async () => {
          try {
            const { data } = await requireSupabase().from('ph_fg_pallets').select('id').eq('code', code).single();
            const r = await rpc<{ code: string }>('ph_raise_fg_hold', { p_type: 'quality', p_reason: reason, p_fg: [(data as { id: string }).id] });
            setMsg(t('ops.trace.held', { code: r.code })); setReason('');
          } catch (e) { setMsg(opsErrorMessage(t, e)); }
        }}>{t('ops.trace.hold')}</button>
      </div>
      {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
    </Card>
  );
}
