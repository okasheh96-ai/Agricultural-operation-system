import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { SignInPage } from '@/core/auth/SignInPage';
import { hasRole } from '@/core/rbac/access';
import { LaterPhase } from '@/core/components/LaterPhase';
import { OfficeShell } from './OfficeShell';
import { FieldShell } from './FieldShell';
import { FIELD_ROLES, OFFICE_NAV } from './nav';

// Route-level code splitting keeps the field shell's initial JS small (§3.14).
const DepartmentsPage = lazy(() => import('@/modules/admin/DepartmentsPage'));
const LocationsPage = lazy(() => import('@/modules/admin/LocationsPage'));
const VerificationQueuePage = lazy(() => import('@/modules/admin/VerificationQueuePage'));
const AuditLogPage = lazy(() => import('@/modules/admin/AuditLogPage'));
const SyncStatusPage = lazy(() => import('@/modules/field/SyncStatusPage'));

function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="p-6">{t('common.loading')}</p>;
}

export function App() {
  const { t } = useTranslation();
  const { session, ready, access, accessLoading } = useAuth();

  if (!ready || (session && accessLoading)) return <Loading />;
  if (!session) return <SignInPage />;
  if (!access) return <p role="alert" className="p-6">{t('auth.noRoles')}</p>;

  const home = hasRole(access, ...FIELD_ROLES) && !hasRole(access, 'system_admin') ? '/field' : '/office';

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/office" element={<OfficeShell />}>
            <Route index element={<Navigate to="admin/departments" replace />} />
            <Route path="admin" element={<Navigate to="departments" replace />} />
            <Route path="admin/departments" element={<DepartmentsPage />} />
            <Route path="admin/locations" element={<LocationsPage />} />
            <Route path="admin/verification" element={<VerificationQueuePage />} />
            <Route path="admin/audit" element={<AuditLogPage />} />
            {OFFICE_NAV.filter((i) => !i.built).map((i) => (
              <Route key={i.key} path={i.path.replace('/office/', '')}
                element={<LaterPhase titleKey={i.labelKey} phase={i.phase} notVerified={i.notVerified} />} />
            ))}
          </Route>
          <Route path="/field" element={<FieldShell />}>
            <Route index element={<Navigate to="sync" replace />} />
            <Route path="my-day" element={<LaterPhase titleKey="nav.myDay" phase="2" />} />
            <Route path="report" element={<LaterPhase titleKey="nav.reportProblem" phase="2" />} />
            <Route path="scan" element={<LaterPhase titleKey="nav.scan" phase="2" />} />
            <Route path="crew" element={<LaterPhase titleKey="nav.myCrew" phase="2" />} />
            <Route path="sync" element={<SyncStatusPage />} />
          </Route>
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
