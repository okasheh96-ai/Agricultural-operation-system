import { useApi } from '../api';
import { t, useLang } from '../i18n';
import { ErrorBox, Loading, type FactRowView } from '../ui';
import { DashboardPage } from './Dashboard';
import type { Dashboard } from '../../worker/dashboard';

export function SnapshotView({ token }: { token: string }) {
  useLang();
  const s = useApi<{ title: string; created_at: string; expires_at: string; dashboard: Dashboard; facts: FactRowView[]; sections: string[] }>(`/api/s/${encodeURIComponent(token)}`);
  if (s.loading) return <Loading />;
  if (s.error) return <div data-testid="snapshot-gone"><h2>{t('snap_gone')}</h2><ErrorBox error={s.error} /></div>;
  const d = s.data!;
  return (
    <div data-testid="snapshot">
      <h1>{d.title}</h1>
      <p className="small muted">{d.dashboard.date} · {t('snap_expires')}: {new Date(d.expires_at).toLocaleString()}</p>
      <DashboardPage me={{ email: '', role: 'viewer', show_workers: false }} frozen={{ dashboard: d.dashboard, facts: d.facts, sections: d.sections }} />
    </div>
  );
}
