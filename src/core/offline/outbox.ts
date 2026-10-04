import Dexie, { type Table } from 'dexie';

/**
 * Offline outbox (Master Prompt §3.7). Every field write is queued locally first with an idempotency
 * key and device time, then replayed: per record in device-time order, parents before children.
 * The server stores processed keys (transitions) or rejects duplicate client-generated ids (inserts),
 * so a retry over a weak link never applies twice. A replay the server rejects is kept as a visible
 * conflict; nothing is silently dropped.
 */
interface OutboxBase {
  idempotencyKey: string;
  /** Who made the change. On a shared crew phone, only this user's session may send it (audit C3). */
  userId: string;
  /** The record this change belongs to (a task for its transitions and its entries), for ordering. */
  entityId: string;
  /** Records that must be synced first (e.g. a new task before its labour entry). */
  dependsOn: string[];
  clientRecordedAt: string;
  deviceId: string;
  state: 'pending' | 'conflict';
  conflictReason?: string;
  /** Error code of the rejection, shown to the user in their language (audit B5). */
  conflictCode?: string;
  attempts: number;
}

export interface TransitionItem extends OutboxBase {
  kind: 'transition';
  entityType: string;
  payload: { toStatus: string; comment?: string; fields?: Record<string, unknown>; expectedVersion?: number };
}

export interface InsertItem extends OutboxBase {
  kind: 'insert';
  table: string;
  /** Must include a client-generated `id` so a replay is recognised as a duplicate. */
  row: Record<string, unknown> & { id: string };
}

export interface UpdateItem extends OutboxBase {
  kind: 'update';
  table: string;
  rowId: string;
  patch: Record<string, unknown>;
  expectedVersion: number;
}

export type OutboxItem = TransitionItem | InsertItem | UpdateItem;
// Distributive over the union so each kind keeps its own fields.
type NewItem<T extends OutboxItem> = T extends OutboxItem
  ? Omit<T, 'idempotencyKey' | 'state' | 'attempts' | 'clientRecordedAt' | 'dependsOn'> & { clientRecordedAt?: string; dependsOn?: string[] }
  : never;

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

export type SendResult = { outcome: 'applied' } | { outcome: 'conflict'; reason: string; code?: string };
export type Sender = (item: OutboxItem) => Promise<SendResult>;

let lastStamp = 0;

/**
 * Device time for a queued change, strictly increasing: changes made in the same millisecond (create, assign,
 * start in one tap) must replay in the order they were made, not in random key order.
 */
export function nextDeviceTime(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export async function enqueue<T extends OutboxItem>(db: FieldDatabase, item: NewItem<T>): Promise<T> {
  const full = {
    ...item,
    dependsOn: item.dependsOn ?? [],
    idempotencyKey: crypto.randomUUID(),
    clientRecordedAt: item.clientRecordedAt ?? nextDeviceTime(),
    state: 'pending',
    attempts: 0,
  } as unknown as T;
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
export async function replay(
  db: FieldDatabase,
  send: Sender,
  userId: string,
): Promise<{ applied: number; conflicts: number; networkFailed: boolean }> {
  // Only the signed-in user's own changes are sent; another user's queued work waits for that user.
  const items = replayOrder((await db.outbox.where('state').equals('pending').toArray()).filter((i) => i.userId === userId));
  let applied = 0;
  let conflicts = 0;
  let networkFailed = false;
  const blocked = new Set((await db.outbox.where('state').equals('conflict').toArray()).filter((i) => i.userId === userId).map((i) => i.entityId));

  for (const item of items) {
    if (blocked.has(item.entityId) || item.dependsOn.some((d) => blocked.has(d))) continue;
    await db.outbox.update(item.idempotencyKey, { attempts: item.attempts + 1 });
    let result: SendResult;
    try {
      result = await send(item);
    } catch {
      networkFailed = true;
      break; // offline / network: keep the rest pending, same keys next time
    }
    if (result.outcome === 'applied') {
      await db.outbox.delete(item.idempotencyKey);
      applied += 1;
    } else {
      await db.outbox.update(item.idempotencyKey, { state: 'conflict', conflictReason: result.reason, conflictCode: result.code });
      blocked.add(item.entityId);
      conflicts += 1;
    }
  }
  if (!networkFailed) await db.meta.put({ key: 'lastSyncedAt', value: new Date().toISOString() });
  return { applied, conflicts, networkFailed };
}

/** The status a record will have once its queued transitions sync (provisional, shown as pending). */
export function provisionalStatus(items: OutboxItem[], entityId: string): string | null {
  const transitions = items
    .filter((i): i is TransitionItem => i.kind === 'transition' && i.entityId === entityId && i.state === 'pending')
    .sort((a, b) => a.clientRecordedAt.localeCompare(b.clientRecordedAt));
  return transitions.at(-1)?.payload.toStatus ?? null;
}

/** A user discards a rejected change after reading the reason (rejected transitions also stay in the server's sync_conflicts). */
export async function dismissConflict(db: FieldDatabase, idempotencyKey: string): Promise<void> {
  await db.outbox.delete(idempotencyKey);
}
