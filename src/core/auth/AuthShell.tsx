import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/core/components/LanguageToggle';

export const authInput = 'ops-field min-h-[48px] w-full rounded-ops-sm border border-ops-line bg-ops-surface px-3.5 text-ops-ink';
export const authButton = 'ops-press ops-btn-primary min-h-[50px] w-full rounded-ops-sm px-4 text-base font-semibold disabled:opacity-60';
export const authCard = 'ops-pop flex flex-col gap-4 rounded-[22px] border border-ops-line bg-ops-surface p-6 shadow-ops-pop sm:p-8';

/** Sign-in, first sign-in and password change: a branded panel beside the form (stacked on phones). */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="ops-root min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 p-4 sm:p-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <section className="relative hidden overflow-hidden rounded-[28px] p-10 lg:block" aria-hidden="true"
          style={{ background: 'linear-gradient(145deg, #1e1b4b, #312e81 45%, #5b21b6)' }}>
          <div className="pointer-events-none absolute -end-24 -top-24 h-72 w-72 rounded-full bg-[#a78bfa]/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 -start-20 h-80 w-80 rounded-full bg-[#38bdf8]/20 blur-3xl" />
          <div className="relative flex h-full min-h-[520px] flex-col justify-between text-[#eef0ff]">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-white/15 text-sm font-bold backdrop-blur">PH</span>
              <span className="text-lg font-semibold">{t('ops.title')}</span>
            </div>
            <div>
              <h2 className="text-[2.1rem] font-bold leading-tight">{t('auth.shell.headline')}</h2>
              <p className="mt-3 max-w-md text-[#c7c9f5]">{t('auth.shell.sub')}</p>
              <ul className="mt-8 grid gap-3 text-sm">
                {(['one', 'two', 'three'] as const).map((k) => (
                  <li key={k} className="flex items-start gap-3 rounded-2xl bg-white/[0.07] p-3 backdrop-blur">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/15 text-xs">✓</span>{t(`auth.shell.${k}`)}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-[#a5a8e6]">{t('auth.shell.private')}</p>
          </div>
        </section>
        <main className="mx-auto flex w-full max-w-md flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 lg:invisible">
              <span aria-hidden="true" className="ops-btn-primary grid h-10 w-10 place-items-center rounded-[12px] text-sm font-bold">PH</span>
              <span className="font-bold text-ops-ink">{t('ops.title')}</span>
            </div>
            <LanguageToggle className="ops-press inline-flex min-h-[40px] items-center rounded-full border border-ops-line bg-ops-surface px-4 text-sm font-semibold text-ops-accent hover:border-ops-linestrong" />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
