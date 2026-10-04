/** Field and entity descriptions for the generic master-data screen (configuration, not farm data). */
export type FieldKind = 'text' | 'textLtr' | 'bool' | 'lookup';

export interface FieldSpec {
  name: string;
  labelKey: string;
  kind: FieldKind;
  required?: boolean;
  /** For lookups: table to read options from, and whether "none / all" is allowed. */
  lookup?: { table: 'departments' | 'locations' | 'asset_classes' | 'user_profiles'; label: 'name' | 'full_name'; nullLabelKey?: string };
  list?: boolean;
}

export interface EntitySpec {
  key: string;
  table: string;
  titleKey: string;
  objectType: string;
  departmentColumn: string | null;
  workflowCode?: string;
  nameColumns: { ar: string; en: string };
  fields: FieldSpec[];
}

const dept = (name: string, required = true, nullLabelKey?: string): FieldSpec => ({
  name, labelKey: 'md.department', kind: 'lookup', required, lookup: { table: 'departments', label: 'name', nullLabelKey }, list: true,
});

export const ENTITIES = {
  assets: {
    key: 'assets', table: 'assets', titleKey: 'md.assetsTitle', objectType: 'asset', departmentColumn: 'owning_department_id',
    workflowCode: 'asset_status', nameColumns: { ar: 'name_ar', en: 'name_en' },
    fields: [
      { name: 'code', labelKey: 'common.code', kind: 'textLtr', required: true, list: true },
      { name: 'name_ar', labelKey: 'common.nameAr', kind: 'text', required: true, list: true },
      { name: 'name_en', labelKey: 'common.nameEn', kind: 'textLtr' },
      { name: 'asset_class_id', labelKey: 'md.assetClass', kind: 'lookup', required: true, lookup: { table: 'asset_classes', label: 'name' }, list: true },
      dept('owning_department_id'),
      { name: 'location_id', labelKey: 'work.location', kind: 'lookup', lookup: { table: 'locations', label: 'name', nullLabelKey: 'common.none' } },
      { name: 'manufacturer', labelKey: 'md.manufacturer', kind: 'textLtr' },
      { name: 'model', labelKey: 'md.model', kind: 'textLtr' },
      { name: 'serial_no', labelKey: 'md.serial', kind: 'textLtr' },
    ],
  },
  workers: {
    key: 'workers', table: 'workers', titleKey: 'md.workersTitle', objectType: 'worker', departmentColumn: 'home_department_id',
    nameColumns: { ar: 'full_name', en: 'full_name_en' },
    fields: [
      { name: 'code', labelKey: 'common.code', kind: 'textLtr', required: true, list: true },
      { name: 'full_name', labelKey: 'md.fullName', kind: 'text', required: true, list: true },
      { name: 'full_name_en', labelKey: 'md.fullNameEn', kind: 'textLtr' },
      dept('home_department_id'),
      { name: 'is_active', labelKey: 'md.active', kind: 'bool', list: true },
    ],
  },
  crews: {
    key: 'crews', table: 'crews', titleKey: 'md.crewsTitle', objectType: 'crew', departmentColumn: 'department_id',
    nameColumns: { ar: 'name_ar', en: 'name_en' },
    fields: [
      { name: 'code', labelKey: 'common.code', kind: 'textLtr', required: true, list: true },
      { name: 'name_ar', labelKey: 'common.nameAr', kind: 'text', required: true, list: true },
      { name: 'name_en', labelKey: 'common.nameEn', kind: 'textLtr' },
      dept('department_id'),
      { name: 'supervisor_user_id', labelKey: 'work.supervisor', kind: 'lookup', lookup: { table: 'user_profiles', label: 'full_name', nullLabelKey: 'plan.unassigned' }, list: true },
    ],
  },
  task_types: {
    key: 'task_types', table: 'task_types', titleKey: 'md.taskTypesTitle', objectType: 'task_type', departmentColumn: 'department_id',
    nameColumns: { ar: 'name_ar', en: 'name_en' },
    fields: [
      { name: 'code', labelKey: 'common.code', kind: 'textLtr', required: true, list: true },
      { name: 'name_ar', labelKey: 'common.nameAr', kind: 'text', required: true, list: true },
      { name: 'name_en', labelKey: 'common.nameEn', kind: 'textLtr' },
      dept('department_id', false, 'md.allDepartments'),
      { name: 'requires_verification', labelKey: 'md.requiresVerification', kind: 'bool', list: true },
      { name: 'allow_self_verification', labelKey: 'md.allowSelfVerification', kind: 'bool' },
    ],
  },
} satisfies Record<string, EntitySpec>;

export function entitySpec(key: string): EntitySpec | undefined {
  return (ENTITIES as Record<string, EntitySpec>)[key];
}

/** Builds the insert/update payload from form strings, typed per field. */
export function toPayload(spec: EntitySpec, form: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const v = form[f.name];
    if (f.kind === 'bool') out[f.name] = v === true;
    else if (typeof v === 'string') out[f.name] = v.trim() === '' ? null : v.trim();
  }
  return out;
}

export function missingRequired(spec: EntitySpec, form: Record<string, string | boolean>): string | null {
  const f = spec.fields.find((x) => x.required && x.kind !== 'bool' && !String(form[x.name] ?? '').trim());
  return f ? f.labelKey : null;
}
