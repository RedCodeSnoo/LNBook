import Database from 'better-sqlite3';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';

import {
  LATEST_SCHEMA_VERSION,
  migrations,
  runMigrations,
  SchemaTooRecentError,
  type Migration,
} from '../migrations';
import { schema } from '../schema';
import { createExecutor, createTestDatabase } from '../testing';

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

function columnsOf(sqlite: Database.Database, table: string): ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info(\`${table}\`)`).all() as ColumnInfo[];
}

/** Inserts one row in every table of a database at schema version 1. */
function seedVersion1(sqlite: Database.Database): void {
  sqlite.exec(`
    INSERT INTO novels (id, origin, title, created_at, updated_at) VALUES (1, 'local', 'Novel', 1, 1);
    INSERT INTO volumes (id, novel_id, title, position, origin) VALUES (1, 1, 'Volume 1', 0, 'toc');
    INSERT INTO chapters (id, novel_id, volume_id, position, title, progress)
      VALUES (1, 1, 1, 0, 'Chapter 1', 0.5);
    INSERT INTO chapter_translations (chapter_id, lang, file_path, engine, created_at)
      VALUES (1, 'fr', 'c1.fr.html', 'mlkit', 1);
    INSERT INTO glossary_terms (novel_id, source_lang, target_lang, source_term, target_term)
      VALUES (1, 'en', 'fr', 'Sect Leader', 'Maître de secte');
    INSERT INTO categories (id, name, position) VALUES (1, 'Reading', 0);
    INSERT INTO novel_categories (novel_id, category_id) VALUES (1, 1);
    INSERT INTO reading_sessions (novel_id, chapter_id, started_at, ended_at, duration_ms, mode)
      VALUES (1, 1, 1000, 61000, 60000, 'read');
    INSERT INTO history (novel_id, chapter_id, last_read_at, total_ms) VALUES (1, 1, 61000, 60000);
    INSERT INTO quotes (id, novel_id, chapter_id, text, anchor, created_at)
      VALUES (1, 1, 1, 'A quote', '{}', 1);
    INSERT INTO quote_folders (id, name, color, position) VALUES (1, 'Theories', '#ff0000', 0);
    INSERT INTO quote_folder_items (quote_id, folder_id) VALUES (1, 1);
    INSERT INTO plugins (id, name, lang, version, site, code_path)
      VALUES ('novelfrance', 'NovelFrance', 'French', '1.0.0', 'https://example.org', 'p.js');
    INSERT INTO plugin_repos (url, name) VALUES ('https://example.org/plugins.json', 'Repo');
    INSERT INTO downloads (chapter_id, created_at) VALUES (1, 1);
    INSERT INTO text_replacements (pattern) VALUES ('ads');
    INSERT INTO settings (key, value) VALUES ('theme', '"dark"');
  `);
}

describe('database migrations', () => {
  it('have strictly increasing versions starting at 1', () => {
    expect(migrations[0].version).toBe(1);
    migrations.forEach((migration, index) => {
      expect(migration.version).toBe(index + 1);
      expect(migration.statements.length).toBeGreaterThan(0);
    });
  });

  it('never drop or rename anything', () => {
    for (const migration of migrations) {
      for (const statement of migration.statements) {
        expect(statement).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
        expect(statement).not.toMatch(/\bRENAME\b/i);
        expect(statement).not.toMatch(/\bDELETE\s+FROM\b/i);
      }
    }
  });

  it('bring a new database to the latest version', () => {
    const { sqlite } = createTestDatabase();
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
  });

  it('are idempotent once applied', () => {
    const { sqlite } = createTestDatabase();
    expect(runMigrations(createExecutor(sqlite))).toEqual([]);
  });

  it('produce exactly the tables and columns of the Drizzle schema', () => {
    const { sqlite } = createTestDatabase();
    const tables = Object.values(schema) as SQLiteTable[];

    const tableNames = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(tableNames.sort()).toEqual(tables.map((table) => getTableConfig(table).name).sort());

    for (const table of tables) {
      const config = getTableConfig(table);
      const actual = columnsOf(sqlite, config.name);
      expect(actual.map((column) => column.name).sort()).toEqual(
        config.columns.map((column) => column.name).sort(),
      );
      for (const column of config.columns) {
        const found = actual.find((candidate) => candidate.name === column.name);
        expect(found?.type.toLowerCase()).toBe(column.getSQLType().toLowerCase());
        // SQLite does not report NOT NULL for an implicit rowid primary key.
        if (!column.primary) {
          expect(Boolean(found?.notnull)).toBe(column.notNull);
        }
      }
    }
  });

  it('keep existing rows when upgrading from every previous schema version', () => {
    for (let from = 1; from <= LATEST_SCHEMA_VERSION; from += 1) {
      const { sqlite } = createTestDatabase({ target: from });
      expect(sqlite.pragma('user_version', { simple: true })).toBe(from);
      if (from === 1) {
        seedVersion1(sqlite);
      }
      const before = from === 1 ? countRows(sqlite) : null;

      runMigrations(createExecutor(sqlite));

      expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
      if (before) {
        expect(countRows(sqlite)).toEqual(before);
        expect(sqlite.prepare('SELECT progress FROM chapters WHERE id = 1').get()).toEqual({
          progress: 0.5,
        });
      }
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    }
  });

  it('roll back a failing migration and keep the previous version', () => {
    const sqlite = new Database(':memory:');
    const broken: Migration[] = [
      { version: 1, name: 'ok', statements: ['CREATE TABLE a (id integer)'] },
      {
        version: 2,
        name: 'broken',
        statements: ['CREATE TABLE b (id integer)', 'THIS IS NOT SQL'],
      },
    ];
    expect(() => runMigrations(createExecutor(sqlite), broken)).toThrow(/Migration 2 \(broken\)/);
    expect(sqlite.pragma('user_version', { simple: true })).toBe(1);
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(tables).toEqual([{ name: 'a' }]);
  });

  it('refuse a database created by a newer version of the app', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(createExecutor(sqlite))).toThrow(SchemaTooRecentError);
  });
});

function countRows(sqlite: Database.Database): Record<string, number> {
  const counts: Record<string, number> = {};
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    counts[name] = (
      sqlite.prepare(`SELECT count(*) AS n FROM \`${name}\``).get() as { n: number }
    ).n;
  }
  return counts;
}
