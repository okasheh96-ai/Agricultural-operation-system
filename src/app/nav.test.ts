import { OFFICE_NAV, visibleNav } from './nav';
import type { Access } from '@/core/rbac/access';

describe('office navigation', () => {
  it('follows the agricultural operating model, not a wells-centric one', () => {
    const top = OFFICE_NAV.map((i) => i.key);
    expect(top).not.toContain('wells');
    expect(top[0]).toBe('command');
    expect(top).toContain('irrigation');
  });

  it('marks QA as a visually distinct section', () => {
    expect(OFFICE_NAV.find((i) => i.key === 'qa')?.tone).toBe('qa');
  });

  it('labels Cattle as Not Yet Verified', () => {
    expect(OFFICE_NAV.find((i) => i.key === 'cattle')?.notVerified).toBe(true);
  });

  it('hides the audit log and verification queue from viewers', () => {
    const viewer: Access = { userId: 'u', farmId: 'f', grants: [{ roleCode: 'executive_viewer', departmentId: null, locationId: null, permissions: [] }] };
    const admin = visibleNav(OFFICE_NAV, viewer).find((i) => i.key === 'admin');
    expect(admin?.children?.map((c) => c.key)).toEqual(['departments', 'locations']);
  });
});
