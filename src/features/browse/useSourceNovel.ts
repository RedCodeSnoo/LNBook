import { useCallback, useEffect, useRef, useState } from 'react';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { Chapter, Novel } from '../../db/schema';
import { PluginError, toPluginError } from '../../plugins/pluginErrors';
import { getSource } from '../../plugins/pluginHost';
import { getInstalledPlugin } from '../../plugins/pluginManager';
import { deviceFiles } from '../../services/deviceFileStore';
import {
  fetchChapterText,
  fetchSourceNovel,
  resolveSourceUrl,
  saveSourceNovel,
} from './sourceNovels';

type RequestState = { busy: boolean; error: PluginError | null };

/** Address of the page of a novel or chapter on its site, or null for local content. */
export function sourcePageUrl(
  novel: Pick<Novel, 'pluginId' | 'sourcePath'> | null,
  chapter?: Pick<Chapter, 'sourcePath'> | null,
): string | null {
  const path = chapter ? chapter.sourcePath : novel?.sourcePath;
  if (!novel?.pluginId || !path) {
    return null;
  }
  try {
    return resolveSourceUrl(getSource(novel.pluginId), path, !chapter);
  } catch {
    return null;
  }
}

/** Fetches the details and chapters of an online novel and stores them. */
export async function refreshNovelFromSource(
  novel: Pick<Novel, 'id' | 'pluginId' | 'sourcePath'>,
): Promise<number> {
  if (!novel.pluginId || !novel.sourcePath) {
    return 0;
  }
  const plugin = getSource(novel.pluginId);
  const fetched = await fetchSourceNovel(plugin, novel.sourcePath);
  const lang = getInstalledPlugin(getDb(), novel.pluginId)?.lang;
  const result = saveSourceNovel(getDb(), { id: novel.pluginId, lang }, novel.sourcePath, fetched);
  invalidate('novel', 'chapters', 'library', 'updates');
  return result.addedChapterIds.length;
}

/**
 * Keeps an online novel in sync with its source: fetched automatically the first time
 * (no chapter yet), and on demand with `refresh`.
 */
export function useSourceNovel(novel: Novel | null, chapterCount: number) {
  const [state, setState] = useState<RequestState>({ busy: false, error: null });
  const running = useRef(false);
  const online = novel?.origin === 'online' && !!novel.pluginId && !!novel.sourcePath;

  const refresh = useCallback(async (): Promise<number | null> => {
    if (!novel || running.current) {
      return null;
    }
    running.current = true;
    setState({ busy: true, error: null });
    try {
      const added = await refreshNovelFromSource(novel);
      setState({ busy: false, error: null });
      return added;
    } catch (error) {
      setState({ busy: false, error: toPluginError(error) });
      return null;
    } finally {
      running.current = false;
    }
    // Only the identity of the novel matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel?.id, novel?.pluginId, novel?.sourcePath]);

  const needsFirstFetch = online && chapterCount === 0;
  useEffect(() => {
    if (!needsFirstFetch) {
      return undefined;
    }
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [needsFirstFetch, refresh]);

  return { online, refreshing: state.busy, error: state.error, refresh };
}

/**
 * Text of an online chapter that is not on the phone yet: fetched when the reader opens
 * it, then kept. `enabled` is false when the text is already there.
 */
export function useChapterFetch(
  novel: Pick<Novel, 'origin' | 'pluginId'> | null,
  chapter: Pick<Chapter, 'id' | 'novelId' | 'sourcePath' | 'filePath'> | null,
  enabled: boolean,
) {
  const [state, setState] = useState<{ chapterId: number; error: PluginError | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pluginId = novel?.origin === 'online' ? novel.pluginId : null;
  const chapterId = chapter?.id ?? null;
  const canFetch = enabled && !!pluginId && !!chapter?.sourcePath;
  const latest = useRef(chapter);
  useEffect(() => {
    latest.current = chapter;
  });

  useEffect(() => {
    const target = latest.current;
    if (!canFetch || !pluginId || !target) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        await fetchChapterText(getDb(), deviceFiles, getSource(pluginId), target);
        if (!cancelled) {
          invalidate('chapterContent', 'chapters');
        }
      } catch (error) {
        if (!cancelled) {
          setState({ chapterId: target.id, error: toPluginError(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canFetch, pluginId, chapterId, attempt]);

  const error = state && state.chapterId === chapterId ? state.error : null;
  const retry = useCallback(() => {
    setState(null);
    setAttempt((value) => value + 1);
  }, []);
  return { fetching: canFetch && !error, error, retry };
}

/** Fetches the next chapter in advance while the current one is being read online. */
export function preloadChapter(
  novel: Pick<Novel, 'origin' | 'pluginId'>,
  chapter: Pick<Chapter, 'id' | 'novelId' | 'sourcePath' | 'filePath'>,
): void {
  if (novel.origin !== 'online' || !novel.pluginId || !chapter.sourcePath || chapter.filePath) {
    return;
  }
  try {
    void fetchChapterText(getDb(), deviceFiles, getSource(novel.pluginId), chapter).catch(
      () => undefined,
    );
  } catch {
    // The source is not available: the chapter will be fetched when opened.
  }
}
