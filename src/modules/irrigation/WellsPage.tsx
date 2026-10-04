import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { useAuth } from '@/core/auth/AuthProvider';
import { can } from '@/core/rbac/access';
import { errorKey } from '@/core/errors';
import { localized } from '@/core/data/tasks';
import { nextTransitions, statusLabel, useWorkflow } from '@/core/data/workflow';
import { QueryState } from '@/core/components/QueryState';
import { VerificationBadge, type VerificationStatus } from '@/core/components/VerificationBadge';

interface WellRow {
  id: string;
  code: string;
  name_ar: string | null;
  name_en: string | null;
  status: string;
  workflow_version_id: string;
  verification_status: VerificationStatus;
  is_temporary_code: boolean;
  owning_department_id: string | null;
  version: number;
  source_note: string | null;
}

const input = 'min-h-touch rounded border border-stone-300 px-3';
const STATUS_ORDER = ['not_yet_verified', 'active', 'inactive', 'under_maintenance'];

/**
 * Irrigation & Water → Wells. The 14 wells are placeholders until the farm enters each one's real code, name
 * and status. Nothing is assumed Active; every status change needs authority and a reason and is kept as history.
 */
export default function WellsPage() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const qc = useQueryClient();
  const wf = useWorkflow('asset_status');
  const [open, setOpen] = useState<{ id: string; mode: 'status' | 'identity' | 'verify' } | null>(null);
  const [form, setForm] = useState({ to: '', reason: '', code: '', name_ar: '', name_en: '', note: '' });
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['wells'],
    queryFn: async () => {
      const { data, error: e } = await requireSupabase().from('water_sources')
        .select('id, code, name_ar, name_en, status, workflow_version_id, verification_status, is_temporary_code, owning_department_id, version, source_note')
        .eq('kind', 'well').is('voided_at', null).order('code').returns<WellRow[]>();
      if (e) throw e;
      return data;
    },
  });

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    setError(null);
    const { error: e } = await action();
    if (e) { setError(errorKey(e)); return; }
    setOpen(null);
    await qc.invalidateQueries({ queryKey: ['wells'] });
  }

  function start(w: WellRow, mode: 'status' | 'identity' | 'verify') {
    setOpen({ id: w.id, mode });
    setForm({ to: '', reason: '', code: w.is_temporary_code ? '' : w.code, name_ar: w.name_ar ?? '', name_en: w.name_en ?? '', note: '' });
  }

  const wells = q.data ?? [];
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-xl font-bold">{t('wells.title')}</h1>
      <p className="text-stone-700">{t('wells.intro')}</p>
      <div className="flex flex-wrap gap-2">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="rounded-full border bg-white px-3 py-1">
            {statusLabel(wf.data, null, s, i18n.language)}: <bdi>{wells.filter((w) => w.status === s).length}</bdi>
          </span>
        ))}
      </div>
      {error && <p role="alert" className="text-red-700">{t(error)}</p>}
      <QueryState isLoading={q.isLoading} error={q.error} isEmpty={wells.length === 0} onRetry={() => void q.refetch()}>
        <ul className="grid gap-2 md:grid-cols-2">
          {wells.map((w) => {
            const mayConfigure = can(access, 'water_source', 'configure', { departmentId: w.owning_department_id });
            const mayVerify = can(access, 'water_source', 'verify', { departmentId: w.owning_department_id });
            const options = nextTransitions(wf.data, w.workflow_version_id, w.status);
            return (
              <li key={w.id} className="rounded-lg border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">
                      <bdi>{w.code}</bdi>
                      {w.is_temporary_code && <span className="ms-2 rounded bg-amber-100 px-1 text-xs text-amber-900">{t('wells.temporaryCode')}</span>}
                    </div>
                    <div>{w.name_ar || w.name_en ? localized(i18n.language, w.name_ar, w.name_en) : <span className="text-amber-900">{t('verification.not_yet_verified')}</span>}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded border px-2 py-0.5 text-sm">{statusLabel(wf.data, w.workflow_version_id, w.status, i18n.language)}</span>
                    <VerificationBadge status={w.verification_status} />
                  </div>
                </div>
                {!open && (mayConfigure || mayVerify) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mayConfigure && <button type="button" className="min-h-touch rounded border px-3" onClick={() => start(w, 'status')}>{t('wells.changeStatus')}</button>}
                    {mayConfigure && <button type="button" className="min-h-touch rounded border px-3" onClick={() => start(w, 'identity')}>{t('wells.editIdentity')}</button>}
                    {mayVerify && w.verification_status !== 'verified' && (
                      <button type="button" disabled={w.is_temporary_code || !w.name_ar} title={w.is_temporary_code || !w.name_ar ? t('wells.verifyNeedsIdentity') : undefined}
                        className="min-h-touch rounded border border-brand px-3 text-brand-dark disabled:opacity-50" onClick={() => start(w, 'verify')}>{t('admin.verify')}</button>
                    )}
                  </div>
                )}
                {open?.id === w.id && (
                  <form className="mt-3 flex flex-col gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const db = requireSupabase();
                    if (open.mode === 'status') void run(() => db.rpc('transition_record', { p_entity_type: 'water_sources', p_id: w.id, p_to_status: form.to, p_comment: form.reason, p_expected_version: w.version }));
                    if (open.mode === 'identity') void run(() => db.from('water_sources').update({ code: form.code.trim(), name_ar: form.name_ar.trim() || null, name_en: form.name_en.trim() || null, is_temporary_code: false, version: w.version }).eq('id', w.id));
                    if (open.mode === 'verify') void run(() => db.rpc('set_verification_status', { p_entity_type: 'water_sources', p_id: w.id, p_status: 'verified', p_source_note: form.note, p_expected_version: w.version }));
                  }}>
                    {open.mode === 'status' && (
                      <>
                        <label className="flex flex-col gap-1"><span>{t('wells.newStatus')}</span>
                          <select required className={input} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })}>
                            <option value="">—</option>
                            {options.map((o) => <option key={o.to_status} value={o.to_status}>{statusLabel(wf.data, w.workflow_version_id, o.to_status, i18n.language)}</option>)}
                          </select></label>
                        <label className="flex flex-col gap-1"><span>{t('wells.reason')}</span>
                          <input required className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
                      </>
                    )}
                    {open.mode === 'identity' && (
                      <>
                        <label className="flex flex-col gap-1"><span>{t('wells.realCode')}</span>
                          <input required dir="ltr" className={input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
                        <label className="flex flex-col gap-1"><span>{t('common.nameAr')}</span>
                          <input required className={input} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} /></label>
                        <label className="flex flex-col gap-1"><span>{t('common.nameEn')}</span>
                          <input dir="ltr" className={input} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} /></label>
                      </>
                    )}
                    {open.mode === 'verify' && (
                      <label className="flex flex-col gap-1"><span>{t('admin.sourceNote')}</span>
                        <input required className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
                    )}
                    <div className="flex gap-2">
                      <button type="submit" className="min-h-touch rounded bg-brand px-4 font-semibold text-white">{t('common.save')}</button>
                      <button type="button" className="min-h-touch rounded border px-4" onClick={() => setOpen(null)}>{t('common.cancel')}</button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>
    </section>
  );
}
