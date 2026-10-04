import ar from './ar.json';
import en from './en.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('locales', () => {
  it('Arabic and English have exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('no empty translations', () => {
    const empty = (o: object) => keys(o).filter((k) => k.split('.').reduce<unknown>((acc, p) => (acc as Record<string, unknown>)[p], o) === '');
    expect(empty(ar)).toEqual([]);
    expect(empty(en)).toEqual([]);
  });

  it('uses the owner-specified wording for unverified and unbuilt items', () => {
    expect(ar.verification.not_yet_verified).toBe('غير مؤكد بعد');
    expect(ar.verification.to_be_confirmed_on_site).toBe('يُؤكَّد ميدانياً');
    expect(ar.labels.laterPhase).toBe('في مرحلة لاحقة');
    expect(en.labels.notImplemented).toBe('Not Implemented');
  });
});
