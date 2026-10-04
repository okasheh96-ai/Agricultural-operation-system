import type { Access } from '@/core/rbac/access';
import { can, departmentsWith } from '@/core/rbac/access';

/**
 * Office navigation (Master Prompt §4.3). Status is honest: "built" sections are real; the rest
 * render a labelled later-phase page. Wells live under Irrigation & Water, never at the top level.
 */
export interface NavItem {
  key: string;
  path: string;
  labelKey: string;
  phase: string;
  built: boolean;
  notVerified?: boolean;
  tone?: 'qa';
  visible?: (access: Access | null) => boolean;
  children?: NavItem[];
}

const canDo = (objectType: string, action: string) => (a: Access | null) => {
  const scope = departmentsWith(a, objectType, action);
  return scope === 'all' || scope.length > 0;
};

/** The Verification Queue is shown to anyone who may verify some master data in some scope. */
const canVerifySomething = (a: Access | null) =>
  !!a?.grants.some((g) => g.permissions.some((p) => p.action === 'verify' && p.objectType !== 'task'));

export const OFFICE_NAV: NavItem[] = [
  { key: 'command', path: '/office/command-center', labelKey: 'nav.commandCenter', phase: '2', built: true },
  {
    key: 'operations', path: '/office/operations', labelKey: 'nav.operations', phase: '2', built: true,
    children: [
      { key: 'board', path: '/office/operations', labelKey: 'nav.board', phase: '2', built: true },
      { key: 'plan', path: '/office/operations/plan', labelKey: 'nav.plan', phase: '2', built: true, visible: canDo('task', 'plan') },
      { key: 'verifyTasks', path: '/office/operations/verification', labelKey: 'nav.verifyTasks', phase: '2', built: true, visible: canDo('task', 'verify') },
      { key: 'exceptions', path: '/office/operations/exceptions', labelKey: 'nav.exceptions', phase: '2', built: true },
    ],
  },
  { key: 'agriculture', path: '/office/agriculture', labelKey: 'nav.agriculture', phase: '3', built: false },
  {
    key: 'irrigation', path: '/office/irrigation', labelKey: 'nav.irrigation', phase: '4', built: true,
    children: [
      { key: 'wells', path: '/office/irrigation/wells', labelKey: 'nav.wells', phase: '4', built: true },
      { key: 'irrigationRuns', path: '/office/irrigation/runs', labelKey: 'nav.irrigationRuns', phase: '4', built: false },
    ],
  },
  { key: 'maintenance', path: '/office/maintenance', labelKey: 'nav.maintenance', phase: '5', built: false },
  { key: 'maintenanceWarehouse', path: '/office/maintenance-warehouse', labelKey: 'nav.maintenanceWarehouse', phase: '6', built: false },
  { key: 'fleet', path: '/office/fleet', labelKey: 'nav.fleet', phase: '7', built: false },
  { key: 'mainWarehouse', path: '/office/main-warehouse', labelKey: 'nav.mainWarehouse', phase: '2–3', built: false },
  { key: 'packingHouse', path: '/office/packing-house', labelKey: 'nav.packingHouse', phase: '8', built: false },
  { key: 'qc', path: '/office/qc', labelKey: 'nav.qc', phase: '9', built: false },
  { key: 'qa', path: '/office/qa', labelKey: 'nav.qa', phase: '9', built: false, tone: 'qa' },
  { key: 'cattle', path: '/office/cattle', labelKey: 'nav.cattle', phase: '—', built: false, notVerified: true },
  { key: 'reports', path: '/office/reports', labelKey: 'nav.reports', phase: '10', built: false },
  {
    key: 'admin', path: '/office/admin', labelKey: 'nav.admin', phase: '1', built: true,
    children: [
      { key: 'departments', path: '/office/admin/departments', labelKey: 'nav.departments', phase: '1', built: true },
      { key: 'locations', path: '/office/admin/locations', labelKey: 'nav.locations', phase: '1', built: true },
      { key: 'verification', path: '/office/admin/verification', labelKey: 'nav.verificationQueue', phase: '1', built: true, visible: canVerifySomething },
      { key: 'audit', path: '/office/admin/audit', labelKey: 'nav.auditLog', phase: '1', built: true, visible: (a) => can(a, 'audit_log', 'view') },
    ],
  },
];

export function visibleNav(items: NavItem[], access: Access | null): NavItem[] {
  return items
    .filter((i) => !i.visible || i.visible(access))
    .map((i) => (i.children ? { ...i, children: visibleNav(i.children, access) } : i));
}

/** Roles that work mainly in the field start in the field shell (§4.2). */
export const FIELD_ROLES = ['supervisor', 'maintenance_technician', 'irrigation_user', 'fleet_user', 'warehouse_user'];
