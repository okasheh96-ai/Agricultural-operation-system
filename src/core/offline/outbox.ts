import Dexie, { type Table } from 'dexie';

/**
 * Offline outbox (Master Prompt §3.7). Every write is queued locally first with an idempotency key,
 * device time and base version, then replayed: per record in device-time order, parents before
 * children. The server stores processed keys, so a retry over a weak link never applies twice.
 * A replay the server rejects is kept as a visible conflict; nothing is silently dropped.
 */
export interface OutboxItem {
  idempotencyKey: string;
  kind: 'transition';
  entityType: string;
  entityId: string;
  /** Records that must be synced first (e.g. the task before its labour entry). */
  dependsOn: string[];
  payload: { toStatus: string; comment?: string; fields?: Record<string, unknown>; expectedVersion?: number };
  clientRecordedAt: string;
  deviceId: string;
  state: 'pending' | 'conflict';
  conflictReason?: string;
  attempts: number;
}

export interface SyncMeta {
  key: string;
  value: string;
}

export class FieldDatabase extends Dexie {
  outbox!: Table<OutboxItem, string>;
  meta!: Table<SyncMeta, string>;

  constructor(name = 'agri-field') {
    super(name);
    this.version(1).stores({
      outbox: 'idempotencyKey, state, entityId, clientRecordedAt',
      meta: 'key',
    });
  }
}

export type SendResult = { outcome: 'applied' } | { outcome: 'conflict'; reason: string };
export type Sender = (item: OutboxItem) => Promise<SendResult>;

export async function enqueue(
  db: FieldDatabase,
  item: Omit<OutboxItem, 'idempotencyKey' | 'state' | 'attempts' | 'clientRecordedAt'> & { clientRecordedAt?: string },
): Promise<OutboxItem> {
  const full: OutboxItem = {
    ...item,
    idempotencyKey: crypto.randomUUID(),
    clientRecordedAt: item.clientRecordedAt ?? new Date().toISOString(),
    state: 'pending',
    attempts: 0,
  };
  await db.outbox.add(full);
  return full;
}

/** Replay order: device time, but never before a pending parent record. */
export function replayOrder(items: OutboxItem[]): OutboxItem[] {
  const pending = [...items].sort((a, b) => a.clientRecordedAt.localeCompare(b.clientRecordedAt));
  const ordered: OutboxItem[] = [];
  while (pending.length > 0) {
    const waiting = new Set(pending.map((i) => i.entityId));
    const idx = pending.findIndex((i) => i.dependsOn.every((d) => d === i.entityId || !waiting.has(d)));
    // idx === -1 only for a dependency cycle; fall back to device-time order rather than stall.
    const [next] = pending.splice(idx === -1 ? 0 : idx, 1);
    if (!next) break;
    ordered.push(next);
  }
  return ordered;
}

/**
 * Sends pending items in replay order. Network failures stop the run and keep items pending
 * (retried later with the same key). Server rejections become conflicts. Later items for a record
 * whose earlier change conflicted are held back so they are not applied out of order.
 */
export async function replay(db: FieldDatabase, send: Sender): Promise<{ applied: number; conflicts: number }> {
  const items = replayOrder(await db.outbox.where('state').equals('pending').toArray());
  let applied = 0;
  let conflicts = 0;
  const blocked = new Set((await db.outbox.where('state').equals('conflict').toArray()).map((i) => i.entityId));

  for (const item of items) {
    if (blocked.has(item.entityId) || item.dependsOn.some((d) => blocked.has(d))) continue;
    await db.outbox.update(item.idempotencyKey, { attempts: item.attempts + 1 });
    let result: SendResult;
    try {
      result = await send(item);
    } catch {
      break; // offline / network: keep the rest pending, same keys next time
    }
    if (result.outcome === 'applied') {
      await db.outbox.delete(item.idempotencyKey);
      applied += 1;
    } else {
      await db.outbox.update(item.idempotencyKey, { state: 'conflict', conflictReason: result.reason });
      blocked.add(item.entityId);
      conflicts += 1;
    }
  }
  await db.meta.put({ key: 'lastSyncedAt', value: new Date().toISOString() });
  return { applied, conflicts };
}
