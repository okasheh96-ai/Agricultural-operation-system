/**
 * Demo farm accounts for one-tap sign-in (scripts/demo-users.mjs creates them on the local demo stack only). Used only
 * behind __DEMO_SIGNIN__, so production builds do not contain this module. It signs in through Supabase Auth like the
 * form does; it is a shortcut for typing, not a way around sign-in.
 */
export const DEMO_PASSWORD = 'demo-password-123';

export const DEMO_ACCOUNTS: { email: string; labelKey: string }[] = [
  { email: 'demo.admin@demo.local', labelKey: 'auth.demo.admin' },
  { email: 'demo.agri.manager@demo.local', labelKey: 'auth.demo.agriManager' },
  { email: 'demo.ops@demo.local', labelKey: 'auth.demo.ops' },
  { email: 'demo.maint.manager@demo.local', labelKey: 'auth.demo.maintManager' },
  { email: 'demo.supervisor@demo.local', labelKey: 'auth.demo.supervisor' },
];
