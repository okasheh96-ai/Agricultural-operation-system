import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { DemoBanner } from '@/core/components/DemoBanner';
import { NotificationBell } from '@/core/components/NotificationBell';
import { SignOutButton } from '@/core/auth/SignOutButton';
import { OFFICE_NAV, activeSection, visibleNav, type NavItem } from './nav';

/** One department or section in the horizontal bar. Unbuilt sections stay visible and honestly labelled. */
function SectionTab({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <li className="shrink-0">
      <NavLink to={item.path}
        className={({ isActive }) =>
          `flex min-h-touch flex-col justify-center rounded-lg px-3 py-1 text-sm whitespace-nowrap ${
            isActive ? 'bg-brand text-white shadow-sm'
              : item.tone === 'qa' ? 'bg-qa-light text-qa hover:bg-qa/10'
                : item.built ? 'text-stone-800 hover:bg-stone-100' : 'text-stone-500 hover:bg-stone-100'}`}>
        <span className="flex items-center gap-1.5 font-medium">
          {item.icon && <span aria-hidden="true">{item.icon}</span>}
          {t(item.labelKey)}
        </span>
        {!item.built && <span className="text-[11px] leading-tight opacity-80">{t('labels.laterPhase')}</span>}
      </NavLink>
    </li>
  );
}

function SubTab({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <li className="shrink-0">
      <NavLink to={item.path} end
        className={({ isActive }) =>
          `inline-flex min-h-touch items-center gap-1 border-b-2 px-3 text-sm whitespace-nowrap ${
            isActive ? 'border-brand font-semibold text-brand-dark' : 'border-transparent text-stone-600 hover:text-stone-900'}`}>
        {t(item.labelKey)}
        {!item.built && <span className="text-[11px] opacity-70">({t('labels.laterPhase')})</span>}
      </NavLink>
    </li>
  );
}

/**
 * Office layout: a top bar instead of a side menu, so every page gets the full width. Departments and sections run
 * horizontally (scrolling sideways on a phone); the open section's pages are a second row of tabs.
 */
export function OfficeShell() {
  const { t } = useTranslation();
  const { access } = useAuth();
  const { pathname } = useLocation();
  const sections = visibleNav(OFFICE_NAV, access);
  const current = activeSection(sections, pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      {/* Not sticky: with every department visible the bar can take several rows, which would cover content on small or
          zoomed screens and hide the focused element. */}
      <header className="border-b border-stone-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-1 md:px-6">
          <Link to="/office/command-center" className="flex min-h-touch items-center gap-2 font-bold text-brand-dark">
            <span aria-hidden="true" className="text-xl">🌾</span>
            {t('app.title')}
          </Link>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <NotificationBell to="/office/notifications" />
            <Link to="/field" className="inline-flex min-h-touch items-center rounded px-3 underline">{t('nav.fieldView')}</Link>
            <LanguageToggle />
            <SignOutButton />
          </div>
        </div>
        <nav aria-label={t('nav.officeView')} className="border-t border-stone-100">
          {/* A phone scrolls this row sideways; wider screens wrap it so every department stays in view. */}
          <ul className="flex gap-1 overflow-x-auto px-2 py-1.5 md:flex-wrap md:overflow-visible md:px-5">
            {sections.map((i) => <SectionTab key={i.key} item={i} />)}
          </ul>
        </nav>
        {current?.children && current.children.length > 0 && (
          <nav aria-label={t(current.labelKey)} className="border-t border-stone-100 bg-stone-50">
            <ul className="flex gap-1 overflow-x-auto px-2 md:px-5">
              {current.children.map((c) => <SubTab key={c.key} item={c} />)}
            </ul>
          </nav>
        )}
      </header>
      <main className="w-full min-w-0 flex-1 p-4 md:p-6"><Outlet /></main>
      <footer className="px-4 pb-3 text-xs text-stone-500 md:px-6">{t('app.version', { version: __APP_VERSION__ })}</footer>
    </div>
  );
}
