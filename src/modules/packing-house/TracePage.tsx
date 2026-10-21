import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { db, localizedName, rpc, type ArrivalBalanceRow, type LotBalanceRow, type PalletRow } from './api';
import { phErrorMessage } from './phErrors';
import { ErrorBox, StatusPill, When, inputCls, primaryBtnCls } from './ui';

interface Trace {
  query: string;
  scope: string;
  pallets: PalletRow[];
  inspections: { code: string; type: string; result: string; at: string; by: string | null; pallet: string; tolerance_basis: string }[];
  moves: { pallet: string; from: string | null; to: string | null; at: string; by: string | null }[];
  holds: { code: string; type: string; status: string; disposition: string | null; pallet: string }[];
  job_cards?: { id: string; code: string; status: string; line: string; issued_kg: string; consumed_kg: string; fg_kg: string;
    order_line?: string | null; customer?: string | null }[];
  fg_pallets?: { id: string; code: string; status: string; grade: string; net_kg: string; job_card: string; lots: string; location: string | null;
    composition: { pallet: string; lot: string | null; kg: number; share: number; method: string }[]; parents?: string[] }[];
  waste?: { id: string; code: string; status: string; category: string; net_kg: string | null; reference_kg: string | null; source: string | null }[];
}

/** MB-02 per lot and MB-03 per arrival for what the trace reached (as recorded; nothing is forced to balance). */
function useBalances(lots: string[], arrivals: string[]) {
  return useQuery({
    queryKey: ['ph', 'trace_balances', lots.join(','), arrivals.join(',')],
    enabled: lots.length + arrivals.length > 0,
    queryFn: async () => {
      const [l, a] = await Promise.all([
        lots.length ? db().from('ph_lot_balance').select('*').in('code', lots).returns<LotBalanceRow[]>() : Promise.resolve({ data: [], error: null }),
        arrivals.length ? db().from('ph_arrival_balance').select('*').in('code', arrivals).returns<ArrivalBalanceRow[]>() : Promise.resolve({ data: [], error: null }),
      ]);
      if (l.error) throw l.error;
      if (a.error) throw a.error;
      return { lots: (l.data ?? []) as LotBalanceRow[], arrivals: (a.data ?? []) as ArrivalBalanceRow[] };
    },
  });
}

/** Trace from a finished pallet, Job Card, incoming pallet, arrival or lot code: back to arrival and source (TQ-01), forward to Job Cards and finished pallets (TQ-02, up to storage). */
export default function TracePage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const ref = params.get('ref') ?? '';
  const [input, setInput] = useState(ref);
  const q = useQuery({ queryKey: ['ph', 'trace', ref], enabled: !!ref, retry: false, queryFn: () => rpc<Trace>('ph_backward_trace', { p_ref: ref }) });
  function submit(e: FormEvent) {
    e.preventDefault();
    setParams(input.trim() ? { ref: input.trim() } : {});
  }
  const d = q.data;
  const lots = [...new Set((d?.pallets ?? []).map((p) => p.lot_code).filter((x): x is string => !!x))];
  const arrivals = [...new Set((d?.pallets ?? []).map((p) => p.arrival_code))];
  const balances = useBalances(lots, arrivals);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-bold">{t('ph.trace.title')}</h1>
        <p className="text-sm text-stone-700">{t('ph.trace.intro')}</p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" role="search">
        <input aria-label={t('ph.trace.ref')} placeholder={t('ph.trace.ref')} dir="ltr" className={`${inputCls} font-mono sm:w-96`} value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" className={primaryBtnCls}>{t('ph.trace.run')}</button>
      </form>
      {q.error && <ErrorBox message={phErrorMessage(t, q.error)} />}
      {d && (
        <>
          <p className="rounded border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">{t('ph.trace.scope')}</p>
          <div className="overflow-x-auto rounded border bg-white">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead><tr className="border-b bg-stone-100">
                <th className="p-2 text-start">{t('ph.trace.pallet')}</th><th className="p-2 text-start">{t('ph.fields.arrival')}</th>
                <th className="p-2 text-start">{t('ph.fields.source_id')}</th><th className="p-2 text-start">{t('ph.fields.harvest_at')}</th>
                <th className="p-2 text-start">{t('ph.fields.harvest_supervisor')}</th><th className="p-2 text-start">{t('ph.fields.crop_id')}</th>
                <th className="p-2 text-start">{t('ph.fields.net_kg')}</th><th className="p-2 text-start">{t('ph.fields.lot')}</th>
                <th className="p-2 text-start">{t('common.status')}</th></tr></thead>
              <tbody>
                {d.pallets.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="p-2 font-mono"><Link className="underline" to={`/office/packing-house/pallets/${p.id}`}><bdi>{p.code}</bdi></Link></td>
                    <td className="p-2 font-mono"><bdi>{p.arrival_code}</bdi></td>
                    <td className="p-2"><bdi>{p.source_code}</bdi> · {localizedName(i18n.language, p.source_name_ar, p.source_name_en)}</td>
                    <td className="p-2"><When iso={p.harvest_at} /></td><td className="p-2">{p.harvest_supervisor ?? '—'}</td>
                    <td className="p-2">{localizedName(i18n.language, p.crop_name_ar, p.crop_name_en)}</td>
                    <td className="p-2"><bdi>{p.net_kg}</bdi></td><td className="p-2 font-mono"><bdi>{p.lot_code ?? '—'}</bdi></td>
                    <td className="p-2"><StatusPill status={p.status} workflow="ph_incoming_pallet" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(d.job_cards ?? []).length > 0 && (
            <section className="rounded-lg border bg-white p-3">
              <h2 className="font-semibold">{t('ph.trace.jobCards')}</h2>
              <ul className="text-sm">
                {d.job_cards?.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-2">
                    <Link className="font-mono underline" to={`/office/packing-house/job-cards/${j.id}`}><bdi>{j.code}</bdi></Link>
                    <StatusPill status={j.status} workflow="ph_job_card" />
                    <span><bdi>{t('ph.trace.jcKg', { issued: j.issued_kg, consumed: j.consumed_kg, fg: j.fg_kg })}</bdi></span>
                    {j.order_line && <span className="rounded bg-sky-50 px-1.5 text-sky-900"><bdi>{j.order_line} · {j.customer}</bdi></span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(d.fg_pallets ?? []).length > 0 && (
            <section className="rounded-lg border bg-white p-3">
              <h2 className="font-semibold">{t('ph.trace.fgPallets')}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {d.fg_pallets?.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2">
                    <Link className="font-mono underline" to={`/office/packing-house/fg-pallets/${f.id}`}><bdi>{f.code}</bdi></Link>
                    <StatusPill status={f.status} workflow="ph_fg_pallet" />
                    <span>{t(`ph.grade.${f.grade}`)} · <bdi>{f.net_kg} kg · {f.job_card} · {f.location ?? '—'}</bdi></span>
                    <span className="text-xs text-stone-600"><bdi>{f.composition.map((c) => `${c.pallet} ${c.kg} kg (${t(`ph.attribution.${c.method}`)})`).join(' · ')}</bdi></span>
                    {(f.parents ?? []).length > 0 && <span className="text-xs text-violet-900">⑂ {t('ph.fg.madeFrom')} <bdi>{f.parents?.join(', ')}</bdi></span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(d.waste ?? []).length > 0 && (
            <section className="rounded-lg border bg-white p-3">
              <h2 className="font-semibold">{t('ph.trace.waste')}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {d.waste?.map((w) => (
                  <li key={w.id} className="flex flex-wrap items-center gap-2">
                    <Link className="font-mono underline" to={`/office/packing-house/waste/${w.id}`}><bdi>{w.code}</bdi></Link>
                    <StatusPill status={w.status} workflow="ph_waste" />
                    <span>{t(`ph.wasteCategory.${w.category}`)} · <bdi>{w.net_kg ? `${w.net_kg} kg` : t('ph.waste.notWeighed')} · {w.source ?? ''}</bdi></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {balances.data && (balances.data.lots.length > 0 || balances.data.arrivals.length > 0) && (
            <section className="rounded-lg border bg-white p-3">
              <h2 className="font-semibold">{t('ph.trace.balances')}</h2>
              <p className="text-xs text-stone-600">{t('ph.trace.balancesNote')}</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {balances.data.lots.map((l) => (
                  <li key={l.id}><bdi className="font-mono">{l.code}</bdi> · <bdi>{t('ph.trace.lotLine', { accepted: l.accepted_kg, consumed: l.consumed_kg,
                    prod: l.in_production_kg, stock: l.in_stock_kg, waste: l.raw_waste_kg, fg: l.fg_attributed_kg })}</bdi>
                    <span className={Number(l.unexplained_kg) === 0 ? 'text-green-800' : 'font-semibold text-amber-900'}> · <bdi>{t('ph.trace.unexplained', { kg: l.unexplained_kg })}</bdi></span></li>
                ))}
                {balances.data.arrivals.map((a) => (
                  <li key={a.id}><bdi className="font-mono">{a.code}</bdi> · <bdi>{t('ph.trace.arrivalLine', { registered: a.registered_kg, accepted: a.accepted_kg,
                    returned: a.returned_to_source_kg, waste: a.rejected_to_waste_kg, regrade: a.regrade_removed_kg, undecided: a.undecided_kg })}</bdi></li>
                ))}
              </ul>
            </section>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <section className="rounded-lg border bg-white p-3"><h2 className="font-semibold">{t('ph.trace.inspections')}</h2>
              <ul className="text-sm">{d.inspections.map((i, k) => <li key={k}><bdi>{i.code}</bdi> · {t(`ph.inspectionType.${i.type}`)} · {i.result} · {i.by} · <bdi>{i.pallet}</bdi></li>)}</ul></section>
            <section className="rounded-lg border bg-white p-3"><h2 className="font-semibold">{t('ph.trace.moves')}</h2>
              <ul className="text-sm">{d.moves.map((m, k) => <li key={k}><bdi>{m.pallet}: {m.from ?? '—'} → {m.to ?? '—'}</bdi> · <When iso={m.at} /></li>)}</ul></section>
            <section className="rounded-lg border bg-white p-3"><h2 className="font-semibold">{t('ph.holds.title')}</h2>
              <ul className="text-sm">{d.holds.map((h, k) => <li key={k}><bdi>{h.code}</bdi> · {t(`ph.holdType.${h.type}`)} · {t(`ph.status.ph_hold.${h.status}`)} · <bdi>{h.pallet}</bdi></li>)}</ul></section>
          </div>
        </>
      )}
    </section>
  );
}
