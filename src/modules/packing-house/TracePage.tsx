import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { localizedName, rpc, type PalletRow } from './api';
import { phErrorMessage } from './phErrors';
import { ErrorBox, StatusPill, When, inputCls, primaryBtnCls } from './ui';

interface Trace {
  query: string;
  scope: string;
  pallets: PalletRow[];
  inspections: { code: string; type: string; result: string; at: string; by: string | null; pallet: string; tolerance_basis: string }[];
  moves: { pallet: string; from: string | null; to: string | null; at: string; by: string | null }[];
  holds: { code: string; type: string; status: string; disposition: string | null; pallet: string }[];
}

/** Backward trace (TQ-01) from a pallet, arrival or lot code, as far as milestone M1 records reach (source and arrival). */
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
