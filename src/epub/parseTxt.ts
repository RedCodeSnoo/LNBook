/** TXT import: decoding and automatic split into chapters. */
import { countWords, textToHtml } from '../services/html';
import { decodeText, detectEncoding, type TextEncoding } from './encoding';
import { BookImportError, type ParsedBook, type ParsedChapter } from './types';
import { detectVolumes } from './volumes';

const ROMAN = '[IVXLCDM]+';
/** "Chapitre 12", "Chapter 12: Title", "CHAPITRE XII", "Prologue", "Épilogue"… */
const HEADING = new RegExp(
  `^\\s*(?:(?:(?:volume|vol\\.?|tome|livre|book)\\s*(?:\\d+|${ROMAN})\\s*[-–—:,.]?\\s*)?` +
    `(?:chapitre|chapter|chap\\.?|ch\\.)\\s*(?:\\d+(?:\\.\\d+)?|${ROMAN})(?![\\p{L}\\d])` +
    `|prologue|[ée]pilogue|epilogue|interlude|avant-propos|pr[ée]face|preface|postface|afterword)` +
    `.{0,120}$`,
  'iu',
);
/** "第十二章 …" */
const CJK_HEADING = /^\s*第\s*[0-9０-９一二三四五六七八九十百千零〇两]+\s*[章节回話话]/u;
/** Lines made only of separators: ***, * * *, ---, ===, ###. */
const SEPARATOR = /^\s*(?:[*＊#=~_—–-]\s*){3,}$/u;

export interface TxtChapterPreview {
  title: string;
  /** Lines of text of the chapter (without the heading line). */
  text: string;
}

export interface TxtPreview {
  encoding: TextEncoding;
  chapters: TxtChapterPreview[];
}

export function isChapterHeading(line: string): boolean {
  if (line.length > 140) {
    return false;
  }
  return HEADING.test(line) || CJK_HEADING.test(line);
}

/**
 * Splits a text into chapters. Headings start a chapter; without any heading, separator
 * lines (***) are used; without separators, the whole text is one chapter.
 */
export function splitTxtChapters(text: string, fallbackTitle: string): TxtChapterPreview[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const hasHeadings = lines.some(isChapterHeading);
  const chapters: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } = { title: '', lines: [] };

  const close = () => {
    if (current.title !== '' || current.lines.some((line) => line.trim() !== '')) {
      chapters.push(current);
    }
  };

  for (const line of lines) {
    if (hasHeadings ? isChapterHeading(line) : false) {
      close();
      current = { title: line.trim().replace(/\s+/g, ' '), lines: [] };
    } else if (!hasHeadings && SEPARATOR.test(line)) {
      close();
      current = { title: '', lines: [] };
    } else if (!SEPARATOR.test(line)) {
      current.lines.push(line);
    }
  }
  close();

  let untitled = 0;
  return chapters.map((chapter, index) => {
    let title = chapter.title;
    if (!title) {
      if (hasHeadings && index === 0) {
        title = fallbackTitle;
      } else {
        untitled += 1;
        title = chapters.length === 1 ? fallbackTitle : `${untitled}`;
      }
    }
    return { title, text: chapter.lines.join('\n').trim() };
  });
}

export function previewTxt(
  data: Uint8Array,
  fallbackTitle: string,
  encoding?: TextEncoding,
): TxtPreview {
  const used = encoding ?? detectEncoding(data);
  const text = decodeText(data, used);
  return { encoding: used, chapters: splitTxtChapters(text, fallbackTitle) };
}

/**
 * Builds the book from a preview. `untitledLabel` formats the title of a chapter that
 * has no heading (e.g. n => "Chapitre 3").
 */
export function txtToBook(
  preview: TxtPreview,
  title: string,
  untitledLabel: (n: number) => string = (n) => `Chapter ${n}`,
): ParsedBook {
  const chapters: ParsedChapter[] = preview.chapters
    .filter((chapter) => chapter.text !== '')
    .map((chapter) => ({
      title: /^\d+$/.test(chapter.title) ? untitledLabel(Number(chapter.title)) : chapter.title,
      volumeIndex: null,
      html: textToHtml(chapter.text),
      wordCount: countWords(chapter.text),
    }));
  if (chapters.length === 0) {
    throw new BookImportError('empty', 'The text file is empty');
  }
  const detected = detectVolumes(chapters.map((chapter) => chapter.title));
  detected.assignment.forEach((volumeIndex, index) => {
    chapters[index].volumeIndex = volumeIndex;
  });
  return {
    title,
    author: null,
    language: null,
    description: null,
    cover: null,
    volumes: detected.volumes.map((volume) => ({ title: volume.title, origin: 'detected' })),
    chapters,
    images: new Map(),
    css: null,
  };
}
