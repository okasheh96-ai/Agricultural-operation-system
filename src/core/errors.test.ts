import { errorKey } from './errors';

it('maps server error codes to translated messages', () => {
  expect(errorKey({ code: 'P0423' })).toBe('errors.P0423');
  expect(errorKey({ code: '42501' })).toBe('errors.42501');
  expect(errorKey({ code: '23P01' })).toBe('errors.23P01');
  expect(errorKey(new Error('boom'))).toBe('errors.unknown');
});
