import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Shared building blocks of the packhouse operations screens. Owner-created screens reuse the same pieces. */

export const field = 'min-h-[44px] w-full min-w-0 rounded-ops-sm border border-ops-line bg-ops-surface px-3 text-ops-ink';
export const btn = 'ops-fade inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-ops-sm border border-ops-line bg-ops-surface px-3 text-sm font-medium text-ops-ink hover:bg-ops-grey disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = 'ops-fade inline-flex min-h-[48px] min-w-[44px] items-center justify-center gap-1.5 rounded-ops-sm bg-ops-accent px-5 text-base font-semibold text-white hover:bg-ops-accent2 disabled:cursor-not-allowed disabled:opacity-50';

export function Card({ title, action, children, className = '', highlight = false, id }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; highlight?: boolean; id?: string;
}) {
  return (
    <section id={id} className={`ops-card min-w-0 p-4 ${highlight ? 'ops-highlight' : ''} ${className}`} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold text-ops-ink">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const nf = (lang: string, digits: number) =>
  new Intl.NumberFormat(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** A number with its unit, tabular, isolated for RTL. Unknown is shown as unknown, never as 0. */
export function Num({ value, unit, digits = 1, className = '' }: { value: string | number | null | undefined; unit?: string; digits?: number; className?: string }) {
  const { t, i18n } = useTranslation();
  if (value === null || value === undefined || value === '') {
    return <span className={`text-ops-muted ${className}`}>{t('ops.unknown')}</span>;
  }
  const n = typeof value === 'number' ? value : Number(value);
  return (
    <bdi className={`ops-num whitespace-nowrap ${className}`}>
      {nf(i18n.language, digits).format(n)}{unit ? <span className="ms-1 text-[0.8em] font-normal text-ops-muted">{t(`ops.units.${unit}`)}</span> : null}
    </bdi>
  );
}

export function useFmt() {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB';
  return {
    time: (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'Asia/Amman' }).format(new Date(iso)) : '—',
    dateTime: (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Amman' }).format(new Date(iso)) : '—',
    date: (d: string | null | undefined) => d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : '—',
    num: (n: number, digits = 1) => nf(i18n.language, digits).format(n),
  };
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';
const TONE: Record<Tone, string> = {
  neutral: 'bg-ops-grey text-ops-ink border-ops-line',
  good: 'bg-ops-greenbg text-ops-green border-[#b6dfc4]',
  warn: 'bg-ops-amberbg text-ops-amber border-[#f3cf94]',
  bad: 'bg-ops-redbg text-ops-red border-[#f2b8b3]',
  info: 'bg-ops-soft text-ops-accent border-[#c9cdf7]',
};
const ICON: Record<Tone, string> = { neutral: '•', good: '✓', warn: '!', bad: '■', info: 'ℹ' };

/** Status as icon + text + colour (colour is never the only signal). */
export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      <span aria-hidden="true">{icon ?? ICON[tone]}</span>{children}
    </span>
  );
}

export function KpiTile({ label, value, sub, to, tone = 'neutral', formula }: {
  label: string; value: ReactNode; sub?: ReactNode; to?: string; tone?: Tone; formula?: string;
}) {
  const body = (
    <>
      <div className="text-sm font-medium text-ops-muted">{label}</div>
      <div className={`mt-1 text-3xl font-bold leading-tight ${tone === 'bad' ? 'text-ops-red' : tone === 'warn' ? 'text-ops-amber' : 'text-ops-ink'}`}>{value}</div>
      {sub && <div className="mt-1 text-sm text-ops-muted">{sub}</div>}
      {formula && <div className="mt-2 border-t border-ops-line pt-2 text-xs text-ops-muted">{formula}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="ops-card ops-fade block min-w-0 p-4 hover:border-ops-accent">{body}</Link>
  ) : (
    <div className="ops-card min-w-0 p-4">{body}</div>
  );
}

/** Bar chart with units and an accessible data-table view (owner brief: charts have a table view). */
export function BarChart({ title, unit, rows }: { title: string; unit: string; rows: { label: string; value: number | null }[] }) {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const id = useId();
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure aria-labelledby={id} className="min-w-0">
      <figcaption id={id} className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title} <span className="font-normal text-ops-muted">({t(`ops.units.${unit}`)})</span></span>
        <button type="button" className={btn} aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? t('ops.chart.showChart') : t('ops.chart.showTable')}
        </button>
      </figcaption>
      {rows.length === 0 ? (
        <p className="text-sm text-ops-muted">{t('ops.chart.empty')}</p>
      ) : table ? (
        <table className="w-full text-sm">
          <thead><tr className="text-ops-muted"><th className="py-1 text-start font-medium">{t('ops.chart.period')}</th><th className="py-1 text-end font-medium">{t(`ops.units.${unit}`)}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label} className="border-t border-ops-line"><td className="py-1"><bdi>{r.label}</bdi></td><td className="py-1 text-end"><Num value={r.value} /></td></tr>)}</tbody>
        </table>
      ) : (
        <div className="flex h-40 items-end gap-1 overflow-x-auto pb-6" role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.value ?? t('ops.unknown')}`).join('، ')}`}>
          {rows.map((r) => (
            <div key={r.label} className="relative flex h-full min-w-[28px] flex-1 flex-col justify-end">
              <div className="ops-accent-bar rounded-t-md" style={{ blockSize: `${Math.max(2, ((r.value ?? 0) / max) * 100)}%` }} title={`${r.label}: ${r.value}`} />
              <span className="absolute -bottom-5 inset-x-0 truncate text-center text-[11px] text-ops-muted"><bdi>{r.label}</bdi></span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

export type SaveState = { kind: 'idle' } | { kind: 'pending' } | { kind: 'saved'; at: string; text?: string } | { kind: 'failed'; message: string };

export function SaveStatus({ state, onRetry }: { state: SaveState; onRetry?: () => void }) {
  const { t } = useTranslation();
  const fmt = useFmt();
  if (state.kind === 'idle') return null;
  if (state.kind === 'pending') return <p role="status" className="text-sm font-medium text-ops-muted">⏳ {t('ops.save.pending')}</p>;
  if (state.kind === 'saved') {
    return <p role="status" className="text-sm font-semibold text-ops-green">✓ {t('ops.save.saved', { time: fmt.time(state.at) })}{state.text ? ` — ${state.text}` : ''}</p>;
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-ops-sm border border-[#f2b8b3] bg-ops-redbg p-2 text-sm text-ops-red">
      <span>✕ {state.message}</span>
      {onRetry && <button type="button" className={btn} onClick={onRetry}>{t('ops.save.retry')}</button>}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-ops-sm border border-dashed border-ops-line p-4 text-sm text-ops-muted">{children}</p>;
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-ops-ink">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ops-muted">{sub}</p>}
      </div>
      {actions && <div className="ops-noprint flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function gradeLabel(t: (k: string) => string, g: string) {
  return t(`ops.grades.${g}`);
}

/** CSV download built in the browser from rows the server returned to this user (exports respect the same permissions). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Loading / error / data for one query, in the ops style; the children get the loaded data. */
export function Loaded<T>({ query, children }: { query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  if (query.isLoading) return <p role="status" className="p-4 text-sm text-ops-muted">{t('common.loading')}</p>;
  if (query.error || query.data === undefined) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ops-sm border border-[#f2b8b3] bg-ops-redbg p-3 text-sm text-ops-red">
        <span>{t('common.error')}</span>
        <button type="button" className={btn} onClick={() => void query.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}
