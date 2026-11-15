/**
 * Drizzle schema of the app database.
 *
 * Rules:
 * - columns are never removed or renamed, only added (see src/db/migrations);
 * - timestamps are Unix milliseconds;
 * - booleans are stored as 0 / 1.
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const bool = (name: string, fallback = false) =>
  integer(name, { mode: 'boolean' }).notNull().default(fallback);

export type NovelOrigin = 'local' | 'online';
export type VolumeOrigin = 'toc' | 'detected' | 'manual';
export type TranslationEngine = 'mlkit' | 'deepl';
/** 'estimated': time set with "Set my progress", without real reading date. */
export type SessionMode = 'read' | 'listen' | 'estimated';
export type DownloadStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed';

export const novels = sqliteTable(
  'novels',
  {
    id: id(),
    origin: text('origin').$type<NovelOrigin>().notNull(),
    pluginId: text('plugin_id'),
    sourcePath: text('source_path'),
    title: text('title').notNull(),
    author: text('author'),
    description: text('description'),
    coverPath: text('cover_path'),
    /** Cover as provided by the source or the imported file, kept to undo a custom cover. */
    originalCoverPath: text('original_cover_path'),
    status: text('status'),
    /** Comma separated list. */
    genres: text('genres'),
    originalLang: text('original_lang'),
    /** Language currently chosen for reading, listening and exporting (null = original). */
    readingLang: text('reading_lang'),
    translationEngine: text('translation_engine').$type<TranslationEngine>(),
    inLibrary: bool('in_library'),
    lastReadChapterId: integer('last_read_chapter_id'),
    lastReadAt: integer('last_read_at'),
    totalReadMs: integer('total_read_ms').notNull().default(0),
    /** JSON array of field names edited by the user; a source refresh must not overwrite them. */
    editedFields: text('edited_fields').notNull().default('[]'),
    /** JSON object of reader settings specific to this novel (null = global settings). */
    readerSettings: text('reader_settings'),
    notifyUpdates: bool('notify_updates', true),
    autoDownload: bool('auto_download'),
    lastCheckedAt: integer('last_checked_at'),
    /** Time of the most recent chapter added by an update check. */
    lastUpdatedAt: integer('last_updated_at'),
    addedAt: integer('added_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('novels_library_idx').on(table.inLibrary, table.origin),
    index('novels_source_idx').on(table.pluginId, table.sourcePath),
  ],
);

export const volumes = sqliteTable(
  'volumes',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    origin: text('origin').$type<VolumeOrigin>().notNull(),
  },
  (table) => [index('volumes_novel_idx').on(table.novelId, table.position)],
);

export const chapters = sqliteTable(
  'chapters',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    volumeId: integer('volume_id').references(() => volumes.id, { onDelete: 'set null' }),
    position: integer('position').notNull(),
    number: real('number'),
    title: text('title').notNull(),
    sourcePath: text('source_path'),
    filePath: text('file_path'),
    /** Copy of the source content, kept when the user edits a chapter. */
    originalFilePath: text('original_file_path'),
    isDownloaded: bool('is_downloaded'),
    isRead: bool('is_read'),
    readAt: integer('read_at'),
    progress: real('progress').notNull().default(0),
    /** JSON anchor: paragraph offset, character offset and 30 characters of context. */
    positionAnchor: text('position_anchor'),
    readMs: integer('read_ms').notNull().default(0),
    isFavorite: bool('is_favorite'),
    releaseTime: text('release_time'),
    isEdited: bool('is_edited'),
    wordCount: integer('word_count'),
    /** Set when an update check discovers the chapter (drives the Updates tab). */
    foundAt: integer('found_at'),
    createdAt: integer('created_at').notNull().default(0),
  },
  (table) => [
    index('chapters_novel_idx').on(table.novelId, table.position),
    index('chapters_volume_idx').on(table.volumeId),
    index('chapters_found_idx').on(table.foundAt),
  ],
);

export const chapterTranslations = sqliteTable(
  'chapter_translations',
  {
    chapterId: integer('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    filePath: text('file_path').notNull(),
    engine: text('engine').$type<TranslationEngine>().notNull(),
    createdAt: integer('created_at').notNull(),
    /** Translated title of the chapter. */
    title: text('title'),
  },
  (table) => [primaryKey({ columns: [table.chapterId, table.lang] })],
);

export const glossaryTerms = sqliteTable(
  'glossary_terms',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    sourceTerm: text('source_term').notNull(),
    /** Same as the source term for "do not translate". */
    targetTerm: text('target_term').notNull(),
  },
  (table) => [index('glossary_novel_idx').on(table.novelId)],
);

export const categories = sqliteTable('categories', {
  id: id(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  /** Novels of an excluded category are skipped by the new chapter check. */
  excludeFromUpdates: bool('exclude_from_updates'),
});

export const novelCategories = sqliteTable(
  'novel_categories',
  {
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.novelId, table.categoryId] })],
);

export const readingSessions = sqliteTable(
  'reading_sessions',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    mode: text('mode').$type<SessionMode>().notNull(),
    words: integer('words').notNull().default(0),
    /** Language that was displayed (null = original). */
    lang: text('lang'),
    /** False once the progress was reset without keeping the times in the novel totals. */
    countsForProgress: bool('counts_for_progress', true),
  },
  (table) => [
    index('sessions_novel_idx').on(table.novelId, table.startedAt),
    index('sessions_chapter_idx').on(table.chapterId),
    index('sessions_started_idx').on(table.startedAt),
  ],
);

export const history = sqliteTable(
  'history',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    chapterId: integer('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    lastReadAt: integer('last_read_at').notNull(),
    totalMs: integer('total_ms').notNull().default(0),
    hidden: bool('hidden'),
  },
  (table) => [
    uniqueIndex('history_chapter_idx').on(table.chapterId),
    index('history_last_read_idx').on(table.lastReadAt),
  ],
);

export const quotes = sqliteTable(
  'quotes',
  {
    id: id(),
    novelId: integer('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    chapterId: integer('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    /** JSON anchor: offsets and neighbouring text. */
    anchor: text('anchor').notNull(),
    lang: text('lang'),
    note: text('note'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    index('quotes_novel_idx').on(table.novelId),
    index('quotes_chapter_idx').on(table.chapterId),
  ],
);

export const quoteFolders = sqliteTable('quote_folders', {
  id: id(),
  name: text('name').notNull(),
  color: text('color').notNull(),
  position: integer('position').notNull(),
});

export const quoteFolderItems = sqliteTable(
  'quote_folder_items',
  {
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    folderId: integer('folder_id')
      .notNull()
      .references(() => quoteFolders.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.quoteId, table.folderId] })],
);

export const plugins = sqliteTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  lang: text('lang').notNull(),
  version: text('version').notNull(),
  site: text('site').notNull(),
  iconUrl: text('icon_url'),
  codePath: text('code_path').notNull(),
  /** JSON object of the values chosen for the plugin's `pluginSettings`. */
  settings: text('settings').notNull().default('{}'),
  enabled: bool('enabled', true),
  repoUrl: text('repo_url'),
  customJsPath: text('custom_js_path'),
  customCssPath: text('custom_css_path'),
  hasSettings: bool('has_settings'),
  pinned: bool('pinned'),
  lastUsedAt: integer('last_used_at'),
  installedAt: integer('installed_at').notNull().default(0),
});

export const pluginRepos = sqliteTable('plugin_repos', {
  url: text('url').primaryKey(),
  name: text('name').notNull(),
});

export const downloads = sqliteTable(
  'downloads',
  {
    id: id(),
    chapterId: integer('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    status: text('status').$type<DownloadStatus>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    position: integer('position').notNull().default(0),
    /** 'download' or 'translate'. */
    kind: text('kind').notNull().default('download'),
    /** Target language of a translation task. */
    lang: text('lang'),
  },
  (table) => [
    index('downloads_status_idx').on(table.status, table.position),
    index('downloads_chapter_idx').on(table.chapterId),
  ],
);

export const textReplacements = sqliteTable('text_replacements', {
  id: id(),
  /** null = applies to every novel. */
  novelId: integer('novel_id').references(() => novels.id, { onDelete: 'cascade' }),
  pattern: text('pattern').notNull(),
  replacement: text('replacement').notNull().default(''),
  isRegex: bool('is_regex'),
  enabled: bool('enabled', true),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  /** JSON encoded value. */
  value: text('value').notNull(),
});

export const schema = {
  novels,
  volumes,
  chapters,
  chapterTranslations,
  glossaryTerms,
  categories,
  novelCategories,
  readingSessions,
  history,
  quotes,
  quoteFolders,
  quoteFolderItems,
  plugins,
  pluginRepos,
  downloads,
  textReplacements,
  settings,
};

export type Novel = typeof novels.$inferSelect;
export type NewNovel = typeof novels.$inferInsert;
export type Volume = typeof volumes.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type ReadingSession = typeof readingSessions.$inferSelect;
export type HistoryEntry = typeof history.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type QuoteFolder = typeof quoteFolders.$inferSelect;
export type Plugin = typeof plugins.$inferSelect;
export type PluginRepo = typeof pluginRepos.$inferSelect;
export type Download = typeof downloads.$inferSelect;
export type TextReplacement = typeof textReplacements.$inferSelect;
export type GlossaryTerm = typeof glossaryTerms.$inferSelect;
