// Demo farm people (farm DEMO, is_demo): invented names, one per role. Shared by the local stack (demo-users.mjs creates them
// through the real Auth admin API) and the in-browser demo build (build-browser-demo.mjs). Never real staff.
export const DEMO_PASSWORD = 'demo-password-123';
export const USERS = [
  { email: 'demo.admin@demo.local', name: 'مدير النظام (تجريبي)', roles: [['system_admin', null], ['ph_adm', null], ['ph_aud', null]] },
  { email: 'demo.ops@demo.local', name: 'مدير العمليات (تجريبي)', roles: [['operations_manager', null]] },
  { email: 'demo.agri.manager@demo.local', name: 'مدير الزراعة (تجريبي)', roles: [['department_manager', 'agriculture']] },
  { email: 'demo.supervisor@demo.local', name: 'مشرف ميداني (تجريبي)', roles: [['supervisor', 'agriculture']] },
  { email: 'demo.supervisor2@demo.local', name: 'مشرف ثانٍ (تجريبي)', roles: [['supervisor', 'agriculture']] },
  { email: 'demo.maint.manager@demo.local', name: 'مدير الصيانة (تجريبي)', roles: [['maintenance_manager', 'maintenance'], ['department_manager', 'maintenance']] },
  { email: 'demo.technician@demo.local', name: 'فني صيانة (تجريبي)', roles: [['maintenance_technician', 'maintenance']] },
  { email: 'demo.warehouse@demo.local', name: 'أمين مستودع (تجريبي)', roles: [['warehouse_user', 'main_warehouse']] },
  { email: 'demo.qa@demo.local', name: 'ضمان الجودة (تجريبي)', roles: [['qa_user', 'qa']] },
  { email: 'demo.exec@demo.local', name: 'مشاهد إداري (تجريبي)', roles: [['executive_viewer', null]] },
  // Packing house (PH-OAS-SPEC-001 §6.1): one demo person per role, granted farm-wide; the matrix decides what each may do.
  { email: 'demo.ph.phm@demo.local', name: 'مدير بيت التعبئة (تجريبي)', roles: [['ph_phm', null]] },
  { email: 'demo.ph.dec@demo.local', name: 'مدخل بيانات الاستلام (تجريبي)', roles: [['ph_dec', null]] },
  { email: 'demo.ph.qci@demo.local', name: 'مراقب جودة (تجريبي)', roles: [['ph_qci', null]] },
  { email: 'demo.ph.qcm@demo.local', name: 'مدير مراقبة الجودة (تجريبي)', roles: [['ph_qcm', null]] },
  { email: 'demo.ph.qao@demo.local', name: 'مسؤول ضمان الجودة (تجريبي)', roles: [['ph_qao', null]] },
  { email: 'demo.ph.qam@demo.local', name: 'مدير ضمان الجودة (تجريبي)', roles: [['ph_qam', null]] },
  { email: 'demo.ph.pho@demo.local', name: 'مشغّل بيت التعبئة (تجريبي)', roles: [['ph_pho', null]] },
  { email: 'demo.ph.eng@demo.local', name: 'مهندس إعادة الفرز (تجريبي)', roles: [['ph_eng', null]] },
  { email: 'demo.ph.whm@demo.local', name: 'مدير المستودعات (تجريبي)', roles: [['ph_whm', null]] },
  { email: 'demo.ph.top@demo.local', name: 'الإدارة العليا (تجريبي)', roles: [['ph_top', null]] },
  { email: 'demo.ph.adm@demo.local', name: 'مسؤول نظام بيت التعبئة (تجريبي)', roles: [['ph_adm', null]] },
  { email: 'demo.ph.aud@demo.local', name: 'مدقق (تجريبي)', roles: [['ph_aud', null]] },
];
