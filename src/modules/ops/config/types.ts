/** An owner-defined operation, as stored in ph_op_versions.definition. The server validates every definition
 *  (ph_op_validate) before it can be published; these types only describe the shape the editor builds. */
export type FieldType = 'text' | 'number' | 'select' | 'date' | 'datetime' | 'check' | 'photo' | 'rows';
export type CondOp = 'eq' | 'neq' | 'in' | 'contains' | 'empty' | 'gt' | 'gte' | 'lt' | 'lte';

export interface OpOption { value: string; label_ar: string; label_en?: string }
export interface OpColumn { key: string; label_ar: string; label_en?: string; type: 'text' | 'number' }
export interface OpField {
  key: string; type: FieldType; label_ar: string; label_en?: string; required?: boolean; unit?: string; min?: number; max?: number;
  options?: OpOption[]; columns?: OpColumn[]; help_ar?: string; help_en?: string;
}
export interface Cond { field: string; op: CondOp; value?: string | string[] }
export interface OpStep {
  key: string; kind: 'form' | 'approval'; role: string; name_ar: string; name_en?: string; fields?: OpField[];
  pass_if?: Cond[]; on_fail?: { action?: 'block' | 'hold'; goto?: string }; show_if?: Cond[]; disabled?: boolean;
}
export interface OpTask { role?: string; due_minutes?: number; priority?: 'low' | 'normal' | 'high'; escalate_after_min?: number; escalate_to_role?: string; details?: string }
export interface OpDef { trigger: { hook: string; conditions?: Cond[] }; task?: OpTask; steps: OpStep[] }

export type SubjectKind = 'load' | 'fg_pallet' | 'line_shift' | 'standalone';

export interface Catalog {
  hooks: { hook: string; subject_kind: SubjectKind; label_en: string; label_ar: string }[];
  subject_fields: Record<SubjectKind, string[]>;
  field_types: FieldType[];
  condition_ops: CondOp[];
  approver_roles: string[];
  datasets: { dataset: string; time_column: string; columns: string[]; numeric_columns: string[]; label_en: string; label_ar: string }[];
  measures: string[];
  windows: string[];
  units: { code: string; name_ar: string; name_en: string | null }[];
}

export interface OpError { key: string; step?: string; field?: string; role?: string; unit?: string; target?: string; hook?: string; subject?: string }

export type Values = Record<string, unknown>;

export const emptyDef = (hook = 'manual'): OpDef => ({ trigger: { hook, conditions: [] }, steps: [] });

/** Next free key like step_2 / field_3 (keys are lower-case, as the server requires). */
export function nextKey(prefix: string, used: string[]): string {
  let i = used.length + 1;
  while (used.includes(`${prefix}_${i}`)) i += 1;
  return `${prefix}_${i}`;
}

/** Client copy of the server's condition check (app.po_cond), used only for the live preview's show-if. */
export function condHolds(facts: Values, c: Cond): boolean {
  const raw = facts[c.field];
  const fact = raw === undefined || raw === null ? '' : String(raw);
  const vals = fact.split(',').map((x) => x.trim().toLowerCase());
  const v = typeof c.value === 'string' ? c.value : '';
  const num = (s: string) => (/^-?[0-9.]+$/.test(s) ? Number(s) : NaN);
  switch (c.op) {
    case 'eq': return vals.includes(v.toLowerCase());
    case 'neq': return !vals.includes(v.toLowerCase());
    case 'in': return Array.isArray(c.value) && c.value.some((x) => vals.includes(x.toLowerCase()));
    case 'contains': return fact.toLowerCase().includes(v.toLowerCase());
    case 'empty': return fact.trim() === '';
    case 'gt': return num(fact) > Number(v);
    case 'gte': return num(fact) >= Number(v);
    case 'lt': return num(fact) < Number(v);
    case 'lte': return num(fact) <= Number(v);
    default: return false;
  }
}
export const condsHold = (facts: Values, conds: Cond[] | undefined) => (conds ?? []).every((c) => condHolds(facts, c));
