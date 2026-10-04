import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/core/components/useOnline';
import { DemoBanner } from '@/core/components/DemoBanner';
import { NotificationBell } from '@/core/components/NotificationBell';
import { useOutbox } from '@/core/offline/useOutbox';

const ITEMS = [
  { to: '/field/my-day', labelKey: 'nav.myDay', icon: '☀' },
  { to: '/field/report', labelKey: 'nav.reportProblem', icon: '⚠' },
  { to: '/field/scan', labelKey: 'nav.scan', icon: '⌗' },
  { to: '/field/crew', labelKey: 'nav.myCrew', icon: '👥' },
  { to: '/field/sync', labelKey: 'nav.sync', icon: '⇅' },
];

/** Field shell (§4.2): large targets, bottom navigation, connectivity always visible. */
export function FieldShell() {
  const { t } = useTranslation();
  const online = useOnline();
  const outbox = useOutbox();
  const pending = (outbox.data ?? []).filter((o) => o.state === 'pending').length;
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="flex items-center justify-between gap-2 bg-brand px-4 py-1 text-white">
        <span className="font-semibold">{t('app.title')}</span>
        <span className="flex items-center gap-2">
          <Link to="/field/sync" className="inline-flex min-h-touch items-center gap-1 text-sm" data-testid="connectivity">
            <span aria-hidden="true">{online ? '●' : '○'}</span>
            {online ? t('field.online') : t('field.offlineShort')}
            {pending > 0 && <span className="rounded bg-amber-400 px-1 text-amber-950"><bdi>{pending}</bdi></span>}
          </Link>
          <NotificationBell to="/field/notifications" />
        </span>
      </header>
      <main className="flex-1 p-4 pb-24"><Outlet /></main>
      <Link to="/office" className="mx-4 mb-24 text-sm underline">{t('nav.officeView')}</Link>
      <nav aria-label={t('nav.fieldView')} className="fixed inset-x-0 bottom-0 grid grid-cols-5 border-t bg-white">
        {ITEMS.map((i) => (
          <NavLink key={i.to} to={i.to}
            className={({ isActive }) => `flex min-h-[64px] flex-col items-center justify-center text-sm ${isActive ? 'text-brand font-bold' : 'text-stone-700'}`}>
            <span aria-hidden="true" className="text-xl">{i.icon}</span>
            {t(i.labelKey)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
