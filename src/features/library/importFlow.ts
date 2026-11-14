/**
 * Import of book files chosen by the user (file picker or "Open with").
 * The flow runs file by file and pauses on the dialogs rendered by <ImportHost />:
 * TXT preview and duplicate choice.
 */
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { create } from 'zustand';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { TextEncoding } from '../../epub/encoding';
import { parseEpub } from '../../epub/parseEpub';
import { previewTxt, txtToBook, type TxtPreview } from '../../epub/parseTxt';
import { BookImportError, type BookErrorCode, type ParsedBook } from '../../epub/types';
import i18n from '../../i18n';
import { deviceFiles } from '../../services/deviceFileStore';
import { getSetting } from '../settings/settingsStore';
import { findDuplicateNovel, importParsedBook } from './importBook';

export interface ImportSource {
  name: string;
  uri: string;
}

export type DuplicateChoice = 'replace' | 'keepBoth' | 'skip';

export type ImportStep =
  | { kind: 'idle' }
  | { kind: 'working'; name: string; index: number; total: number }
  | {
      kind: 'txt';
      name: string;
      data: Uint8Array;
      preview: TxtPreview;
      title: string;
      /** null = the user skipped the file. */
      resolve: (result: { preview: TxtPreview; title: string } | null) => void;
    }
  | { kind: 'duplicate'; title: string; resolve: (choice: DuplicateChoice) => void }
  | { kind: 'summary'; imported: string[]; failed: { name: string; reason: string }[] };

export const useImportStore = create<{ step: ImportStep }>(() => ({ step: { kind: 'idle' } }));

const setStep = (step: ImportStep) => useImportStore.setState({ step });

export function closeImportSummary(): void {
  setStep({ kind: 'idle' });
}

/** Lets the interface draw the progress before a long synchronous parse. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 40));

export function baseName(fileName: string): string {
  const name = decodeURIComponent(fileName).split(/[\\/]/).pop() ?? fileName;
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || name;
}

export function fileKind(fileName: string): 'epub' | 'txt' | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.epub')) {
    return 'epub';
  }
  if (lower.endsWith('.txt')) {
    return 'txt';
  }
  return null;
}

const ERROR_KEYS: Record<BookErrorCode, string> = {
  drm: 'import.errorDrm',
  corrupted: 'import.errorCorrupted',
  empty: 'import.errorEmpty',
  unsupported: 'import.errorUnsupported',
};

function errorMessage(error: unknown): string {
  if (error instanceof BookImportError) {
    return i18n.t(ERROR_KEYS[error.code]);
  }
  return i18n.t('import.errorUnknown');
}

/** PK.. = zip archive (EPUB), used when the file name has no usable extension. */
function looksLikeZip(data: Uint8Array): boolean {
  return data[0] === 0x50 && data[1] === 0x4b;
}

/** Text without NUL bytes: a file shared without extension is then read as TXT. */
function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096);
  return sample.length > 0 && !sample.includes(0);
}

async function readBook(source: ImportSource, data: Uint8Array): Promise<ParsedBook | null> {
  const kind =
    fileKind(source.name) ?? (looksLikeZip(data) ? 'epub' : looksLikeText(data) ? 'txt' : null);
  if (kind === 'epub') {
    return parseEpub(data, {
      keepFormatting: getSetting('keepEpubFormatting'),
      fallbackTitle: baseName(source.name),
    });
  }
  if (kind === 'txt') {
    const title = baseName(source.name);
    const preview = previewTxt(data, title);
    const confirmed = await new Promise<{ preview: TxtPreview; title: string } | null>((resolve) =>
      setStep({ kind: 'txt', name: source.name, data, preview, title, resolve }),
    );
    if (!confirmed) {
      return null;
    }
    return txtToBook(confirmed.preview, confirmed.title, (n) =>
      i18n.t('novel.chapterNumber', { number: n }),
    );
  }
  throw new BookImportError('unsupported', 'Unsupported file type');
}

let running = false;

/** Imports the given files one after the other, then shows a summary. */
export async function importFiles(sources: ImportSource[]): Promise<void> {
  if (running || sources.length === 0) {
    return;
  }
  running = true;
  const imported: string[] = [];
  const failed: { name: string; reason: string }[] = [];
  try {
    for (const [index, source] of sources.entries()) {
      setStep({ kind: 'working', name: source.name, index, total: sources.length });
      await nextFrame();
      try {
        const data = await new File(source.uri).bytes();
        const book = await readBook(source, data);
        if (!book) {
          continue;
        }
        const db = getDb();
        let replaceNovelId: number | undefined;
        const duplicate = findDuplicateNovel(db, book.title, book.author);
        if (duplicate !== null) {
          const choice = await new Promise<DuplicateChoice>((resolve) =>
            setStep({ kind: 'duplicate', title: book.title, resolve }),
          );
          if (choice === 'skip') {
            continue;
          }
          replaceNovelId = choice === 'replace' ? duplicate : undefined;
        }
        setStep({ kind: 'working', name: source.name, index, total: sources.length });
        await nextFrame();
        importParsedBook(db, deviceFiles, book, { replaceNovelId });
        imported.push(book.title);
        invalidate('library', 'novel', 'chapters');
      } catch (error) {
        failed.push({ name: source.name, reason: errorMessage(error) });
      }
    }
  } finally {
    running = false;
  }
  if (failed.length > 0 || imported.length > 1) {
    setStep({ kind: 'summary', imported, failed });
  } else {
    setStep({ kind: 'idle' });
  }
}

/** Opens the Android file picker (several files, EPUB and TXT) and imports the choice. */
export async function pickAndImport(): Promise<void> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/epub+zip', 'text/plain', 'application/octet-stream'],
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (result.canceled) {
    return;
  }
  await importFiles(result.assets.map((asset) => ({ name: asset.name, uri: asset.uri })));
}

/** Re-decodes a TXT preview with another encoding. */
export function redecodeTxt(data: Uint8Array, title: string, encoding: TextEncoding): TxtPreview {
  return previewTxt(data, title, encoding);
}
