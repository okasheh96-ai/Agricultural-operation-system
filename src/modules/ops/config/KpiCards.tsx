import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { localName, rpc } from '../api';
import { BarChart, Card, Num } from '../ui';

export interface KpiFilter { field: string; op: string; value: string }
export interface KpiDef {
  title_ar: string; title_en?: string; dataset: string; measure: 'count' | 'sum' | 'avg' | 'ratio' | 'rate_per_hour'; field?: string;
  filters?: KpiFilter[]; numerator_filters?: KpiFilter[]; group_by?: string; window: string; target?: string; target_dir?: 'min' | 'max';
  unit?: string; chart?: 'number' | 'bar'; roles?: string[]; sort_order?: number; formula_ar?: string; formula_en?: string;
}
export interface KpiResult { rows: { group: string | null; value: string | number | null; n: number }[]; from: string | null; to: string; unit?: string; target?: string | null }
export interface KpiCardData { code: string; version: number; definition: KpiDef; result: KpiResult | { error: string } }

export function useMyKpiCards() {
  return useQuery({ queryKey: ['ops', 'my-kpi-cards'], queryFn: () => rpc<KpiCardData[]>('ph_my_kpi_cards'), refetchInterval: 60_000 });
}

/** One owner-built card: the value (unknown stays unknown), its target, the window it covers, and a table view for grouped data. */
export function KpiCardView({ def, result, code }: { def: KpiDef; result: KpiResult | { error: string } | undefined; code?: string }) {
  const { t, i18n } = useTranslation();
  const title = localName(i18n.language, def.title_ar, def.title_en) || code || '';
  const unit = def.unit || (def.measure === 'ratio' ? 'pct' : '');
  if (!result) return <Card title={title}><p className="text-sm text-ops-muted">…</p></Card>;
  if ('error' in result) return <Card title={title}><p className="text-sm text-ops-red">{t('ops.kpiset.evalError')}</p></Card>;
  const formula = localName(i18n.language, def.formula_ar, def.formula_en) || t(`ops.kpiset.measures.${def.measure}`);
  if (def.group_by) {
    return (
      <Card title={title}>
        <BarChart title={title} unit={unit || 'count'} rows={result.rows.map((r) => ({ label: r.group ?? t('ops.unknown'), value: r.value === null ? null : Number(r.value) }))} />
        <p className="mt-2 text-xs text-ops-muted">{formula} · {t(`ops.kpiset.windows.${def.window}`)}</p>
      </Card>
    );
  }
  const v = result.rows[0]?.value ?? null;
  const target = def.target !== undefined && def.target !== '' ? Number(def.target) : null;
  const off = v !== null && target !== null && (def.target_dir === 'min' ? Number(v) < target : Number(v) > target);
  return (
    <div className="ops-card relative min-w-0 overflow-hidden p-5">
      <span aria-hidden="true" className="ops-accent-bar absolute inset-x-0 top-0 h-[3px]" />
      <div className="text-sm font-medium text-ops-muted">{title}</div>
      <div className={`mt-1 text-3xl font-bold leading-tight ${off ? 'text-ops-amber' : 'text-ops-ink'}`}>
        <Num animate value={v} unit={unit && unit !== 'count' ? unit : undefined} digits={2} />
      </div>
      {target !== null && <div className="mt-1 text-sm text-ops-muted">{t('ops.kpiset.targetIs', { v: target })}{off ? ` · ${t('ops.kpiset.offTarget')}` : ''}</div>}
      <div className="mt-2 border-t border-ops-line pt-2 text-xs text-ops-muted">{formula} · {t(`ops.kpiset.windows.${def.window}`)} · {t('ops.kpiset.records', { n: result.rows[0]?.n ?? 0 })}</div>
    </div>
  );
}
