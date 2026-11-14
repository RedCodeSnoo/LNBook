import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

import { runMigrations } from './migrations';
import { schema } from './schema';

export const DATABASE_NAME = 'lnbook.db';

export type AppDatabase = ExpoSQLiteDatabase<typeof schema>;

let sqlite: SQLiteDatabase | null = null;
let database: AppDatabase | null = null;

/** Opens the database and applies pending migrations. Safe to call several times. */
export function openAppDatabase(): AppDatabase {
  if (database) {
    return database;
  }
  const connection = openDatabaseSync(DATABASE_NAME);
  connection.execSync('PRAGMA journal_mode = WAL');
  connection.execSync('PRAGMA foreign_keys = ON');
  runMigrations({
    exec: (sql) => connection.execSync(sql),
    getUserVersion: () =>
      connection.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0,
  });
  sqlite = connection;
  database = drizzle(connection, { schema });
  return database;
}

/** The opened database. `openAppDatabase` must have been called at startup. */
export function getDb(): AppDatabase {
  return database ?? openAppDatabase();
}

/** Closes the connection (before replacing the database file during a restore). */
export function closeAppDatabase(): void {
  sqlite?.closeSync();
  sqlite = null;
  database = null;
}

/** Replaces the database used by `getDb` (tests only). */
export function setDbForTests(db: AppDatabase | null): void {
  database = db;
}
