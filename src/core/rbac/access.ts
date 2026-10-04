/**
 * UI mirror of app.has_permission(). The database remains the authority; this only decides
 * which controls to show. Same rules: a department-scoped role applies only to its department;
 * a farm-wide role (departmentId null) applies everywhere.
 */
export interface Grant {
  roleCode: string;
  departmentId: string | null;
  locationId: string | null;
  permissions: { objectType: string; action: string; allowedStates: string[] | null }[];
}

export interface Access {
  userId: string;
  farmId: string;
  /** Demo farm (separate, clearly labelled); never real farm data. */
  isDemo?: boolean;
  grants: Grant[];
}

/** Departments in which the user may perform an action on an object (farm-wide grants return 'all'). */
export function departmentsWith(access: Access | null, objectType: string, action: string): 'all' | string[] {
  const ids = new Set<string>();
  for (const g of access?.grants ?? []) {
    if (!g.permissions.some((p) => p.objectType === objectType && p.action === action)) continue;
    if (g.departmentId === null) return 'all';
    ids.add(g.departmentId);
  }
  return [...ids];
}

export function can(
  access: Access | null,
  objectType: string,
  action: string,
  opts: { departmentId?: string | null; state?: string | null; locationPath?: string[] } = {},
): boolean {
  if (!access) return false;
  return access.grants.some(
    (g) =>
      (g.departmentId === null || g.departmentId === (opts.departmentId ?? null)) &&
      (g.locationId === null || (opts.locationPath ?? []).includes(g.locationId)) &&
      g.permissions.some(
        (p) =>
          p.objectType === objectType &&
          p.action === action &&
          (p.allowedStates === null || (opts.state != null && p.allowedStates.includes(opts.state))),
      ),
  );
}

export function hasRole(access: Access | null, ...roleCodes: string[]): boolean {
  return !!access?.grants.some((g) => roleCodes.includes(g.roleCode));
}
