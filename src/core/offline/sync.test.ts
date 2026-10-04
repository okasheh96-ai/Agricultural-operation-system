import { QueryClient } from '@tanstack/react-query';
import { fieldDb } from './fieldDb';
import { enqueue } from './outbox';

const sent: string[] = [];
vi.mock('./supabaseSender', () => ({
  supabaseSender: () => async (item: { idempotencyKey: string }) => {
    sent.push(item.idempotencyKey);
    return { outcome: 'applied' };
  },
}));
vi.mock('@/core/supabase', () => ({ requireSupabase: () => ({}) }));

const { syncNow, setSyncUser } = await import('./sync');

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

describe('syncNow', () => {
  beforeEach(async () => {
    sent.length = 0;
    await fieldDb.outbox.clear();
    setSyncUser('u1');
  });

  // Regression: offline, the run completed synchronously and left a settled promise in `running`,
  // so every later sync (including the one on reconnect) silently did nothing.
  it('syncs on reconnect after being called while offline', async () => {
    const qc = new QueryClient();
    const item = await enqueue(fieldDb, { kind: 'transition', entityType: 'tasks', entityId: 't1', deviceId: 'd', userId: 'u1', payload: { toStatus: 'in_progress' } });
    setOnline(false);
    await syncNow(qc);
    expect(sent).toEqual([]);
    setOnline(true);
    await syncNow(qc);
    expect(sent).toEqual([item.idempotencyKey]);
    expect(await fieldDb.outbox.count()).toBe(0);
  });

  it('sends nothing when nobody is signed in (after sign-out on a shared phone)', async () => {
    const qc = new QueryClient();
    await enqueue(fieldDb, { kind: 'transition', entityType: 'tasks', entityId: 't3', deviceId: 'd', userId: 'u1', payload: { toStatus: 'in_progress' } });
    setOnline(true);
    setSyncUser(null);
    await syncNow(qc);
    expect(sent).toEqual([]);
  });

  it('trusts the online event even if navigator.onLine still reads false', async () => {
    const qc = new QueryClient();
    await enqueue(fieldDb, { kind: 'transition', entityType: 'tasks', entityId: 't2', deviceId: 'd', userId: 'u1', payload: { toStatus: 'in_progress' } });
    setOnline(false);
    await syncNow(qc, { assumeOnline: true });
    expect(sent).toHaveLength(1);
  });
});
