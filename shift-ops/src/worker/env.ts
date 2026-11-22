export interface Env {
  DB: D1Database;
  RESTORE_DB: D1Database;
  ORIGINALS: R2Bucket;
  BACKUPS: R2Bucket;
  ASSETS: Fetcher;
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
  AUTH_MODE: 'access' | 'dev';
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  OWNER_EMAIL: string;
  TIMEZONE: string;
}
