import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';

/** Offers a new app version; the user chooses when (never mid-task). Pending outbox items survive reloads. */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-2 bg-sky-100 px-4 py-2 text-sky-950">
      <span>{t('app.updateAvailable')}</span>
      <button type="button" onClick={() => void updateServiceWorker(true)} className="min-h-touch rounded bg-sky-800 px-3 font-semibold text-white">
        {t('app.reloadNow')}
      </button>
    </div>
  );
}
