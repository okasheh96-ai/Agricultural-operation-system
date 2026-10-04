import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';

/** Every screen of the demo farm says so (§4.5, §5.3). */
export function DemoBanner() {
  const { t } = useTranslation();
  const { access } = useAuth();
  if (!access?.isDemo) return null;
  return (
    <div role="note" className="bg-yellow-300 px-4 py-1 text-center text-sm font-semibold text-yellow-950">
      {t('labels.demoBanner')}
    </div>
  );
}
