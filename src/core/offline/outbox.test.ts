import { enqueue, FieldDatabase, provisionalStatus, replay, replayOrder, type OutboxItem, type Sender } from './outbox';

let db: FieldDatabase;
let n = 0;
beforeEach(async () => {
  db = new FieldDatabase(`test-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const base = { kind: 'transition' as const, entityType: 'tasks', deviceId: 'dev-1', dependsOn: [] as string[], userId: 'u1' };

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
    const result = await replay(db, async () => ({ outcome: 'applied' }), 'u1');
    expect(result).toEqual({ applied: 1, conflicts: 0, networkFailed: false });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.meta.get('lastSyncedAt')).toBeDefined();
  });

  it('keeps items pending with the same key when the network fails', async () => {
    const item = await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'in_progress' } });
    const failing: Sender = async () => { throw new Error('offline'); };
    expect((await replay(db, failing, 'u1')).networkFailed).toBe(true);
    expect(await db.meta.get('lastSyncedAt')).toBeUndefined();
    const stored = await db.outbox.get(item.idempotencyKey);
    expect(stored?.state).toBe('pending');
    const seen: string[] = [];
    await replay(db, async (i) => { seen.push(i.idempotencyKey); return { outcome: 'applied' }; }, 'u1');
    expect(seen).toEqual([item.idempotencyKey]);
  });

  it('turns a server rejection into a visible conflict and holds later changes to that record', async () => {
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'completed' }, clientRecordedAt: '2026-10-04T06:00:00Z' });
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'pending_verification' }, clientRecordedAt: '2026-10-04T06:10:00Z' });
    await enqueue(db, { ...base, entityId: 't2', payload: { toStatus: 'in_progress' }, clientRecordedAt: '2026-10-04T06:05:00Z' });
    const sent: string[] = [];
    const result = await replay(db, async (i) => {
      sent.push(`${i.entityId}:${i.kind === 'transition' ? i.payload.toStatus : i.kind}`);
      return i.entityId === 't1' ? { outcome: 'conflict', reason: 'Transition not allowed' } : { outcome: 'applied' };
    }, 'u1');
    expect(result).toEqual({ applied: 1, conflicts: 1, networkFailed: false });
    expect(sent).toEqual(['t1:completed', 't2:in_progress']);
    const conflicts = await db.outbox.where('state').equals('conflict').toArray();
    expect(conflicts[0]?.conflictReason).toBe('Transition not allowed');
    expect(await db.outbox.where('state').equals('pending').count()).toBe(1);
  });
});

describe('outbox — field writes of every kind', () => {
  it('shows the provisional status of a record from its latest queued transition', async () => {
    await enqueue(db, { ...base, entityId: 't9', payload: { toStatus: 'in_progress' }, clientRecordedAt: '2026-10-04T06:00:00Z' });
    await enqueue(db, { ...base, entityId: 't9', payload: { toStatus: 'blocked' }, clientRecordedAt: '2026-10-04T06:05:00Z' });
    expect(provisionalStatus(await db.outbox.toArray(), 't9')).toBe('blocked');
    expect(provisionalStatus(await db.outbox.toArray(), 'other')).toBeNull();
  });

  it('replays a task transition and its labour entry in device-time order', async () => {
    await enqueue(db, { ...base, entityId: 't1', payload: { toStatus: 'in_progress' }, clientRecordedAt: '2026-10-04T06:00:00Z' });
    await enqueue(db, { kind: 'insert', table: 'labour_entries', entityId: 't1', deviceId: 'dev-1', userId: 'u1',
      row: { id: 'l1', task_id: 't1', hours: 2 }, clientRecordedAt: '2026-10-04T06:30:00Z' });
    const seen: string[] = [];
    await replay(db, async (i) => { seen.push(i.kind); return { outcome: 'applied' }; }, 'u1');
    expect(seen).toEqual(['transition', 'insert']);
  });

  it('keeps a rejected insert as a conflict with the server reason', async () => {
    await enqueue(db, { kind: 'insert', table: 'labour_entries', entityId: 't1', deviceId: 'dev-1', userId: 'u1', row: { id: 'l2', task_id: 't1', hours: 1 } });
    await replay(db, async () => ({ outcome: 'conflict', reason: 'Execution records can only change while the task is active' }), 'u1');
    const [c] = await db.outbox.toArray();
    expect(c?.state).toBe('conflict');
    expect(c?.conflictReason).toContain('active');
  });
});

describe('outbox — shared crew phone (audit C3)', () => {
  it('sends only the signed-in user\'s changes; another user\'s wait for them', async () => {
    await enqueue(db, { ...base, userId: 'alice', entityId: 'tA', payload: { toStatus: 'in_progress' } });
    await enqueue(db, { ...base, userId: 'bob', entityId: 'tB', payload: { toStatus: 'in_progress' } });
    const sent: string[] = [];
    const send: Sender = async (i) => { sent.push(i.entityId); return { outcome: 'applied' }; };
    await replay(db, send, 'bob');
    expect(sent).toEqual(['tB']);
    expect((await db.outbox.toArray()).map((i) => i.userId)).toEqual(['alice']);
    await replay(db, send, 'alice');
    expect(sent).toEqual(['tB', 'tA']);
  });

  it('keeps the rejection code so the reason can be shown in Arabic (audit B5)', async () => {
    await enqueue(db, { ...base, entityId: 'tC', payload: { toStatus: 'in_progress' } });
    await replay(db, async () => ({ outcome: 'conflict', reason: 'Transition cancelled → in_progress is not allowed', code: 'P0422' }), 'u1');
    expect((await db.outbox.toArray())[0]?.conflictCode).toBe('P0422');
  });
});

describe('outbox — ordering within one tap', () => {
  it('changes queued in the same millisecond keep their order (create → assign → start)', async () => {
    const t = 'tq';
    await enqueue(db, { kind: 'insert', table: 'tasks', entityId: t, deviceId: 'd', userId: 'u1', row: { id: t } });
    await enqueue(db, { ...base, entityId: t, payload: { toStatus: 'assigned' } });
    await enqueue(db, { ...base, entityId: t, payload: { toStatus: 'in_progress' } });
    const order: string[] = [];
    await replay(db, async (i) => { order.push(i.kind === 'transition' ? i.payload.toStatus : i.kind); return { outcome: 'applied' }; }, 'u1');
    expect(order).toEqual(['insert', 'assigned', 'in_progress']);
  });
  it('the provisional status is the last change made', async () => {
    await enqueue(db, { ...base, entityId: 'tp', payload: { toStatus: 'assigned' } });
    await enqueue(db, { ...base, entityId: 'tp', payload: { toStatus: 'in_progress' } });
    expect(provisionalStatus(await db.outbox.toArray(), 'tp')).toBe('in_progress');
  });
});
