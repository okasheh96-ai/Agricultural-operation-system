import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/core/supabase';
import type { Access, Grant } from '@/core/rbac/access';
import { withDeviceCache } from '@/core/data/cache';
import { setSyncUser } from '@/core/offline/sync';

interface AuthState {
  session: Session | null;
  ready: boolean;
  access: Access | null;
  accessLoading: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, ready: false, access: null, accessLoading: false });

interface UserRoleRow {
  farm_id: string;
  role_id: string;
  department_id: string | null;
  location_id: string | null;
  valid_from: string;
  valid_to: string | null;
  roles: { code: string } | null;
}
interface PermissionRow {
  role_id: string;
  object_type: string;
  action: string;
  allowed_states: string[] | null;
}

async function loadAccess(userId: string): Promise<Access | null> {
  const db = requireSupabase();
  const { data: roles, error } = await db
    .from('user_roles')
    .select('farm_id, role_id, department_id, location_id, valid_from, valid_to, roles(code)')
    .eq('user_id', userId)
    .is('voided_at', null)
    .returns<UserRoleRow[]>();
  if (error) throw error;
  const now = Date.now();
  const active = roles.filter((r) => Date.parse(r.valid_from) <= now && (r.valid_to === null || Date.parse(r.valid_to) > now));
  const first = active[0];
  if (!first) return null;

  const { data: perms, error: permError } = await db
    .from('role_permissions')
    .select('role_id, object_type, action, allowed_states')
    .in('role_id', active.map((r) => r.role_id))
    .is('voided_at', null)
    .returns<PermissionRow[]>();
  if (permError) throw permError;

  const grants: Grant[] = active.map((r) => ({
    roleCode: r.roles?.code ?? '',
    departmentId: r.department_id,
    locationId: r.location_id,
    permissions: perms
      .filter((p) => p.role_id === r.role_id)
      .map((p) => ({ objectType: p.object_type, action: p.action, allowedStates: p.allowed_states })),
  }));
  const { data: farm } = await db.from('farms').select('is_demo').eq('id', first.farm_id).maybeSingle<{ is_demo: boolean }>();
  const nowIso = new Date().toISOString();
  const { data: dels } = await db.from('delegations').select('from_user_id').eq('to_user_id', userId).is('voided_at', null)
    .lte('valid_from', nowIso).gt('valid_to', nowIso).returns<{ from_user_id: string }[]>();
  return { userId, farmId: first.farm_id, isDemo: farm?.is_demo ?? false, grants, delegatorIds: (dels ?? []).map((d) => d.from_user_id) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const db = requireSupabase();
    void db.auth.getSession().then(({ data }) => {
      setSyncUser(data.session?.user.id ?? null);
      setSession(data.session);
      setReady(true);
    });
    const { data } = db.auth.onAuthStateChange((_event, next) => {
      setSyncUser(next?.user.id ?? null);
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  // Roles are part of the device's working set: the field app must start and show the right controls offline.
  // The server still enforces every permission at sync.
  const accessQuery = useQuery({
    queryKey: ['access', userId],
    queryFn: () => withDeviceCache(`access:${userId}`, () => loadAccess(userId as string)),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    networkMode: 'always',
  });

  return (
    <AuthContext.Provider
      value={{ session, ready, access: accessQuery.data ?? null, accessLoading: accessQuery.isLoading }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
