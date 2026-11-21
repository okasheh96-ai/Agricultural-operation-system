import { lazy } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMyPermissions } from './api';

const OverviewPage = lazy(() => import('./OverviewPage'));

/** Managers land on the overview; people without KPI access (e.g. line supervisors) land on their shift form. */
export default function OpsIndex() {
  const { t } = useTranslation();
  const perms = useMyPermissions();
  if (perms.isLoading) return <p role="status" className="p-6">{t('common.loading')}</p>;
  if (perms.data?.has('report.kpi_view')) return <OverviewPage />;
  return <Navigate to="/ops/shift" replace />;
}
