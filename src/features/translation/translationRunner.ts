/**
 * Translates chapters: one chapter on demand (the reader), or the queue of a whole novel
 * in the background. The engines are given from outside, so this runs in tests too.
 */
import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import {
  chapters,
  novels,
  type Chapter,
  type Novel,
  type TranslationEngine,
} from '../../db/schema';
import type { SourcePlugin } from '../../plugins/types';
import type { FileStore } from '../../services/fileStore';
import { htmlToText } from '../../services/html';
import { fetchChapterText } from '../browse/sourceNovels';
import { detectLanguage } from './detectLanguage';
import { translateChapterHtml, translateTitle, type ChapterTranslator } from './translateHtml';
import {
  completeTranslationTask,
  failTranslationTask,
  getTranslation,
  listTranslationTasks,
  nextTranslationTask,
  pauseTranslations,
  saveTranslation,
  setTranslationStatus,
} from './translationRepository';

export type TranslationErrorKind =
  /** A language model of the on-device engine is not downloaded. */
  | 'modelMissing'
  | 'deeplKey'
  | 'deeplQuota'
  | 'network'
  /** Unknown source language, or same language on both sides, or unsupported pair. */
  | 'language'
  /** The text of the chapter is not on the phone and cannot be fetched. */
  | 'noText'
  | 'failed';

export class TranslationError extends Error {
  constructor(
    readonly kind: TranslationErrorKind,
    message: string,
    /** Engine that failed, when the failure comes from one. */
    readonly engine: TranslationEngine | null = null,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export function toTranslationError(error: unknown): TranslationError {
  return error instanceof TranslationError
    ? error
    : new TranslationError('failed', error instanceof Error ? error.message : String(error));
}

/** Errors that would hit every chapter the same way: the queue waits for the user. */
const BLOCKING: TranslationErrorKind[] = ['modelMissing', 'deeplKey', 'deeplQuota', 'network'];

export interface TranslateDeps {
  db: AppDatabase;
  files: FileStore;
  getPlugin(pluginId: string): SourcePlugin;
  /** Engine to use for a novel and a pair of languages. Throws a TranslationError. */
  translatorFor(
    novel: Novel,
    source: string,
    target: string,
  ): Promise<{ translator: ChapterTranslator; engine: TranslationEngine }>;
  now(): number;
}

const short = (code: string) => code.toLowerCase().split(/[-_]/)[0];

/** Original text of a chapter, fetched from its source when it is not on the phone. */
async function originalHtml(deps: TranslateDeps, novel: Novel, chapter: Chapter): Promise<string> {
  if (chapter.filePath && deps.files.exists(chapter.filePath)) {
    return deps.files.readText(chapter.filePath);
  }
  if (novel.origin === 'online' && novel.pluginId && chapter.sourcePath) {
    try {
      return await fetchChapterText(deps.db, deps.files, deps.getPlugin(novel.pluginId), chapter);
    } catch (error) {
      throw new TranslationError('noText', error instanceof Error ? error.message : 'No text');
    }
  }
  throw new TranslationError('noText', 'The text of the chapter is not on the phone');
}

/**
 * Translates one chapter into `lang` and stores the result. Does nothing when the
 * translation already exists, unless `again` is set.
 */
export async function translateChapter(
  deps: TranslateDeps,
  chapterId: number,
  lang: string,
  options: { again?: boolean } = {},
): Promise<'done' | 'already'> {
  const { db } = deps;
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
  const novel = chapter
    ? db.select().from(novels).where(eq(novels.id, chapter.novelId)).get()
    : undefined;
  if (!chapter || !novel) {
    throw new TranslationError('noText', 'The chapter no longer exists');
  }
  if (!options.again && getTranslation(db, chapterId, lang)) {
    return 'already';
  }
  const html = await originalHtml(deps, novel, chapter);

  let source = novel.originalLang;
  if (!source) {
    // The language of the book was never told: it is read from the text, and remembered.
    source = detectLanguage(htmlToText(html));
    if (source) {
      db.update(novels).set({ originalLang: source }).where(eq(novels.id, novel.id)).run();
    }
  }
  if (!source) {
    throw new TranslationError('language', 'The language of the text is unknown');
  }
  if (short(source) === short(lang)) {
    throw new TranslationError('language', 'The text is already in that language');
  }

  const { translator, engine } = await deps.translatorFor(novel, short(source), short(lang));
  let translated: string;
  let title: string;
  try {
    translated = await translateChapterHtml(html, translator);
    title = await translateTitle(chapter.title, translator);
  } catch (error) {
    const known = toTranslationError(error);
    throw new TranslationError(known.kind, known.message, known.engine ?? engine);
  }
  saveTranslation(db, deps.files, chapter, lang, { html: translated, title, engine }, deps.now());
  return 'done';
}

export type QueueStop = 'done' | 'stopped' | TranslationErrorKind;

export interface QueueProgress {
  novelTitle: string;
  chapterTitle: string;
  /** Chapters of this novel translated since the queue started, and their total. */
  done: number;
  total: number;
}

export interface RunnerHooks {
  onProgress(progress: QueueProgress): void;
  /** A chapter was translated or a task changed state. */
  onChange(): void;
}

/** Processes the queue of chapters to translate, one at a time. */
export class TranslationRunner {
  private running = false;
  private stopRequested = false;

  constructor(
    private readonly deps: TranslateDeps,
    private readonly hooks: RunnerHooks,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Asks the loop to stop after the chapter being translated. */
  stop(): void {
    this.stopRequested = true;
  }

  async run(): Promise<QueueStop> {
    if (this.running) {
      return 'stopped';
    }
    const { db } = this.deps;
    this.running = true;
    this.stopRequested = false;
    const doneByNovel = new Map<number, number>();
    try {
      for (;;) {
        if (this.stopRequested) {
          return 'stopped';
        }
        const task = nextTranslationTask(db);
        if (!task) {
          return 'done';
        }
        const done = doneByNovel.get(task.novelId) ?? 0;
        const remaining = listTranslationTasks(db).filter(
          (row) =>
            row.novelId === task.novelId && (row.status === 'queued' || row.status === 'running'),
        ).length;
        this.hooks.onProgress({
          novelTitle: task.novelTitle,
          chapterTitle: task.chapterTitle,
          done,
          total: done + remaining,
        });
        setTranslationStatus(db, task.id, 'running');
        this.hooks.onChange();
        try {
          await translateChapter(this.deps, task.chapterId, task.lang, { again: true });
          completeTranslationTask(db, task.id);
          doneByNovel.set(task.novelId, done + 1);
          this.hooks.onChange();
        } catch (error) {
          const failure = toTranslationError(error);
          if (BLOCKING.includes(failure.kind)) {
            // The other chapters would fail the same way: everything waits.
            setTranslationStatus(db, task.id, 'queued');
            pauseTranslations(db);
            this.hooks.onChange();
            return failure.kind;
          }
          failTranslationTask(db, task.id, failure.message);
          this.hooks.onChange();
        }
      }
    } finally {
      this.running = false;
    }
  }
}
