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

/** Packing-house demo people (PH-OAS-SPEC-001 §6.1), one per role, so each role's view and limits can be tried. */
export const DEMO_PH_ACCOUNTS: { email: string; labelKey: string }[] = [
  { email: 'demo.ph.phm@demo.local', labelKey: 'auth.demo.ph.phm' },
  { email: 'demo.ph.pe@demo.local', labelKey: 'auth.demo.ph.pe' },
  { email: 'demo.ph.ll@demo.local', labelKey: 'auth.demo.ph.ll' },
  { email: 'demo.ph.stk@demo.local', labelKey: 'auth.demo.ph.stk' },
  { email: 'demo.ph.dec@demo.local', labelKey: 'auth.demo.ph.dec' },
  { email: 'demo.ph.qci@demo.local', labelKey: 'auth.demo.ph.qci' },
  { email: 'demo.ph.qao@demo.local', labelKey: 'auth.demo.ph.qao' },
  { email: 'demo.ph.qam@demo.local', labelKey: 'auth.demo.ph.qam' },
  { email: 'demo.ph.pho@demo.local', labelKey: 'auth.demo.ph.pho' },
  { email: 'demo.ph.eng@demo.local', labelKey: 'auth.demo.ph.eng' },
  { email: 'demo.ph.whm@demo.local', labelKey: 'auth.demo.ph.whm' },
  { email: 'demo.ph.top@demo.local', labelKey: 'auth.demo.ph.top' },
  { email: 'demo.ph.aud@demo.local', labelKey: 'auth.demo.ph.aud' },
];
