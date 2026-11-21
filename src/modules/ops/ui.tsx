import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { matchesSearch } from '@/core/i18n/normalizeArabic';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/** Shared building blocks of the packhouse operations screens (design system). Owner-created screens reuse the same pieces.
 *  Every colour is a theme token (light and dark), every status pairs colour with text or an icon, and motion is short
 *  and switched off for people who ask their device for reduced motion. */

export const field = 'ops-field min-h-[44px] w-full min-w-0 rounded-ops-sm border border-ops-line bg-ops-surface px-3 text-ops-ink';
export const btn = 'ops-press inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-ops-sm border border-ops-line bg-ops-surface px-3.5 text-sm font-medium text-ops-ink shadow-[0_1px_0_rgb(0_0_0/2%)] hover:border-ops-linestrong hover:bg-ops-surface2 disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = 'ops-press ops-btn-primary inline-flex min-h-[46px] min-w-[44px] items-center justify-center gap-1.5 rounded-ops-sm px-5 text-[0.95rem] font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const btnGhost = 'ops-press inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-ops-sm px-3 text-sm font-medium text-ops-muted hover:bg-ops-grey hover:text-ops-ink disabled:opacity-50';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Card({ title, action, children, className = '', highlight = false, id, sub, icon }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; highlight?: boolean; id?: string; sub?: ReactNode; icon?: ReactNode;
}) {
  return (
    <section id={id} className={`ops-card min-w-0 p-4 sm:p-5 ${highlight ? 'ops-highlight' : ''} ${className}`} aria-label={typeof title === 'string' ? title : undefined}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-3">
            {icon && <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-ops-sm bg-ops-soft text-ops-accent">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[1.02rem] font-semibold leading-tight text-ops-ink">{title}</h2>}
              {sub && <p className="mt-0.5 text-sm text-ops-muted">{sub}</p>}
            </div>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const nf = (lang: string, digits: number) =>
  new Intl.NumberFormat(lang === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** A number counting up to its value once (600 ms, eased); the final value is what screen readers get. */
function useCountUp(target: number, enabled: boolean) {
  const [v, setV] = useState(enabled && !reducedMotion() ? 0 : target);
  const from = useRef(enabled && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!enabled || reducedMotion() || !Number.isFinite(target)) { setV(target); return; }
    const start = performance.now(); const a = from.current; let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 600); const e = 1 - Math.pow(1 - p, 3);
      setV(a + (target - a) * e);
      if (p < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return v;
}

/** A number with its unit, tabular, isolated for RTL. Unknown is shown as unknown, never as 0. */
export function Num({ value, unit, digits = 1, className = '', animate = false }: {
  value: string | number | null | undefined; unit?: string; digits?: number; className?: string; animate?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const n = value === null || value === undefined || value === '' ? NaN : typeof value === 'number' ? value : Number(value);
  const shown = useCountUp(Number.isFinite(n) ? n : 0, animate);
  if (value === null || value === undefined || value === '') {
    return <span className={`text-ops-muted ${className}`}>{t('ops.unknown')}</span>;
  }
  return (
    <bdi className={`ops-num whitespace-nowrap ${className}`} aria-label={animate ? `${nf(i18n.language, digits).format(n)}${unit ? ` ${t(`ops.units.${unit}`)}` : ''}` : undefined}>
      {nf(i18n.language, digits).format(animate ? shown : n)}{unit ? <span className="ms-1 text-[0.8em] font-normal text-ops-muted">{t(`ops.units.${unit}`)}</span> : null}
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
  good: 'bg-ops-greenbg text-ops-green border-ops-greenline',
  warn: 'bg-ops-amberbg text-ops-amber border-ops-amberline',
  bad: 'bg-ops-redbg text-ops-red border-ops-redline',
  info: 'bg-ops-soft text-ops-accent border-ops-accentline',
};
const DOT: Record<Tone, string> = { neutral: 'bg-ops-muted', good: 'bg-ops-green', warn: 'bg-ops-amber', bad: 'bg-ops-red', info: 'bg-ops-accent' };
const ICON: Record<Tone, string> = { neutral: '', good: '✓', warn: '!', bad: '■', info: '' };

/** Status as dot/icon + text + colour (colour is never the only signal). */
export function Pill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: string }) {
  const ic = icon ?? ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE[tone]}`}>
      {ic ? <span aria-hidden="true">{ic}</span> : <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}{children}
    </span>
  );
}

export function KpiTile({ label, value, sub, to, tone = 'neutral', formula, icon }: {
  label: string; value: ReactNode; sub?: ReactNode; to?: string; tone?: Tone; formula?: string; icon?: ReactNode;
}) {
  const body = (
    <>
      <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-[3px] rounded-t-ops ${tone === 'bad' ? 'bg-ops-red' : tone === 'warn' ? 'bg-ops-amber' : 'ops-accent-bar'}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium text-ops-muted">{label}</div>
        {icon && <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-ops-sm bg-ops-soft text-ops-accent">{icon}</span>}
      </div>
      <div className={`mt-2 text-[2rem] font-bold leading-none tracking-tight ${tone === 'bad' ? 'text-ops-red' : tone === 'warn' ? 'text-ops-amber' : 'text-ops-ink'}`}>{value}</div>
      {sub && <div className="mt-2 text-sm text-ops-muted">{sub}</div>}
      {formula && <div className="mt-3 border-t border-ops-line pt-2 text-xs leading-relaxed text-ops-muted">{formula}</div>}
      {to && <span aria-hidden="true" className="absolute bottom-3 end-3 text-ops-muted opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100">→</span>}
    </>
  );
  return to ? (
    <Link to={to} className="ops-card group relative block min-w-0 overflow-hidden p-5">{body}</Link>
  ) : (
    <div className="ops-card relative min-w-0 overflow-hidden p-5">{body}</div>
  );
}

/** Bar chart with units, hover read-out and an accessible data-table view (owner brief: charts have a table view). */
export function BarChart({ title, unit, rows }: { title: string; unit: string; rows: { label: string; value: number | null }[] }) {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <figure aria-labelledby={id} className="min-w-0">
      <figcaption id={id} className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{title} <span className="font-normal text-ops-muted">({t(`ops.units.${unit}`, { defaultValue: unit })})</span></span>
        <Segmented value={table ? 'table' : 'chart'} onChange={(v) => setTable(v === 'table')} label={title}
          options={[{ value: 'chart', label: t('ops.chart.showChart') }, { value: 'table', label: t('ops.chart.showTable') }]} />
      </figcaption>
      {rows.length === 0 ? (
        <EmptyState>{t('ops.chart.empty')}</EmptyState>
      ) : table ? (
        <DataTable rows={rows.map((r, i) => ({ ...r, id: String(i) }))} pageSize={12} label={title}
          columns={[{ key: 'label', header: t('ops.chart.period'), render: (r) => <bdi>{r.label}</bdi>, sort: (r) => r.label },
                    { key: 'value', header: t(`ops.units.${unit}`, { defaultValue: unit }), align: 'end', render: (r) => <Num value={r.value} />, sort: (r) => r.value ?? -Infinity }]} />
      ) : (
        <div className="relative">
          <div className="pointer-events-none absolute inset-x-0 top-0 flex h-44 flex-col justify-between" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => <div key={i} className="border-t border-dashed border-ops-line" />)}
          </div>
          <div className="relative flex h-44 items-end gap-1.5 overflow-x-auto pb-7 ops-scroll-thin" role="img"
            aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.value ?? t('ops.unknown')}`).join('، ')}`} onMouseLeave={() => setHover(null)}>
            {rows.map((r, i) => (
              <div key={r.label} className="relative flex h-full min-w-[26px] flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
                {hover === i && (
                  <span className="ops-pop absolute bottom-[calc(100%+4px)] start-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ops-ink px-2 py-1 text-xs font-semibold text-ops-bg shadow-ops-pop rtl:translate-x-1/2">
                    <bdi>{r.label}</bdi>: <Num value={r.value} />
                  </span>
                )}
                <div className={`ops-accent-bar origin-bottom rounded-t-md transition-[opacity,transform] duration-300 ${hover !== null && hover !== i ? 'opacity-40' : ''}`}
                  style={{ blockSize: `${Math.max(2, ((r.value ?? 0) / max) * 100)}%` }} />
                <span className="absolute -bottom-6 inset-x-0 truncate text-center text-[11px] text-ops-muted"><bdi>{r.label}</bdi></span>
              </div>
            ))}
          </div>
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
  if (state.kind === 'pending') {
    return <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-ops-muted"><Spinner />{t('ops.save.pending')}</p>;
  }
  if (state.kind === 'saved') {
    return (
      <p role="status" className="ops-pop inline-flex items-center gap-2 rounded-ops-sm bg-ops-greenbg px-2.5 py-1 text-sm font-semibold text-ops-green">
        <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-ops-green text-[11px] text-ops-greenbg">✓</span>
        {t('ops.save.saved', { time: fmt.time(state.at) })}{state.text ? ` — ${state.text}` : ''}
      </p>
    );
  }
  return (
    <div role="alert" className="ops-pop flex flex-wrap items-center gap-2 rounded-ops-sm border border-ops-redline bg-ops-redbg p-2.5 text-sm text-ops-red">
      <span aria-hidden="true">✕</span><span className="min-w-0 flex-1">{state.message}</span>
      {onRetry && <button type="button" className={btn} onClick={onRetry}>{t('ops.save.retry')}</button>}
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-ops-line border-t-ops-accent ${className}`} />;
}

export function EmptyState({ children, icon = '◌', action }: { children: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ops-enter flex flex-col items-center gap-2 rounded-ops border border-dashed border-ops-linestrong bg-ops-surface2 px-4 py-8 text-center">
      <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-ops-soft text-lg text-ops-accent">{icon}</span>
      <div className="max-w-md text-sm text-ops-muted">{children}</div>
      {action}
    </div>
  );
}

export interface Crumb { label: string; to?: string }
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <nav aria-label={t('ops.ui.breadcrumbs')} className="mb-2 text-xs text-ops-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="rtl:-scale-x-100">›</span>}
            {c.to && i < items.length - 1 ? <Link className="hover:text-ops-accent" to={c.to}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? 'page' : undefined}>{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageTitle({ title, sub, actions, crumbs }: { title: string; sub?: ReactNode; actions?: ReactNode; crumbs?: Crumb[] }) {
  return (
    <div className="ops-enter mb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[1.65rem] font-bold leading-tight tracking-tight text-ops-ink sm:text-[1.85rem]">{title}</h1>
          {sub && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ops-muted">{sub}</p>}
        </div>
        {actions && <div className="ops-noprint flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function gradeLabel(t: (k: string) => string, g: string) {
  return t(`ops.grades.${g}`);
}

/** CSV download built in the browser from rows the server returned to this user (exports respect the same permissions). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const raw = v == null ? '' : String(v);
    const s = typeof v === 'string' && /^[=+@\t\r-]/.test(raw) && !/^-?\d+(?:\.\d+)?$/.test(raw) ? "'" + raw : raw;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`ops-skeleton ${className}`} />;
}

/** Loading (skeleton) / error (retry) / data for one query; the children get the loaded data. */
export function Loaded<T>({ query, children, skeleton = 'list' }: {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode; skeleton?: 'list' | 'cards';
}) {
  const { t } = useTranslation();
  if (query.isLoading) {
    return (
      <div role="status" aria-label={t('common.loading')} className={skeleton === 'cards' ? 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4' : 'grid gap-2.5'}>
        {Array.from({ length: skeleton === 'cards' ? 4 : 5 }, (_, i) => <Skeleton key={i} className={skeleton === 'cards' ? 'h-28' : 'h-14'} />)}
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    );
  }
  if (query.error || query.data === undefined) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-ops border border-ops-redline bg-ops-redbg p-4 text-sm text-ops-red">
        <span aria-hidden="true">✕</span><span className="flex-1">{t('common.error')}</span>
        <button type="button" className={btn} onClick={() => void query.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tabs and segmented control (roving focus with arrow keys, animated indicator)
// ---------------------------------------------------------------------------------------------------------------------
export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: { key: K; label: ReactNode; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const idx = Math.max(0, tabs.findIndex((t) => t.key === value));
  useEffect(() => {
    const el = refs.current[idx];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [idx, tabs.length]);
  const onKey = (e: KeyboardEvent) => {
    const rtl = document.documentElement.dir === 'rtl';
    const d = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + tabs.length) % tabs.length;
    const next = tabs[n];
    if (next) { onChange(next.key); refs.current[n]?.focus(); }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey}
      className="relative mb-5 flex max-w-full gap-1 overflow-x-auto rounded-ops bg-ops-grey p-1 ops-scroll-thin">
      {ind && <span aria-hidden="true" className="absolute top-1 bottom-1 rounded-ops-sm bg-ops-surface shadow-ops transition-all duration-300 [transition-timing-function:var(--ops-ease)]" style={{ left: ind.left, width: ind.width }} />}
      {tabs.map((t, i) => (
        <button key={t.key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={value === t.key} tabIndex={value === t.key ? 0 : -1}
          onClick={() => onChange(t.key)}
          className={`relative z-[1] inline-flex min-h-[42px] shrink-0 items-center gap-2 whitespace-nowrap rounded-ops-sm px-4 text-sm font-semibold transition-colors ${value === t.key ? 'text-ops-accent' : 'text-ops-muted hover:text-ops-ink'}`}>
          {t.label}
          {t.count !== undefined && <span className="ops-num rounded-full bg-ops-soft px-1.5 text-[11px] text-ops-accent">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-ops-sm bg-ops-grey p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-[36px] rounded-[9px] px-3 text-xs font-semibold transition-all ${value === o.value ? 'bg-ops-surface text-ops-accent shadow-ops' : 'text-ops-muted hover:text-ops-ink'}`}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Dialogs: modal and side drawer (Escape closes, focus moves in and returns, background is inert to pointer)
// ---------------------------------------------------------------------------------------------------------------------
export function useDialog(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])');
    (first ?? ref.current)?.focus();
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        const a = f[0]; const z = f[f.length - 1];
        if (a && z && e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (a && z && !e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);
  return ref;
}

export function Modal({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className="ops-root fixed inset-0 z-[80] grid place-items-end bg-transparent sm:place-items-center" style={{ background: 'none' }}>
      <div className="ops-backdrop absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        className={`ops-pop relative m-0 max-h-[92vh] w-full overflow-y-auto rounded-t-[22px] border border-ops-line bg-ops-elevated p-5 shadow-ops-pop sm:m-4 sm:rounded-[20px] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={id} className="text-lg font-semibold">{title}</h2>
          <button type="button" className={btnGhost} onClick={onClose} aria-label={t('ops.ui.close')}>✕</button>
        </div>
        {children}
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-ops-line pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useDialog(open, onClose);
  const id = useId();
  if (!open) return null;
  return createPortal(
    <div className="ops-root fixed inset-0 z-[80]" style={{ background: 'none' }}>
      <div className="ops-backdrop absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}
        className="ops-drawer absolute inset-y-0 end-0 flex w-full max-w-md flex-col border-s border-ops-line bg-ops-elevated shadow-ops-pop">
        <div className="flex items-center justify-between gap-3 border-b border-ops-line p-4">
          <h2 id={id} className="text-lg font-semibold">{title}</h2>
          <button type="button" className={btnGhost} onClick={onClose} aria-label={t('ops.ui.close')}>✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Toasts: brief confirmation after a saved action (the saved state also stays visible next to the form)
// ---------------------------------------------------------------------------------------------------------------------
type Toast = { id: number; text: string; tone: 'good' | 'bad' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'good') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {items.map((i) => (
          <div key={i.id} className={`ops-toast pointer-events-auto flex max-w-md items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-ops-pop ${i.tone === 'bad' ? 'border-ops-redline bg-ops-redbg text-ops-red' : i.tone === 'info' ? 'border-ops-accentline bg-ops-elevated text-ops-ink' : 'border-ops-greenline bg-ops-elevated text-ops-green'}`}>
            <span aria-hidden="true">{i.tone === 'bad' ? '✕' : '✓'}</span>{i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Data table: search, sortable columns (aria-sort), pagination, stacked rows on phones
// ---------------------------------------------------------------------------------------------------------------------
export interface Column<R> { key: string; header: ReactNode; render: (r: R) => ReactNode; sort?: (r: R) => string | number; align?: 'start' | 'end'; search?: (r: R) => string; className?: string }
export function DataTable<R extends { id: string }>({ rows, columns, pageSize = 20, searchable = false, label, empty, rowClass, toolbar }: {
  rows: R[]; columns: Column<R>[]; pageSize?: number; searchable?: boolean; label: string; empty?: ReactNode; rowClass?: (r: R) => string; toolbar?: ReactNode;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? rows.filter((r) => columns.some((c) => matchesSearch(c.search?.(r) ?? String(c.sort?.(r) ?? ''), needle))) : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    if (sort && col?.sort) {
      const f = col.sort;
      out = [...out].sort((a, b) => { const x = f(a); const y = f(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
    }
    return out;
  }, [rows, q, sort, columns]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const p = Math.min(page, pages - 1);
  const shown = filtered.slice(p * pageSize, (p + 1) * pageSize);
  useEffect(() => setPage(0), [q]);
  return (
    <div className="min-w-0">
      {(searchable || toolbar) && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchable && (
            <div className="relative min-w-[12rem] flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-ops-muted">⌕</span>
              <input type="search" className={`${field} ps-9`} placeholder={t('ops.ui.search')} aria-label={`${t('ops.ui.search')} — ${label}`} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {toolbar}
        </div>
      )}
      {filtered.length === 0 ? (empty ?? <EmptyState>{q ? t('ops.ui.noMatch') : t('ops.ui.noRows')}</EmptyState>) : (
        <div className="overflow-x-auto rounded-ops-sm border border-ops-line ops-scroll-thin">
          <table className="w-full min-w-[560px] text-sm" aria-label={label}>
            <thead className="bg-ops-surface2 text-ops-muted">
              <tr>
                {columns.map((c) => {
                  const active = sort?.key === c.key;
                  return (
                    <th key={c.key} scope="col" aria-sort={active ? (sort?.dir === 1 ? 'ascending' : 'descending') : undefined}
                      className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${c.align === 'end' ? 'text-end' : 'text-start'}`}>
                      {c.sort ? (
                        <button type="button" className={`inline-flex items-center gap-1 hover:text-ops-ink ${active ? 'text-ops-accent' : ''}`}
                          onClick={() => setSort(active ? { key: c.key, dir: sort?.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                          {c.header}<span aria-hidden="true" className="text-[10px]">{active ? (sort?.dir === 1 ? '▲' : '▼') : '↕'}</span>
                        </button>
                      ) : c.header}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-ops-line bg-ops-surface">
              {shown.map((r) => (
                <tr key={r.id} className={`transition-colors hover:bg-ops-surface2 ${rowClass?.(r) ?? ''}`}>
                  {columns.map((c) => <td key={c.key} className={`px-3 py-2.5 align-middle ${c.align === 'end' ? 'text-end' : ''} ${c.className ?? ''}`}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label={t('ops.ui.pagination')} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ops-muted">
          <span className="ops-num">{t('ops.ui.rangeOf', { from: p * pageSize + 1, to: Math.min(filtered.length, (p + 1) * pageSize), total: filtered.length })}</span>
          <span className="flex gap-1">
            <button type="button" className={btn} disabled={p === 0} onClick={() => setPage(p - 1)}>{t('ops.ui.prev')}</button>
            <button type="button" className={btn} disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>{t('ops.ui.next')}</button>
          </span>
        </nav>
      )}
    </div>
  );
}
