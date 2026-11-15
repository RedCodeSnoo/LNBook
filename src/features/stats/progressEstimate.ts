/**
 * "Set my progress": time estimated for chapters read elsewhere (another app, paper…),
 * from their number of words and a reading speed. Pure functions.
 */

/** Speed used when no real session can measure it. */
export const DEFAULT_SPEED_WPM = 250;
/** Words per chapter used when no chapter of the novel has a known text. */
export const DEFAULT_WORDS_PER_CHAPTER = 2500;
export const MIN_SPEED_WPM = 30;
export const MAX_SPEED_WPM = 2000;

export interface EstimateChapter {
  id: number;
  /** Words of the text in the chosen language; null when the text is not on the phone. */
  words: number | null;
  /** True when real reading or listening time exists: it is kept as it is. */
  hasRealTime: boolean;
}

export interface EstimateEntry {
  chapterId: number;
  words: number;
  ms: number;
}

export interface ProgressEstimate {
  /** Chapters marked as read. */
  chapters: number;
  /** Words of every marked chapter (exact or estimated). */
  words: number;
  /** Time added: chapters that have no real time. */
  estimatedMs: number;
  /** Chapters whose number of words comes from the "words per chapter" field. */
  usingAverage: number;
  /** Chapters that keep their real time. */
  keptReal: number;
  /** One session to store per chapter without real time. */
  entries: EstimateEntry[];
}

/** Reading time of a number of words, in milliseconds. */
export function readingTimeMs(words: number, speedWpm: number): number {
  if (words <= 0 || speedWpm <= 0) {
    return 0;
  }
  return Math.round((words / speedWpm) * 60_000);
}

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return DEFAULT_SPEED_WPM;
  }
  return Math.round(Math.min(MAX_SPEED_WPM, Math.max(MIN_SPEED_WPM, speed)));
}

export function estimateProgress(
  chapters: EstimateChapter[],
  speedWpm: number,
  wordsPerChapter: number,
): ProgressEstimate {
  const speed = clampSpeed(speedWpm);
  const fallback = Math.max(0, Math.round(wordsPerChapter));
  const result: ProgressEstimate = {
    chapters: chapters.length,
    words: 0,
    estimatedMs: 0,
    usingAverage: 0,
    keptReal: 0,
    entries: [],
  };
  for (const chapter of chapters) {
    const known = chapter.words !== null && chapter.words > 0;
    const words = known ? (chapter.words as number) : fallback;
    if (!known) {
      result.usingAverage += 1;
    }
    result.words += words;
    if (chapter.hasRealTime) {
      result.keptReal += 1;
      continue;
    }
    const ms = readingTimeMs(words, speed);
    result.estimatedMs += ms;
    result.entries.push({ chapterId: chapter.id, words, ms });
  }
  return result;
}

/** Average words of the chapters whose text is known, or the default value. */
export function averageWordsPerChapter(words: (number | null)[]): number {
  const known = words.filter((value): value is number => value !== null && value > 0);
  if (known.length === 0) {
    return DEFAULT_WORDS_PER_CHAPTER;
  }
  return Math.round(known.reduce((sum, value) => sum + value, 0) / known.length);
}

/** "1,2 M", "45 k", "980" (decimal mark of the language). */
export function formatWordCount(words: number, language: string): string {
  const decimal = (value: number) =>
    (Math.round(value * 10) / 10).toString().replace('.', language.startsWith('fr') ? ',' : '.');
  if (words >= 1_000_000) {
    return `${decimal(words / 1_000_000)} M`;
  }
  if (words >= 10_000) {
    return `${Math.round(words / 1000)} k`;
  }
  return String(Math.round(words));
}

/** Values typed in the sheet, remembered per novel. */
export interface ProgressInputs {
  lastChapterId: number | null;
  speedWpm: number;
  wordsPerChapter: number | null;
  /** null = original language. */
  lang: string | null;
}
