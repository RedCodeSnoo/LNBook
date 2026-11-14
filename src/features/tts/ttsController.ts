/**
 * Reading aloud. The native player says the sentences of one chapter; this controller
 * prepares them, follows the playback (highlight, position, listening time) and chains
 * the chapters. It does not depend on the reader screen: it keeps going with the screen
 * off, driven by the events of the native player.
 */
import type { AppDatabase } from '../../db/client';
import type { Chapter, Novel } from '../../db/schema';
import type { SourcePlugin } from '../../plugins/types';
import type { FileStore } from '../../services/fileStore';
import { fetchChapterText } from '../browse/sourceNovels';
import { extractBlockTexts } from '../reader/blocks';
import { parseAnchor } from '../reader/readerHtml';
import {
  listReplacementRules,
  loadReaderContext,
  prepareChapterHtml,
  readChapterHtml,
  saveReadingPosition,
  type ReaderContext,
} from '../reader/readerRepository';
import { ReadingTimer } from '../stats/readingTimer';
import { saveSession } from '../stats/sessionsRepository';
import { paragraphStart, sentenceIndexAt, spokenSentences, type Sentence } from './sentences';

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused';

export type SleepTimer =
  | { kind: 'none' }
  /** Stops at a given time. */
  | { kind: 'time'; endsAt: number }
  /** Stops at the end of the n-th chapter from now (1 = end of the current chapter). */
  | { kind: 'chapters'; left: number };

export type StartFrom =
  | { kind: 'start' }
  /** Where the reader stopped in the chapter. */
  | { kind: 'position' }
  /** A precise place: block and character. */
  | { kind: 'place'; b: number; o: number };

export interface TtsSnapshot {
  status: TtsStatus;
  novelId: number | null;
  chapterId: number | null;
  index: number;
  total: number;
  /** Sentence being said, to highlight it in the reader. */
  sentence: Sentence | null;
  sleep: SleepTimer;
  /** Why reading could not start or go on. */
  error: 'engine' | 'noText' | null;
}

export const IDLE_SNAPSHOT: TtsSnapshot = {
  status: 'idle',
  novelId: null,
  chapterId: null,
  index: 0,
  total: 0,
  sentence: null,
  sleep: { kind: 'none' },
  error: null,
};

export interface VoiceSettings {
  engine: string;
  rate: number;
  pitch: number;
  pauseMs: number;
  autoNext: boolean;
  /** Voice identifier and language tag to use for a language code (null = original). */
  voiceFor(language: string | null): { voice: string | null; locale: string | null };
  readThreshold: number;
  incognito: boolean;
}

/** What the controller needs from the native player. */
export interface NativePlayer {
  configure(
    rate: number,
    pitch: number,
    pauseMs: number,
    voice: string | null,
    language: string | null,
  ): void;
  load(options: {
    engine: string | null;
    sentences: string[];
    endsBlock: boolean[];
    start: number;
    autoplay: boolean;
    title: string;
    subtitle: string;
    coverPath: string | null;
    hasNext: boolean;
    hasPrevious: boolean;
    labels: Record<string, string>;
  }): Promise<boolean>;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(index: number): void;
  setSleepTimer(ms: number): void;
}

export interface TtsDeps {
  db: () => AppDatabase;
  files: FileStore;
  native: NativePlayer;
  getPlugin: (pluginId: string) => SourcePlugin;
  settings: () => VoiceSettings;
  labels: () => Record<string, string>;
  /** Absolute path of a file of the app, for the cover shown in the notification. */
  absolutePath: (path: string) => string;
  now: () => number;
  onChange: (snapshot: TtsSnapshot) => void;
  /** Data changed in the database (progress, time): screens must refresh. */
  onDataChanged: () => void;
  /**
   * Text of a chapter as displayed in the given language, when it is not the stored
   * original (a translation). Returns null to use the original.
   */
  displayedHtml?: (novel: Novel, chapter: Chapter) => string | null;
}

/** Positions are saved every few sentences, and whenever the voice stops. */
const SAVE_EVERY = 4;
const MIN_SESSION_MS = 3000;

export class TtsController {
  private snapshot: TtsSnapshot = IDLE_SNAPSHOT;
  private context: ReaderContext | null = null;
  private sentences: Sentence[] = [];
  private blocks: string[] = [];
  private lang: string | null = null;
  /** Changes with every chapter load: late answers of an older load are ignored. */
  private loadId = 0;
  private listening: {
    timer: ReadingTimer;
    chapterId: number;
    novelId: number;
    sessionId?: number;
    startIndex: number;
    maxIndex: number;
    lang: string | null;
  } | null = null;
  private dataChanged = false;

  constructor(private readonly deps: TtsDeps) {}

  get state(): TtsSnapshot {
    return this.snapshot;
  }

  private set(patch: Partial<TtsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.deps.onChange(this.snapshot);
  }

  // ------------------------------------------------------------------ starting

  private applyVoice(): void {
    const settings = this.deps.settings();
    const { voice, locale } = settings.voiceFor(this.lang);
    this.deps.native.configure(settings.rate, settings.pitch, settings.pauseMs, voice, locale);
  }

  /** Settings changed while reading: the voice follows at once. */
  settingsChanged(): void {
    if (this.snapshot.status !== 'idle') {
      this.applyVoice();
    }
  }

  /** Starts reading a chapter aloud. Fetches its text first when it is not on the phone. */
  async start(chapterId: number, from: StartFrom = { kind: 'position' }): Promise<boolean> {
    const { db, files, native } = this.deps;
    const loadId = (this.loadId += 1);
    this.checkpoint(true);
    let context = loadReaderContext(db(), chapterId);
    if (!context) {
      return false;
    }
    this.set({
      status: 'loading',
      novelId: context.novel.id,
      chapterId,
      index: 0,
      total: 0,
      sentence: null,
      error: null,
    });

    let html = this.deps.displayedHtml?.(context.novel, context.chapter) ?? null;
    if (html === null) {
      html = readChapterHtml(files, context.chapter);
    }
    if (html === null && context.novel.origin === 'online' && context.novel.pluginId) {
      try {
        html = await fetchChapterText(
          db(),
          files,
          this.deps.getPlugin(context.novel.pluginId),
          context.chapter,
        );
        this.dataChanged = true;
      } catch {
        html = null;
      }
      if (loadId !== this.loadId) {
        return false;
      }
      context = loadReaderContext(db(), chapterId) ?? context;
    }
    if (html === null) {
      this.fail('noText');
      return false;
    }

    const prepared = prepareChapterHtml(html, listReplacementRules(db(), context.novel.id));
    this.blocks = extractBlockTexts(prepared);
    this.sentences = spokenSentences(prepared, this.blocks);
    this.context = context;
    this.lang = context.novel.readingLang ?? context.novel.originalLang ?? null;
    if (this.sentences.length === 0) {
      // Nothing to say (a chapter of images): go on with the next one.
      return this.afterChapter(loadId);
    }

    let index = 0;
    if (from.kind === 'place') {
      index = sentenceIndexAt(this.sentences, from.b, from.o);
    } else if (from.kind === 'position' && context.chapter.progress < 1) {
      const anchor = parseAnchor(context.chapter.positionAnchor);
      index = anchor ? sentenceIndexAt(this.sentences, anchor.b, anchor.o) : 0;
    }

    this.applyVoice();
    const cover = context.novel.coverPath;
    const loaded = await native.load({
      engine: this.deps.settings().engine || null,
      sentences: this.sentences.map((sentence) => sentence.text),
      endsBlock: this.sentences.map((sentence) => sentence.endsBlock),
      start: index,
      autoplay: true,
      title: context.novel.title,
      subtitle: context.chapter.title,
      coverPath:
        cover && !/^https?:/i.test(cover) && files.exists(cover)
          ? this.deps.absolutePath(cover)
          : null,
      hasNext: context.next !== null,
      hasPrevious: context.previous !== null,
      labels: this.deps.labels(),
    });
    if (loadId !== this.loadId) {
      return false;
    }
    if (!loaded) {
      this.fail('engine');
      return false;
    }
    this.set({
      novelId: context.novel.id,
      chapterId,
      index,
      total: this.sentences.length,
      sentence: this.sentences[index] ?? null,
    });
    return true;
  }

  private fail(error: 'engine' | 'noText'): void {
    this.deps.native.stop();
    this.reset(error);
  }

  private reset(error: TtsSnapshot['error'] = null): void {
    this.checkpoint(true);
    this.context = null;
    this.sentences = [];
    this.blocks = [];
    this.set({ ...IDLE_SNAPSHOT, error });
    this.flushDataChanged();
  }

  // ------------------------------------------------------------------ native events

  /** The native player changed state (also from the notification or a headset). */
  onNativeState(state: 'stopped' | 'playing' | 'paused', index: number): void {
    if (this.snapshot.status === 'idle' && state !== 'stopped') {
      return;
    }
    if (state === 'stopped') {
      if (this.snapshot.status !== 'idle' && this.snapshot.status !== 'loading') {
        this.savePosition();
        this.reset();
      }
      return;
    }
    if (state === 'playing') {
      this.beginListening();
      this.listening?.timer.activity(this.deps.now());
      this.set({ status: 'playing' });
    } else {
      this.set({ status: 'paused', index, sentence: this.sentences[index] ?? null });
      this.listening?.timer.pause(this.deps.now());
      this.savePosition();
      this.checkpoint(false);
      this.flushDataChanged();
    }
  }

  /** A sentence starts. */
  onNativeSentence(index: number): void {
    if (this.snapshot.status === 'idle' || index >= this.sentences.length) {
      return;
    }
    this.set({ index, sentence: this.sentences[index] });
    if (this.snapshot.status === 'playing') {
      this.beginListening();
      const listening = this.listening;
      if (listening) {
        listening.timer.activity(this.deps.now());
        listening.maxIndex = Math.max(listening.maxIndex, index);
      }
    }
    if (index % SAVE_EVERY === 0) {
      this.savePosition();
    }
  }

  /** The last sentence of the chapter was said. */
  onNativeFinished(): void {
    if (this.snapshot.status === 'idle') {
      return;
    }
    void this.afterChapter(this.loadId);
  }

  /** "Next" or "previous" from the notification, the lock screen or a headset. */
  onNativeCommand(command: 'next' | 'previous'): void {
    const target = command === 'next' ? this.context?.next : this.context?.previous;
    if (target) {
      this.savePosition();
      void this.start(target.id, { kind: 'start' });
    }
  }

  /** The sleep timer stopped the voice. */
  onNativeSleep(): void {
    this.set({ sleep: { kind: 'none' } });
  }

  onNativeError(): void {
    if (this.snapshot.status !== 'idle') {
      this.fail('engine');
    }
  }

  /** End of a chapter: it becomes read, then the next one starts (unless told not to). */
  private async afterChapter(loadId: number): Promise<boolean> {
    const context = this.context;
    if (!context) {
      return false;
    }
    const listening = this.listening;
    if (listening) {
      listening.maxIndex = this.sentences.length;
    }
    saveReadingPosition(
      this.deps.db(),
      context.chapter.id,
      { progress: 1, anchor: null },
      this.deps.settings().readThreshold,
      this.deps.now(),
    );
    this.dataChanged = true;
    this.checkpoint(true);

    let sleep = this.snapshot.sleep;
    let stopHere = false;
    if (sleep.kind === 'chapters') {
      const left = sleep.left - 1;
      stopHere = left <= 0;
      sleep = stopHere ? { kind: 'none' } : { kind: 'chapters', left };
      this.set({ sleep });
    }
    if (stopHere || !this.deps.settings().autoNext || !context.next) {
      this.deps.native.stop();
      this.reset();
      return false;
    }
    if (loadId !== this.loadId) {
      return false;
    }
    this.flushDataChanged();
    return this.start(context.next.id, { kind: 'start' });
  }

  // ------------------------------------------------------------------ commands

  toggle(): void {
    if (this.snapshot.status === 'playing') {
      this.deps.native.pause();
    } else if (this.snapshot.status === 'paused') {
      this.deps.native.play();
    }
  }

  pause(): void {
    if (this.snapshot.status === 'playing') {
      this.deps.native.pause();
    }
  }

  stop(): void {
    if (this.snapshot.status === 'idle') {
      return;
    }
    this.loadId += 1;
    this.savePosition();
    this.deps.native.stop();
    this.reset();
  }

  private seek(index: number): void {
    if (this.snapshot.status !== 'playing' && this.snapshot.status !== 'paused') {
      return;
    }
    if (index >= this.sentences.length) {
      // Past the last sentence: same as the end of the chapter.
      void this.afterChapter(this.loadId);
      return;
    }
    const target = Math.max(0, index);
    this.set({ index: target, sentence: this.sentences[target] ?? null });
    this.deps.native.seekTo(target);
  }

  stepSentence(direction: 1 | -1): void {
    this.seek(this.snapshot.index + direction);
  }

  stepParagraph(direction: 1 | -1): void {
    this.seek(paragraphStart(this.sentences, this.snapshot.index, direction));
  }

  /** Reads from a place of the chapter being read (tap on "read from here"). */
  seekToPlace(b: number, o: number): void {
    this.seek(sentenceIndexAt(this.sentences, b, o));
  }

  setSleepTimer(timer: SleepTimer): void {
    this.deps.native.setSleepTimer(
      timer.kind === 'time' ? Math.max(1000, timer.endsAt - this.deps.now()) : 0,
    );
    this.set({ sleep: timer });
  }

  // ------------------------------------------------------------------ position, time

  private savePosition(): void {
    const context = this.context;
    const sentence = this.sentences[this.snapshot.index];
    if (!context || !sentence || this.sentences.length === 0) {
      return;
    }
    const block = this.blocks[sentence.b] ?? '';
    saveReadingPosition(
      this.deps.db(),
      context.chapter.id,
      {
        // The end of the chapter is only reached when its last sentence has been said.
        progress: Math.min(0.99, this.snapshot.index / this.sentences.length),
        anchor: { b: sentence.b, o: sentence.start, c: block.substr(sentence.start, 30) },
      },
      // Listening only marks a chapter as read at its very end.
      2,
      this.deps.now(),
    );
    this.dataChanged = true;
  }

  private beginListening(): void {
    const context = this.context;
    if (!context || this.listening?.chapterId === context.chapter.id) {
      return;
    }
    this.checkpoint(true);
    this.listening = {
      timer: new ReadingTimer(this.deps.now()),
      chapterId: context.chapter.id,
      novelId: context.novel.id,
      startIndex: this.snapshot.index,
      maxIndex: this.snapshot.index,
      lang: context.novel.readingLang ?? null,
    };
  }

  /** Writes the listening time so far; `end` closes the session of the chapter. */
  private checkpoint(end: boolean): void {
    const listening = this.listening;
    if (!listening) {
      return;
    }
    if (end) {
      this.listening = null;
    }
    if (this.deps.settings().incognito) {
      return;
    }
    const now = this.deps.now();
    const durationMs = listening.timer.elapsed(now);
    if (durationMs < MIN_SESSION_MS) {
      return;
    }
    let words = 0;
    for (
      let i = listening.startIndex;
      i < listening.maxIndex && i < this.sentences.length;
      i += 1
    ) {
      words += this.sentences[i].text.split(/\s+/).length;
    }
    listening.sessionId = saveSession(
      this.deps.db(),
      {
        novelId: listening.novelId,
        chapterId: listening.chapterId,
        startedAt: listening.timer.startedAt,
        endedAt: listening.timer.endedAt(now),
        durationMs,
        mode: 'listen',
        words,
        lang: listening.lang,
      },
      listening.sessionId,
    );
    this.dataChanged = true;
  }

  private flushDataChanged(): void {
    if (this.dataChanged) {
      this.dataChanged = false;
      this.deps.onDataChanged();
    }
  }
}
