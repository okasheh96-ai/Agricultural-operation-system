import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/core/auth/AuthProvider';
import { SignInPage } from '@/core/auth/SignInPage';
import { hasRole } from '@/core/rbac/access';
import { LaterPhase } from '@/core/components/LaterPhase';
import { installAutoSync } from '@/core/offline/sync';
import { OfficeShell } from './OfficeShell';
import { FieldShell } from './FieldShell';
import { FIELD_ROLES, OFFICE_NAV } from './nav';

// Route-level code splitting keeps the field shell's initial JS small (§3.14).
const DepartmentsPage = lazy(() => import('@/modules/admin/DepartmentsPage'));
const LocationsPage = lazy(() => import('@/modules/admin/LocationsPage'));
const VerificationQueuePage = lazy(() => import('@/modules/admin/VerificationQueuePage'));
const AuditLogPage = lazy(() => import('@/modules/admin/AuditLogPage'));
const SyncStatusPage = lazy(() => import('@/modules/field/SyncStatusPage'));
const MyDayPage = lazy(() => import('@/modules/field/MyDayPage'));
const TaskExecutePage = lazy(() => import('@/modules/field/TaskExecutePage'));
const ReportProblemPage = lazy(() => import('@/modules/field/ReportProblemPage'));
const MyCrewPage = lazy(() => import('@/modules/field/MyCrewPage'));
const NewTaskPage = lazy(() => import('@/modules/field/NewTaskPage'));
const CommandCenterPage = lazy(() => import('@/modules/operations/CommandCenterPage'));
const OperationsBoardPage = lazy(() => import('@/modules/operations/OperationsBoardPage'));
const DailyPlanPage = lazy(() => import('@/modules/operations/DailyPlanPage'));
const VerificationPage = lazy(() => import('@/modules/operations/VerificationPage'));
const ExceptionsPage = lazy(() => import('@/modules/operations/ExceptionsPage'));
const NotificationsPage = lazy(() => import('@/core/components/NotificationsPage'));
const WellsPage = lazy(() => import('@/modules/irrigation/WellsPage'));

function Loading() {
  const { t } = useTranslation();
  return <p role="status" className="p-6">{t('common.loading')}</p>;
}

export function App() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { session, ready, access, accessLoading } = useAuth();
  useEffect(() => (session ? installAutoSync(qc) : undefined), [session, qc]);

  if (!ready || (session && accessLoading)) return <Loading />;
  if (!session) return <SignInPage />;
  if (!access) return <p role="alert" className="p-6">{t('auth.noRoles')}</p>;

  const fieldFirst = hasRole(access, ...FIELD_ROLES) && !hasRole(access, 'system_admin', 'department_manager', 'operations_manager', 'maintenance_manager');
  const home = fieldFirst ? '/field' : '/office';
  // Unbuilt sections (and unbuilt sub-sections of built ones) get an honest "later phase" page.
  const unbuilt = OFFICE_NAV.flatMap((i) => [i, ...(i.children ?? [])]).filter((i) => !i.built);

  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Navigate to={home} replace />} />
          <Route path="/office" element={<OfficeShell />}>
            <Route index element={<Navigate to="command-center" replace />} />
            <Route path="command-center" element={<CommandCenterPage />} />
            <Route path="operations" element={<OperationsBoardPage />} />
            <Route path="operations/plan" element={<DailyPlanPage />} />
            <Route path="operations/verification" element={<VerificationPage />} />
            <Route path="operations/exceptions" element={<ExceptionsPage />} />
            <Route path="tasks/:id" element={<TaskExecutePage />} />
            <Route path="notifications" element={<NotificationsPage taskBase="/office/tasks" />} />
            <Route path="irrigation" element={<Navigate to="wells" replace />} />
            <Route path="irrigation/wells" element={<WellsPage />} />
            <Route path="admin" element={<Navigate to="departments" replace />} />
            <Route path="admin/departments" element={<DepartmentsPage />} />
            <Route path="admin/locations" element={<LocationsPage />} />
            <Route path="admin/verification" element={<VerificationQueuePage />} />
            <Route path="admin/audit" element={<AuditLogPage />} />
            {unbuilt.map((i) => (
              <Route key={i.key} path={i.path.replace('/office/', '')}
                element={<LaterPhase titleKey={i.labelKey} phase={i.phase} notVerified={i.notVerified} />} />
            ))}
          </Route>
          <Route path="/field" element={<FieldShell />}>
            <Route index element={<Navigate to="my-day" replace />} />
            <Route path="my-day" element={<MyDayPage />} />
            <Route path="tasks/new" element={<NewTaskPage />} />
            <Route path="tasks/:id" element={<TaskExecutePage />} />
            <Route path="report" element={<ReportProblemPage />} />
            <Route path="scan" element={<LaterPhase titleKey="nav.scan" phase="2b" />} />
            <Route path="crew" element={<MyCrewPage />} />
            <Route path="sync" element={<SyncStatusPage />} />
            <Route path="notifications" element={<NotificationsPage taskBase="/field/tasks" />} />
          </Route>
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
