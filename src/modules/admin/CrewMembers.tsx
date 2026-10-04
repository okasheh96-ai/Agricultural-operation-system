import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { can } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { formatDateTime, type Locale } from '@/core/i18n';

interface MemberRow { id: string; version: number; valid_from: string; valid_to: string | null; workers: { id: string; code: string; full_name: string } | null }
interface WorkerRow { id: string; code: string; full_name: string }

/** Time-bounded crew membership: add a worker from today, or end a membership (history is kept). */
export function CrewMembers({ crewId, departmentId, onClose }: { crewId: string; departmentId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const mayEdit = can(access, 'crew', 'configure', { departmentId });
  const [worker, setWorker] = useState('');
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({ queryKey: ['crew-members', crewId], queryFn: async () => {
    const { data, error: e } = await requireSupabase().from('crew_members').select('id, version, valid_from, valid_to, workers(id, code, full_name)')
      .eq('crew_id', crewId).is('voided_at', null).order('valid_from', { ascending: false }).returns<MemberRow[]>();
    if (e) throw e;
    return data;
  } });
  const workers = useQuery({ queryKey: ['workers-lite'], queryFn: async () => {
    const { data, error: e } = await requireSupabase().from('workers').select('id, code, full_name').is('voided_at', null).eq('is_active', true).order('code').returns<WorkerRow[]>();
    if (e) throw e;
    return data;
  } });

  const now = Date.now();
  const current = (members.data ?? []).filter((m) => !m.valid_to || Date.parse(m.valid_to) > now);
  const past = (members.data ?? []).filter((m) => m.valid_to && Date.parse(m.valid_to) <= now);

  async function act(p: PromiseLike<{ error: unknown }>) {
    setError(null);
    const { error: e } = await p;
    if (e) setError(errorKey(e));
    await qc.invalidateQueries({ queryKey: ['crew-members', crewId] });
  }

  return (
    <div className="mt-3 rounded border bg-stone-50 p-3">
      <h3 className="mb-2 font-semibold">{t('md.members')} (<bdi>{current.length}</bdi>)</h3>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
      <ul className="mb-2 flex flex-col gap-1">
        {current.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2">
            <span>{m.workers?.full_name} <bdi className="text-xs text-stone-500">{m.workers?.code}</bdi></span>
            {mayEdit && (
              <button type="button" className="min-h-touch rounded border px-3 text-sm"
                onClick={() => void act(requireSupabase().from('crew_members').update({ valid_to: new Date().toISOString(), version: m.version }).eq('id', m.id))}>
                {t('md.endMembership')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {past.length > 0 && (
        <details className="mb-2 text-sm text-stone-600">
          <summary>{t('md.pastMembers')} (<bdi>{past.length}</bdi>)</summary>
          {past.map((m) => <div key={m.id}>{m.workers?.full_name} — <bdi>{formatDateTime(m.valid_to as string, i18n.language as Locale)}</bdi></div>)}
        </details>
      )}
      {mayEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          void act(requireSupabase().from('crew_members').insert({ farm_id: access?.farmId, crew_id: crewId, worker_id: worker }));
          setWorker('');
        }}>
          <label className="flex min-w-0 flex-col gap-1"><span>{t('work.worker')}</span>
            <select required className="min-h-touch w-full min-w-0 rounded border border-stone-300 px-3" value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">—</option>
              {workers.data?.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.full_name}</option>)}
            </select></label>
          <button type="submit" disabled={!worker} className="min-h-touch rounded bg-brand px-4 font-semibold text-white disabled:opacity-60">{t('md.addMember')}</button>
        </form>
      )}
      <button type="button" className="mt-2 min-h-touch underline" onClick={onClose}>{t('common.cancel')}</button>
    </div>
  );
}
