import { describe, expect, it } from 'vitest';
import { parseQuantity, formatMilli, mulDiv } from '../../src/shared/num';
import { parseDateText, parseTimeText, excelSerialToLocal, shiftDateOf, localToUtcMs, shiftTimeToUtcMs } from '../../src/shared/time';
import { __dicts } from '../../src/client/i18n';
import { validateRow } from '../../src/shared/rows';

describe('numbers', () => {
  it('Arabic and English numerals, separators, no float error', () => {
    expect(parseQuantity('٤١٠٠').milli).toBe(4100000);
    expect(parseQuantity('٤٬١٠٠٫٥').milli).toBe(4100500);
    expect(parseQuantity('4,100').milli).toBe(4100000);
    expect(parseQuantity('1.234.567').milli).toBe(1234567000);
    expect(parseQuantity(0.1 + 0.2).milli).toBe(300);
    expect(parseQuantity('(50)').milli).toBe(-50000);
    expect(parseQuantity('12,5')).toMatchObject({ milli: 12500, issue: 'ambiguous_separator' });
    expect(parseQuantity('12a').milli).toBeNull();
    expect(parseQuantity('')).toMatchObject({ milli: null, issue: 'empty' });
    expect(formatMilli(4100500)).toBe('4100.5');
    expect(mulDiv(8000000, 4, 8)).toBe(4000000);
  });
});
describe('dates and Amman shifts', () => {
  it('Excel serials, dd/mm ambiguity, times', () => {
    expect(excelSerialToLocal(46348).date).toBe('2026-11-22');
    expect(parseDateText('22/11/2026')).toMatchObject({ date: '2026-11-22' });
    expect(parseDateText('05/06/2026')).toMatchObject({ issue: 'ambiguous_date' });
    expect(parseDateText('٢٠٢٦-١١-٢٢').date).toBe('2026-11-22');
    expect(parseTimeText('6:30 PM')).toBe('18:30');
    expect(parseTimeText('١٤:٣٠')).toBe('14:30');
    expect(parseTimeText(0.25)).toBe('06:00');
  });
  it('overnight shift keeps one shift date', () => {
    const t = shiftTimeToUtcMs('2026-11-22', '02:00', '18:00');
    expect(t).toBe(localToUtcMs('2026-11-23', '02:00'));
    expect(shiftDateOf(t, '18:00')).toBe('2026-11-22');
    expect(new Date(localToUtcMs('2026-11-22', '06:00')).toISOString()).toBe('2026-11-22T03:00:00.000Z');
  });
});
describe('row validation', () => {
  const ctx = { dataset: 'production', shiftDate: '2026-11-22', shiftStart: '06:00', tz: 'Asia/Amman', defaultMode: 'interval' as const, knownUnits: new Set(['kg']), knownCodes: {}, ocrThreshold: 80 };
  it('never invents a unit or a value', () => {
    const r = validateRow({ dims: { line: 'L1', product: 'T' }, time: '10:00', measures: [{ metric: 'qty', value: '5', unit: null, role: 'actual' }], attrs: {} }, ctx);
    expect(r.issues.map((i) => i.code)).toContain('missing_unit');
    expect(r.drafts).toHaveLength(0);
  });
  it('low OCR confidence blocks until confirmed', () => {
    const v = { dims: { line: 'L1', product: 'T' }, time: '10:00', measures: [{ metric: 'qty', value: '5', unit: 'kg', role: 'actual' as const }], attrs: {}, conf: { 'm:qty': 40 } };
    expect(validateRow(v, ctx).issues.map((i) => i.code)).toContain('uncertain_ocr');
    expect(validateRow({ ...v, confirmed: ['m:qty'] }, ctx).drafts).toHaveLength(1);
  });
});
describe('i18n', () => {
  it('every key has Arabic and English', () => {
    expect(Object.keys(__dicts.ar).sort()).toEqual(Object.keys(__dicts.en).sort());
  });
});
