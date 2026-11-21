import { Icon } from '@/modules/ops/icons';
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
            isActive ? 'bg-ops-soft text-ops-accent ring-1 ring-inset ring-ops-accentline'
              : item.tone === 'qa' ? 'bg-qa-light text-qa hover:bg-qa/10'
                : item.built ? 'text-stone-800 hover:bg-stone-100' : 'text-stone-500 hover:bg-stone-100'}`}>
        <span className="flex items-center gap-1.5 font-medium">
          {item.icon && <Icon name={item.icon} className="h-4 w-4" />}
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
    <div className="ops-root farm-workspace flex min-h-screen flex-col">
      <DemoBanner />
      {/* Not sticky: with every department visible the bar can take several rows, which would cover content on small or
          zoomed screens and hide the focused element. */}
      <header className="border-b border-ops-line bg-ops-surface shadow-ops">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 md:px-8">
          <Link to="/office/command-center" className="flex min-h-touch items-center gap-2 font-bold text-ops-ink">
            <span aria-hidden="true" className="ops-btn-primary grid h-10 w-10 place-items-center rounded-xl"><Icon name="leaf" /></span>
            {t('app.title')}
          </Link>
          <div className="farm-actions flex flex-wrap items-center gap-1 text-sm">
            <NotificationBell to="/office/notifications" />
            <Link to="/field" className="inline-flex min-h-touch items-center rounded px-3 underline">{t('nav.fieldView')}</Link>
            <LanguageToggle />
            <SignOutButton />
          </div>
        </div>
        <nav aria-label={t('nav.officeView')} className="border-t border-stone-100">
          {/* A phone scrolls this row sideways; wider screens wrap it so every department stays in view. */}
          <ul className="flex gap-1 overflow-x-auto mx-auto max-w-[1560px] px-3 py-2 md:flex-wrap md:overflow-visible md:px-7">
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
      <main key={pathname} className="ops-enter mx-auto w-full min-w-0 max-w-[1560px] flex-1 p-4 md:p-8"><Outlet /></main>
      <footer className="px-4 pb-3 text-xs text-stone-500 md:px-6">{t('app.version', { version: __APP_VERSION__ })}</footer>
    </div>
  );
}
