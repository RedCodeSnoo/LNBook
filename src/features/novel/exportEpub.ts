/** Builds the EPUB of a novel from what is stored on the phone. */
import type { AppDatabase } from '../../db/client';
import { buildEpub, type EpubBook } from '../../epub/buildEpub';
import { novelDir, type FileStore } from '../../services/fileStore';
import { getNovel, listChapters, listVolumes } from './novelRepository';

export interface ExportOptions {
  /** UUID of the publication. */
  identifier: string;
  /** First and last chapter to include (1-based, in list order); everything by default. */
  from?: number;
  to?: number;
  /** Cover to use when the cover of the novel is not a local file (online novels). */
  cover?: { data: Uint8Array; extension: string } | null;
  now?: Date;
}

export interface ExportResult {
  book: EpubBook;
  /** Chapters of the range that are not on the phone and were left out. */
  missing: number;
}

const isRemote = (path: string) => /^(https?:|content:|data:)/i.test(path);

/** Gathers the chapters, volumes, images and cover of a novel. Null when nothing can be exported. */
export function novelToEpubBook(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  options: ExportOptions,
): ExportResult | null {
  const novel = getNovel(db, novelId);
  if (!novel) {
    return null;
  }
  const all = listChapters(db, novelId);
  const from = Math.max(1, options.from ?? 1);
  const to = Math.min(all.length, options.to ?? all.length);
  const wanted = all.slice(from - 1, to);
  const available = wanted.filter((chapter) => chapter.filePath && files.exists(chapter.filePath));
  if (available.length === 0) {
    return null;
  }

  // Only the volumes that still have a chapter in the export are kept.
  const volumeTitles = new Map(listVolumes(db, novelId).map((volume) => [volume.id, volume.title]));
  const volumes: string[] = [];
  const volumeIndex = new Map<number, number>();
  const chapters = available.map((chapter) => {
    let index: number | null = null;
    if (chapter.volumeId !== null && volumeTitles.has(chapter.volumeId)) {
      if (!volumeIndex.has(chapter.volumeId)) {
        volumeIndex.set(chapter.volumeId, volumes.length);
        volumes.push(volumeTitles.get(chapter.volumeId) as string);
      }
      index = volumeIndex.get(chapter.volumeId) as number;
    }
    return {
      title: chapter.title,
      volumeIndex: index,
      html: files.readText(chapter.filePath as string),
    };
  });

  const images = new Map<string, Uint8Array>();
  const imageDir = `${novelDir(novelId)}/images`;
  for (const name of files.list(imageDir)) {
    images.set(name, files.readBytes(`${imageDir}/${name}`));
  }

  let cover = options.cover ?? null;
  if (!cover && novel.coverPath && !isRemote(novel.coverPath) && files.exists(novel.coverPath)) {
    cover = {
      data: files.readBytes(novel.coverPath),
      extension: /\.([A-Za-z0-9]+)$/.exec(novel.coverPath)?.[1] ?? 'jpg',
    };
  }

  return {
    book: {
      identifier: options.identifier,
      title: novel.title,
      author: novel.author,
      language: novel.originalLang,
      description: novel.description,
      cover,
      volumes,
      chapters,
      images,
      modified: options.now ?? new Date(),
    },
    missing: wanted.length - available.length,
  };
}

/** File name proposed for an exported novel. */
export function epubFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${cleaned || 'novel'}.epub`;
}

export function exportNovelEpub(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  options: ExportOptions,
): { data: Uint8Array; missing: number; fileName: string } | null {
  const result = novelToEpubBook(db, files, novelId, options);
  if (!result) {
    return null;
  }
  return {
    data: buildEpub(result.book),
    missing: result.missing,
    fileName: epubFileName(result.book.title),
  };
}
