/** Translation wired to the device: engines, DeepL key, models, queue, interface state. */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { nativeTranslate } from '../../../modules/lnbook-system';
import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { Novel, TranslationEngine } from '../../db/schema';
import i18n from '../../i18n';
import { getSource } from '../../plugins/pluginHost';
import { deviceFiles } from '../../services/deviceFileStore';
import { beginWork, endWork, reportWork } from '../../services/foregroundWork';
import { ensureNotificationPermission } from '../../services/notifications';
import { getNovel, listChapters } from '../novel/novelRepository';
import { readValue, writeValue } from '../settings/settingsRepository';
import { getSetting } from '../settings/settingsStore';
import {
  deeplCreateGlossary,
  deeplDeleteGlossary,
  DeepLError,
  deeplTranslate,
  deeplUsage,
  type DeepLUsage,
} from './deepl';
import { glossaryFingerprint, prepareGlossary, protectTerms, restoreTerms } from './glossary';
import type { ChapterTranslator } from './translateHtml';
import {
  cancelTranslations,
  enqueueTranslations,
  listGlossary,
  nextTranslationTask,
  pauseTranslations,
  recoverInterruptedTranslations,
  resumeTranslations,
  setNovelEngine,
} from './translationRepository';
import {
  translateChapter,
  TranslationError,
  TranslationRunner,
  toTranslationError,
  type QueueProgress,
  type QueueStop,
  type TranslateDeps,
} from './translationRunner';

// ------------------------------------------------------------------ DeepL key

const DEEPL_KEY = 'deeplApiKey';
let deeplKey: string | null | undefined;

/** The key of the user, kept encrypted on the phone and never written anywhere else. */
export async function getDeeplKey(): Promise<string | null> {
  if (deeplKey === undefined) {
    try {
      deeplKey = (await SecureStore.getItemAsync(DEEPL_KEY))?.trim() || null;
    } catch {
      deeplKey = null;
    }
  }
  return deeplKey;
}

export async function setDeeplKey(key: string): Promise<void> {
  const cleaned = key.trim();
  deeplKey = cleaned || null;
  try {
    if (cleaned) {
      await SecureStore.setItemAsync(DEEPL_KEY, cleaned);
    } else {
      await SecureStore.deleteItemAsync(DEEPL_KEY);
    }
  } catch {
    // The key stays usable until the app closes.
  }
  useTranslationState.setState({ hasDeeplKey: !!deeplKey });
}

export async function getDeeplUsage(): Promise<DeepLUsage | null> {
  const key = await getDeeplKey();
  if (!key) {
    return null;
  }
  return deeplUsage(fetch, key);
}

// ------------------------------------------------------------------ models

export function supportedModelLanguages(): string[] {
  try {
    return nativeTranslate.getSupportedLanguages();
  } catch {
    return [];
  }
}

export async function listDownloadedModels(): Promise<string[]> {
  try {
    return await nativeTranslate.getDownloadedModels();
  } catch {
    return [];
  }
}

export const downloadModel = (language: string) => nativeTranslate.downloadModel(language, false);
export const deleteModel = (language: string) => nativeTranslate.deleteModel(language);

/** Models that must be downloaded before translating between two languages. */
export async function missingModels(source: string, target: string): Promise<string[]> {
  const present = new Set(await listDownloadedModels());
  return [source, target].filter((code) => code !== 'en' && !present.has(code));
}

// ------------------------------------------------------------------ engines

const CHUNK = 40;

async function mlkitTranslate(source: string, target: string, texts: string[]): Promise<string[]> {
  const out: string[] = [];
  try {
    for (let start = 0; start < texts.length; start += CHUNK) {
      out.push(
        ...(await nativeTranslate.translate(source, target, texts.slice(start, start + CHUNK))),
      );
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (code === 'ERR_MODEL_MISSING') {
      throw new TranslationError('modelMissing', message, 'mlkit');
    }
    throw new TranslationError(code === 'ERR_LANGUAGE' ? 'language' : 'failed', message, 'mlkit');
  }
  return out;
}

function fromDeepL(error: unknown): TranslationError {
  if (error instanceof DeepLError) {
    const kind =
      error.kind === 'key'
        ? 'deeplKey'
        : error.kind === 'quota'
          ? 'deeplQuota'
          : error.kind === 'network'
            ? 'network'
            : error.kind === 'language'
              ? 'language'
              : 'failed';
    return new TranslationError(kind, error.message, 'deepl');
  }
  return toTranslationError(error);
}

/** The glossary of the novel as stored at DeepL (created or replaced when it changed). */
async function deeplGlossaryId(
  key: string,
  novel: Novel,
  source: string,
  target: string,
): Promise<string | null> {
  const entries = prepareGlossary(listGlossary(getDb(), novel.id, source, target));
  const settingKey = `deeplGlossary:${novel.id}:${source}:${target}`;
  const stored = readValue<{ id: string; fingerprint: string } | null>(getDb(), settingKey, null);
  if (entries.length === 0) {
    if (stored) {
      void deeplDeleteGlossary(fetch, key, stored.id);
      writeValue(getDb(), settingKey, null);
    }
    return null;
  }
  const fingerprint = glossaryFingerprint(entries);
  if (stored && stored.fingerprint === fingerprint) {
    return stored.id;
  }
  const id = await deeplCreateGlossary(
    fetch,
    key,
    novel.title.slice(0, 80),
    source,
    target,
    entries,
  );
  if (stored) {
    void deeplDeleteGlossary(fetch, key, stored.id);
  }
  writeValue(getDb(), settingKey, { id, fingerprint });
  return id;
}

/** Engine a novel is translated with: its own choice, else the global setting. */
export async function engineFor(
  novel: Pick<Novel, 'translationEngine'>,
): Promise<TranslationEngine> {
  const wanted = novel.translationEngine ?? getSetting('translationEngine');
  return wanted === 'deepl' && (await getDeeplKey()) ? 'deepl' : 'mlkit';
}

async function translatorFor(
  novel: Novel,
  source: string,
  target: string,
): Promise<{ translator: ChapterTranslator; engine: TranslationEngine }> {
  const engine = await engineFor(novel);
  if (engine === 'deepl') {
    const key = (await getDeeplKey()) as string;
    let glossaryId: string | null;
    try {
      glossaryId = await deeplGlossaryId(key, novel, source, target);
    } catch (error) {
      throw fromDeepL(error);
    }
    return {
      engine,
      translator: {
        mode: 'html',
        translate: async (fragments) => {
          try {
            return await deeplTranslate(fetch, key, fragments, { source, target, glossaryId });
          } catch (error) {
            throw fromDeepL(error);
          }
        },
      },
    };
  }
  return {
    engine,
    translator: {
      mode: 'text',
      glossary: prepareGlossary(listGlossary(getDb(), novel.id, source, target)),
      translate: (texts) => mlkitTranslate(source, target, texts),
    },
  };
}

const deps = (): TranslateDeps => ({
  db: getDb(),
  files: deviceFiles,
  getPlugin: getSource,
  translatorFor,
  now: () => Date.now(),
});

// ------------------------------------------------------------------ on demand

const inFlight = new Map<string, Promise<'done' | 'already'>>();

/** Translates one chapter now (the reader waits for it). Calls for the same chapter share the work. */
export function translateNow(
  chapterId: number,
  lang: string,
  again = false,
): Promise<'done' | 'already'> {
  const key = `${chapterId}:${lang}`;
  const running = inFlight.get(key);
  if (running && !again) {
    return running;
  }
  const work = translateChapter(deps(), chapterId, lang, { again })
    .then((result) => {
      if (result === 'done') {
        invalidate('chapterContent', 'chapters', 'novel', 'library');
      }
      return result;
    })
    .finally(() => {
      if (inFlight.get(key) === work) {
        inFlight.delete(key);
      }
    });
  inFlight.set(key, work);
  return work;
}

let aheadToken = 0;

/** Translates the chapters that follow the one being read, quietly, one after the other. */
export function translateAhead(novelId: number, chapterId: number, lang: string): void {
  const count = Math.max(0, Math.round(getSetting('translateAhead')));
  const token = (aheadToken += 1);
  if (count === 0) {
    return;
  }
  const list = listChapters(getDb(), novelId);
  const index = list.findIndex((chapter) => chapter.id === chapterId);
  const next = list.slice(index + 1, index + 1 + count);
  void (async () => {
    for (const chapter of next) {
      if (token !== aheadToken) {
        return;
      }
      try {
        await translateNow(chapter.id, lang);
      } catch {
        // The reader will show the reason if this chapter is opened.
        return;
      }
    }
  })();
}

/** Translates a short text (a selection in the reader) with the engine of the novel. */
export async function translateText(
  novel: Novel,
  text: string,
  source: string,
  target: string,
): Promise<string> {
  const { translator } = await translatorFor(novel, source, target);
  if (translator.mode === 'text') {
    const safe = protectTerms(text, translator.glossary);
    const [translated] = await translator.translate([safe.text]);
    return restoreTerms(translated ?? '', safe.targets);
  }
  const [translated] = await translator.translate([
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
  ]);
  return (translated ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** "Use the on-device engine instead" after a DeepL failure. */
export function switchToOnDeviceEngine(novelId: number): void {
  setNovelEngine(getDb(), novelId, 'mlkit');
  invalidate('novel');
}

// ------------------------------------------------------------------ queue

interface TranslationState {
  running: boolean;
  progress: QueueProgress | null;
  /** Why the queue stopped last time. */
  lastStop: QueueStop | null;
  hasDeeplKey: boolean;
}

export const useTranslationState = create<TranslationState>(() => ({
  running: false,
  progress: null,
  lastStop: null,
  hasDeeplKey: false,
}));

let runner: TranslationRunner | null = null;

function getRunner(): TranslationRunner {
  runner ??= new TranslationRunner(deps(), {
    onProgress: (progress) => {
      useTranslationState.setState({ progress });
      reportWork(
        'translation',
        i18n.t('translation.notificationTitle', { title: progress.novelTitle }),
        `${progress.done} / ${progress.total} · ${progress.chapterTitle}`,
        progress.done,
        progress.total,
      );
    },
    onChange: () => invalidate('downloads', 'chapters', 'novel', 'library', 'chapterContent'),
  });
  return runner;
}

export async function startTranslations(): Promise<void> {
  const current = getRunner();
  if (current.isRunning || !nextTranslationTask(getDb())) {
    return;
  }
  useTranslationState.setState({ running: true, lastStop: null });
  await ensureNotificationPermission();
  beginWork(
    'translation',
    i18n.t('downloads.channel'),
    i18n.t('translation.notificationStarting'),
    '',
  );
  let reason: QueueStop = 'stopped';
  try {
    reason = await current.run();
  } finally {
    endWork('translation');
    useTranslationState.setState({ running: false, progress: null, lastStop: reason });
    invalidate('downloads', 'chapters', 'novel', 'library');
  }
}

/** Queues chapters of a novel for translation and starts the queue. */
export function queueTranslations(chapterIds: number[], lang: string, again = false): number {
  const added = enqueueTranslations(getDb(), chapterIds, lang, { again });
  invalidate('downloads');
  void startTranslations();
  return added;
}

/** Queues every chapter of a novel that is not translated yet. */
export function queueNovelTranslation(novelId: number, lang: string): number {
  if (!getNovel(getDb(), novelId)) {
    return 0;
  }
  return queueTranslations(
    listChapters(getDb(), novelId).map((chapter) => chapter.id),
    lang,
  );
}

export function pauseAllTranslations(): void {
  pauseTranslations(getDb());
  runner?.stop();
  invalidate('downloads');
}

export function resumeAllTranslations(): void {
  resumeTranslations(getDb());
  invalidate('downloads');
  void startTranslations();
}

export function cancelAllTranslations(novelId?: number, lang?: string): void {
  cancelTranslations(getDb(), novelId, lang);
  if (novelId === undefined) {
    runner?.stop();
  }
  invalidate('downloads');
}

/** At launch: interrupted translations continue, and the key state is known. */
export function resumeTranslationsAtLaunch(): void {
  recoverInterruptedTranslations(getDb());
  void getDeeplKey().then((key) => useTranslationState.setState({ hasDeeplKey: !!key }));
  void startTranslations();
}
