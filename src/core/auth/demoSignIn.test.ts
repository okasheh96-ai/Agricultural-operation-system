import { readFileSync } from 'node:fs';
import ar from '@/locales/ar.json';
import en from '@/locales/en.json';
import { DEMO_ACCOUNTS, DEMO_PH_ACCOUNTS } from './demoSignIn';

const lookup = (dict: unknown, key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);

describe('one-tap demo sign-in', () => {
  it('offers only accounts the demo stack creates, starting with the full-access admin', () => {
    const created = readFileSync('scripts/demo-people.mjs', 'utf8');
    for (const a of DEMO_ACCOUNTS) expect(created).toContain(`'${a.email}'`);
    expect(DEMO_ACCOUNTS[0]?.email).toBe('demo.admin@demo.local');
  });

  it('labels every account in Arabic and English', () => {
    for (const a of DEMO_ACCOUNTS) {
      expect(typeof lookup(ar, a.labelKey)).toBe('string');
      expect(typeof lookup(en, a.labelKey)).toBe('string');
    }
  });

  it('offers packing-house roles that the demo stack creates, each labelled in both languages', () => {
    const created = readFileSync('scripts/demo-people.mjs', 'utf8');
    for (const a of DEMO_PH_ACCOUNTS) {
      expect(created).toContain(`'${a.email}'`);
      expect(typeof lookup(ar, a.labelKey)).toBe('string');
      expect(typeof lookup(en, a.labelKey)).toBe('string');
    }
  });
});
