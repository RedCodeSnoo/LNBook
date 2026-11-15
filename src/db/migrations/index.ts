import { migration0001 } from './0001_initial_schema';
import { migration0002 } from './0002_translation_titles';
import type { Migration, MigrationExecutor } from './types';

export type { Migration, MigrationExecutor } from './types';

/**
 * Every migration, in order. To change the schema: edit schema.ts, run `npm run db:generate`
 * to get the SQL, then add a new file here. Released migrations are never edited.
 */
export const migrations: Migration[] = [migration0001, migration0002];

export const LATEST_SCHEMA_VERSION = migrations[migrations.length - 1].version;

export class SchemaTooRecentError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(`Database schema ${found} is newer than the supported schema ${supported}`);
    this.name = 'SchemaTooRecentError';
  }
}

/**
 * Brings a database to the latest schema. Each migration runs in its own transaction,
 * so a failure leaves the database at the last version that was fully applied.
 * Returns the versions that were applied.
 */
export function runMigrations(
  db: MigrationExecutor,
  list: Migration[] = migrations,
  target: number = Number.POSITIVE_INFINITY,
): number[] {
  const current = db.getUserVersion();
  const latest = list.length > 0 ? list[list.length - 1].version : 0;
  if (current > latest) {
    throw new SchemaTooRecentError(current, latest);
  }

  const applied: number[] = [];
  for (const migration of list) {
    if (migration.version <= current || migration.version > target) {
      continue;
    }
    db.exec('BEGIN');
    try {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    applied.push(migration.version);
  }
  return applied;
}
