import { newLocationSchema } from './locationSchema';

describe('newLocationSchema', () => {
  it('requires code and Arabic name; English optional', () => {
    const ok = newLocationSchema.safeParse({ code: 'B-01', name_ar: 'قطعة ١', name_en: '', type: 'block', parent_id: null });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.name_en).toBeNull();
    const bad = newLocationSchema.safeParse({ code: ' ', name_ar: '', type: 'block', parent_id: null });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('errors.required');
  });
  it('rejects unknown location types', () => {
    expect(newLocationSchema.safeParse({ code: 'X', name_ar: 'س', type: 'wellfield', parent_id: null }).success).toBe(false);
  });
});
