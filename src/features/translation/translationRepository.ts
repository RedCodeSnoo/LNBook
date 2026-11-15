/**
 * Translated versions of chapters: where they are stored, which one is displayed, the
 * glossary of a novel and the queue of chapters waiting to be translated.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import {
  chapters,
  chapterTranslations,
  downloads,
  glossaryTerms,
  novels,
  type Chapter,
  type DownloadStatus,
  type Novel,
  type TranslationEngine,
} from '../../db/schema';
import { translationFile, type FileStore } from '../../services/fileStore';
import type { GlossaryEntry } from './glossary';

const short = (code: string) => code.toLowerCase().split(/[-_]/)[0];

/** Language a novel is displayed in when it is not its original language, else null. */
export function activeTranslationLang(
  novel: Pick<Novel, 'readingLang' | 'originalLang'>,
): string | null {
  const lang = novel.readingLang;
  if (!lang || (novel.originalLang && short(lang) === short(novel.originalLang))) {
    return null;
  }
  return lang;
}

export interface StoredTranslation {
  lang: string;
  filePath: string;
  engine: TranslationEngine;
  title: string | null;
  createdAt: number;
}

export function getTranslation(
  db: AppDatabase,
  chapterId: number,
  lang: string,
): StoredTranslation | null {
  return (
    db
      .select()
      .from(chapterTranslations)
      .where(and(eq(chapterTranslations.chapterId, chapterId), eq(chapterTranslations.lang, lang)))
      .get() ?? null
  );
}

/** Stores the translated text of a chapter (replacing an older translation). */
export function saveTranslation(
  db: AppDatabase,
  files: FileStore,
  chapter: Pick<Chapter, 'id' | 'novelId'>,
  lang: string,
  content: { html: string; title: string | null; engine: TranslationEngine },
  now = Date.now(),
): void {
  const filePath = translationFile(chapter.novelId, chapter.id, lang);
  files.writeText(filePath, content.html);
  const values = { filePath, engine: content.engine, title: content.title, createdAt: now };
  db.insert(chapterTranslations)
    .values({ chapterId: chapter.id, lang, ...values })
    .onConflictDoUpdate({
      target: [chapterTranslations.chapterId, chapterTranslations.lang],
      set: values,
    })
    .run();
}

export function deleteTranslation(
  db: AppDatabase,
  files: FileStore,
  chapterId: number,
  lang: string,
): void {
  const stored = getTranslation(db, chapterId, lang);
  if (stored) {
    files.delete(stored.filePath);
    db.delete(chapterTranslations)
      .where(and(eq(chapterTranslations.chapterId, chapterId), eq(chapterTranslations.lang, lang)))
      .run();
  }
}

/** Removes a whole translated version of a novel. */
export function deleteNovelTranslation(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  lang: string,
): void {
  const rows = db
    .select({ chapterId: chapterTranslations.chapterId, filePath: chapterTranslations.filePath })
    .from(chapterTranslations)
    .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
    .where(and(eq(chapters.novelId, novelId), eq(chapterTranslations.lang, lang)))
    .all();
  for (const row of rows) {
    files.delete(row.filePath);
  }
  for (let start = 0; start < rows.length; start += 500) {
    db.delete(chapterTranslations)
      .where(
        and(
          eq(chapterTranslations.lang, lang),
          inArray(
            chapterTranslations.chapterId,
            rows.slice(start, start + 500).map((row) => row.chapterId),
          ),
        ),
      )
      .run();
  }
  cancelTranslations(db, novelId, lang);
  const novel = db
    .select({ readingLang: novels.readingLang })
    .from(novels)
    .where(eq(novels.id, novelId))
    .get();
  if (novel?.readingLang === lang) {
    db.update(novels).set({ readingLang: null }).where(eq(novels.id, novelId)).run();
  }
}

export interface TranslatedLanguage {
  lang: string;
  /** Chapters translated in that language. */
  count: number;
}

/** Languages a novel has translated chapters in, with how many. */
export function listTranslatedLanguages(db: AppDatabase, novelId: number): TranslatedLanguage[] {
  return db
    .select({ lang: chapterTranslations.lang, count: sql<number>`count(*)` })
    .from(chapterTranslations)
    .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
    .where(eq(chapters.novelId, novelId))
    .groupBy(chapterTranslations.lang)
    .orderBy(asc(chapterTranslations.lang))
    .all();
}

/** Ids of the chapters of a novel translated in a language. */
export function listTranslatedChapterIds(
  db: AppDatabase,
  novelId: number,
  lang: string,
): Set<number> {
  return new Set(
    db
      .select({ id: chapterTranslations.chapterId })
      .from(chapterTranslations)
      .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
      .where(and(eq(chapters.novelId, novelId), eq(chapterTranslations.lang, lang)))
      .all()
      .map((row) => row.id),
  );
}

/** Translated titles of the chapters of a novel in a language. */
export function listTranslatedTitles(
  db: AppDatabase,
  novelId: number,
  lang: string,
): Map<number, string> {
  const map = new Map<number, string>();
  const rows = db
    .select({ id: chapterTranslations.chapterId, title: chapterTranslations.title })
    .from(chapterTranslations)
    .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
    .where(and(eq(chapters.novelId, novelId), eq(chapterTranslations.lang, lang)))
    .all();
  for (const row of rows) {
    if (row.title) {
      map.set(row.id, row.title);
    }
  }
  return map;
}

/** Translated chapters of a novel in a language, with their translated title when known. */
export function listTranslatedChapters(
  db: AppDatabase,
  novelId: number,
  lang: string,
): Map<number, string | null> {
  return new Map(
    db
      .select({ id: chapterTranslations.chapterId, title: chapterTranslations.title })
      .from(chapterTranslations)
      .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
      .where(and(eq(chapters.novelId, novelId), eq(chapterTranslations.lang, lang)))
      .all()
      .map((row) => [row.id, row.title]),
  );
}

/** Files of the translated chapters of a novel in a language, by chapter. */
export function listTranslationFiles(
  db: AppDatabase,
  novelId: number,
  lang: string,
): Map<number, { filePath: string; title: string | null }> {
  return new Map(
    db
      .select({
        id: chapterTranslations.chapterId,
        filePath: chapterTranslations.filePath,
        title: chapterTranslations.title,
      })
      .from(chapterTranslations)
      .innerJoin(chapters, eq(chapters.id, chapterTranslations.chapterId))
      .where(and(eq(chapters.novelId, novelId), eq(chapterTranslations.lang, lang)))
      .all()
      .map((row) => [row.id, { filePath: row.filePath, title: row.title }]),
  );
}

/** Sets the language a novel is read in (null = original). */
export function setReadingLang(db: AppDatabase, novelId: number, lang: string | null): void {
  db.update(novels).set({ readingLang: lang }).where(eq(novels.id, novelId)).run();
}

export function setNovelEngine(
  db: AppDatabase,
  novelId: number,
  engine: TranslationEngine | null,
): void {
  db.update(novels).set({ translationEngine: engine }).where(eq(novels.id, novelId)).run();
}

export interface DisplayedChapter {
  /** HTML shown to the reader, before the replacement rules. */
  html: string;
  /** Title in the displayed language. */
  title: string;
  /** Language of the displayed text when it is a translation, else null. */
  lang: string | null;
  /** The other version of the same chapter (original when a translation is shown). */
  otherHtml: string | null;
}

/**
 * Text of a chapter in the language the novel is read in. Falls back to the original
 * when the chapter is not translated yet. Null when the chapter is not on the phone.
 */
export function readDisplayedChapter(
  db: AppDatabase,
  files: FileStore,
  novel: Pick<Novel, 'readingLang' | 'originalLang'>,
  chapter: Pick<Chapter, 'id' | 'title' | 'filePath'>,
): DisplayedChapter | null {
  const original =
    chapter.filePath && files.exists(chapter.filePath) ? files.readText(chapter.filePath) : null;
  const lang = activeTranslationLang(novel);
  if (lang) {
    const stored = getTranslation(db, chapter.id, lang);
    if (stored && files.exists(stored.filePath)) {
      return {
        html: files.readText(stored.filePath),
        title: stored.title ?? chapter.title,
        lang,
        otherHtml: original,
      };
    }
  }
  if (original === null) {
    return null;
  }
  // The original is displayed: a translation of the chapter, if any, is its other version.
  const other = db
    .select({ filePath: chapterTranslations.filePath })
    .from(chapterTranslations)
    .where(eq(chapterTranslations.chapterId, chapter.id))
    .orderBy(asc(chapterTranslations.lang))
    .all()
    .find((row) => files.exists(row.filePath));
  return {
    html: original,
    title: chapter.title,
    lang: null,
    otherHtml: other ? files.readText(other.filePath) : null,
  };
}

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export interface GlossaryTerm extends GlossaryEntry {
  id: number;
}

export function listGlossary(
  db: AppDatabase,
  novelId: number,
  sourceLang: string,
  targetLang: string,
): GlossaryTerm[] {
  return db
    .select({
      id: glossaryTerms.id,
      source: glossaryTerms.sourceTerm,
      target: glossaryTerms.targetTerm,
    })
    .from(glossaryTerms)
    .where(
      and(
        eq(glossaryTerms.novelId, novelId),
        eq(glossaryTerms.sourceLang, short(sourceLang)),
        eq(glossaryTerms.targetLang, short(targetLang)),
      ),
    )
    .orderBy(asc(glossaryTerms.sourceTerm))
    .all();
}

/** Adds a term, or changes it when `id` is given or the source term already exists. */
export function saveGlossaryTerm(
  db: AppDatabase,
  term: {
    id?: number;
    novelId: number;
    sourceLang: string;
    targetLang: string;
    source: string;
    /** Empty = do not translate. */
    target: string;
  },
): number | null {
  const source = term.source.trim();
  if (source === '') {
    return null;
  }
  const target = term.target.trim() || source;
  const sourceLang = short(term.sourceLang);
  const targetLang = short(term.targetLang);
  const existing =
    term.id ??
    listGlossary(db, term.novelId, sourceLang, targetLang).find(
      (candidate) => candidate.source.toLowerCase() === source.toLowerCase(),
    )?.id;
  if (existing !== undefined) {
    db.update(glossaryTerms)
      .set({ sourceTerm: source, targetTerm: target })
      .where(eq(glossaryTerms.id, existing))
      .run();
    return existing;
  }
  return db
    .insert(glossaryTerms)
    .values({
      novelId: term.novelId,
      sourceLang,
      targetLang,
      sourceTerm: source,
      targetTerm: target,
    })
    .returning({ id: glossaryTerms.id })
    .get().id;
}

export function deleteGlossaryTerm(db: AppDatabase, id: number): void {
  db.delete(glossaryTerms).where(eq(glossaryTerms.id, id)).run();
}

// ---------------------------------------------------------------------------
// Queue of chapters to translate (table `downloads`, kind = 'translate')
// ---------------------------------------------------------------------------

export interface TranslationTask {
  id: number;
  chapterId: number;
  lang: string;
  status: DownloadStatus;
  attempts: number;
  error: string | null;
  novelId: number;
  novelTitle: string;
  chapterTitle: string;
}

export function listTranslationTasks(db: AppDatabase): TranslationTask[] {
  return db
    .select({
      id: downloads.id,
      chapterId: downloads.chapterId,
      lang: sql<string>`coalesce(${downloads.lang}, '')`,
      status: downloads.status,
      attempts: downloads.attempts,
      error: downloads.error,
      novelId: novels.id,
      novelTitle: novels.title,
      chapterTitle: chapters.title,
    })
    .from(downloads)
    .innerJoin(chapters, eq(chapters.id, downloads.chapterId))
    .innerJoin(novels, eq(novels.id, chapters.novelId))
    .where(eq(downloads.kind, 'translate'))
    .orderBy(asc(downloads.position), asc(downloads.id))
    .all();
}

/**
 * Queues chapters for translation, in the order given. Chapters already translated in
 * that language (unless `again`) or already queued are skipped. Returns how many were added.
 */
export function enqueueTranslations(
  db: AppDatabase,
  chapterIds: number[],
  lang: string,
  options: { again?: boolean; now?: number } = {},
): number {
  if (chapterIds.length === 0) {
    return 0;
  }
  const now = options.now ?? Date.now();
  return db.transaction((tx) => {
    const queued = new Set(
      tx
        .select({ chapterId: downloads.chapterId })
        .from(downloads)
        .where(and(eq(downloads.kind, 'translate'), eq(downloads.lang, lang)))
        .all()
        .map((row) => row.chapterId),
    );
    const done = new Set<number>();
    if (!options.again) {
      for (let start = 0; start < chapterIds.length; start += 500) {
        for (const row of tx
          .select({ id: chapterTranslations.chapterId })
          .from(chapterTranslations)
          .where(
            and(
              eq(chapterTranslations.lang, lang),
              inArray(chapterTranslations.chapterId, chapterIds.slice(start, start + 500)),
            ),
          )
          .all()) {
          done.add(row.id);
        }
      }
    }
    let position =
      tx
        .select({ max: sql<number | null>`max(${downloads.position})` })
        .from(downloads)
        .get()?.max ?? 0;
    let added = 0;
    for (const chapterId of chapterIds) {
      if (queued.has(chapterId) || done.has(chapterId)) {
        continue;
      }
      queued.add(chapterId);
      position += 1;
      tx.insert(downloads)
        .values({ chapterId, status: 'queued', createdAt: now, position, kind: 'translate', lang })
        .run();
      added += 1;
    }
    return added;
  });
}

export function nextTranslationTask(db: AppDatabase): TranslationTask | null {
  return listTranslationTasks(db).find((task) => task.status === 'queued') ?? null;
}

export function setTranslationStatus(db: AppDatabase, id: number, status: DownloadStatus): void {
  db.update(downloads).set({ status }).where(eq(downloads.id, id)).run();
}

export function completeTranslationTask(db: AppDatabase, id: number): void {
  db.delete(downloads).where(eq(downloads.id, id)).run();
}

/** Records a failure; the task stays in the list as failed with its reason. */
export function failTranslationTask(db: AppDatabase, id: number, error: string): void {
  db.update(downloads)
    .set({ status: 'failed', error: error.slice(0, 300), attempts: sql`${downloads.attempts} + 1` })
    .where(eq(downloads.id, id))
    .run();
}

const translateTasks = (statuses: DownloadStatus[]) =>
  and(eq(downloads.kind, 'translate'), inArray(downloads.status, statuses));

export function pauseTranslations(db: AppDatabase): void {
  db.update(downloads)
    .set({ status: 'paused' })
    .where(translateTasks(['queued', 'running']))
    .run();
}

/** Paused, failed and interrupted tasks go back to the queue. */
export function resumeTranslations(db: AppDatabase): void {
  db.update(downloads)
    .set({ status: 'queued', error: null })
    .where(translateTasks(['paused', 'failed', 'running']))
    .run();
}

/** Tasks interrupted when the app was closed go back to the queue. */
export function recoverInterruptedTranslations(db: AppDatabase): void {
  db.update(downloads)
    .set({ status: 'queued' })
    .where(translateTasks(['running']))
    .run();
}

/** Cancels the waiting translations of a novel (one language, or all). */
export function cancelTranslations(db: AppDatabase, novelId?: number, lang?: string): void {
  if (novelId === undefined) {
    db.delete(downloads).where(eq(downloads.kind, 'translate')).run();
    return;
  }
  const ids = db
    .select({ id: downloads.id, lang: downloads.lang })
    .from(downloads)
    .innerJoin(chapters, eq(chapters.id, downloads.chapterId))
    .where(and(eq(chapters.novelId, novelId), eq(downloads.kind, 'translate')))
    .all()
    .filter((row) => lang === undefined || row.lang === lang)
    .map((row) => row.id);
  for (let start = 0; start < ids.length; start += 500) {
    db.delete(downloads)
      .where(inArray(downloads.id, ids.slice(start, start + 500)))
      .run();
  }
}
