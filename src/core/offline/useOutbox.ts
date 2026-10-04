import { useQuery } from '@tanstack/react-query';
import { fieldDb } from './fieldDb';

/** Live view of the device outbox (pending changes and conflicts) for provisional display. */
export function useOutbox() {
  return useQuery({ queryKey: ['outbox'], queryFn: () => fieldDb.outbox.toArray(), networkMode: 'always' });
}
