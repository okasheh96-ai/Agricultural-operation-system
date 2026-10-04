import { ENTITIES, missingRequired, toPayload } from './masterData';

describe('master data specs', () => {
  it('types payloads: empty text becomes null, booleans stay booleans', () => {
    const p = toPayload(ENTITIES.task_types, { code: ' T1 ', name_ar: 'نوع', name_en: '', department_id: '', requires_verification: true, allow_self_verification: false });
    expect(p).toEqual({ code: 'T1', name_ar: 'نوع', name_en: null, department_id: null, requires_verification: true, allow_self_verification: false });
  });
  it('reports the first missing required field', () => {
    expect(missingRequired(ENTITIES.assets, { code: 'A1', name_ar: '' })).toBe('common.nameAr');
    expect(missingRequired(ENTITIES.workers, { code: 'W', full_name: 'x', home_department_id: 'd' })).toBeNull();
  });
  it('never asks for invented specifications: manufacturer/model/serial are optional', () => {
    const optional = ENTITIES.assets.fields.filter((f) => ['manufacturer', 'model', 'serial_no'].includes(f.name));
    expect(optional.every((f) => !f.required)).toBe(true);
  });
});
