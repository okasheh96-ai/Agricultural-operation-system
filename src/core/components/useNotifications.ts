import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '@/core/supabase';

export interface NotificationRow {
  id: string;
  kind: string;
  entity_type: string;
  entity_id: string;
  params: Record<string, string>;
  created_at: string;
  read_at: string | null;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('notifications')
        .select('id, kind, entity_type, entity_id, params, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(50)
        .returns<NotificationRow[]>();
      if (error) throw error;
      return data;
    },
  });
}
