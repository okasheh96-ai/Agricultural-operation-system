import { NavLink, Outlet, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { OFFICE_NAV, visibleNav, type NavItem } from './nav';

function NavEntry({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const base = 'flex min-h-touch items-center justify-between gap-2 rounded px-3';
  return (
    <li>
      <NavLink to={item.path} end={!!item.children}
        className={({ isActive }) =>
          `${base} ${isActive ? 'bg-brand text-white' : item.tone === 'qa' ? 'bg-qa-light text-qa' : 'hover:bg-stone-200'}`}>
        <span>{t(item.labelKey)}</span>
        {!item.built && <span className="text-xs opacity-70">{t('labels.laterPhase')}</span>}
      </NavLink>
      {item.children && item.children.length > 0 && (
        <ul className="ms-4 mt-1 flex flex-col gap-1 border-s border-stone-300 ps-2">
          {item.children.map((c) => <NavEntry key={c.key} item={c} />)}
        </ul>
      )}
    </li>
  );
}

export function OfficeShell() {
  const { t } = useTranslation();
  const { access } = useAuth();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-stone-200 bg-white p-3 md:w-72 md:border-b-0 md:border-e">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="font-bold text-brand-dark">{t('app.title')}</span>
        </div>
        <nav aria-label={t('nav.officeView')}>
          <ul className="flex flex-col gap-1">
            {visibleNav(OFFICE_NAV, access).map((i) => <NavEntry key={i.key} item={i} />)}
          </ul>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <Link to="/field" className="min-h-touch inline-flex items-center rounded px-3 underline">{t('nav.fieldView')}</Link>
          <LanguageToggle />
          <button type="button" onClick={() => void requireSupabase().auth.signOut()} className="min-h-touch rounded px-3 underline">
            {t('common.signOut')}
          </button>
        </div>
        <p className="mt-2 text-xs text-stone-500">{t('app.version', { version: __APP_VERSION__ })}</p>
      </aside>
      <main className="flex-1 p-4 md:p-6"><Outlet /></main>
    </div>
  );
}
