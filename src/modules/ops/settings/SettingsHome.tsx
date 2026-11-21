import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { requireSupabase } from '@/core/supabase';
import { localName, useMyPermissions } from '../api';
import { btnPrimary, Card, PageTitle, Pill } from '../ui';

interface OpenItem { code: string; priority: string; title_ar: string; title_en: string; blocks_ar: string; blocks_en: string; decision_state: string }

/** Operations Settings: every area the Owner configures without code, and the items still waiting for a decision (steps
 *  that depend on them stay blocked on a real farm). */
export default function SettingsHome() {
  const { t, i18n } = useTranslation();
  const perms = useMyPermissions();
  const open = useQuery({ queryKey: ['ops', 'open-items'], queryFn: async () => {
    const db = requireSupabase();
    const [d, cells] = await Promise.all([
      db.from('ph_open_decisions').select('code, priority, title_ar, title_en, blocks_ar, blocks_en, decision_state').is('voided_at', null).in('decision_state', ['open', 'proposed', 'demo_assumption']).order('code'),
      db.from('ph_permission_cells').select('id', { count: 'exact', head: true }).is('voided_at', null).in('state', ['proposed', 'pending_decision']),
    ]);
    if (d.error) throw d.error;
    return { decisions: (d.data ?? []) as OpenItem[], cells: cells.count ?? null };
  } });
  const has = (k: string) => !!perms.data?.has(k);
  const areas = [
    { key: 'people', to: '/ops/settings/people', show: has('users.administer') || has('delegated.accounts') },
    { key: 'operations', to: '/ops/settings/operations', show: has('settings.edit') || has('settings.publish') },
    { key: 'kpis', to: '/ops/settings/kpis', show: has('settings.edit') || has('settings.publish') },
    { key: 'master', to: '/ops/settings/master', show: has('md_operational.edit') || has('md_customer.edit') || has('md_operational.approve') || has('md_customer.approve') },
    { key: 'tasks', to: '/ops/tasks', show: has('task.create') },
    { key: 'authority', to: '/office/packing-house/matrix', show: has('settings.authority') || has('users.administer') },
  ].filter((a) => a.show);
  const pr: Record<string, 'bad' | 'warn' | 'info' | 'neutral'> = { critical: 'bad', high: 'warn', medium: 'info', low: 'neutral' };
  return (
    <div>
      <PageTitle title={t('ops.settings.title')} sub={t('ops.settings.sub')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {areas.map((a) => (
          <Link key={a.key} to={a.to} className="ops-card ops-fade block p-4 hover:border-ops-accent">
            <h2 className="font-semibold">{t(`ops.settings.areas.${a.key}.title`)}</h2>
            <p className="mt-1 text-sm text-ops-muted">{t(`ops.settings.areas.${a.key}.sub`)}</p>
          </Link>
        ))}
      </div>
      {has('backup.download') && <BackupCard />}
      <Card title={t('ops.settings.openItems')} className="mt-4" highlight={(open.data?.decisions.length ?? 0) > 0}>
        <p className="mb-2 text-sm text-ops-muted">{t('ops.settings.openHelp')}</p>
        {open.data && open.data.cells !== null && <p className="mb-2 text-sm">{t('ops.settings.cellsWaiting', { n: open.data.cells })}</p>}
        <ul className="grid gap-2">
          {(open.data?.decisions ?? []).map((d) => (
            <li key={d.code} className="rounded-ops-sm border border-ops-line p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2"><bdi className="font-semibold">{d.code}</bdi><Pill tone={pr[d.priority] ?? 'neutral'}>{t(`ops.settings.priority.${d.priority}`)}</Pill>
                {d.decision_state === 'demo_assumption' && <Pill tone="warn">{t('ops.settings.demoAssumption')}</Pill>}</div>
              <p className="mt-1">{localName(i18n.language, d.title_ar, d.title_en)}</p>
              <p className="mt-1 text-xs text-ops-muted">{t('ops.settings.blocks')}: {localName(i18n.language, d.blocks_ar, d.blocks_en)}</p>
            </li>
          ))}
        </ul>
        <Link to="/office/packing-house/decisions" className="mt-3 inline-block text-sm font-semibold text-ops-accent underline">{t('ops.settings.decide')}</Link>
      </Card>
    </div>
  );
}

/** Full backup (database: records, photos, settings, accounts) downloaded by the Owner; the server checks and records it. */
function BackupCard() {
  const { t } = useTranslation();
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const download = async () => {
    setState('busy');
    try {
      const { data } = await requireSupabase().auth.getSession();
      const res = await fetch('/api/backup', { headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` } });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'packhouse-backup.dump';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setState('done');
    } catch { setState('failed'); }
  };
  return (
    <Card title={t('ops.settings.backup.title')} className="mt-4">
      <p className="mb-2 text-sm text-ops-muted">{t('ops.settings.backup.help')}</p>
      <button type="button" className={btnPrimary} disabled={state === 'busy'} onClick={download}>{t('ops.settings.backup.download')}</button>
      <p role="status" className="mt-2 text-sm">{state === 'busy' ? t('ops.save.pending') : state === 'done' ? t('ops.settings.backup.done') : state === 'failed' ? t('ops.settings.backup.failed') : ''}</p>
    </Card>
  );
}
