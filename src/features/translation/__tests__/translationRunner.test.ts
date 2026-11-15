import { eq } from 'drizzle-orm';

import { chapters, novels } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import type { SourcePlugin } from '../../../plugins/types';
import { MemoryFileStore } from '../../../services/fileStore';
import {
  activeTranslationLang,
  cancelTranslations,
  deleteGlossaryTerm,
  deleteNovelTranslation,
  enqueueTranslations,
  listGlossary,
  listTranslatedChapterIds,
  listTranslatedLanguages,
  listTranslatedTitles,
  listTranslationTasks,
  readDisplayedChapter,
  resumeTranslations,
  saveGlossaryTerm,
  setReadingLang,
} from '../translationRepository';
import {
  translateChapter,
  TranslationError,
  TranslationRunner,
  type QueueProgress,
  type TranslateDeps,
} from '../translationRunner';

function setup(options: { online?: boolean; lang?: string | null } = {}) {
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const novelId = db
    .insert(novels)
    .values({
      origin: options.online ? 'online' : 'local',
      pluginId: options.online ? 'demo' : null,
      sourcePath: options.online ? '/n' : null,
      title: 'Saga',
      originalLang: options.lang === undefined ? 'en' : options.lang,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning({ id: novels.id })
    .get().id;
  const ids: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const id = db
      .insert(chapters)
      .values({
        novelId,
        position: i,
        title: `Chapter ${i + 1}`,
        sourcePath: options.online ? `/c/${i + 1}` : null,
        createdAt: 1,
      })
      .returning({ id: chapters.id })
      .get().id;
    if (!options.online) {
      const path = `novels/${novelId}/chapters/${id}.html`;
      files.writeText(
        path,
        `<p>The master said that he was not ready for this trial and she had other plans ${i + 1}.</p>`,
      );
      db.update(chapters).set({ filePath: path }).where(eq(chapters.id, id)).run();
    }
    ids.push(id);
  }
  const requests: string[] = [];
  let failure: TranslationError | null = null;
  const deps: TranslateDeps = {
    db,
    files,
    getPlugin: () =>
      ({
        id: 'demo',
        name: 'Demo',
        site: 'https://demo.test',
        version: '1',
        parseChapter: async (path: string) => `<p>Fetched text of ${path}.</p>`,
      }) as unknown as SourcePlugin,
    translatorFor: async (_novel, source, target) => {
      requests.push(`${source}>${target}`);
      if (failure) {
        throw failure;
      }
      return {
        engine: 'mlkit',
        translator: {
          mode: 'text',
          glossary: [],
          translate: async (texts) => texts.map((text) => `[${target}] ${text}`),
        },
      };
    },
    now: () => 5_000,
  };
  return {
    db,
    files,
    ids,
    novelId,
    deps,
    requests,
    failWith: (error: TranslationError | null) => {
      failure = error;
    },
    novel: () => db.select().from(novels).where(eq(novels.id, novelId)).get()!,
    chapter: (index: number) =>
      db.select().from(chapters).where(eq(chapters.id, ids[index])).get()!,
  };
}

describe('translating a chapter', () => {
  it('stores the translated text and title next to the original', async () => {
    const t = setup();
    expect(await translateChapter(t.deps, t.ids[0], 'fr')).toBe('done');
    expect(t.requests).toEqual(['en>fr']);
    expect(t.files.readText(`novels/${t.novelId}/translations/fr/${t.ids[0]}.html`)).toBe(
      '<p>[fr] The master said that he was not ready for this trial and she had other plans 1.</p>',
    );
    expect(listTranslatedLanguages(t.db, t.novelId)).toEqual([{ lang: 'fr', count: 1 }]);
    expect(listTranslatedChapterIds(t.db, t.novelId, 'fr')).toEqual(new Set([t.ids[0]]));
    expect(listTranslatedTitles(t.db, t.novelId, 'fr').get(t.ids[0])).toBe('[fr] Chapter 1');
    // Reading it again costs nothing.
    expect(await translateChapter(t.deps, t.ids[0], 'fr')).toBe('already');
    expect(t.requests).toHaveLength(1);
    expect(await translateChapter(t.deps, t.ids[0], 'fr', { again: true })).toBe('done');
  });

  it('shows the translation when the novel is read in that language', async () => {
    const t = setup();
    await translateChapter(t.deps, t.ids[0], 'fr');
    // Reading the original: the translation is its other version (bilingual display).
    const original = readDisplayedChapter(t.db, t.files, t.novel(), t.chapter(0));
    expect(original).toMatchObject({ lang: null, title: 'Chapter 1' });
    expect(original?.otherHtml).toContain('[fr]');
    expect(readDisplayedChapter(t.db, t.files, t.novel(), t.chapter(1))?.otherHtml).toBeNull();
    setReadingLang(t.db, t.novelId, 'fr');
    expect(activeTranslationLang(t.novel())).toBe('fr');
    const shown = readDisplayedChapter(t.db, t.files, t.novel(), t.chapter(0));
    expect(shown).toMatchObject({ lang: 'fr', title: '[fr] Chapter 1' });
    expect(shown?.html).toContain('[fr] The master');
    expect(shown?.otherHtml).toContain('<p>The master');
    // A chapter not translated yet is shown in its original language.
    expect(readDisplayedChapter(t.db, t.files, t.novel(), t.chapter(1))).toMatchObject({
      lang: null,
    });
    // The original language chosen as reading language is not a translation.
    setReadingLang(t.db, t.novelId, 'en');
    expect(activeTranslationLang(t.novel())).toBeNull();
  });

  it('downloads the text of an online chapter first', async () => {
    const t = setup({ online: true });
    await translateChapter(t.deps, t.ids[1], 'fr');
    expect(t.chapter(1).filePath).not.toBeNull();
    expect(t.files.readText(`novels/${t.novelId}/translations/fr/${t.ids[1]}.html`)).toBe(
      '<p>[fr] Fetched text of /c/2.</p>',
    );
  });

  it('finds the language of the text when the book does not say it', async () => {
    const t = setup({ lang: null });
    await translateChapter(t.deps, t.ids[0], 'fr');
    expect(t.novel().originalLang).toBe('en');
    expect(t.requests).toEqual(['en>fr']);
  });

  it('refuses to translate a text into its own language', async () => {
    const t = setup();
    await expect(translateChapter(t.deps, t.ids[0], 'en')).rejects.toMatchObject({
      kind: 'language',
    });
  });

  it('removes a translated version and goes back to the original', async () => {
    const t = setup();
    await translateChapter(t.deps, t.ids[0], 'fr');
    setReadingLang(t.db, t.novelId, 'fr');
    deleteNovelTranslation(t.db, t.files, t.novelId, 'fr');
    expect(listTranslatedLanguages(t.db, t.novelId)).toEqual([]);
    expect(t.files.exists(`novels/${t.novelId}/translations/fr/${t.ids[0]}.html`)).toBe(false);
    expect(t.novel().readingLang).toBeNull();
  });
});

describe('translation queue', () => {
  it('translates the queued chapters in order and reports the progress', async () => {
    const t = setup();
    expect(enqueueTranslations(t.db, t.ids, 'fr')).toBe(3);
    expect(enqueueTranslations(t.db, t.ids, 'fr')).toBe(0);
    const progress: QueueProgress[] = [];
    let changes = 0;
    const runner = new TranslationRunner(t.deps, {
      onProgress: (value) => progress.push(value),
      onChange: () => {
        changes += 1;
      },
    });
    expect(await runner.run()).toBe('done');
    expect(progress.map((value) => `${value.done}/${value.total} ${value.chapterTitle}`)).toEqual([
      '0/3 Chapter 1',
      '1/3 Chapter 2',
      '2/3 Chapter 3',
    ]);
    expect(listTranslationTasks(t.db)).toEqual([]);
    expect(listTranslatedLanguages(t.db, t.novelId)).toEqual([{ lang: 'fr', count: 3 }]);
    expect(changes).toBeGreaterThan(0);
    // Already translated chapters are not queued again, unless asked.
    expect(enqueueTranslations(t.db, t.ids, 'fr')).toBe(0);
    expect(enqueueTranslations(t.db, t.ids, 'fr', { again: true })).toBe(3);
  });

  it('waits for the user when the engine cannot work at all', async () => {
    const t = setup();
    enqueueTranslations(t.db, t.ids, 'fr');
    t.failWith(new TranslationError('modelMissing', 'fr', 'mlkit'));
    const runner = new TranslationRunner(t.deps, {
      onProgress: () => undefined,
      onChange: () => undefined,
    });
    expect(await runner.run()).toBe('modelMissing');
    expect(listTranslationTasks(t.db).map((task) => task.status)).toEqual([
      'paused',
      'paused',
      'paused',
    ]);
    t.failWith(null);
    resumeTranslations(t.db);
    expect(await runner.run()).toBe('done');
    expect(listTranslatedLanguages(t.db, t.novelId)).toEqual([{ lang: 'fr', count: 3 }]);
  });

  it('keeps a chapter that fails as failed and goes on with the others', async () => {
    const t = setup();
    t.files.delete(`novels/${t.novelId}/chapters/${t.ids[1]}.html`);
    enqueueTranslations(t.db, t.ids, 'fr');
    const runner = new TranslationRunner(t.deps, {
      onProgress: () => undefined,
      onChange: () => undefined,
    });
    expect(await runner.run()).toBe('done');
    const left = listTranslationTasks(t.db);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ chapterId: t.ids[1], status: 'failed', attempts: 1 });
    expect(listTranslatedLanguages(t.db, t.novelId)).toEqual([{ lang: 'fr', count: 2 }]);
    cancelTranslations(t.db, t.novelId);
    expect(listTranslationTasks(t.db)).toEqual([]);
  });
});

describe('glossary of a novel', () => {
  it('keeps terms per pair of languages', () => {
    const t = setup();
    const base = { novelId: t.novelId, sourceLang: 'en', targetLang: 'fr' };
    const id = saveGlossaryTerm(t.db, { ...base, source: 'Sect Leader', target: 'Chef de secte' });
    saveGlossaryTerm(t.db, { ...base, source: 'Lin Feng', target: '' });
    // Same source term: the entry is changed, not duplicated.
    saveGlossaryTerm(t.db, { ...base, source: 'sect leader', target: 'Maître de secte' });
    expect(saveGlossaryTerm(t.db, { ...base, source: '  ', target: 'x' })).toBeNull();
    expect(listGlossary(t.db, t.novelId, 'en', 'fr')).toEqual([
      { id: expect.any(Number), source: 'Lin Feng', target: 'Lin Feng' },
      { id, source: 'sect leader', target: 'Maître de secte' },
    ]);
    expect(listGlossary(t.db, t.novelId, 'fr', 'en')).toEqual([]);
    deleteGlossaryTerm(t.db, id as number);
    expect(listGlossary(t.db, t.novelId, 'en', 'fr')).toHaveLength(1);
  });
});
