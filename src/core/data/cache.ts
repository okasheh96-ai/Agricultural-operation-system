import { fieldDb } from '@/core/offline/fieldDb';

/**
 * Network-first read with a device copy for weak or no connectivity (§3.7 working set). The copy is a
 * read cache of server data, never treated as the source of truth; writes go through the outbox.
 */
export async function withDeviceCache<T>(key: string, load: () => Promise<T>): Promise<T> {
  // Known offline: answer from the device at once (the API client would otherwise retry with backoff first).
  if (!navigator.onLine) {
    const cached = await fieldDb.meta.get(`cache:${key}`);
    if (cached) return (JSON.parse(cached.value) as { data: T }).data;
  }
  try {
    const fresh = await load();
    await fieldDb.meta.put({ key: `cache:${key}`, value: JSON.stringify({ at: new Date().toISOString(), data: fresh }) });
    return fresh;
  } catch (e) {
    const cached = await fieldDb.meta.get(`cache:${key}`);
    if (cached) return (JSON.parse(cached.value) as { data: T }).data;
    throw e;
  }
}
