/**
 * Moving everything to another phone: backup → restore, table by table and file by file,
 * with a large library, merging, failures that must leave the phone untouched, the safety
 * backup, and backups and databases made by the published version (1.1.0).
 */
import { sql } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { AppDatabase } from '../../../db/client';
import { LATEST_SCHEMA_VERSION, migrations, runMigrations } from '../../../db/migrations';
import { schema } from '../../../db/schema';
import { createExecutor, createTestDatabase } from '../../../db/testing';
import { MemoryFileStore } from '../../../services/fileStore';
import { backupErrorText } from '../backupErrors';
import { BACKUP_TABLES, FILE_ROOTS, WORK_DIR, readTable, type Row } from '../backupFile';
import {
  cleanBackupWork,
  createBackupArchive,
  NotEnoughSpaceError,
  openBackupArchive,
  restoreBackupArchive,
  SafetyBackupError,
  VerificationError,
  type BackupEnv,
} from '../backupJobs';
import { restoreMerging, restoreReplacing } from '../restore';
import { legacyBackup } from './helpers/legacyBackup';
import { MemoryArchive } from './helpers/memoryArchive';

interface Phone {
  db: AppDatabase;
  sqlite: Database.Database;
  files: MemoryFileStore;
}

const newPhone = (): Phone => {
  const { db, sqlite } = createTestDatabase();
  return { db, sqlite, files: new MemoryFileStore() };
};

const bytes = (length: number, seed: number) =>
  Uint8Array.from({ length }, (_, index) => (index * 31 + seed) % 251);

/**
 * A real library: an imported EPUB with images and its stylesheet, an online novel with
 * downloaded chapters, a translation and a custom cover, real and estimated reading time,
 * history, quotes in folders (and an empty folder), shelves, a source with its settings,
 * a custom font, a glossary, replacement rules, settings and the DeepL key, plus the empty
 * folders that deleting downloads, the last font or the last source leaves behind.
 */
function seedLibrary(phone: Phone, options: { chapters?: number; imageBytes?: number } = {}) {
  const { sqlite, files } = phone;
  const chapterCount = options.chapters ?? 4;
  const imageBytes = options.imageBytes ?? 5_000;
  sqlite.exec(`
    INSERT INTO categories (id, name, position) VALUES (1, 'En cours', 0), (2, 'Favoris', 1);
    INSERT INTO plugins (id, name, lang, version, site, code_path)
      VALUES ('novelfr', 'NovelFR', 'French', '1.2.0', 'https://novel.example', 'plugins/novelfr/index.js');
    INSERT INTO plugin_repos (url, name) VALUES ('https://repo.example/plugins.json', 'Repo');
    INSERT INTO novels (id, origin, title, author, in_library, cover_path, original_cover_path, original_lang, created_at, updated_at, added_at)
      VALUES (1, 'local', 'Été à Kyōto', 'Ann Autrice', 1, 'novels/1/cover.jpg', 'novels/1/cover.jpg', 'fr', 1, 1, 1);
    INSERT INTO novels (id, origin, plugin_id, source_path, title, author, in_library, cover_path, original_cover_path, created_at, updated_at, added_at)
      VALUES (2, 'online', 'novelfr', '/novel/42', 'The Sect Leader', 'Someone', 1, 'novels/2/cover-custom-77.png', 'novels/2/cover.jpg', 1, 1, 1);
    INSERT INTO novel_categories (novel_id, category_id) VALUES (1, 1), (2, 1), (2, 2);
    INSERT INTO volumes (id, novel_id, title, position, origin) VALUES (1, 1, 'Livre 1', 0, 'toc');
    INSERT INTO quote_folders (id, name, color, position) VALUES (1, 'Théories', '#336699', 0), (2, 'Vide', '#aa0000', 1);
    INSERT INTO glossary_terms (novel_id, source_lang, target_lang, source_term, target_term)
      VALUES (2, 'en', 'fr', 'Sect Leader', 'Maître de secte');
    INSERT INTO text_replacements (novel_id, pattern, replacement) VALUES (NULL, 'ads', ''), (2, 'Mr.', 'M.');
    INSERT INTO settings (key, value) VALUES
      ('appTheme', '"dark"'), ('readerFontSize', '19'), ('language', '"fr"'),
      ('pluginStore:novelfr:token', '"abc"'), ('progressEstimate:2', '{"wpm":250}'),
      ('deeplKey', '"secret"');
  `);
  files.writeBytes('novels/1/cover.jpg', bytes(800, 1));
  files.writeText('novels/1/original.css', 'p { text-indent: 1em; }');
  files.writeBytes('novels/1/images/Image n°1 (été).jpg', bytes(imageBytes, 2));
  files.writeBytes('novels/1/images/OEBPS/fig 2.png', bytes(imageBytes, 3));
  files.writeBytes('novels/2/cover.jpg', bytes(600, 4));
  files.writeBytes('novels/2/cover-custom-77.png', bytes(700, 5));
  files.writeText('plugins/novelfr/index.js', 'module.exports = {}');
  files.writeBytes('fonts/literata-custom.ttf', bytes(3000, 6));
  files.mkdir('novels/1/translations/en');
  files.mkdir('plugins/removed-source');
  let chapterId = 0;
  for (const novelId of [1, 2]) {
    for (let position = 0; position < chapterCount; position += 1) {
      chapterId += 1;
      const downloaded = novelId === 1 || position < 2;
      const path = `novels/${novelId}/chapters/${chapterId}.html`;
      sqlite
        .prepare(
          `INSERT INTO chapters (id, novel_id, volume_id, position, number, title, source_path, file_path, is_downloaded, is_read, progress, position_anchor, word_count, read_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          chapterId,
          novelId,
          novelId === 1 ? 1 : null,
          position,
          position + 1,
          `Chapitre ${position + 1} — « ${novelId} »`,
          novelId === 2 ? `/c/${position}` : null,
          downloaded ? path : null,
          downloaded ? 1 : 0,
          position === 0 ? 1 : 0,
          position === 0 ? 1 : position === 1 ? 0.42 : 0,
          position === 1 ? '{"b":12,"o":40,"c":"le vent se lève"}' : null,
          1200 + position,
          position === 0 ? 5000 : null,
        );
      if (downloaded) {
        files.writeText(path, `<p>Texte ${novelId}-${position} ${'lorem '.repeat(30)}</p>`);
      }
    }
  }
  // Novel 2: the user deleted the downloads of its last chapters (empty folder left).
  files.mkdir('novels/2/images');
  sqlite.exec(`
    UPDATE novels SET last_read_chapter_id = 2 WHERE id = 1;
    UPDATE novels SET last_read_chapter_id = ${chapterCount + 2} WHERE id = 2;
    INSERT INTO chapter_translations (chapter_id, lang, file_path, engine, title, created_at)
      VALUES (${chapterCount + 1}, 'fr', 'novels/2/translations/fr/${chapterCount + 1}.html', 'mlkit', 'Chapitre traduit', 3);
    INSERT INTO reading_sessions (novel_id, chapter_id, started_at, ended_at, duration_ms, mode, words, lang)
      VALUES (1, 1, 1000, 61000, 60000, 'read', 1200, NULL),
             (1, 2, 70000, 100000, 30000, 'listen', 400, NULL),
             (2, ${chapterCount + 1}, 0, 0, 290000, 'estimated', 1201, 'fr');
    INSERT INTO history (novel_id, chapter_id, last_read_at, total_ms, hidden) VALUES (1, 1, 61000, 60000, 0), (1, 2, 100000, 30000, 1);
    INSERT INTO quotes (id, novel_id, chapter_id, text, anchor, lang, note, created_at)
      VALUES (1, 1, 2, 'Le vent se lève', '{"b":12}', NULL, 'à retenir', 9), (2, 2, ${chapterCount + 1}, 'Sect', '{}', 'fr', NULL, 10);
    INSERT INTO quote_folder_items (quote_id, folder_id) VALUES (1, 1), (2, 1);
  `);
  files.writeText(`novels/2/translations/fr/${chapterCount + 1}.html`, '<p>Le maître de secte</p>');
}

/** Every row of every saved table, in a stable order. */
function dumpTables(db: AppDatabase): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    out[table] = readTable(db, table)
      .filter((row) => table !== 'settings' || !/^deepl/.test(String(row.key)))
      .map((row) => JSON.stringify(row))
      .sort()
      .map((row) => JSON.parse(row) as Row);
  }
  return out;
}

/** Every file of the saved folders with its content. */
function dumpFiles(files: MemoryFileStore): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [path, content] of files.files) {
    if (FILE_ROOTS.some((root) => path.startsWith(`${root}/`))) {
      out[path] = [...content];
    }
  }
  return out;
}

function envOf(phone: Phone, zips: Map<string, Uint8Array>, extra: Partial<BackupEnv> = {}) {
  const archive = new MemoryArchive(phone.files, zips);
  const env: BackupEnv = {
    db: phone.db,
    files: phone.files,
    archive,
    schemaVersion: LATEST_SCHEMA_VERSION,
    appVersion: '1.1.1',
    now: () => 1_763_000_000_000,
    ...extra,
  };
  return { env, archive };
}

async function writeBackup(phone: Phone, zips: Map<string, Uint8Array>, uri = 'content://backup') {
  const { env } = envOf(phone, zips);
  return createBackupArchive(env, uri, {
    includeChapters: true,
    includeTranslations: true,
    localOutput: false,
  });
}

async function open(phone: Phone, zips: Map<string, Uint8Array>, uri = 'content://backup') {
  const opened = await openBackupArchive(envOf(phone, zips).env, uri);
  if (opened.kind !== 'lnbook') {
    throw new Error('not a backup');
  }
  return opened.content;
}

describe('the bug of app 1.1.0', () => {
  it('failed on every library with an empty folder; this version saves it', async () => {
    const phone = newPhone();
    seedLibrary(phone);
    // Exactly what 1.1.0 did: the empty folder is read as a file.
    expect(() =>
      legacyBackup(phone.db, phone.files, {
        schemaVersion: 2,
        appVersion: '1.1.0',
        includeChapters: true,
        includeTranslations: true,
      }),
    ).toThrow('Is a directory');
    const created = await writeBackup(phone, new Map());
    expect(created.missing).toEqual([]);
    expect(created.manifest.counts).toMatchObject({ novels: 2, chapters: 8, quotes: 2 });
  });
});

describe('moving everything to another phone', () => {
  it('restores every table and every file identically on a new phone', async () => {
    const source = newPhone();
    seedLibrary(source);
    const zips = new Map<string, Uint8Array>();
    const created = await writeBackup(source, zips);
    expect(created.manifest).toMatchObject({
      app: 'LNBook',
      schemaVersion: LATEST_SCHEMA_VERSION,
      appVersion: '1.1.1',
      checksums: 'checksums.json',
      counts: {
        novels: 2,
        chapters: 8,
        quotes: 2,
        quoteFolders: 2,
        readingSessions: 3,
        history: 2,
        plugins: 1,
        categories: 2,
        files: 15,
      },
    });
    // The work folder of the backup is gone.
    expect(source.files.list(WORK_DIR)).toEqual([]);

    const target = newPhone();
    const content = await open(target, zips);
    restoreReplacing(target.db, target.files, content);
    target.files.delete(content.stagingDir);

    expect(dumpTables(target.db)).toEqual(dumpTables(source.db));
    expect(dumpFiles(target.files)).toEqual(dumpFiles(source.files));
    // The DeepL key never leaves the phone.
    expect(readTable(target.db, 'settings').some((row) => row.key === 'deeplKey')).toBe(false);
    // Exact reading position, estimated time and quotes in their folder.
    expect(target.db.get(sql`SELECT position_anchor FROM chapters WHERE id = 2`)).toEqual({
      position_anchor: '{"b":12,"o":40,"c":"le vent se lève"}',
    });
    expect(
      target.db.all(sql`SELECT mode, duration_ms FROM reading_sessions ORDER BY started_at`),
    ).toEqual([
      { mode: 'estimated', duration_ms: 290000 },
      { mode: 'read', duration_ms: 60000 },
      { mode: 'listen', duration_ms: 30000 },
    ]);
    expect(
      target.db.all(
        sql`SELECT q.text, f.name FROM quotes q JOIN quote_folder_items i ON i.quote_id = q.id JOIN quote_folders f ON f.id = i.folder_id ORDER BY q.id`,
      ),
    ).toEqual([
      { text: 'Le vent se lève', name: 'Théories' },
      { text: 'Sect', name: 'Théories' },
    ]);
    expect(target.files.list(WORK_DIR)).toEqual([]);
  });

  it('handles a library of thousands of chapters and tens of megabytes', async () => {
    const source = newPhone();
    seedLibrary(source, { chapters: 1500, imageBytes: 12 * 1024 * 1024 });
    const zips = new Map<string, Uint8Array>();
    const created = await writeBackup(source, zips);
    expect(created.size).toBeGreaterThan(24 * 1024 * 1024);
    expect(created.manifest.counts?.chapters).toBe(3000);
    const target = newPhone();
    const content = await open(target, zips);
    restoreReplacing(target.db, target.files, content);
    expect(dumpTables(target.db)).toEqual(dumpTables(source.db));
    expect(Object.keys(dumpFiles(target.files)).sort()).toEqual(
      Object.keys(dumpFiles(source.files)).sort(),
    );
    expect(target.files.readBytes('novels/1/images/OEBPS/fig 2.png')).toEqual(
      source.files.readBytes('novels/1/images/OEBPS/fig 2.png'),
    );
  }, 60_000);

  it('makes a complete safety backup first, which undoes the restore', async () => {
    const source = newPhone();
    seedLibrary(source);
    const zips = new Map<string, Uint8Array>();
    await writeBackup(source, zips);

    const target = newPhone();
    target.sqlite.exec(
      `INSERT INTO novels (id, origin, title, created_at, updated_at) VALUES (1, 'local', 'Mon livre', 1, 1);
       INSERT INTO chapters (id, novel_id, position, title, file_path, is_downloaded, created_at) VALUES (1, 1, 0, 'Un', 'novels/1/chapters/1.html', 1, 1);`,
    );
    target.files.writeText('novels/1/chapters/1.html', '<p>Mon texte</p>');
    const before = { tables: dumpTables(target.db), files: dumpFiles(target.files) };

    const { env } = envOf(target, zips);
    const content = await open(target, zips);
    await restoreBackupArchive(env, content, 'replace', 'file:///safety.zip');
    expect(dumpTables(target.db)).toEqual(dumpTables(source.db));
    expect(target.files.list(WORK_DIR)).toEqual([]);

    // Restoring the safety backup brings the phone back as it was.
    const safety = await open(target, zips, 'file:///safety.zip');
    restoreReplacing(target.db, target.files, safety);
    target.files.delete(safety.stagingDir);
    expect(dumpTables(target.db)).toEqual(before.tables);
    expect(dumpFiles(target.files)).toEqual(before.files);
  });

  it('restores nothing when the safety backup cannot be made', async () => {
    const source = newPhone();
    seedLibrary(source);
    const zips = new Map<string, Uint8Array>();
    await writeBackup(source, zips);
    const target = newPhone();
    target.sqlite.exec(
      `INSERT INTO novels (origin, title, created_at, updated_at) VALUES ('local', 'Mon livre', 1, 1)`,
    );
    const before = dumpTables(target.db);
    const content = await open(target, zips);
    const { env } = envOf(target, zips, { freeSpace: () => 1024 });
    const failure = restoreBackupArchive(env, content, 'replace', 'file:///safety.zip');
    await expect(failure).rejects.toBeInstanceOf(SafetyBackupError);
    expect(dumpTables(target.db)).toEqual(before);
    expect(target.files.exists(content.stagingDir)).toBe(false);
  });

  it('leaves the phone untouched when the restore fails half way', async () => {
    const source = newPhone();
    seedLibrary(source);
    const zips = new Map<string, Uint8Array>();
    await writeBackup(source, zips);
    const target = newPhone();
    target.sqlite.exec(
      `INSERT INTO novels (id, origin, title, created_at, updated_at) VALUES (1, 'local', 'Mon livre', 1, 1)`,
    );
    target.files.writeText('novels/1/cover.jpg', 'ma couverture');
    target.files.writeText('fonts/mine.ttf', 'ma police');
    const before = { tables: dumpTables(target.db), files: dumpFiles(target.files) };
    const content = await open(target, zips);
    // A row the database refuses (title is required): the transaction fails.
    content.tables.chapters[3] = { ...content.tables.chapters[3], title: null };
    expect(() => restoreReplacing(target.db, target.files, content)).toThrow();
    expect(dumpTables(target.db)).toEqual(before.tables);
    expect(dumpFiles(target.files)).toEqual(before.files);
  });
});

describe('merging into a phone that has data', () => {
  it('keeps the most advanced progress, adds the missing activity, and never duplicates', async () => {
    const source = newPhone();
    seedLibrary(source);
    // On the other phone, the same online novel was read further, with a new quote.
    const target = newPhone();
    target.sqlite.exec(`
      INSERT INTO novels (id, origin, plugin_id, source_path, title, in_library, created_at, updated_at)
        VALUES (1, 'online', 'novelfr', '/novel/42', 'The Sect Leader', 1, 1, 1);
      INSERT INTO chapters (id, novel_id, position, title, source_path, is_read, progress, created_at)
        VALUES (1, 1, 0, 'C1', '/c/0', 0, 0.3, 1), (2, 1, 1, 'C2', '/c/1', 1, 1, 1), (3, 1, 2, 'C3', '/c/2', 0, 0, 1), (4, 1, 3, 'C4', '/c/3', 0, 0, 1);
      INSERT INTO reading_sessions (novel_id, chapter_id, started_at, ended_at, duration_ms, mode)
        VALUES (1, 2, 500000, 560000, 60000, 'read');
      INSERT INTO quote_folders (id, name, color, position) VALUES (1, 'théories', '#000000', 0);
      INSERT INTO quotes (id, novel_id, chapter_id, text, anchor, created_at) VALUES (1, 1, 2, 'Mine', '{}', 1);
      INSERT INTO settings (key, value) VALUES ('appTheme', '"light"');
    `);
    const zips = new Map<string, Uint8Array>();
    await writeBackup(source, zips);

    const first = restoreMerging(target.db, target.files, await open(target, zips));
    expect(first).toMatchObject({ novelsAdded: 1, novelsUpdated: 1 });
    const afterFirst = dumpTables(target.db);
    // Merging the same backup again adds nothing.
    const second = restoreMerging(target.db, target.files, await open(target, zips));
    expect(second).toMatchObject({ novelsAdded: 0 });
    expect(dumpTables(target.db)).toEqual(afterFirst);

    const chaptersOfShared = target.db.all<Row>(
      sql`SELECT position, is_read, progress FROM chapters WHERE novel_id = 1 ORDER BY position`,
    );
    expect(chaptersOfShared).toEqual([
      { position: 0, is_read: 1, progress: 1 },
      { position: 1, is_read: 1, progress: 1 },
      { position: 2, is_read: 0, progress: 0 },
      { position: 3, is_read: 0, progress: 0 },
    ]);
    // The estimated time of the other phone is added (no real time on that chapter here).
    expect(
      target.db.all(
        sql`SELECT chapter_id, mode FROM reading_sessions WHERE novel_id = 1 ORDER BY chapter_id`,
      ),
    ).toEqual([
      { chapter_id: 1, mode: 'estimated' },
      { chapter_id: 2, mode: 'read' },
    ]);
    // Both quotes, the folder matched by name (not duplicated).
    expect(target.db.all(sql`SELECT text FROM quotes WHERE novel_id = 1 ORDER BY text`)).toEqual([
      { text: 'Mine' },
      { text: 'Sect' },
    ]);
    expect(target.db.all(sql`SELECT name FROM quote_folders ORDER BY id`)).toEqual([
      { name: 'théories' },
      { name: 'Vide' },
    ]);
    // The novel the phone did not have comes with its files, under its new id.
    const added = target.db.get<Row>(
      sql`SELECT id, cover_path FROM novels WHERE title = 'Été à Kyōto'`,
    );
    expect(added.cover_path).toBe(`novels/${String(added.id)}/cover.jpg`);
    expect(target.files.readBytes(String(added.cover_path))).toEqual(
      source.files.readBytes('novels/1/cover.jpg'),
    );
    // Settings of the phone win.
    expect(target.db.get(sql`SELECT value FROM settings WHERE key = 'appTheme'`)).toEqual({
      value: '"light"',
    });
  });
});

describe('backups and databases of the published version', () => {
  it('keeps every row of a database created by app 1.1.0', () => {
    // Schema of app 1.1.0 (the published version): migrations 1 and 2.
    const published = migrations.filter((migration) => migration.version <= 2);
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    runMigrations(createExecutor(sqlite), published);
    const db = drizzle(sqlite, { schema }) as unknown as AppDatabase;
    const phone: Phone = { db, sqlite, files: new MemoryFileStore() };
    seedLibrary(phone);
    const before = dumpTables(db);
    const downloads = sqlite.prepare('SELECT count(*) AS n FROM downloads').get();
    // What this version does at launch.
    runMigrations(createExecutor(sqlite));
    expect(sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    expect(dumpTables(db)).toEqual(before);
    expect(sqlite.prepare('SELECT count(*) AS n FROM downloads').get()).toEqual(downloads);
  });

  it('restores a backup made by app 1.1.0', async () => {
    const source = newPhone();
    seedLibrary(source);
    source.files.delete('novels/1/translations');
    source.files.delete('plugins/removed-source');
    source.files.delete('novels/2/images');
    const zips = new Map<string, Uint8Array>([
      [
        'content://old',
        legacyBackup(source.db, source.files, {
          schemaVersion: 2,
          appVersion: '1.1.0',
          includeChapters: true,
          includeTranslations: true,
        }),
      ],
    ]);
    const target = newPhone();
    const content = await open(target, zips, 'content://old');
    expect(content.manifest.checksums).toBeUndefined();
    restoreReplacing(target.db, target.files, content);
    expect(dumpTables(target.db)).toEqual(dumpTables(source.db));
    expect(dumpFiles(target.files)).toEqual(dumpFiles(source.files));
  });

  it('restores a backup of an older schema into the current one', async () => {
    // Schema 1: translations had no title yet.
    const old = createTestDatabase({ target: 1 });
    const source: Phone = { ...old, files: new MemoryFileStore() };
    source.sqlite.exec(`
      INSERT INTO novels (id, origin, title, created_at, updated_at) VALUES (1, 'local', 'Vieux', 1, 1);
      INSERT INTO chapters (id, novel_id, position, title, created_at) VALUES (1, 1, 0, 'Un', 1);
      INSERT INTO chapter_translations (chapter_id, lang, file_path, engine, created_at) VALUES (1, 'fr', 'novels/1/translations/fr/1.html', 'mlkit', 1);
    `);
    source.files.writeText('novels/1/translations/fr/1.html', '<p>Un</p>');
    const zips = new Map<string, Uint8Array>([
      [
        'content://old',
        legacyBackup(source.db, source.files, {
          schemaVersion: 1,
          appVersion: '0.5.0',
          includeChapters: true,
          includeTranslations: true,
        }),
      ],
    ]);
    const target = newPhone();
    restoreReplacing(target.db, target.files, await open(target, zips, 'content://old'));
    expect(target.db.all(sql`SELECT lang, title FROM chapter_translations`)).toEqual([
      { lang: 'fr', title: null },
    ]);
  });
});

describe('checks and errors', () => {
  it('only reports success after reading the backup back', async () => {
    const phone = newPhone();
    seedLibrary(phone);
    const zips = new Map<string, Uint8Array>();
    const { env, archive } = envOf(phone, zips);
    archive.damageNextRead = true;
    const failure = createBackupArchive(env, 'content://backup', {
      includeChapters: true,
      includeTranslations: true,
      localOutput: false,
    });
    await expect(failure).rejects.toBeInstanceOf(VerificationError);
  });

  it('refuses a damaged backup without touching the phone', async () => {
    const source = newPhone();
    seedLibrary(source);
    const zips = new Map<string, Uint8Array>();
    await writeBackup(source, zips);
    const target = newPhone();
    const { env, archive } = envOf(target, zips);
    archive.damageNextRead = true;
    await expect(openBackupArchive(env, 'content://backup')).rejects.toMatchObject({
      code: 'corrupted',
    });
    expect(target.files.files.size).toBe(0);
  });

  it('checks the free space before writing on the phone', async () => {
    const phone = newPhone();
    seedLibrary(phone);
    const { env } = envOf(phone, new Map(), { freeSpace: () => 10 * 1024 * 1024 });
    const failure = createBackupArchive(env, 'file:///cache/backup.zip', {
      includeChapters: true,
      includeTranslations: true,
      localOutput: true,
    });
    await expect(failure).rejects.toBeInstanceOf(NotEnoughSpaceError);
    expect(phone.files.list(WORK_DIR)).toEqual([]);
  });

  it('says what went wrong in plain words', () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key;
    const native = Object.assign(
      new Error(
        "Call to function 'LnbookBackup.writeBackupZip' has been rejected.\n→ Caused by: IOException: write failed: ENOSPC (No space left on device)",
      ),
      { code: 'ERR_BACKUP_NO_SPACE' },
    );
    expect(backupErrorText(native, t)).toEqual({
      message: 'backup.errors.noSpace',
      detail: 'IOException: write failed: ENOSPC (No space left on device)',
    });
    const permission = Object.assign(new Error('SecurityException: Permission Denial'), {
      code: 'ERR_BACKUP_PERMISSION',
    });
    expect(backupErrorText(new SafetyBackupError(permission), t).message).toBe(
      'backup.errors.safety {"reason":"backup.errors.permission"}',
    );
    expect(backupErrorText(new Error('boom'), t)).toEqual({
      message: 'backup.errors.unknown',
      detail: 'boom',
    });
  });

  it('cleans what an interrupted backup left, but keeps data moved aside by a restore', () => {
    const files = new MemoryFileStore();
    files.writeText(`${WORK_DIR}/create-1/data/novels.json`, '[]');
    files.writeText(`${WORK_DIR}/restore-2/previous/novels/1/cover.jpg`, 'x');
    cleanBackupWork(files);
    expect(files.exists(`${WORK_DIR}/create-1`)).toBe(false);
    expect(files.exists(`${WORK_DIR}/restore-2/previous/novels/1/cover.jpg`)).toBe(true);
  });
});
