import type { SupabaseClient } from '@supabase/supabase-js';
import type { Sender } from './outbox';

/** Sends one queued transition through the server's idempotent sync_transition(). */
export function supabaseSender(client: SupabaseClient): Sender {
  return async (item) => {
    const { data, error } = await client.rpc('sync_transition', {
      p_entity_type: item.entityType,
      p_id: item.entityId,
      p_to_status: item.payload.toStatus,
      p_idempotency_key: item.idempotencyKey,
      p_client_recorded_at: item.clientRecordedAt,
      p_payload: item.payload.fields ?? {},
      p_comment: item.payload.comment ?? null,
      p_expected_version: item.payload.expectedVersion ?? null,
      p_device_id: item.deviceId,
    });
    if (error) throw error; // transport/auth problem: stays pending
    const result = data as { outcome: 'applied' | 'conflict'; reason_message?: string };
    return result.outcome === 'applied' ? { outcome: 'applied' } : { outcome: 'conflict', reason: result.reason_message ?? '' };
  };
}
