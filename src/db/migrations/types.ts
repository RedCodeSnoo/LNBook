export interface Migration {
  /** Schema version reached once the migration is applied (PRAGMA user_version). */
  version: number;
  name: string;
  /** SQL statements. They only add tables, columns or indexes: no data is ever destroyed. */
  statements: string[];
}

/** Minimal database access needed to migrate; implemented for expo-sqlite and for the tests. */
export interface MigrationExecutor {
  exec(sql: string): void;
  getUserVersion(): number;
}
