import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { signInErrorKey } from './signInError';

describe('sign-in error message', () => {
  it('says the server was not reached when the request never got an answer', () => {
    expect(signInErrorKey(new AuthRetryableFetchError('Failed to fetch', 0))).toBe('auth.unreachable');
  });

  it('asks to check email and password only when the server refused them', () => {
    expect(signInErrorKey(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'))).toBe('auth.failed');
  });
});
