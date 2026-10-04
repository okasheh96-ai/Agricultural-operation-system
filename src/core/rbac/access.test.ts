import { can, hasRole, type Access } from './access';

const MAINT = 'dept-maint';
const access: Access = {
  userId: 'u1',
  farmId: 'f1',
  grants: [
    {
      roleCode: 'department_manager', departmentId: MAINT, locationId: null,
      permissions: [{ objectType: 'asset', action: 'create', allowedStates: null }],
    },
    {
      roleCode: 'executive_viewer', departmentId: null, locationId: null,
      permissions: [{ objectType: 'asset', action: 'view', allowedStates: null }],
    },
    {
      roleCode: 'supervisor', departmentId: null, locationId: 'gh',
      permissions: [{ objectType: 'task', action: 'execute', allowedStates: ['assigned', 'in_progress'] }],
    },
  ],
};

describe('can (UI mirror of app.has_permission)', () => {
  it('department-scoped roles apply only to their department', () => {
    expect(can(access, 'asset', 'create', { departmentId: MAINT })).toBe(true);
    expect(can(access, 'asset', 'create', { departmentId: 'dept-irr' })).toBe(false);
    expect(can(access, 'asset', 'create')).toBe(false);
  });
  it('farm-wide roles apply everywhere', () => {
    expect(can(access, 'asset', 'view', { departmentId: 'anything' })).toBe(true);
  });
  it('location scope and workflow state are respected', () => {
    expect(can(access, 'task', 'execute', { state: 'assigned', locationPath: ['farm', 'gh', 'h1'] })).toBe(true);
    expect(can(access, 'task', 'execute', { state: 'verified', locationPath: ['farm', 'gh'] })).toBe(false);
    expect(can(access, 'task', 'execute', { state: 'assigned', locationPath: ['farm', 'orchard'] })).toBe(false);
  });
  it('no access means no permission', () => {
    expect(can(null, 'asset', 'view')).toBe(false);
    expect(hasRole(access, 'qa_user')).toBe(false);
    expect(hasRole(access, 'supervisor')).toBe(true);
  });
});
