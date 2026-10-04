import { matchesSearch, normalizeArabic } from './normalizeArabic';

describe('normalizeArabic (mirror of app.normalize_ar)', () => {
  it.each([
    ['إدارة', 'اداره'],
    ['أحمد', 'احمد'],
    ['آبار', 'ابار'],
    ['مستشفى', 'مستشفي'],
    ['مَزْرَعَة', 'مزرعه'],
    ['مـــزرعة', 'مزرعه'],
  ])('%s ≡ %s', (a, b) => {
    expect(normalizeArabic(a)).toBe(normalizeArabic(b));
  });

  it('lowercases Latin and handles null', () => {
    expect(normalizeArabic('MAT EXAKTA')).toBe('mat exakta');
    expect(normalizeArabic(null)).toBe('');
  });

  it('matches regardless of variant spelling', () => {
    expect(matchesSearch('قطعة البساتين الشمالية', 'قطعه')).toBe(true);
    expect(matchesSearch('W-01', '')).toBe(true);
    expect(matchesSearch('Greenhouse', 'orchard')).toBe(false);
  });
});
