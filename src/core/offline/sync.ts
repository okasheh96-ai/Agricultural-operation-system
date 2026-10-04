import type { QueryClient } from '@tanstack/react-query';
import { fieldDb } from './fieldDb';
import { enqueue, replay, type InsertItem, type TransitionItem, type UpdateItem } from './outbox';
import { supabaseSender } from './supabaseSender';
import { requireSupabase } from '@/core/supabase';

const DEVICE_KEY = 'agri.deviceId';

/** A per-install identifier recorded with each change (device, not person — §3.8). */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

let currentUser: string | null = null;

/** Set by the auth layer on every session change: queued changes are attributed to, and sent by, this user. */
export function setSyncUser(userId: string | null): void {
  currentUser = userId;
}

let running: Promise<void> | null = null;
let again = false;
let retryTimer: number | undefined;
let retryStep = 0;
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000];

/**
 * Replays the outbox now (no-op while offline) and refreshes affected queries.
 * - A request arriving while a run is in progress triggers one more run, so a reconnect is never swallowed.
 * - Browsers report "online" before the link is usable (and weak links drop requests), so a run that
 *   stops on a network error is retried with backoff instead of waiting for the next periodic sync.
 * - Query invalidation is not awaited: offline, TanStack pauses refetches, and awaiting them would keep
 *   this run "in progress" until reconnect — exactly when the next run must start.
 */
export function syncNow(queryClient: QueryClient, opts: { assumeOnline?: boolean } = {}): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  let networkFailed = false;
  // The "online" event is itself the signal: navigator.onLine can still read false while it is dispatched.
  let assumeOnline = opts.assumeOnline ?? false;
  const loop = async () => {
    do {
      again = false;
      // Only the signed-in user's own changes are sent (shared crew phone, audit C3); nobody signed in → nothing.
      const user = currentUser;
      if (user && (assumeOnline || navigator.onLine)) networkFailed = (await replay(fieldDb, supabaseSender(requireSupabase()), user)).networkFailed;
      assumeOnline = false;
    } while (again);
  };
  // Cleanup must run after `running` is assigned. Offline, loop() finishes without awaiting anything, so a
  // try/finally inside it would clear `running` before the assignment and leave a settled promise behind,
  // blocking every later sync. `.finally()` callbacks always run asynchronously.
  running = loop().finally(() => {
    running = null;
    window.clearTimeout(retryTimer);
    if (networkFailed) {
      // Back off while the link is unusable; the next "online" event or periodic run also retries.
      retryTimer = window.setTimeout(() => void syncNow(queryClient), RETRY_DELAYS_MS[Math.min(retryStep, RETRY_DELAYS_MS.length - 1)]);
      retryStep += 1;
    } else {
      retryStep = 0;
    }
    void queryClient.invalidateQueries();
  });
  return running;
}

export function installAutoSync(queryClient: QueryClient): () => void {
  const onOnline = () => void syncNow(queryClient, { assumeOnline: true });
  window.addEventListener('online', onOnline);
  const timer = window.setInterval(() => void syncNow(queryClient), 60_000);
  return () => {
    window.removeEventListener('online', onOnline);
    window.clearInterval(timer);
  };
}

type Queued<T> = Omit<T, 'idempotencyKey' | 'state' | 'attempts' | 'clientRecordedAt' | 'dependsOn' | 'deviceId' | 'kind' | 'userId'> & { dependsOn?: string[] };

function signedInUser(): string {
  if (!currentUser) throw new Error('No signed-in user for queued change');
  return currentUser;
}

/** All field writes go through the outbox first, then sync immediately when online. */
export async function queueTransition(qc: QueryClient, item: Queued<TransitionItem>): Promise<void> {
  await enqueue<TransitionItem>(fieldDb, { ...item, kind: 'transition', deviceId: deviceId(), userId: signedInUser() });
  await qc.invalidateQueries({ queryKey: ['outbox'] });
  await syncNow(qc);
}

export async function queueInsert(qc: QueryClient, item: Queued<InsertItem>): Promise<void> {
  await enqueue<InsertItem>(fieldDb, { ...item, kind: 'insert', deviceId: deviceId(), userId: signedInUser() });
  await qc.invalidateQueries({ queryKey: ['outbox'] });
  await syncNow(qc);
}

export async function queueUpdate(qc: QueryClient, item: Queued<UpdateItem>): Promise<void> {
  await enqueue<UpdateItem>(fieldDb, { ...item, kind: 'update', deviceId: deviceId(), userId: signedInUser() });
  await qc.invalidateQueries({ queryKey: ['outbox'] });
  await syncNow(qc);
}
