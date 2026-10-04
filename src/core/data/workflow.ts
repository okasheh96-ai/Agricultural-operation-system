import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/core/supabase';
import { fieldDb } from '@/core/offline/fieldDb';

export interface WorkflowStatus {
  workflow_version_id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  is_terminal: boolean;
  sort_order: number;
}
export interface WorkflowTransition {
  workflow_version_id: string;
  from_status: string;
  to_status: string;
  required_action: string;
  required_fields: string[];
  guard: string | null;
}
export interface WorkflowMirror {
  /** Version new records start on (needed to create records offline). */
  activeVersionId: string | null;
  statuses: WorkflowStatus[];
  transitions: WorkflowTransition[];
}

async function fetchWorkflow(code: string): Promise<WorkflowMirror> {
  const db = requireSupabase();
  const { data: versions, error } = await db.from('workflow_versions').select('id, is_active').eq('workflow_code', code).is('voided_at', null);
  if (error) throw error;
  const ids = versions.map((v: { id: string }) => v.id);
  const activeVersionId = (versions as { id: string; is_active: boolean }[]).find((v) => v.is_active)?.id ?? null;
  const [s, t] = await Promise.all([
    db.from('workflow_statuses').select('workflow_version_id, code, name_ar, name_en, is_terminal, sort_order').in('workflow_version_id', ids).is('voided_at', null),
    db.from('allowed_transitions').select('workflow_version_id, from_status, to_status, required_action, required_fields, guard').in('workflow_version_id', ids).is('voided_at', null),
  ]);
  if (s.error) throw s.error;
  if (t.error) throw t.error;
  return { activeVersionId, statuses: s.data as WorkflowStatus[], transitions: t.data as WorkflowTransition[] };
}

/**
 * The active transition rules mirrored on the device (§3.5): the field app shows the right buttons and
 * applies changes provisionally offline; the server re-checks everything at sync.
 */
export function useWorkflow(code: string) {
  return useQuery({
    queryKey: ['workflow', code],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const key = `workflow:${code}`;
      if (!navigator.onLine) {
        const offline = await fieldDb.meta.get(key);
        if (offline) return JSON.parse(offline.value) as WorkflowMirror;
      }
      try {
        const wf = await fetchWorkflow(code);
        await fieldDb.meta.put({ key, value: JSON.stringify(wf) });
        return wf;
      } catch (e) {
        const cached = await fieldDb.meta.get(key);
        if (cached) return JSON.parse(cached.value) as WorkflowMirror;
        throw e;
      }
    },
  });
}

export function statusLabel(wf: WorkflowMirror | undefined, versionId: string | null, code: string, locale: string): string {
  const s = wf?.statuses.find((x) => x.code === code && (versionId === null || x.workflow_version_id === versionId))
    ?? wf?.statuses.find((x) => x.code === code);
  if (!s) return code;
  return locale === 'en' && s.name_en ? s.name_en : s.name_ar;
}

export function nextTransitions(wf: WorkflowMirror | undefined, versionId: string, from: string): WorkflowTransition[] {
  return (wf?.transitions ?? []).filter((t) => t.workflow_version_id === versionId && t.from_status === from);
}
