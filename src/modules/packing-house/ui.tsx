import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type Locale } from '@/core/i18n';
import { STATUS_STYLE, TONE_CLASS } from './stages';
import type { Evidence } from './api';
import { reasonText, type PhReason } from './phErrors';

export const inputCls = 'min-h-touch w-full min-w-0 rounded border border-stone-300 bg-white px-3';
export const btnCls = 'inline-flex min-h-touch items-center gap-1.5 rounded border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';
export const primaryBtnCls = 'inline-flex min-h-touch items-center gap-1.5 rounded bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50';

/** Workflow status as icon + text + colour; labels come from the workflow data via i18n keys. */
export function StatusPill({ status, workflow }: { status: string; workflow: string }) {
  const { t } = useTranslation();
  const s = STATUS_STYLE[status] ?? { icon: '•', tone: 'grey' as const };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-sm font-medium ${TONE_CLASS[s.tone]}`}>
      <span aria-hidden="true">{s.icon}</span>
      {t(`ph.status.${workflow}.${status}`, { defaultValue: status })}
    </span>
  );
}

/** The specification's own label on a rule, cell or value: C Confirmed · P Proposed · NYV Not Yet Verified. */
export function EvidenceBadge({ evidence, compact = false }: { evidence: Evidence; compact?: boolean }) {
  const { t } = useTranslation();
  const cls = evidence === 'C' ? 'bg-green-100 text-green-900 border-green-300'
    : evidence === 'P' ? 'bg-sky-100 text-sky-900 border-sky-300' : 'bg-amber-100 text-amber-900 border-amber-300';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 text-xs font-semibold ${cls}`} title={t(`ph.evidence.${evidence}`)}>
      {compact ? evidence : `${evidence} · ${t(`ph.evidence.${evidence}`)}`}
    </span>
  );
}

export function When({ iso }: { iso: string | null | undefined }) {
  const { i18n } = useTranslation();
  if (!iso) return <>—</>;
  return <bdi>{formatDateTime(iso, i18n.language as Locale)}</bdi>;
}

export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="truncate font-medium text-stone-900">{children}</div>
    </div>
  );
}

export type StripState = 'done' | 'waiting' | 'active' | 'rejected' | 'held' | 'not_reached' | 'later';

const STRIP_STATE: Record<StripState, { icon: string; cls: string }> = {
  done: { icon: '✓', cls: 'bg-green-500 text-white' },
  waiting: { icon: '⏳', cls: 'bg-amber-400 text-stone-900' },
  active: { icon: '▶', cls: 'bg-sky-400 text-stone-900' },
  rejected: { icon: '✕', cls: 'bg-red-500 text-white' },
  held: { icon: '⏸', cls: 'bg-red-500 text-white' },
  not_reached: { icon: '–', cls: 'bg-slate-500 text-slate-100' },
  later: { icon: '⏭', cls: 'bg-slate-500 text-slate-100' },
};

/**
 * One responsibility panel (the dark strips of the agreed layout): which activity, who is responsible (the person who
 * acted, or the role queue when nobody has yet — people are never assigned by invention), its state and elapsed time.
 */
export function ActivityStrip(props: {
  icon: string;
  title: string;
  who: string;
  detail?: string;
  state: StripState;
  attention?: boolean;
}) {
  const { t } = useTranslation();
  const s = STRIP_STATE[props.state];
  const active = props.state === 'active' || props.state === 'waiting';
  return (
    <div className={`flex min-w-[11.5rem] flex-1 items-start gap-2 rounded px-2.5 py-1.5 text-sm ${
      active ? 'bg-sky-800 text-white' : props.state === 'not_reached' || props.state === 'later' ? 'bg-slate-600 text-slate-200' : 'bg-slate-700 text-white'}
      ${props.attention ? 'ring-2 ring-amber-400' : ''}`}>
      <span aria-hidden="true" className="mt-0.5 text-base">{props.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{props.title}</div>
        <div className="truncate text-slate-100">{props.who}</div>
        {props.detail && <div className="truncate text-xs text-slate-200"><bdi>{props.detail}</bdi></div>}
      </div>
      <span className={`mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-bold ${s.cls}`}
        title={t(`ph.strip.${props.state}`)} aria-label={t(`ph.strip.${props.state}`)}>{s.icon}</span>
    </div>
  );
}

/** Explains why an action is not available (permission, open decision, segregation of duties, state). */
export function ReasonNote({ reason }: { reason: PhReason }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-start gap-1.5 text-xs text-stone-600">
      <span aria-hidden="true">ⓘ</span><span>{reasonText(t, reason)}</span>
    </p>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{message}</p>;
}

export function WarningList({ warnings }: { warnings: PhReason[] }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <ul role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {warnings.map((w, i) => <li key={i}>⚠ {reasonText(t, w)}</li>)}
    </ul>
  );
}

/** Inline panel that holds one action's form. */
export function ActionPanel({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <section aria-label={title} className="rounded-lg border-2 border-brand/40 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold text-brand-dark">{title}</h3>
        <button type="button" className={btnCls} onClick={onClose}>{t('common.cancel')}</button>
      </div>
      {children}
    </section>
  );
}

export function Labelled({ label, children, required = false, hint }: { label: string; children: ReactNode; required?: boolean; hint?: string }) {
  const { t } = useTranslation();
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="font-medium text-stone-700">{label}{required && <span className="text-red-700" aria-label={t('ph.required')}> *</span>}</span>
      {children}
      {hint && <span className="text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** One audit value, readable: linked record ids shortened, timestamps in local time, empty as a dash. */
export function auditValue(v: unknown, locale: Locale): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && UUID.test(v)) return `#${v.slice(0, 8)}`;
  if (typeof v === 'string' && ISO_TIME.test(v)) return formatDateTime(v, locale);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** The database records the V-21 outcome in English; show it in the user's language. */
const PLAUSIBILITY: Record<string, string> = {
  'Not checked: plausibility tolerance pending OD-29': 'ph.plausibility.pending',
  'Outside plausibility tolerance; confirmed by the registrar': 'ph.plausibility.confirmed',
  'Within plausibility tolerance': 'ph.plausibility.within',
};
export function plausibilityText(t: TFunction, note: string | null): string {
  if (!note) return '—';
  const key = PLAUSIBILITY[note];
  return key ? t(key) : note;
}

/** Printing works everywhere except the in-browser demo shown inside a host page, whose frame blocks the print dialog. */
export function canPrint(): boolean {
  return !(__BROWSER_DB__ && window.self !== window.top);
}
