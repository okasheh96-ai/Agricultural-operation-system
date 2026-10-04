import { FieldDatabase } from './outbox';

/** The device's local store. Cleared on sign-out and when the device is revoked (§3.6a). */
export const fieldDb = new FieldDatabase();
