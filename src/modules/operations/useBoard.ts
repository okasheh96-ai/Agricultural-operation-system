import { useQuery } from '@tanstack/react-query';
import { loadBoard, type TaskBoardRow } from '@/core/data/tasks';

export type Bucket = 'planned' | 'inProgress' | 'blocked' | 'overdue' | 'pendingVerification' | 'done';
export const BUCKETS: Bucket[] = ['planned', 'inProgress', 'blocked', 'overdue', 'pendingVerification', 'done'];

export function inBucket(t: TaskBoardRow, b: Bucket): boolean {
  switch (b) {
    case 'planned': return t.status === 'planned' || t.status === 'assigned' || t.status === 'draft';
    case 'inProgress': return t.status === 'in_progress';
    case 'blocked': return t.status === 'blocked';
    case 'overdue': return t.is_overdue;
    case 'pendingVerification': return t.status === 'pending_verification';
    case 'done': return ['completed', 'verified', 'closed'].includes(t.status);
  }
}

export function useBoard(date: string) {
  return useQuery({ queryKey: ['board', date], queryFn: () => loadBoard(date), refetchInterval: 60_000 });
}
