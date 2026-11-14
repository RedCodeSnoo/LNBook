import { useCallback, useMemo } from 'react';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { Novel } from '../../db/schema';
import { setSetting, useSetting } from '../settings/settingsStore';
import { setNovelReaderSettings } from './readerRepository';
import {
  normalizeReaderSettings,
  resolveReaderSettings,
  type ReaderSettings,
} from './readerSettings';

/** Settings that are lists shared by every novel: always saved globally. */
const GLOBAL_KEYS: (keyof ReaderSettings)[] = ['customThemes', 'customFonts'];

/**
 * Reader settings for a novel: the global ones, or the novel's own when "specific
 * settings for this novel" is on. `update` writes to the right place.
 */
export function useReaderSettings(novel: Pick<Novel, 'id' | 'readerSettings'> | null) {
  const stored = useSetting('reader');
  const global = useMemo(() => normalizeReaderSettings(stored), [stored]);
  const overrides = novel?.readerSettings ?? null;
  const { settings, perNovel } = useMemo(
    () => resolveReaderSettings(global, overrides),
    [global, overrides],
  );
  const novelId = novel?.id ?? null;

  const update = useCallback(
    (patch: Partial<ReaderSettings>) => {
      const globalPatch: Partial<ReaderSettings> = {};
      const localPatch: Partial<ReaderSettings> = {};
      for (const key of Object.keys(patch) as (keyof ReaderSettings)[]) {
        const target = !perNovel || GLOBAL_KEYS.includes(key) ? globalPatch : localPatch;
        (target as Record<string, unknown>)[key] = patch[key];
      }
      if (Object.keys(globalPatch).length > 0) {
        setSetting('reader', { ...global, ...globalPatch });
      }
      if (novelId !== null && Object.keys(localPatch).length > 0) {
        setNovelReaderSettings(getDb(), novelId, { ...settings, ...localPatch });
        invalidate('novel');
      }
    },
    [global, settings, perNovel, novelId],
  );

  /** Turns the novel specific settings on (starting from the current ones) or off. */
  const setPerNovel = useCallback(
    (enabled: boolean) => {
      if (novelId === null) {
        return;
      }
      setNovelReaderSettings(getDb(), novelId, enabled ? settings : null);
      invalidate('novel');
    },
    [novelId, settings],
  );

  return { settings, perNovel, update, setPerNovel };
}
