/** Download of one chapter for offline reading: its text and its images. */
import { eq } from 'drizzle-orm';
import { isTag, type AnyNode } from 'domhandler';
import { render } from 'dom-serializer';
import { parseDocument } from 'htmlparser2';

import type { AppDatabase } from '../../db/client';
import { chapters, type Chapter } from '../../db/schema';
import { isCloudflareChallenge, CloudflareError } from '../../plugins/libs/fetch';
import type { SourcePlugin } from '../../plugins/types';
import { imageFile, type FileStore } from '../../services/fileStore';
import { fetchChapterText } from '../browse/sourceNovels';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

/** Short stable name for an image address (same address = same file). */
export function hashName(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 13);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function extensionOf(url: string, contentType: string): string {
  const fromType = EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()];
  if (fromType) {
    return fromType;
  }
  const match = /\.(jpe?g|png|gif|webp|svg|avif)(?:[?#]|$)/i.exec(url);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

function collectImages(node: AnyNode, out: { attribs: Record<string, string> }[]): void {
  if (!isTag(node)) {
    return;
  }
  if (node.name === 'img') {
    out.push(node);
  }
  for (const child of node.children) {
    collectImages(child, out);
  }
}

export interface ImageResult {
  html: string;
  downloaded: number;
  /** Images that could not be fetched: they keep their web address. */
  failed: number;
}

/**
 * Downloads the remote images of a chapter into the novel folder and points the HTML to
 * the local copies. Requests use the image headers of the plugin (Referer, User-Agent).
 */
export async function downloadChapterImages(
  files: FileStore,
  novelId: number,
  html: string,
  fetcher: typeof fetch,
  requestInit: SourcePlugin['imageRequestInit'],
): Promise<ImageResult> {
  if (!/<img\b/i.test(html)) {
    return { html, downloaded: 0, failed: 0 };
  }
  const document = parseDocument(html, { decodeEntities: true });
  const images: { attribs: Record<string, string> }[] = [];
  for (const child of document.children) {
    collectImages(child, images);
  }
  let downloaded = 0;
  let failed = 0;
  for (const image of images) {
    const source = image.attribs.src ?? '';
    if (!/^https?:\/\//i.test(source)) {
      continue;
    }
    try {
      const response = await fetcher(source, {
        method: requestInit?.method ?? 'GET',
        headers: requestInit?.headers,
        body: requestInit?.body,
      });
      if (await isCloudflareChallenge(response)) {
        throw new CloudflareError(source);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.length === 0) {
        throw new Error('Empty image');
      }
      const type = response.headers?.get?.('content-type') ?? '';
      const name = `${hashName(source)}.${extensionOf(source, type)}`;
      files.writeBytes(imageFile(novelId, name), data);
      image.attribs.src = `images/${name}`;
      downloaded += 1;
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
      failed += 1;
    }
  }
  if (downloaded === 0) {
    return { html, downloaded, failed };
  }
  return {
    html: render(document.children, {
      encodeEntities: 'utf8',
      selfClosingTags: true,
      emptyAttrs: true,
    }),
    downloaded,
    failed,
  };
}

/** Downloads a chapter with its images and marks it as available offline. */
export async function downloadChapter(
  db: AppDatabase,
  files: FileStore,
  plugin: SourcePlugin,
  fetcher: typeof fetch,
  chapter: Pick<Chapter, 'id' | 'novelId' | 'sourcePath'>,
): Promise<ImageResult> {
  const html = await fetchChapterText(db, files, plugin, chapter, false);
  const result = await downloadChapterImages(
    files,
    chapter.novelId,
    html,
    fetcher,
    plugin.imageRequestInit,
  );
  const stored = db
    .select({ filePath: chapters.filePath })
    .from(chapters)
    .where(eq(chapters.id, chapter.id))
    .get();
  if (stored?.filePath && result.downloaded > 0) {
    files.writeText(stored.filePath, result.html);
  }
  db.update(chapters).set({ isDownloaded: true }).where(eq(chapters.id, chapter.id)).run();
  return result;
}
