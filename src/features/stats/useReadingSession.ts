import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { getDb } from '../../db/client';
import { invalidate } from '../../db/invalidation';
import type { SessionMode } from '../../db/schema';
import { getSetting } from '../settings/settingsStore';
import { ReadingTimer } from './readingTimer';
import { saveSession } from './sessionsRepository';

/** Shorter visits (flipping through chapters) are not worth a session. */
const MIN_SESSION_MS = 3000;
const CHECKPOINT_MS = 30_000;

interface Target {
  novelId: number;
  chapterId: number;
  /** Words of the chapter, to estimate the words read from the progress made. */
  wordCount: number;
  startProgress: number;
  /** Language displayed (null = original). */
  lang: string | null;
  mode: SessionMode;
}

/**
 * Records the time spent on a chapter as a reading session. A new session starts every
 * time the target changes; the running session is saved every 30 seconds, when the app
 * goes to the background and when the reader leaves. Nothing is written in incognito mode.
 */
export function useReadingSession(target: Target | null) {
  const state = useRef<{
    timer: ReadingTimer;
    target: Target;
    sessionId?: number;
    maxProgress: number;
  } | null>(null);

  const checkpoint = useCallback(() => {
    const current = state.current;
    if (!current || getSetting('incognito')) {
      return;
    }
    const now = Date.now();
    const durationMs = current.timer.elapsed(now);
    if (durationMs < MIN_SESSION_MS) {
      return;
    }
    const { target: of } = current;
    current.sessionId = saveSession(
      getDb(),
      {
        novelId: of.novelId,
        chapterId: of.chapterId,
        startedAt: current.timer.startedAt,
        endedAt: current.timer.endedAt(now),
        durationMs,
        mode: of.mode,
        words: Math.round(of.wordCount * Math.max(0, current.maxProgress - of.startProgress)),
        lang: of.lang,
      },
      current.sessionId,
    );
  }, []);

  const novelId = target?.novelId ?? null;
  const chapterId = target?.chapterId ?? null;
  const mode = target?.mode ?? null;
  const latestTarget = useRef(target);
  useEffect(() => {
    latestTarget.current = target;
  });

  useEffect(() => {
    const starting = latestTarget.current;
    if (!starting || novelId === null || chapterId === null) {
      return undefined;
    }
    // A chapter already finished is read again from the start.
    const startProgress = starting.startProgress >= 1 ? 0 : starting.startProgress;
    state.current = {
      timer: new ReadingTimer(Date.now()),
      target: { ...starting, startProgress },
      maxProgress: startProgress,
    };
    const interval = setInterval(checkpoint, CHECKPOINT_MS);
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState !== 'active') {
        state.current?.timer.pause(Date.now());
        checkpoint();
      }
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
      checkpoint();
      if (state.current?.sessionId !== undefined) {
        invalidate('history', 'stats', 'chapters', 'novel', 'library');
      }
      state.current = null;
    };
  }, [novelId, chapterId, mode, checkpoint]);

  /** The reader touched the screen or scrolled (or the voice is speaking). */
  const activity = useCallback(() => state.current?.timer.activity(Date.now()), []);
  const progress = useCallback((value: number) => {
    if (state.current && value > state.current.maxProgress) {
      state.current.maxProgress = value;
    }
  }, []);

  return useMemo(() => ({ activity, progress }), [activity, progress]);
}
