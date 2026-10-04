import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/core/auth/AuthProvider';
import { fieldDb } from './fieldDb';

/** Live view of the signed-in user's own queued changes and conflicts (provisional display). */
export function useOutbox() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['outbox', userId],
    queryFn: async () => (await fieldDb.outbox.toArray()).filter((i) => i.userId === userId),
    networkMode: 'always',
  });
}

/** Changes on this device that belong to other users (shared crew phone); they wait for those users. */
export function useOthersOutbox() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['outbox-others', userId],
    queryFn: async () => (await fieldDb.outbox.toArray()).filter((i) => i.userId !== userId).length,
    networkMode: 'always',
  });
}
