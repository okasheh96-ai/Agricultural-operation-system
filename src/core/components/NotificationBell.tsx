import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNotifications } from './useNotifications';

export function NotificationBell({ to, className = '' }: { to: string; className?: string }) {
  const { t } = useTranslation();
  const q = useNotifications();
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;
  return (
    <Link to={to} className={`relative inline-flex min-h-touch min-w-touch items-center justify-center ${className}`}
      aria-label={`${t('notifications.title')}${unread ? ` (${unread})` : ''}`}>
      <span aria-hidden="true" className="text-xl">🔔</span>
      {unread > 0 && (
        <span className="absolute -top-0 end-0 rounded-full bg-red-600 px-1.5 text-xs font-bold text-white"><bdi>{unread}</bdi></span>
      )}
    </Link>
  );
}
