/** In-memory database for Jest tests (better-sqlite3 instead of expo-sqlite). */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDatabase } from './client';
import { runMigrations, type Migration, type MigrationExecutor } from './migrations';
import { schema } from './schema';

export function createExecutor(sqlite: Database.Database): MigrationExecutor {
  return {
    exec: (sql) => {
      sqlite.exec(sql);
    },
    getUserVersion: () => sqlite.pragma('user_version', { simple: true }) as number,
  };
}

export function createTestDatabase(options: { migrations?: Migration[]; target?: number } = {}) {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(createExecutor(sqlite), options.migrations, options.target);
  // Both drivers expose the same synchronous query builder API.
  const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;
  return { sqlite, db };
}
