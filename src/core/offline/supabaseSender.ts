import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { Sender, SendResult } from './outbox';

/** A database/API rejection (SQLSTATE or PostgREST code) vs a transport failure that should be retried. */
function classify(error: PostgrestError): SendResult | 'retry' {
  if (/^[0-9A-Z]{5}$/.test(error.code) || error.code.startsWith('PGRST')) {
    return { outcome: 'conflict', reason: error.message };
  }
  return 'retry';
}

export function supabaseSender(client: SupabaseClient): Sender {
  return async (item) => {
    if (item.kind === 'transition') {
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
    }

    if (item.kind === 'insert') {
      const { error } = await client.from(item.table).insert({ ...item.row, client_recorded_at: item.clientRecordedAt });
      if (!error) return { outcome: 'applied' };
      if (error.code === '23505' && error.message.includes('_pkey')) return { outcome: 'applied' }; // replayed insert
      const c = classify(error);
      if (c === 'retry') throw error;
      return c;
    }

    const { data, error } = await client
      .from(item.table)
      .update({ ...item.patch, version: item.expectedVersion })
      .eq('id', item.rowId)
      .select('id');
    if (error) {
      const c = classify(error);
      if (c === 'retry') throw error;
      return c;
    }
    return data.length === 1 ? { outcome: 'applied' } : { outcome: 'conflict', reason: 'Record not found or not editable' };
  };
}
