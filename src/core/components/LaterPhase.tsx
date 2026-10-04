import { useTranslation } from 'react-i18next';

/** Honest placeholder for unbuilt modules: labelled, no sample data, no fake controls (§4.5). */
export function LaterPhase({ titleKey, phase, notVerified = false }: { titleKey: string; phase: string; notVerified?: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="max-w-2xl">
      <h1 className="mb-3 text-xl font-bold">{t(titleKey)}</h1>
      <p className="mb-3 inline-flex items-center gap-2 rounded border border-stone-300 bg-stone-100 px-3 py-1 text-sm">
        <span aria-hidden="true">⏳</span>
        {t('labels.notImplemented')} · {t('labels.laterPhase')}
      </p>
      <p className="text-stone-700">{t('labels.laterPhaseBody', { phase })}</p>
      {notVerified && <p className="mt-2 text-amber-900">{t('labels.notVerifiedModule')}</p>}
    </section>
  );
}
