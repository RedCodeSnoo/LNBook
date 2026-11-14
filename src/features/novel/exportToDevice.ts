/** "Export as EPUB": builds the file, then saves it in a chosen folder or shares it. */
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { getDb } from '../../db/client';
import { deviceFiles } from '../../services/deviceFileStore';
import { exportNovelEpub, type ExportOptions } from './exportEpub';
import { getNovel } from './novelRepository';

const EPUB_MIME = 'application/epub+zip';

/** Cover of an online novel: fetched so that the EPUB has one too. */
async function remoteCover(url: string): Promise<ExportOptions['cover']> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    const extension = type.includes('png')
      ? 'png'
      : type.includes('webp')
        ? 'webp'
        : type.includes('gif')
          ? 'gif'
          : 'jpg';
    return { data: new Uint8Array(await response.arrayBuffer()), extension };
  } catch {
    return null;
  }
}

export type ExportOutcome =
  { status: 'saved' | 'shared'; missing: number } | { status: 'empty' | 'cancelled' | 'failed' };

export async function exportNovelToDevice(
  novelId: number,
  target: 'folder' | 'share',
  range: { from?: number; to?: number } = {},
): Promise<ExportOutcome> {
  const novel = getNovel(getDb(), novelId);
  const cover =
    novel?.coverPath && /^https?:/i.test(novel.coverPath)
      ? await remoteCover(novel.coverPath)
      : null;
  const exported = exportNovelEpub(getDb(), deviceFiles, novelId, {
    identifier: randomUUID(),
    cover,
    ...range,
  });
  if (!exported) {
    return { status: 'empty' };
  }
  try {
    if (target === 'folder') {
      let directory: Directory;
      try {
        directory = await Directory.pickDirectoryAsync();
      } catch {
        return { status: 'cancelled' };
      }
      directory.createFile(exported.fileName, EPUB_MIME).write(exported.data);
      return { status: 'saved', missing: exported.missing };
    }
    const file = new File(Paths.cache, exported.fileName);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(exported.data);
    await Sharing.shareAsync(file.uri, { mimeType: EPUB_MIME });
    return { status: 'shared', missing: exported.missing };
  } catch {
    return { status: 'failed' };
  }
}
