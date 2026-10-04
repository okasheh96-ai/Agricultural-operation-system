import { useTranslation } from 'react-i18next';
import { statusLabel, type WorkflowMirror } from '@/core/data/workflow';

const STYLE: Record<string, { icon: string; cls: string }> = {
  draft: { icon: '✎', cls: 'bg-stone-100 text-stone-800 border-stone-300' },
  planned: { icon: '◷', cls: 'bg-sky-50 text-sky-900 border-sky-300' },
  assigned: { icon: '➜', cls: 'bg-sky-100 text-sky-900 border-sky-400' },
  in_progress: { icon: '▶', cls: 'bg-amber-100 text-amber-900 border-amber-400' },
  blocked: { icon: '⛔', cls: 'bg-red-100 text-red-900 border-red-400' },
  completed: { icon: '✓', cls: 'bg-green-50 text-green-900 border-green-300' },
  pending_verification: { icon: '⌛', cls: 'bg-violet-100 text-violet-900 border-violet-300' },
  verified: { icon: '✔', cls: 'bg-green-100 text-green-900 border-green-400' },
  closed: { icon: '■', cls: 'bg-stone-200 text-stone-800 border-stone-400' },
  cancelled: { icon: '✕', cls: 'bg-stone-100 text-stone-600 border-stone-300' },
};
const FALLBACK = { icon: '•', cls: 'bg-stone-100 text-stone-800 border-stone-300' };

/** Status as icon + text + colour (never colour alone). Labels come from the workflow data (configurable). */
export function StatusBadge(props: { workflow: WorkflowMirror | undefined; versionId: string | null; status: string; pending?: boolean }) {
  const { t, i18n } = useTranslation();
  const s = STYLE[props.status] ?? FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {statusLabel(props.workflow, props.versionId, props.status, i18n.language)}
      {props.pending && <span className="ms-1 text-xs">({t('work.pendingSync')})</span>}
    </span>
  );
}
