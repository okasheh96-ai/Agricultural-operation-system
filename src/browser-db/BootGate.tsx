import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '@/core/components/LanguageToggle';
import { bootBrowserDb, resetBrowserDemo, type BootInfo, type BootStep } from './engine';

declare const __BROWSER_DB_BUILD__: string;

const STEPS: BootStep[] = ['download', 'start', 'seed'];

/** In-browser demo only: starts the demo database before the app, and says plainly what kind of demo this is. */
export function BootGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<BootStep>('download');
  const [info, setInfo] = useState<BootInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootBrowserDb(setStep, __BROWSER_DB_BUILD__).then(setInfo, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (info) return <>{children}<DemoDataControl info={info} /></>;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-dark"><span aria-hidden="true">🏭</span>{t('browserDb.title')}</h1>
        <LanguageToggle />
      </div>
      <p className="text-sm text-stone-700">{t('browserDb.what')}</p>
      {error ? (
        <section role="alert" className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-4 text-red-950">
          <h2 className="font-semibold">{t('browserDb.failedTitle')}</h2>
          <p className="text-sm">{t('browserDb.failedBody')}</p>
          <p className="text-xs text-red-800"><bdi>{error}</bdi></p>
          <button type="button" className="min-h-touch self-start rounded border border-red-400 bg-white px-4 font-semibold" onClick={() => void resetBrowserDemo()}>
            {t('browserDb.resetNow')}
          </button>
        </section>
      ) : (
        <ol className="flex flex-col gap-2 rounded-lg bg-white p-4 shadow" aria-live="polite">
          {STEPS.map((s) => {
            const at = STEPS.indexOf(step);
            const me = STEPS.indexOf(s);
            return (
              <li key={s} className={`flex items-center gap-2 text-sm ${me > at ? 'text-stone-400' : 'text-stone-900'}`}>
                <span aria-hidden="true">{me < at ? '✓' : me === at ? '⏳' : '·'}</span>{t(`browserDb.steps.${s}`)}
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}

function DemoDataControl({ info }: { info: BootInfo }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] start-2 z-50 flex max-w-[18rem] flex-col items-start gap-2 print:hidden">
      {open && (
        <section className="flex flex-col gap-2 rounded-lg border border-stone-300 bg-white p-3 text-sm shadow-lg">
          <p>{t('browserDb.what')}</p>
          <p className="text-stone-600">{info.persistent ? t('browserDb.kept') : t('browserDb.notKept')}</p>
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p className="font-semibold">{t('browserDb.confirmReset')}</p>
              <div className="flex gap-2">
                <button type="button" className="min-h-touch rounded bg-red-700 px-3 font-semibold text-white" onClick={() => void resetBrowserDemo()}>{t('browserDb.resetNow')}</button>
                <button type="button" className="min-h-touch rounded border border-stone-300 px-3" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" className="min-h-touch self-start rounded border border-stone-300 px-3" onClick={() => setConfirming(true)}>{t('browserDb.reset')}</button>
          )}
        </section>
      )}
      <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); setConfirming(false); }}
        className="rounded-full border border-stone-300 bg-white/95 px-3 py-1 text-xs font-semibold text-stone-700 shadow">
        🗄 {t('browserDb.chip')}
      </button>
    </div>
  );
}
