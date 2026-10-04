import { enqueue, FieldDatabase, replay, replayOrder, type OutboxItem, type Sender } from './outbox';

let db: FieldDatabase;
let n = 0;
beforeEach(async () => {
  db = new FieldDatabase(`test-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const base = { kind: 'transition' as const, entityType: 'tasks', deviceId: 'dev-1', dependsOn: [] as string[] };

describe('outbox', () => {
  it('queues with an idempotency key, device time and pending state', async () => {
    const item = await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'in_progress' } });
    expect(item.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(item.state).toBe('pending');
    expect(await db.outbox.count()).toBe(1);
  });

  it('replays per record in device-time order and parents before children', () => {
    const mk = (key: string, entityId: string, at: string, dependsOn: string[] = []): OutboxItem => ({
      ...base, idempotencyKey: key, entityId, dependsOn, clientRecordedAt: at, state: 'pending', attempts: 0,
      payload: { toStatus: 'x' },
    });
    const order = replayOrder([
      mk('c', 'labour1', '2026-10-04T06:01:00Z', ['task1']),
      mk('b', 'task1', '2026-10-04T06:05:00Z'),
      mk('a', 'task1', '2026-10-04T06:00:00Z'),
    ]).map((i) => i.idempotencyKey);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('removes applied items and records last sync', async () => {
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'in_progress' } });
    const result = await replay(db, async () => ({ outcome: 'applied' }));
    expect(result).toEqual({ applied: 1, conflicts: 0 });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get('lastSyncedAt')).toBeDefined();
  });

  it('keeps items pending with the same key when the network fails', async () => {
    const item = await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'in_progress' } });
    const failing: Sender = async () => { throw new Error('offline'); };
    await replay(db, failing);
    const stored = await db.outbox.get(item.idempotencyKey);
    expect(stored?.state).toBe('pending');
    const seen: string[] = [];
    await replay(db, async (i) => { seen.push(i.idempotencyKey); return { outcome: 'applied' }; });
    expect(seen).toEqual([item.idempotencyKey]);
  });

  it('turns a server rejection into a visible conflict and holds later changes to that record', async () => {
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'completed' }, clientRecordedAt: '2026-10-04T06:00:00Z' });
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'pending_verification' }, clientRecordedAt: '2026-10-04T06:10:00Z' });
    await enqueue(db, { ...base, entityId: 't2', payload: { toStatus: 'in_progress' }, clientRecordedAt: '2026-10-04T06:05:00Z' });
    const sent: string[] = [];
    const result = await replay(db, async (i) => {
      sent.push(`${i.entityId}:${i.payload.toStatus}`);
      return i.entityId === 't1' ? { outcome: 'conflict', reason: 'Transition not allowed' } : { outcome: 'applied' };
    });
    expect(result).toEqual({ applied: 1, conflicts: 1 });
    expect(sent).toEqual(['t1:completed', 't2:in_progress']);
    const conflicts = await db.outbox.where('state').equals('conflict').toArray();
    expect(conflicts[0]?.conflictReason).toBe('Transition not allowed');
    expect(await db.outbox.where('state').equals('pending').count()).toBe(1);
  });
});
