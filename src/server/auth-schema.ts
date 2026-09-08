import { getMigrations } from 'better-auth/db/migration';

import { auth } from '../auth';

let migration: Promise<void> | null = null;

/**
 * Better Auth's built-in SQLite adapter requires its core tables before the
 * first session or OAuth request. Cache one migration promise per process so
 * concurrent requests wait for the same schema transaction.
 */
export function ensureAuthSchema(): Promise<void> {
  if (!migration) {
    migration = getMigrations(auth.options)
      .then(async ({ runMigrations }) => {
        await runMigrations();
      })
      .catch((error: unknown) => {
        migration = null;
        throw error;
      });
  }
  return migration;
}
