import { useTranslation } from 'react-i18next';

export type VerificationStatus = 'verified' | 'not_yet_verified' | 'to_be_confirmed_on_site' | 'conflicting';

const STYLE: Record<VerificationStatus, { icon: string; cls: string }> = {
  verified: { icon: '✓', cls: 'bg-green-100 text-green-900 border-green-300' },
  not_yet_verified: { icon: '?', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  to_be_confirmed_on_site: { icon: '⌖', cls: 'bg-sky-100 text-sky-900 border-sky-300' },
  conflicting: { icon: '!', cls: 'bg-red-100 text-red-900 border-red-300' },
};

/** Status always shown as icon + text + colour, never colour alone (§4.1). */
export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const { t } = useTranslation();
  const s = STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm ${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span>
      {t(`verification.${status}`)}
    </span>
  );
}
