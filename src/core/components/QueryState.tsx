import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useOnline } from './useOnline';

/** Every list has loading, error, empty and offline states in both languages (§4.5). */
export function QueryState(props: {
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  onRetry?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <>
      {!online && <p role="status" className="mb-3 rounded bg-amber-50 p-3 text-amber-900">{t('common.offline')}</p>}
      {props.isLoading ? (
        <p role="status" className="p-4 text-stone-600">{t('common.loading')}</p>
      ) : props.error ? (
        <div role="alert" className="flex items-center gap-3 p-4 text-red-800">
          <span>{t('common.error')}</span>
          {props.onRetry && (
            <button type="button" onClick={props.onRetry} className="min-h-touch rounded border px-3">{t('common.retry')}</button>
          )}
        </div>
      ) : props.isEmpty ? (
        <p className="p-4 text-stone-600">{t('common.empty')}</p>
      ) : (
        props.children
      )}
    </>
  );
}
