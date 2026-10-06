import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * The message for a failed sign-in. "Check your email and password" is only true when the server answered; when it was
 * not reached (no network, or a forwarding login that expired) the user must reload or reconnect instead.
 */
export function signInErrorKey(error: unknown): 'auth.unreachable' | 'auth.failed' {
  return isAuthRetryableFetchError(error) ? 'auth.unreachable' : 'auth.failed';
}
