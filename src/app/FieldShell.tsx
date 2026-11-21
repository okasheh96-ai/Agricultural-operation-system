import { Icon } from '@/modules/ops/icons';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/core/components/useOnline';
import { DemoBanner } from '@/core/components/DemoBanner';
import { NotificationBell } from '@/core/components/NotificationBell';
import { useOutbox } from '@/core/offline/useOutbox';
import { SignOutButton } from '@/core/auth/SignOutButton';

const ITEMS = [
  { to: '/field/my-day', labelKey: 'nav.myDay', icon: 'sun' },
  { to: '/field/report', labelKey: 'nav.reportProblem', icon: 'complaints' },
  { to: '/field/scan', labelKey: 'nav.scan', icon: 'scan' },
  { to: '/field/crew', labelKey: 'nav.myCrew', icon: 'people' },
  { to: '/field/sync', labelKey: 'nav.sync', icon: 'sync' },
];

/** Field shell (§4.2): large targets, bottom navigation, connectivity always visible. */
export function FieldShell() {
  const { t } = useTranslation();
  const online = useOnline();
  const outbox = useOutbox();
  const pending = (outbox.data ?? []).filter((o) => o.state === 'pending').length;
  return (
    <div className="ops-root farm-workspace flex min-h-screen flex-col">
      <DemoBanner />
      <header className="flex items-center justify-between gap-3 border-b border-ops-line bg-ops-surface px-4 py-2 text-ops-ink md:px-8">
        <span className="flex min-w-0 items-center gap-2 font-semibold"><span className="ops-btn-primary grid h-10 w-10 shrink-0 place-items-center rounded-xl"><Icon name="leaf" /></span>{t('app.title')}</span>
        <span className="flex items-center gap-2">
          <Link to="/field/sync" className="inline-flex min-h-touch items-center gap-1 text-sm" data-testid="connectivity">
            <span aria-hidden="true">{online ? '●' : '○'}</span>
            {online ? t('field.online') : t('field.offlineShort')}
            {pending > 0 && <span className="rounded bg-amber-400 px-1 text-amber-950"><bdi>{pending}</bdi></span>}
          </Link>
          <NotificationBell to="/field/notifications" />
        </span>
      </header>
      <main className="ops-enter mx-auto w-full min-w-0 max-w-5xl flex-1 p-4 md:p-7"><Outlet /></main>
      <div className="farm-actions mx-auto mb-24 flex w-full max-w-5xl px-4 flex-wrap items-center gap-2 text-sm">
        <Link to="/office" className="min-h-touch inline-flex items-center underline">{t('nav.officeView')}</Link>
        <LanguageToggle /><SignOutButton />
      </div>
      <nav aria-label={t('nav.fieldView')} className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t border-ops-line bg-ops-surface pb-[env(safe-area-inset-bottom)] shadow-ops">
        {ITEMS.map((i) => (
          <NavLink key={i.to} to={i.to}
            className={({ isActive }) => `flex min-h-[64px] flex-col items-center justify-center text-sm ${isActive ? 'bg-ops-soft text-ops-accent font-bold' : 'text-stone-700'}`}>
            <Icon name={i.icon} />
            {t(i.labelKey)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
