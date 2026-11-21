import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { requireSupabase } from '@/core/supabase';
import { SignOutButton } from '@/core/auth/SignOutButton';
import { DemoBanner } from '@/core/components/DemoBanner';
import { localName, useMyPermissions } from './api';
import { Icon } from './icons';
import { useTheme, type ThemePref } from './theme';
import { Breadcrumbs, ToastProvider, type Crumb } from './ui';

export interface OpsNavItem {
  key: string;
  to: string;
  icon: string;
  /** Packing-house action(s) that make the item useful (any of them); the server still decides every call. */
  needs?: string | string[];
  mobile?: boolean;
  end?: boolean;
  section: 'run' | 'quality' | 'config';
}

const SETTINGS_NEEDS = ['import.run', 'acc.view', 'acc.record', 'acc.hr_decide', 'settings.authority', 'users.administer', 'delegated.accounts', 'settings.edit', 'settings.publish', 'md_operational.edit', 'md_operational.approve',
  'md_customer.edit', 'md_customer.approve', 'task.create'];

export const OPS_NAV: OpsNavItem[] = [
  { key: 'overview', to: '/ops', icon: 'overview', needs: 'report.kpi_view', end: true, section: 'run' },
  { key: 'shift', to: '/ops/shift', icon: 'shift', mobile: true, section: 'run' },
  { key: 'downtime', to: '/ops/downtime', icon: 'downtime', mobile: true, section: 'run' },
  { key: 'orders', to: '/ops/orders', icon: 'orders', section: 'run' },
  { key: 'tasks', to: '/ops/tasks', icon: 'tasks', mobile: true, section: 'run' },
  { key: 'operations', to: '/ops/operations', icon: 'operations', section: 'run' },
  { key: 'report', to: '/ops/report', icon: 'report', needs: 'report.kpi_view', section: 'run' },
  { key: 'dispatch', to: '/ops/dispatch', icon: 'dispatch', section: 'quality' },
  { key: 'specs', to: '/ops/specs', icon: 'ruler', section: 'quality' },
  { key: 'maintenance', to: '/ops/maintenance', icon: 'wrench', section: 'run' },
  { key: 'trace', to: '/ops/trace', icon: 'trace', mobile: true, section: 'quality' },
  { key: 'complaints', to: '/ops/complaints', icon: 'complaints', section: 'quality' },
  { key: 'workflow', to: '/office/packing-house', icon: 'workflow', section: 'quality' },
  { key: 'settings', to: '/ops/settings', icon: 'settings', end: true, needs: SETTINGS_NEEDS, section: 'config' },
];

/** Settings sub-pages (command palette and breadcrumbs). */
const SETTINGS_PAGES = [
  { key: 'people', to: '/ops/settings/people', icon: 'people', needs: ['users.administer', 'delegated.accounts'] },
  { key: 'operations', to: '/ops/settings/operations', icon: 'operations', needs: ['settings.edit', 'settings.publish'] },
  { key: 'kpis', to: '/ops/settings/kpis', icon: 'kpi', needs: ['settings.edit', 'settings.publish'] },
  { key: 'master', to: '/ops/settings/master', icon: 'database', needs: ['md_operational.edit', 'md_customer.edit', 'md_operational.approve', 'md_customer.approve'] },
  { key: 'import', to: '/ops/settings/import', icon: 'upload', needs: ['import.run'] },
  { key: 'accountability', to: '/ops/settings/accountability', icon: 'scale', needs: ['acc.view', 'acc.record', 'acc.hr_decide', 'settings.authority'] },
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

function useMe() {
  const { access } = useAuth();
  return useQuery({
    queryKey: ['ops', 'me', access?.userId],
    enabled: !!access?.userId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await requireSupabase().from('user_profiles').select('full_name').eq('id', access?.userId ?? '').maybeSingle();
      return (data as { full_name: string } | null)?.full_name ?? '';
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

function ThemeSwitch() {
  const { t } = useTranslation();
  const [pref, setPref] = useTheme();
  const opts: { v: ThemePref; icon: string; label: string }[] = [
    { v: 'light', icon: 'sun', label: t('ops.ui.themeLight') }, { v: 'dark', icon: 'moon', label: t('ops.ui.themeDark') }, { v: 'system', icon: 'monitor', label: t('ops.ui.themeSystem') },
  ];
  return (
    <div role="radiogroup" aria-label={t('ops.ui.theme')} className="hidden items-center rounded-full border border-ops-line bg-ops-surface p-0.5 sm:inline-flex">
      {opts.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={pref === o.v} title={o.label} aria-label={o.label} onClick={() => setPref(o.v)}
          className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${pref === o.v ? 'bg-ops-soft text-ops-accent' : 'text-ops-muted hover:text-ops-ink'}`}>
          <Icon name={o.icon} className="h-[18px] w-[18px]" />
        </button>
      ))}
    </div>
  );
}

interface Cmd { id: string; label: string; hint?: string; icon: string; run: () => void }

/** Ctrl/⌘ K: jump to any page this person may use, switch theme or language. Only real destinations and settings. */
function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Cmd[] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQ(''); setI(0); window.setTimeout(() => input.current?.focus(), 10); } }, [open]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(n)) : commands;
  }, [q, commands]);
  if (!open) return null;
  const go = (c: Cmd | undefined) => { if (c) { onClose(); c.run(); } };
  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center p-4 pt-[12vh]" role="presentation">
      <div className="ops-backdrop absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={t('ops.ui.command')} className="ops-pop relative w-full max-w-xl overflow-hidden rounded-[20px] border border-ops-line bg-ops-elevated shadow-ops-pop"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(list[i]); }
        }}>
        <div className="flex items-center gap-3 border-b border-ops-line px-4">
          <Icon name="search" className="h-5 w-5 text-ops-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder={t('ops.ui.commandHint')} aria-label={t('ops.ui.commandHint')}
            role="combobox" aria-expanded="true" aria-controls="ops-cmd-list" aria-activedescendant={list[i] ? `cmd-${list[i]?.id}` : undefined}
            className="min-h-[56px] flex-1 bg-transparent text-base text-ops-ink outline-none placeholder:text-ops-muted" />
          <kbd className="rounded border border-ops-line px-1.5 py-0.5 text-[11px] text-ops-muted">Esc</kbd>
        </div>
        <ul id="ops-cmd-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2 ops-scroll-thin">
          {list.length === 0 && <li className="p-4 text-center text-sm text-ops-muted">{t('ops.ui.commandEmpty')}</li>}
          {list.map((c, k) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={k === i}>
              <button type="button" onMouseEnter={() => setI(k)} onClick={() => go(c)}
                className={`flex w-full items-center gap-3 rounded-ops-sm px-3 py-2.5 text-start text-sm ${k === i ? 'bg-ops-soft text-ops-accent' : 'text-ops-ink'}`}>
                <Icon name={c.icon} className="h-[18px] w-[18px]" />
                <span className="flex-1 font-medium">{c.label}</span>
                {c.hint && <span className="text-xs text-ops-muted">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function OpsShell() {
  const { t, i18n } = useTranslation();
  const { access } = useAuth();
  const perms = useMyPermissions();
  const farm = useFarmName();
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menu, setMenu] = useState(false);
  const [cmd, setCmd] = useState(false);
  const [, setTheme] = useTheme();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmd((c) => !c); } };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(RAIL_KEY, c ? '0' : '1'); } catch { /* preference only */ } return !c; });
  const has = (n: string | string[] | undefined) => !n || (Array.isArray(n) ? n : [n]).some((x) => perms.data?.has(x));
  const visible = OPS_NAV.filter((i) => has(i.needs));
  const mobile = visible.filter((i) => i.mobile);
  const more = visible.filter((i) => !i.mobile);
  const sections = (['run', 'quality', 'config'] as const).map((s) => ({ s, items: visible.filter((i) => i.section === s) })).filter((x) => x.items.length);

  const commands: Cmd[] = useMemo(() => [
    ...visible.map((i) => ({ id: i.key, label: t(`ops.nav.${i.key}`), icon: i.icon, hint: t(`ops.ui.sections.${i.section}`), run: () => nav(i.to) })),
    ...SETTINGS_PAGES.filter((p) => has(p.needs)).map((p) => ({ id: `set-${p.key}`, label: t(`ops.settings.areas.${p.key}.title`), icon: p.icon, hint: t('ops.nav.settings'), run: () => nav(p.to) })),
    { id: 'th-light', label: `${t('ops.ui.theme')}: ${t('ops.ui.themeLight')}`, icon: 'sun', run: () => setTheme('light') },
    { id: 'th-dark', label: `${t('ops.ui.theme')}: ${t('ops.ui.themeDark')}`, icon: 'moon', run: () => setTheme('dark') },
    { id: 'th-sys', label: `${t('ops.ui.theme')}: ${t('ops.ui.themeSystem')}`, icon: 'monitor', run: () => setTheme('system') },
    { id: 'lang', label: t('common.language'), icon: 'globe', run: () => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar') },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [visible.map((v) => v.key).join(), perms.data, i18n.language]);

  // Breadcrumbs from the route: section › page (› settings page).
  const crumbs: Crumb[] = useMemo(() => {
    const path = loc.pathname;
    const sp = SETTINGS_PAGES.find((p) => path.startsWith(p.to));
    if (sp) return [{ label: t('ops.nav.settings'), to: '/ops/settings' }, { label: t(`ops.settings.areas.${sp.key}.title`) }];
    if (path.startsWith('/ops/run/')) return [{ label: t('ops.nav.operations'), to: '/ops/operations' }, { label: t('ops.run.run') }];
    const item = [...OPS_NAV].reverse().find((i) => (i.end ? path === i.to : path.startsWith(i.to)));
    return item ? [{ label: t(`ops.ui.sections.${item.section}`) }, { label: t(`ops.nav.${item.key}`) }] : [];
  }, [loc.pathname, t]);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `group relative flex min-h-[42px] items-center gap-3 rounded-ops-sm px-3 text-sm font-medium transition-colors ${isActive ? 'bg-ops-soft text-ops-accent' : 'text-ops-muted hover:bg-ops-grey hover:text-ops-ink'}`;
  const initials = (me.data || '•').split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2).map((w) => w[0]).join('') || '•';
  const roles = [...new Set((access?.grants ?? []).map((g) => g.roleCode.replace(/^ph_/, '').toUpperCase()))].slice(0, 3).join(' · ');

  return (
    <ToastProvider>
      <div className="ops-root min-h-screen">
        {access?.isDemo && <DemoBanner />}
        <a href="#ops-main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-ops-surface focus:p-2">{t('ops.skip')}</a>
        <div className="flex">
          {/* Desktop rail: collapsible, frosted, grouped by work area. */}
          <nav aria-label={t('ops.nav.label')}
            className={`ops-glass ops-noprint sticky top-0 hidden h-screen shrink-0 flex-col p-3 transition-[width] duration-300 [transition-timing-function:var(--ops-ease)] lg:flex ${collapsed ? 'w-[76px]' : 'w-[264px]'}`}>
            <div className="mb-4 flex items-center gap-3 px-1 pt-1">
              <span aria-hidden="true" className="ops-btn-primary grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-sm font-bold shadow-ops">PH</span>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-ops-ink">{t('ops.title')}</div>
                  <div className="truncate text-xs text-ops-muted">{farm.data ? localName(i18n.language, farm.data.name_ar, farm.data.name_en) : ' '}</div>
                </div>
              )}
            </div>
            <button type="button" onClick={() => setCmd(true)}
              className={`mb-4 flex min-h-[40px] items-center gap-2 rounded-ops-sm border border-ops-line bg-ops-surface px-3 text-sm text-ops-muted transition-colors hover:border-ops-linestrong ${collapsed ? 'justify-center px-0' : ''}`}
              aria-label={t('ops.ui.command')}>
              <Icon name="search" className="h-4 w-4" />{!collapsed && <><span className="flex-1 text-start">{t('ops.ui.command')}</span><kbd dir="ltr" className="rounded border border-ops-line px-1 text-[10px]">⌘K</kbd></>}
            </button>
            <div className="-mx-1 flex-1 overflow-y-auto px-1 ops-scroll-thin">
              {sections.map(({ s, items }) => (
                <div key={s} className="mb-4">
                  {!collapsed && <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ops-muted/80">{t(`ops.ui.sections.${s}`)}</div>}
                  <div className="grid gap-0.5">
                    {items.map((i) => (
                      <NavLink key={i.key} to={i.to} end={i.end} className={linkCls} title={collapsed ? t(`ops.nav.${i.key}`) : undefined}>
                        {({ isActive }) => (
                          <>
                            {isActive && <span aria-hidden="true" className="ops-accent-bar absolute inset-y-2 start-0 w-[3px] rounded-full" />}
                            <Icon name={i.icon} className="h-[19px] w-[19px] shrink-0" />
                            <span className={collapsed ? 'sr-only' : 'truncate'}>{t(`ops.nav.${i.key}`)}</span>
                          </>
                        )}
                      </NavLink>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-ops-line pt-3">
              <div className={`flex items-center gap-3 rounded-ops-sm p-1.5 ${collapsed ? 'justify-center' : ''}`}>
                <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ops-soft text-sm font-bold text-ops-accent">{initials}</span>
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold"><bdi>{me.data || '—'}</bdi></div>
                    <div className="truncate text-[11px] text-ops-muted"><bdi>{roles}</bdi></div>
                  </div>
                )}
              </div>
              <div className={`mt-1 flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-between'}`}>
                <NavLink to="/office" className="inline-flex min-h-[36px] items-center gap-1 rounded-ops-sm px-2 text-xs text-ops-muted hover:text-ops-ink">
                  <Icon name="home" className="h-4 w-4" />{!collapsed && t('ops.nav.office')}
                </NavLink>
                <button type="button" onClick={toggle} className="grid h-9 w-9 place-items-center rounded-ops-sm text-ops-muted hover:bg-ops-grey hover:text-ops-ink"
                  aria-expanded={!collapsed} aria-label={collapsed ? t('ops.nav.expand') : t('ops.nav.collapse')}>
                  <Icon name="collapse" className={`h-4 w-4 transition-transform duration-300 ${collapsed ? 'rotate-180 rtl:rotate-0' : 'rtl:rotate-180'}`} />
                </button>
              </div>
            </div>
          </nav>

          <div className="min-w-0 flex-1">
            {/* Top bar: where I am, search, theme, language, sign-out. */}
            <header className="ops-noprint sticky top-0 z-30 border-b border-ops-line bg-[color-mix(in_srgb,var(--ops-bg)_82%,transparent)] backdrop-blur-xl">
              <div className="mx-auto flex min-h-[60px] w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6">
                <div className="min-w-0 flex-1">
                  <div className="lg:hidden">
                    <div className="truncate text-sm font-semibold">{farm.data ? localName(i18n.language, farm.data.name_ar, farm.data.name_en) : t('ops.title')}</div>
                  </div>
                  <div className="hidden lg:block"><Breadcrumbs items={crumbs} /></div>
                  <div className="text-xs text-ops-muted"><Clock /></div>
                </div>
                <button type="button" onClick={() => setCmd(true)} aria-label={t('ops.ui.command')}
                  className="grid h-10 w-10 place-items-center rounded-full border border-ops-line bg-ops-surface text-ops-muted hover:text-ops-ink lg:hidden">
                  <Icon name="search" className="h-[18px] w-[18px]" />
                </button>
                <ThemeSwitch />
                <button type="button" onClick={() => void i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')}
                  className="ops-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-ops-line bg-ops-surface px-3 text-sm font-semibold text-ops-accent hover:border-ops-linestrong">
                  <Icon name="globe" className="h-4 w-4" /><span className="hidden sm:inline">{t('common.language')}</span>
                </button>
                <SignOutButton className="ops-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-ops-line bg-ops-surface px-3 text-sm text-ops-ink hover:border-ops-linestrong">
                  <Icon name="logout" className="h-4 w-4 rtl:-scale-x-100" /><span className="hidden sm:inline">{t('common.signOut')}</span>
                </SignOutButton>
              </div>
            </header>
            <main id="ops-main" key={loc.pathname} className="ops-enter mx-auto w-full max-w-[1440px] px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
              <Outlet />
            </main>
          </div>
        </div>

        {/* Phone: bottom navigation for the shift, stops, tasks and trace; everything else in a labelled sheet. */}
        <nav aria-label={t('ops.nav.label')} className="ops-noprint fixed inset-x-0 bottom-0 z-40 border-t border-ops-line bg-[color-mix(in_srgb,var(--ops-surface)_92%,transparent)] pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
          {menu && (
            <div id="ops-more" className="ops-pop max-h-[60vh] overflow-y-auto border-b border-ops-line p-2">
              <p className="px-3 pb-1 text-xs font-semibold text-ops-muted">{t('ops.nav.more')}</p>
              <div className="grid grid-cols-2 gap-1">
                {more.map((i) => (
                  <NavLink key={i.key} to={i.to} end={i.end} className={linkCls}>
                    <Icon name={i.icon} className="h-[18px] w-[18px]" />{t(`ops.nav.${i.key}`)}
                  </NavLink>
                ))}
                <NavLink to="/office" className={linkCls}><Icon name="home" className="h-[18px] w-[18px]" />{t('ops.nav.office')}</NavLink>
              </div>
              <div className="mt-2 flex justify-center sm:hidden"><MobileTheme /></div>
            </div>
          )}
          <div className="grid grid-cols-5">
            {mobile.map((i) => (
              <NavLink key={i.key} to={i.to} end={i.end}
                className={({ isActive }) => `relative flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-ops-accent' : 'text-ops-muted'}`}>
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden="true" className="ops-accent-bar absolute top-0 h-[3px] w-8 rounded-full" />}
                    <Icon name={i.icon} className="h-[21px] w-[21px]" />{t(`ops.nav.${i.key}`)}
                  </>
                )}
              </NavLink>
            ))}
            <button type="button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-controls="ops-more"
              className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${menu ? 'text-ops-accent' : 'text-ops-muted'}`}>
              <Icon name="menu" className="h-[21px] w-[21px]" />{t('ops.nav.more')}
            </button>
          </div>
        </nav>
        <CommandPalette open={cmd} onClose={() => setCmd(false)} commands={commands} />
      </div>
    </ToastProvider>
  );
}

function MobileTheme() {
  const { t } = useTranslation();
  const [pref, setPref] = useTheme();
  return (
    <div role="radiogroup" aria-label={t('ops.ui.theme')} className="inline-flex rounded-full border border-ops-line bg-ops-surface p-0.5">
      {(['light', 'dark', 'system'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={pref === v} onClick={() => setPref(v)}
          className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${pref === v ? 'bg-ops-soft text-ops-accent' : 'text-ops-muted'}`}>
          <Icon name={v === 'light' ? 'sun' : v === 'dark' ? 'moon' : 'monitor'} className="h-4 w-4" />{t(`ops.ui.theme${v[0]?.toUpperCase()}${v.slice(1)}`)}
        </button>
      ))}
    </div>
  );
}
