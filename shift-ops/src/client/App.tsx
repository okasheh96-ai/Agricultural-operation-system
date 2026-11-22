import { useEffect, useState } from 'react';
import { api, ApiError, navigate, startVersionPolling, useApi, useLocation } from './api';
import { getLang, setLang, t, useLang } from './i18n';
import { Loading, errText } from "./ui";
import type { Me } from '../shared/types';
import { DashboardPage } from './pages/Dashboard';
import { PlanPage } from './pages/Plan';
import { ImportPage } from './pages/Import';
import { ReviewDetail, ReviewList } from './pages/Review';
import { SettingsPage } from './pages/Settings';
import { SnapshotView } from './pages/SnapshotView';

function Guide({ onClose }: { onClose: () => void }) {
  return (
    <div className="card" data-testid="guide">
      <h2>{t('guide_title')}</h2>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => <p key={i}>{t(`guide_${i}`)}</p>)}
      <button className="btn primary" onClick={onClose} data-testid="guide-dismiss">{t('guide_dismiss')}</button>
    </div>
  );
}

export function App() {
  useLang();
  const loc = useLocation();
  const path = loc.split('?')[0];
  if (path.startsWith('/s/')) return <Shell me={null}><SnapshotView token={path.slice(3)} /></Shell>;
  return <Authed path={path} />;
}

function Authed({ path }: { path: string }) {
  const me = useApi<Me & { owner_configured: boolean }>('/api/me');
  const settings = useApi<{ settings: Record<string, unknown> }>(me.data?.role === 'owner' ? '/api/settings' : null);
  const [guide, setGuide] = useState<boolean | null>(null);
  useEffect(() => { if (me.data) startVersionPolling(); }, [me.data]);
  useEffect(() => { if (settings.data && guide === null) setGuide(settings.data.settings.guide_dismissed !== true); }, [settings.data]);
  if (me.loading) return <Shell me={null}><Loading /></Shell>;
  if (me.error) {
    const e = me.error as ApiError;
    return <Shell me={null}><div className="state error" role="alert" data-testid="auth-error">{e.code === 'no_access' ? t('err_no_access') : errText(e)}<button className="btn" onClick={me.reload}>{t('retry')}</button></div></Shell>;
  }
  const m = me.data!;
  let page;
  if (m.role !== 'owner') page = <DashboardPage me={m} />;
  else if (path === '/plan') page = <PlanPage />;
  else if (path === '/import') page = <ImportPage />;
  else if (path === '/review') page = <ReviewList />;
  else if (path.startsWith('/review/')) page = <ReviewDetail id={path.slice(8)} />;
  else if (path.startsWith('/settings')) page = <SettingsPage tab={path.split('/')[2] ?? 'ref'} />;
  else page = <DashboardPage me={m} />;
  return (
    <Shell me={m} path={path}>
      {m.role === 'owner' && guide && <Guide onClose={() => { setGuide(false); void api('/api/settings', { method: 'PUT', body: { guide_dismissed: true } }).catch(() => undefined); }} />}
      {page}
    </Shell>
  );
}

function Shell({ me, path = '/', children }: { me: Me | null; path?: string; children: React.ReactNode }) {
  const nav = me?.role === 'owner' ? [['/', 'nav_today'], ['/plan', 'nav_plan'], ['/import', 'nav_import'], ['/review', 'nav_review'], ['/settings', 'nav_settings']] : [];
  return (
    <>
      <header className="topbar">
        <span className="title">{t('app_title')}</span>
        {me && <span className="badge" data-testid="role">{t(`role_${me.role}`)}</span>}
        <button className="btn plain" onClick={() => setLang(getLang() === 'ar' ? 'en' : 'ar')} data-testid="lang">{t('lang_switch')}</button>
        {me && <a className="btn plain" href="/cdn-cgi/access/logout">{t('sign_out')}</a>}
      </header>
      <main>{children}</main>
      {nav.length > 0 && (
        <nav className="bottomnav">
          {nav.map(([p, k]) => {
            const on = p === '/' ? path === '/' : path.startsWith(p);
            return <a key={p} href={p} className={on ? 'on' : ''} onClick={(e) => { e.preventDefault(); navigate(p); }} data-testid={`nav-${k}`}>{t(k)}</a>;
          })}
        </nav>
      )}
    </>
  );
}

