import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { fmtDateTime, fmtQ, t, useLang } from './i18n';

export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'network') return t('err_network');
    const k = `err_${e.code}`;
    const msg = t(k) !== k ? t(k) : `${t('err_generic')}: ${e.code}`;
    return msg;
  }
  return t('err_generic');
}

export function Loading() {
  return <div className="state loading" role="status" aria-live="polite"><span className="spinner" aria-hidden />{t('loading')}</div>;
}
export function Empty({ children }: { children?: ReactNode }) {
  return <div className="state empty">{children ?? t('empty')}</div>;
}
export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const detail = error instanceof ApiError && error.detail ? JSON.stringify(error.detail).slice(0, 300) : null;
  return (
    <div className="state error" role="alert">
      <strong>{t('failed')}</strong> — {errText(error)}
      {detail && <details><summary>{t('details')}</summary><code className="ltr">{detail}</code></details>}
      {onRetry && <button className="btn" onClick={onRetry}>{t('retry')}</button>}
    </div>
  );
}

/** Async button with saving / saved / failed / retry states. */
export function ActionButton({ onClick, children, kind = 'primary', disabled, confirmText, testId }: { onClick: () => Promise<unknown>; children: ReactNode; kind?: 'primary' | 'danger' | 'plain'; disabled?: boolean; confirmText?: string; testId?: string }) {
  const [st, setSt] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [err, setErr] = useState<unknown>(null);
  const run = async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    setSt('busy');
    setErr(null);
    try { await onClick(); setSt('ok'); setTimeout(() => setSt((s) => (s === 'ok' ? 'idle' : s)), 1800); } catch (e) { setErr(e); setSt('err'); }
  };
  return (
    <span className="action">
      <button data-testid={testId} className={`btn ${kind}`} onClick={run} disabled={disabled || st === 'busy'} aria-busy={st === 'busy'}>
        {st === 'busy' ? t('saving') : children}
      </button>
      {st === 'ok' && <span className="ok" role="status">✓ {t('saved')}</span>}
      {st === 'err' && <span className="err" role="alert">{errText(err)} <button className="link" onClick={run}>{t('retry')}</button></span>}
    </span>
  );
}

export function StatusBadge({ s }: { s: string }) {
  return <span className={`badge st-${s}`} data-status={s}>{t(`st_${s}`)}</span>;
}

export function Q({ v, unit }: { v: number | null | undefined; unit?: string | null }) {
  useLang();
  if (v === null || v === undefined) return <span className="muted">{t('unavailable')}</span>;
  return <span className="num">{fmtQ(v)}{unit ? <span className="unit"> {unit}</span> : null}</span>;
}

// ------------------------------------------------------------------ charts (SVG, logical direction)
export function BarList({ items, unit, onSelect, selected }: { items: { key: string; label?: string; value: number | null }[]; unit?: string; onSelect?: (k: string) => void; selected?: string | null }) {
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value ?? 0)));
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.key}>
          <button className={`barrow ${selected === i.key ? 'sel' : ''}`} onClick={() => onSelect?.(i.key)} disabled={!onSelect} aria-pressed={selected === i.key}>
            <span className="barlabel">{i.label ?? (i.key || '—')}</span>
            <span className="bartrack"><span className="barfill" style={{ inlineSize: `${(Math.abs(i.value ?? 0) / max) * 100}%` }} /></span>
            <span className="barval"><Q v={i.value} unit={unit} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Progress({ actual, due, target }: { actual: number | null; due: number | null; target: number }) {
  const pct = (v: number | null) => (v === null || !target ? 0 : Math.min(100, (v / target) * 100));
  return (
    <div className="progress" aria-hidden>
      <span className="pfill" style={{ inlineSize: `${pct(actual)}%` }} />
      {due !== null && <span className="pdue" style={{ insetInlineStart: `${pct(due)}%` }} />}
    </div>
  );
}

export function Trend({ points, unit }: { points: { key: string; value: number | null }[]; unit?: string }) {
  const lang = useLang();
  const vals = points.filter((p) => p.value !== null) as { key: string; value: number }[];
  if (vals.length < 2) return <BarList items={points.map((p) => ({ key: p.key, label: label(p.key), value: p.value }))} unit={unit} />;
  const W = 320, H = 120, P = 6;
  const max = Math.max(...vals.map((v) => v.value));
  const min = Math.min(0, ...vals.map((v) => v.value));
  const x = (i: number) => P + (i * (W - 2 * P)) / (vals.length - 1);
  const y = (v: number) => H - P - ((v - min) / (max - min || 1)) * (H - 2 * P);
  const pts = vals.map((v, i) => `${lang === 'ar' ? W - x(i) : x(i)},${y(v.value)}`).join(' ');
  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={vals.map((v) => `${label(v.key)}: ${fmtQ(v.value)}`).join(', ')}>
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
        {vals.map((v, i) => <circle key={v.key} cx={lang === 'ar' ? W - x(i) : x(i)} cy={y(v.value)} r="3.5" fill="var(--accent)"><title>{`${label(v.key)}: ${fmtQ(v.value)} ${unit ?? ''}`}</title></circle>)}
      </svg>
      <figcaption className="trendaxis"><span>{label(vals[0].key)}</span><span>{label(vals[vals.length - 1].key)}</span></figcaption>
    </figure>
  );
}
function label(k: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(k)) return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Amman', hourCycle: 'h23' }).format(new Date(k));
  return k;
}

// ------------------------------------------------------------------ drill-down: approved rows behind a KPI
export interface FactRowView { id: string; dataset: string; shift_date: string; at_ms: number | null; start_ms: number | null; end_ms: number | null; line: string | null; product: string | null; grade: string | null; lot: string | null; customer: string | null; order_ref: string | null; worker: string | null; reason: string | null; doc_no: string | null; metric: string; qty: number; unit: string; mode: string; source_ref: string | null; batch_id: string; approved_at: string; status: string | null }

export function FactTable({ query, title, onClose, staticRows }: { query?: Record<string, unknown>; title: string; onClose?: () => void; staticRows?: FactRowView[] }) {
  useLang();
  const [rows, setRows] = useState<FactRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ k: string; dir: 'asc' | 'desc' }>({ k: 'at_ms', dir: 'desc' });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const load = async (offset: number) => {
    if (staticRows) return;
    setBusy(true);
    try {
      const r = await api<{ rows: FactRowView[]; total: number }>('/api/facts/query', { body: { ...query, q: q || undefined, sort: sort.k, dir: sort.dir, offset, limit: 50 } });
      setRows((p) => (offset ? [...p, ...r.rows] : r.rows));
      setTotal(r.total);
      setErr(null);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  useEffect(() => { void load(0); }, [JSON.stringify(query), q, sort.k, sort.dir]);
  const shown = staticRows ? filterSort(staticRows, q, sort) : rows;
  const count = staticRows ? shown.length : total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || staticRows) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !busy && rows.length < total) void load(rows.length); });
    io.observe(el);
    return () => io.disconnect();
  });
  const th = (k: string, l: string) => (
    <th><button className="link" onClick={() => setSort((s) => ({ k, dir: s.k === k && s.dir === 'desc' ? 'asc' : 'desc' }))}>{l}{sort.k === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
  );
  return (
    <div className="facttable" data-testid="fact-table">
      <div className="ft-head">
        <h3>{title} <span className="muted">({count})</span></h3>
        {onClose && <button className="btn plain" onClick={onClose}>{t('close')}</button>}
      </div>
      <input className="input" type="search" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
      {err ? <ErrorBox error={err} onRetry={() => load(0)} /> : null}
      <div className="tablewrap">
        <table>
          <thead><tr>{th('shift_date', t('shift_date'))}{th('at_ms', t('f_time'))}{th('dataset', t('dataset'))}{th('line', t('f_line'))}{th('product', t('f_product'))}{th('grade', t('f_grade'))}{th('lot', t('f_lot'))}{th('qty', t('qty'))}<th>{t('source')}</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.shift_date}</td><td>{r.at_ms ? fmtDateTime(r.at_ms) : r.start_ms ? `${fmtDateTime(r.start_ms)}–${fmtDateTime(r.end_ms)}` : '—'}</td>
                <td>{t(`ds_${r.dataset}`) !== `ds_${r.dataset}` ? t(`ds_${r.dataset}`) : r.dataset}<span className="muted"> · {r.metric}{r.mode === 'cumulative' ? ` · ${t('cumulative')}` : ''}</span></td>
                <td>{r.line ?? '—'}</td><td>{r.product ?? '—'}</td><td>{r.grade ?? '—'}</td><td>{r.lot ?? r.doc_no ?? r.customer ?? '—'}</td>
                <td className="num"><Q v={r.qty} unit={r.unit} /></td><td className="ltr small">{r.source_ref ?? '—'}{r.worker ? ` · ${r.worker}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && !busy && <Empty />}
      {busy && <Loading />}
      {!staticRows && rows.length < total && <div ref={sentinel}><button className="btn plain" onClick={() => load(rows.length)}>{t('load_more')}</button></div>}
    </div>
  );
}
function filterSort(rows: FactRowView[], q: string, sort: { k: string; dir: 'asc' | 'desc' }) {
  const ql = q.toLowerCase();
  const f = ql ? rows.filter((r) => Object.values(r).some((v) => v !== null && String(v).toLowerCase().includes(ql))) : rows;
  const k = sort.k as keyof FactRowView;
  return [...f].sort((a, b) => { const x = a[k] ?? ''; const y = b[k] ?? ''; const c = x < y ? -1 : x > y ? 1 : 0; return sort.dir === 'asc' ? c : -c; });
}

export function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="drawer-bg" onClick={onClose}>
      <div className="drawer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="flabel">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Select({ value, onChange, options, testId, allowEmpty }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; testId?: string; allowEmpty?: string }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
