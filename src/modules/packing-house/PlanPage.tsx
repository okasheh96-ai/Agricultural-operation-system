import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryState } from '@/core/components/QueryState';
import { localizedName, useDailyPlan } from './api';
import { StatusPill, When, btnCls, inputCls } from './ui';

/**
 * FR-PL-03 daily production plan for a date: open order lines by required date, the Job Cards planned on each line, the raw
 * stock released or stored by crop (oldest first, for FIFO) and the finished stock in storage. Read-only: plans are made by
 * creating Job Cards (from an accepted order line or for stock), which the PHM approves.
 */
export default function PlanPage() {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState('');
  const plan = useDailyPlan(date);
  const d = plan.data;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{t('ph.plan.title')}</h1>
          <p className="text-sm text-stone-700">{t('ph.plan.intro')}</p>
        </div>
        <label className="flex flex-col gap-1 text-sm"><span>{t('ph.filters.date')}</span>
          <input type="date" dir="ltr" className={inputCls} value={date || d?.date || ''} onChange={(e) => setDate(e.target.value)} /></label>
        <Link to="/office/packing-house?stage=orders" className={btnCls}>{t('ph.stages.orders')}</Link>
      </div>
      <QueryState isLoading={plan.isLoading} error={plan.error} isEmpty={!d} onRetry={() => void plan.refetch()}>
        {d && (
          <>
            <section className="rounded-lg border bg-white p-3">
              <h2 className="mb-2 font-semibold">{t('ph.plan.lines')} · <bdi>{d.date}</bdi></h2>
              <div className="grid gap-3 md:grid-cols-3">
                {d.lines.map((l) => (
                  <div key={l.code} className="min-w-0 rounded border border-stone-200 p-2">
                    <h3 className="font-semibold">{localizedName(i18n.language, l.name_ar, l.name_en)}</h3>
                    {l.job_cards.length === 0 ? <p className="text-sm text-stone-600">{t('ph.plan.noJobCards')}</p> : (
                      <ul className="flex flex-col gap-1 text-sm">
                        {l.job_cards.map((j) => (
                          <li key={j.id} className="flex flex-wrap items-center gap-1.5">
                            <Link className="font-mono underline" to={`/office/packing-house/job-cards/${j.id}`}><bdi>{j.code}</bdi></Link>
                            <StatusPill status={j.status} workflow="ph_job_card" />
                            <span>{localizedName(i18n.language, j.crop_name_ar, j.crop_name_en)} · {t(`ph.grade.${j.grade_target}`)}</span>
                            <span className="text-stone-600"><bdi>{j.order_line ?? t('ph.order.stock')}</bdi></span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border bg-white p-3">
              <h2 className="mb-2 font-semibold">{t('ph.plan.orders')}</h2>
              {d.order_lines.length === 0 ? <p className="text-sm text-stone-600">{t('ph.empty.orders')}</p> : (
                <ul className="flex flex-col gap-1 text-sm">
                  {d.order_lines.map((o) => (
                    <li key={o.id} className="flex flex-wrap items-center gap-2 border-b border-stone-100 pb-1">
                      <bdi className="font-mono">{o.code}</bdi><StatusPill status={o.status} workflow="ph_order_line" />
                      <span>{o.customer_name} · {localizedName(i18n.language, o.crop_name_ar, o.crop_name_en)} · {t(`ph.grade.${o.grade}`)}</span>
                      <bdi>{o.quantity} {t(`ph.order.unit.${o.quantity_unit}`)} · {o.required_date} · {t(`ph.market.${o.market_type}`)}</bdi>
                      <span className="text-stone-600">{o.job_card_codes ?? t('ph.plan.notPlanned')}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="grid gap-3 md:grid-cols-2">
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.plan.rawStock')}</h2>
                {d.raw_stock.length === 0 ? <p className="text-sm text-stone-600">{t('ph.plan.none')}</p> : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {d.raw_stock.map((r) => (
                      <li key={r.crop_code}>
                        <strong>{localizedName(i18n.language, r.crop_name_ar, r.crop_name_en)}</strong> · <bdi>{t('ph.plan.rawLine', {
                          released: r.released_kg ?? 0, stored: r.stored_kg ?? 0, n: r.pallets, age: r.oldest_age_hours })}</bdi>
                        <span className="text-stone-500"> · <When iso={r.oldest_received} /></span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1 text-xs text-stone-500">{t('ph.plan.rawNote')}</p>
              </section>
              <section className="rounded-lg border bg-white p-3">
                <h2 className="mb-2 font-semibold">{t('ph.plan.fgStock')}</h2>
                {d.fg_stock.length === 0 ? <p className="text-sm text-stone-600">{t('ph.plan.none')}</p> : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {d.fg_stock.map((r) => (
                      <li key={`${r.crop_code}-${r.grade}`}>
                        <strong>{localizedName(i18n.language, r.crop_name_ar, r.crop_name_en)}</strong> · {t(`ph.grade.${r.grade}`)} · <bdi>{t('ph.plan.fgLine', { n: r.pallets, boxes: r.boxes, kg: r.kg })}</bdi>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </QueryState>
    </section>
  );
}
