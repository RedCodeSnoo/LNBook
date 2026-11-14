import { eq } from 'drizzle-orm';

import { chapters, history, novels, readingSessions } from '../../../db/schema';
import { createTestDatabase } from '../../../db/testing';
import type { SourcePlugin } from '../../../plugins/types';
import { MemoryFileStore } from '../../../services/fileStore';
import {
  TtsController,
  type NativePlayer,
  type TtsSnapshot,
  type VoiceSettings,
} from '../ttsController';
import {
  chosenVoice,
  defaultLocale,
  voiceLabel,
  voiceLanguages,
  voicesForLanguage,
} from '../voices';

function setup(options: { online?: boolean; chapterCount?: number } = {}) {
  const { db } = createTestDatabase();
  const files = new MemoryFileStore();
  const novelId = db
    .insert(novels)
    .values({
      origin: options.online ? 'online' : 'local',
      pluginId: options.online ? 'demo' : null,
      sourcePath: options.online ? '/n' : null,
      title: 'Saga',
      originalLang: 'en',
      inLibrary: true,
      createdAt: 1,
      updatedAt: 1,
    })
    .returning({ id: novels.id })
    .get().id;
  const ids: number[] = [];
  for (let i = 0; i < (options.chapterCount ?? 3); i += 1) {
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
      files.writeText(path, `<p>One ${i + 1}. Two ${i + 1}.</p><p>Three ${i + 1}.</p>`);
      db.update(chapters).set({ filePath: path }).where(eq(chapters.id, id)).run();
    }
    ids.push(id);
  }

  const calls: string[] = [];
  const loads: Parameters<NativePlayer['load']>[0][] = [];
  let loadOk = true;
  const native: NativePlayer = {
    configure: (rate, pitch, pauseMs, voice, language) =>
      calls.push(`configure ${rate} ${pitch} ${pauseMs} ${voice} ${language}`),
    load: async (load) => {
      loads.push(load);
      return loadOk;
    },
    play: () => calls.push('play'),
    pause: () => calls.push('pause'),
    stop: () => calls.push('stop'),
    seekTo: (index) => calls.push(`seek ${index}`),
    setSleepTimer: (ms) => calls.push(`sleep ${ms}`),
  };
  let now = 1_000_000;
  const settings: VoiceSettings = {
    engine: '',
    rate: 1.2,
    pitch: 1,
    pauseMs: 300,
    autoNext: true,
    voiceFor: (language) => ({ voice: language === 'en' ? 'en-voice' : null, locale: language }),
    readThreshold: 0.95,
    incognito: false,
  };
  const snapshots: TtsSnapshot[] = [];
  let dataChanges = 0;
  const controller = new TtsController({
    db: () => db,
    files,
    native,
    getPlugin: () =>
      ({
        id: 'demo',
        name: 'Demo',
        site: 'https://demo.test',
        version: '1',
        parseChapter: async (path: string) => `<p>Online text of ${path}. More.</p>`,
      }) as unknown as SourcePlugin,
    settings: () => settings,
    labels: () => ({ play: 'Play' }),
    absolutePath: (path) => `/data/${path}`,
    now: () => now,
    onChange: (snapshot) => snapshots.push(snapshot),
    onDataChanged: () => {
      dataChanges += 1;
    },
  });
  /** Lets the awaited load answer be handled. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  return {
    db,
    files,
    ids,
    novelId,
    controller,
    calls,
    loads,
    settings,
    settle,
    advance: (ms: number) => {
      now += ms;
    },
    failLoads: () => {
      loadOk = false;
    },
    dataChanges: () => dataChanges,
  };
}

describe('reading aloud', () => {
  it('gives the sentences of the chapter to the player with the voice of its language', async () => {
    const t = setup();
    expect(await t.controller.start(t.ids[0], { kind: 'start' })).toBe(true);
    expect(t.calls[0]).toBe('configure 1.2 1 300 en-voice en');
    expect(t.loads[0]).toMatchObject({
      sentences: ['One 1.', 'Two 1.', 'Three 1.'],
      endsBlock: [false, true, true],
      start: 0,
      autoplay: true,
      title: 'Saga',
      subtitle: 'Chapter 1',
      hasNext: true,
      hasPrevious: false,
    });
    expect(t.controller.state).toMatchObject({ chapterId: t.ids[0], total: 3, index: 0 });
    t.controller.onNativeState('playing', 0);
    expect(t.controller.state.status).toBe('playing');
  });

  it('starts where the reader stopped, or at a chosen place', async () => {
    const t = setup();
    t.db
      .update(chapters)
      .set({ progress: 0.5, positionAnchor: JSON.stringify({ b: 1, o: 0, c: '' }) })
      .where(eq(chapters.id, t.ids[0]))
      .run();
    await t.controller.start(t.ids[0]);
    expect(t.loads[0].start).toBe(2);
    await t.controller.start(t.ids[0], { kind: 'place', b: 0, o: 8 });
    expect(t.loads[1].start).toBe(1);
    expect(t.controller.state.sentence).toMatchObject({ b: 0, start: 7, end: 13 });
  });

  it('follows the sentences, saves the position and the listening time', async () => {
    const t = setup();
    await t.controller.start(t.ids[0], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.controller.onNativeSentence(0);
    t.advance(20_000);
    t.controller.onNativeSentence(1);
    t.advance(20_000);
    t.controller.onNativeState('paused', 1);
    expect(t.controller.state).toMatchObject({ status: 'paused', index: 1 });
    const chapter = t.db.select().from(chapters).where(eq(chapters.id, t.ids[0])).get();
    expect(chapter?.isRead).toBe(false);
    expect(JSON.parse(chapter?.positionAnchor ?? '{}')).toMatchObject({ b: 0, o: 7 });
    const sessions = t.db.select().from(readingSessions).all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ mode: 'listen', durationMs: 40_000, chapterId: t.ids[0] });
    expect(t.db.select().from(history).all()).toHaveLength(1);
    expect(t.dataChanges()).toBeGreaterThan(0);

    // Resuming continues the same session: time is not counted twice.
    t.controller.toggle();
    expect(t.calls).toContain('play');
    t.controller.onNativeState('playing', 1);
    t.advance(10_000);
    t.controller.onNativeState('paused', 1);
    const after = t.db.select().from(readingSessions).all();
    expect(after).toHaveLength(1);
    expect(after[0].durationMs).toBe(50_000);
  });

  it('marks the chapter as read and goes on with the next one', async () => {
    const t = setup();
    await t.controller.start(t.ids[0], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.advance(5_000);
    t.controller.onNativeFinished();
    await t.settle();
    expect(t.db.select().from(chapters).where(eq(chapters.id, t.ids[0])).get()).toMatchObject({
      isRead: true,
      progress: 1,
    });
    expect(t.loads).toHaveLength(2);
    expect(t.loads[1]).toMatchObject({ subtitle: 'Chapter 2', start: 0, hasPrevious: true });
    expect(t.controller.state.chapterId).toBe(t.ids[1]);
  });

  it('stops at the end of the book, or when chaining is turned off', async () => {
    const t = setup({ chapterCount: 1 });
    await t.controller.start(t.ids[0], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.controller.onNativeFinished();
    await t.settle();
    expect(t.calls).toContain('stop');
    expect(t.controller.state.status).toBe('idle');

    const other = setup();
    other.settings.autoNext = false;
    await other.controller.start(other.ids[0], { kind: 'start' });
    other.controller.onNativeState('playing', 0);
    other.controller.onNativeFinished();
    await other.settle();
    expect(other.loads).toHaveLength(1);
    expect(other.controller.state.status).toBe('idle');
  });

  it('has a sleep timer: a duration, or the end of n chapters', async () => {
    const t = setup();
    await t.controller.start(t.ids[0], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.controller.setSleepTimer({ kind: 'time', endsAt: 1_000_000 + 15 * 60_000 });
    expect(t.calls).toContain(`sleep ${15 * 60_000}`);
    t.controller.onNativeSleep();
    expect(t.controller.state.sleep).toEqual({ kind: 'none' });

    t.controller.setSleepTimer({ kind: 'chapters', left: 2 });
    expect(t.calls[t.calls.length - 1]).toBe('sleep 0');
    t.controller.onNativeFinished();
    await t.settle();
    expect(t.controller.state).toMatchObject({
      chapterId: t.ids[1],
      sleep: { kind: 'chapters', left: 1 },
    });
    t.controller.onNativeState('playing', 0);
    t.controller.onNativeFinished();
    await t.settle();
    expect(t.controller.state.status).toBe('idle');
    expect(t.loads).toHaveLength(2);
  });

  it('moves by sentence and by paragraph, and to other chapters from the notification', async () => {
    const t = setup();
    await t.controller.start(t.ids[1], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.controller.stepSentence(1);
    expect(t.calls[t.calls.length - 1]).toBe('seek 1');
    t.controller.stepParagraph(1);
    expect(t.calls[t.calls.length - 1]).toBe('seek 2');
    t.controller.stepParagraph(-1);
    expect(t.calls[t.calls.length - 1]).toBe('seek 0');
    t.controller.stepSentence(-1);
    expect(t.calls[t.calls.length - 1]).toBe('seek 0');

    t.controller.onNativeCommand('previous');
    await t.settle();
    expect(t.controller.state.chapterId).toBe(t.ids[0]);
    t.controller.onNativeCommand('next');
    await t.settle();
    expect(t.controller.state.chapterId).toBe(t.ids[1]);
  });

  it('fetches the text of an online chapter before reading it', async () => {
    const t = setup({ online: true });
    expect(await t.controller.start(t.ids[0], { kind: 'start' })).toBe(true);
    expect(t.loads[0].sentences).toEqual(['Online text of /c/1.', 'More.']);
    expect(t.files.exists(`novels/${t.novelId}/chapters/${t.ids[0]}.html`)).toBe(true);
  });

  it('reports what prevents reading', async () => {
    const t = setup();
    t.files.delete(`novels/${t.novelId}`);
    expect(await t.controller.start(t.ids[0])).toBe(false);
    expect(t.controller.state).toMatchObject({ status: 'idle', error: 'noText' });

    const other = setup();
    other.failLoads();
    expect(await other.controller.start(other.ids[0])).toBe(false);
    expect(other.controller.state).toMatchObject({ status: 'idle', error: 'engine' });
  });

  it('writes nothing about time in incognito mode, and stops cleanly', async () => {
    const t = setup();
    t.settings.incognito = true;
    await t.controller.start(t.ids[0], { kind: 'start' });
    t.controller.onNativeState('playing', 0);
    t.advance(60_000);
    t.controller.stop();
    expect(t.db.select().from(readingSessions).all()).toHaveLength(0);
    expect(t.controller.state.status).toBe('idle');
    // The native player then reports "stopped": nothing more happens.
    t.controller.onNativeState('stopped', 0);
    expect(t.controller.state.status).toBe('idle');
  });
});

describe('voices', () => {
  const voices = [
    { id: 'fr-fr-x-vlf-network', locale: 'fr-FR', quality: 400, network: true, installed: true },
    { id: 'fr-fr-x-vlf-local', locale: 'fr-FR', quality: 400, network: false, installed: true },
    { id: 'fr-ca-x-caa-local', locale: 'fr-CA', quality: 300, network: false, installed: false },
    { id: 'en-us-x-sfg-local', locale: 'en-US', quality: 400, network: false, installed: true },
  ];

  it('lists the voices of a language, the best first', () => {
    expect(voicesForLanguage(voices, 'fr').map((voice) => voice.id)).toEqual([
      'fr-fr-x-vlf-local',
      'fr-fr-x-vlf-network',
      'fr-ca-x-caa-local',
    ]);
    expect(voiceLanguages(voices)).toEqual(['en', 'fr']);
    expect(voiceLabel(voices[1])).toBe('FR · vlf');
  });

  it('keeps one voice per language', () => {
    const remembered = { fr: 'fr-fr-x-vlf-local', en: 'gone' };
    expect(chosenVoice(voices, remembered, 'fr-FR')).toBe('fr-fr-x-vlf-local');
    expect(chosenVoice(voices, remembered, 'en')).toBeNull();
    expect(chosenVoice(voices, remembered, null)).toBeNull();
    expect(defaultLocale('fr', ['en-US', 'fr-CA'])).toBe('fr-CA');
    expect(defaultLocale('de', ['en-US'])).toBe('de');
    expect(defaultLocale(null, ['en-US'])).toBeNull();
  });
});
