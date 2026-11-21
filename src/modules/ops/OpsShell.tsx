import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { SignOutButton } from '@/core/auth/SignOutButton';
import { DemoBanner } from '@/core/components/DemoBanner';
import { localName, useMyPermissions } from './api';

export interface OpsNavItem {
  key: string;
  to: string;
  icon: string;
  /** Packing-house action that makes the item useful; the server still decides every call. */
  needs?: string;
  mobile?: boolean;
  end?: boolean;
}

export const OPS_NAV: OpsNavItem[] = [
  { key: 'overview', to: '/ops', icon: '◧', needs: 'report.kpi_view', end: true },
  { key: 'shift', to: '/ops/shift', icon: '✎', mobile: true },
  { key: 'downtime', to: '/ops/downtime', icon: '⏸', mobile: true },
  { key: 'orders', to: '/ops/orders', icon: '⏱' },
  { key: 'report', to: '/ops/report', icon: '▤', needs: 'report.kpi_view' },
  { key: 'trace', to: '/office/packing-house/trace', icon: '⇄', mobile: true },
  { key: 'workflow', to: '/office/packing-house', icon: '⛁' },
];

const RAIL_KEY = 'ops.rail.collapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; }
}

function useFarmName() {
  const { access } = useAuth();
  return useQuery({
    queryKey: ['ops', 'farm', access?.farmId],
    enabled: !!access?.farmId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await requireSupabase().from('farms').select('name_ar, name_en').eq('id', access?.farmId ?? '').single();
      if (error) throw error;
      return data as { name_ar: string; name_en: string | null };
    },
  });
}

function Clock() {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const locale = i18n.language === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB';
  return (
    <bdi className="ops-num">
      {new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Amman' }).format(now)}
    </bdi>
  );
}

export function OpsShell() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const perms = useMyPermissions();
  const farm = useFarmName();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [loc.pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(RAIL_KEY, c ? '0' : '1'); } catch { /* preference only */ }
      return !c;
    });
  };
  const visible = OPS_NAV.filter((i) => !i.needs || perms.data?.has(i.needs));
  const mobile = visible.filter((i) => i.mobile);
  const more = visible.filter((i) => !i.mobile);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `ops-fade flex min-h-[44px] items-center gap-3 rounded-ops-sm px-3 text-sm font-medium ${isActive ? 'bg-ops-soft text-ops-accent' : 'text-ops-ink hover:bg-ops-grey'}`;

  return (
    <div className="ops-root min-h-screen">
      {access?.isDemo && <DemoBanner />}
      <a href="#ops-main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">{t('ops.skip')}</a>
      <div className="flex">
        {/* Desktop rail: collapsible, frosted edge. */}
        <nav aria-label={t('ops.nav.label')}
          className={`ops-glass ops-noprint sticky top-0 hidden h-screen shrink-0 flex-col gap-1 p-3 lg:flex ${collapsed ? 'w-[76px]' : 'w-60'}`}>
          <div className="mb-2 flex items-center justify-between gap-2">
            {!collapsed && <span className="truncate text-sm font-bold text-ops-accent">{t('ops.title')}</span>}
            <button type="button" onClick={toggle} className="ops-fade inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-ops-sm hover:bg-ops-grey"
              aria-expanded={!collapsed} aria-label={collapsed ? t('ops.nav.expand') : t('ops.nav.collapse')}>
              <span aria-hidden="true">{collapsed ? '»' : '«'}</span>
            </button>
          </div>
          {visible.map((i) => (
            <NavLink key={i.key} to={i.to} end={i.end} className={linkCls} title={collapsed ? t(`ops.nav.${i.key}`) : undefined}>
              <span aria-hidden="true" className="w-5 text-center text-base">{i.icon}</span>
              <span className={collapsed ? 'sr-only' : 'truncate'}>{t(`ops.nav.${i.key}`)}</span>
            </NavLink>
          ))}
          <div className="mt-auto border-t border-ops-line pt-2 text-xs text-ops-muted">
            {!collapsed && <NavLink to="/office" className="underline">{t('ops.nav.office')}</NavLink>}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {/* Top bar: site, shift context, date and time, language, sign-out. */}
          <header className="ops-noprint sticky top-0 z-30 border-b border-ops-line bg-ops-surface/95 backdrop-blur">
            <div className="flex min-h-[56px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{farm.data ? localName(i18n.language, farm.data.name_ar, farm.data.name_en) : t('ops.title')}</div>
                <div className="text-xs text-ops-muted"><Clock /></div>
              </div>
              <button type="button" onClick={() => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
                className="ops-fade min-h-[44px] min-w-[44px] rounded-ops-sm px-3 text-sm font-medium text-ops-accent hover:bg-ops-grey">
                {t('common.language')}
              </button>
              <SignOutButton className="min-h-[44px] rounded-ops-sm px-3 text-sm" />
            </div>
          </header>
          <main id="ops-main" className="mx-auto w-full max-w-[1400px] px-4 pb-28 pt-4 lg:pb-8">
            <Outlet />
          </main>
        </div>
      </div>

      {/* Phone: compact bottom navigation for the shift, stops and trace; everything else in a labelled menu. */}
      <nav aria-label={t('ops.nav.label')} className="ops-noprint fixed inset-x-0 bottom-0 z-40 border-t border-ops-line bg-ops-surface lg:hidden">
        {menu && (
          <div id="ops-more" className="border-b border-ops-line p-2">
            <p className="px-2 pb-1 text-xs font-semibold text-ops-muted">{t('ops.nav.more')}</p>
            {more.map((i) => (
              <NavLink key={i.key} to={i.to} end={i.end} className={linkCls}>
                <span aria-hidden="true" className="w-5 text-center">{i.icon}</span>{t(`ops.nav.${i.key}`)}
              </NavLink>
            ))}
            <NavLink to="/office" className={linkCls}><span aria-hidden="true" className="w-5 text-center">⌂</span>{t('ops.nav.office')}</NavLink>
          </div>
        )}
        <div className="grid grid-cols-4">
          {mobile.map((i) => (
            <NavLink key={i.key} to={i.to} end={i.end}
              className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-ops-accent' : 'text-ops-muted'}`}>
              <span aria-hidden="true" className="text-lg leading-none">{i.icon}</span>{t(`ops.nav.${i.key}`)}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="ops-more"
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-xs font-medium ${menu ? 'text-ops-accent' : 'text-ops-muted'}`}>
            <span aria-hidden="true" className="text-lg leading-none">☰</span>{t('ops.nav.more')}
          </button>
        </div>
      </nav>
    </div>
  );
}
