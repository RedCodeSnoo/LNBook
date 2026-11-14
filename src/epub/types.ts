/** Result of reading a book file (EPUB or TXT), independent of where it is stored. */
export interface ParsedBook {
  title: string;
  author: string | null;
  /** BCP 47 language code as written in the file, lower case (e.g. "en", "fr"). */
  language: string | null;
  description: string | null;
  cover: ParsedImage | null;
  volumes: ParsedVolume[];
  chapters: ParsedChapter[];
  /** Images referenced by the chapters, keyed by the name used in the chapter HTML. */
  images: Map<string, Uint8Array>;
  /** Stylesheets of the book, concatenated (only with "keep the original formatting"). */
  css: string | null;
}

export interface ParsedVolume {
  title: string;
  origin: 'toc' | 'detected';
}

export interface ParsedChapter {
  title: string;
  /** Index in `volumes`, or null when the chapter is outside any volume. */
  volumeIndex: number | null;
  /** Cleaned HTML (see services/html). Images use `images/<name>` sources. */
  html: string;
  wordCount: number;
}

export interface ParsedImage {
  data: Uint8Array;
  /** File extension without dot: jpg, png, webp, gif, svg. */
  extension: string;
}

export type BookErrorCode = 'drm' | 'corrupted' | 'empty' | 'unsupported';

export class BookImportError extends Error {
  constructor(
    readonly code: BookErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BookImportError';
  }
}

export interface EpubParseOptions {
  keepFormatting?: boolean;
  /** Title used when the file has none (usually the file name). */
  fallbackTitle?: string;
}
