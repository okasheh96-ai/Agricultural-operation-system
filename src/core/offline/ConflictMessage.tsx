import { useTranslation } from 'react-i18next';
import { errorKey } from '@/core/errors';

/** A rejected change explained in the user's language (audit B5); the server's text stays available for support. */
export function ConflictMessage({ code, reason }: { code?: string; reason?: string }) {
  const { t } = useTranslation();
  return (
    <>
      {t('work.conflict')}: {t(errorKey({ code: code ?? '' }))}
      {reason && (
        <details className="mt-1 text-xs opacity-80">
          <summary>{t('common.details')}</summary>
          <bdi dir="ltr">{reason}</bdi>
        </details>
      )}
    </>
  );
}
