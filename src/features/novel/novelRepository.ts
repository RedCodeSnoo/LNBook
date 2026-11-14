import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters, novels, volumes, type Chapter, type Novel, type Volume } from '../../db/schema';
import { novelDir, type FileStore } from '../../services/fileStore';

export type EditableNovelField =
  'title' | 'author' | 'description' | 'genres' | 'status' | 'originalLang' | 'cover';

export type NovelPatch = Partial<
  Pick<Novel, 'title' | 'author' | 'description' | 'genres' | 'status' | 'originalLang'>
>;

export function getNovel(db: AppDatabase, novelId: number): Novel | null {
  return db.select().from(novels).where(eq(novels.id, novelId)).get() ?? null;
}

export function listChapters(db: AppDatabase, novelId: number): Chapter[] {
  return db
    .select()
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.position), asc(chapters.id))
    .all();
}

export function getChapter(db: AppDatabase, chapterId: number): Chapter | null {
  return db.select().from(chapters).where(eq(chapters.id, chapterId)).get() ?? null;
}

export function listVolumes(db: AppDatabase, novelId: number): Volume[] {
  return db
    .select()
    .from(volumes)
    .where(eq(volumes.novelId, novelId))
    .orderBy(asc(volumes.position), asc(volumes.id))
    .all();
}

export function parseEditedFields(novel: Pick<Novel, 'editedFields'>): EditableNovelField[] {
  try {
    const value: unknown = JSON.parse(novel.editedFields);
    return Array.isArray(value) ? (value as EditableNovelField[]) : [];
  } catch {
    return [];
  }
}

function addEditedFields(db: AppDatabase, novelId: number, fields: EditableNovelField[]): string {
  const novel = getNovel(db, novelId);
  const merged = new Set([...(novel ? parseEditedFields(novel) : []), ...fields]);
  return JSON.stringify([...merged]);
}

/**
 * Saves fields edited by the user and remembers them in `edited_fields`, so that a
 * refresh from the source does not overwrite them.
 */
export function updateNovelFields(
  db: AppDatabase,
  novelId: number,
  patch: NovelPatch,
  now = Date.now(),
): void {
  const fields = Object.keys(patch) as (keyof NovelPatch)[];
  if (fields.length === 0) {
    return;
  }
  const cleaned: NovelPatch = {};
  for (const field of fields) {
    const value = patch[field];
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (field === 'title') {
      if (trimmed) {
        cleaned.title = trimmed;
      }
    } else {
      cleaned[field] = trimmed === '' ? null : (trimmed ?? null);
    }
  }
  db.update(novels)
    .set({
      ...cleaned,
      editedFields: addEditedFields(db, novelId, Object.keys(cleaned) as EditableNovelField[]),
      updatedAt: now,
    })
    .where(eq(novels.id, novelId))
    .run();
}

/**
 * Applies metadata coming from the source, skipping the fields edited by the user.
 */
export function applySourceMetadata(
  db: AppDatabase,
  novelId: number,
  metadata: NovelPatch,
  now = Date.now(),
): void {
  const novel = getNovel(db, novelId);
  if (!novel) {
    return;
  }
  const edited = new Set<string>(parseEditedFields(novel));
  const patch: NovelPatch = {};
  for (const [field, value] of Object.entries(metadata) as [keyof NovelPatch, string | null][]) {
    if (!edited.has(field) && value !== undefined && value !== null && value !== '') {
      patch[field] = value as never;
    }
  }
  if (Object.keys(patch).length > 0) {
    db.update(novels)
      .set({ ...patch, updatedAt: now })
      .where(eq(novels.id, novelId))
      .run();
  }
}

/** Uses an image chosen by the user as cover. The original cover file is kept. */
export function setCustomCover(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  data: Uint8Array,
  extension: string,
  now = Date.now(),
): string {
  const novel = getNovel(db, novelId);
  if (novel?.coverPath && novel.coverPath !== novel.originalCoverPath) {
    files.delete(novel.coverPath);
  }
  // A new file name each time, so that image caches do not show the previous cover.
  const path = `${novelDir(novelId)}/cover-custom-${now}.${extension}`;
  files.writeBytes(path, data);
  db.update(novels)
    .set({ coverPath: path, editedFields: addEditedFields(db, novelId, ['cover']), updatedAt: now })
    .where(eq(novels.id, novelId))
    .run();
  return path;
}

/** Goes back to the cover of the file or the source (possibly none). */
export function restoreOriginalCover(
  db: AppDatabase,
  files: FileStore,
  novelId: number,
  now = Date.now(),
): void {
  const novel = getNovel(db, novelId);
  if (!novel) {
    return;
  }
  if (novel.coverPath && novel.coverPath !== novel.originalCoverPath) {
    files.delete(novel.coverPath);
  }
  const edited = parseEditedFields(novel).filter((field) => field !== 'cover');
  db.update(novels)
    .set({
      coverPath: novel.originalCoverPath,
      editedFields: JSON.stringify(edited),
      updatedAt: now,
    })
    .where(eq(novels.id, novelId))
    .run();
}

// ---------------------------------------------------------------------------
// Read state
// ---------------------------------------------------------------------------

export function setChaptersRead(
  db: AppDatabase,
  chapterIds: number[],
  read: boolean,
  now = Date.now(),
): void {
  if (chapterIds.length === 0) {
    return;
  }
  db.update(chapters)
    .set(
      read
        ? { isRead: true, readAt: now, progress: 1 }
        : { isRead: false, readAt: null, progress: 0, positionAnchor: null },
    )
    .where(inArray(chapters.id, chapterIds))
    .run();
}

/** Marks as read every chapter placed before the given one (itself excluded). */
export function markPreviousChaptersRead(
  db: AppDatabase,
  chapterId: number,
  now = Date.now(),
): void {
  const chapter = getChapter(db, chapterId);
  if (!chapter) {
    return;
  }
  db.update(chapters)
    .set({ isRead: true, readAt: now, progress: 1 })
    .where(
      and(
        eq(chapters.novelId, chapter.novelId),
        lte(chapters.position, chapter.position - 1),
        eq(chapters.isRead, false),
      ),
    )
    .run();
}

export function setChapterFavorite(db: AppDatabase, chapterId: number, favorite: boolean): void {
  db.update(chapters).set({ isFavorite: favorite }).where(eq(chapters.id, chapterId)).run();
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------

function nextVolumePosition(db: AppDatabase, novelId: number): number {
  const row = db
    .select({ max: sql<number | null>`max(${volumes.position})` })
    .from(volumes)
    .where(eq(volumes.novelId, novelId))
    .get();
  return (row?.max ?? -1) + 1;
}

/** Deletes the volumes of a novel that no longer contain any chapter. */
function removeEmptyVolumes(db: AppDatabase, novelId: number): void {
  db.delete(volumes)
    .where(
      and(
        eq(volumes.novelId, novelId),
        sql`not exists (select 1 from chapters c where c.volume_id = "volumes"."id")`,
      ),
    )
    .run();
}

/** Groups chapters into a new manual volume. */
export function createManualVolume(
  db: AppDatabase,
  novelId: number,
  title: string,
  chapterIds: number[],
): number {
  return db.transaction((tx) => {
    const id = tx
      .insert(volumes)
      .values({
        novelId,
        title: title.trim() || 'Volume',
        position: nextVolumePosition(tx as unknown as AppDatabase, novelId),
        origin: 'manual',
      })
      .returning({ id: volumes.id })
      .get().id;
    if (chapterIds.length > 0) {
      tx.update(chapters)
        .set({ volumeId: id })
        .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, chapterIds)))
        .run();
    }
    removeEmptyVolumes(tx as unknown as AppDatabase, novelId);
    return id;
  });
}

export function renameVolume(db: AppDatabase, volumeId: number, title: string): void {
  const trimmed = title.trim();
  if (trimmed !== '') {
    db.update(volumes).set({ title: trimmed }).where(eq(volumes.id, volumeId)).run();
  }
}

/** Moves chapters into a volume, or out of any volume with `null`. */
export function moveChaptersToVolume(
  db: AppDatabase,
  novelId: number,
  chapterIds: number[],
  volumeId: number | null,
): void {
  if (chapterIds.length === 0) {
    return;
  }
  db.transaction((tx) => {
    tx.update(chapters)
      .set({ volumeId })
      .where(and(eq(chapters.novelId, novelId), inArray(chapters.id, chapterIds)))
      .run();
    removeEmptyVolumes(tx as unknown as AppDatabase, novelId);
  });
}

/** Merges volumes into the first one of the list. */
export function mergeVolumes(db: AppDatabase, novelId: number, volumeIds: number[]): void {
  const [target, ...others] = volumeIds;
  if (target === undefined || others.length === 0) {
    return;
  }
  db.transaction((tx) => {
    tx.update(chapters)
      .set({ volumeId: target })
      .where(and(eq(chapters.novelId, novelId), inArray(chapters.volumeId, others)))
      .run();
    tx.delete(volumes)
      .where(and(eq(volumes.novelId, novelId), inArray(volumes.id, others)))
      .run();
  });
}

/** Removes a volume; its chapters stay, outside any volume. */
export function deleteVolume(db: AppDatabase, volumeId: number): void {
  db.delete(volumes).where(eq(volumes.id, volumeId)).run();
}
