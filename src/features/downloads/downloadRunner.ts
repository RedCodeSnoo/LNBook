/**
 * Runs the download queue: one chapter at a time, polite to the sites (a delay between
 * two requests to the same source), with retries and increasing waits.
 */
import { eq } from 'drizzle-orm';

import type { AppDatabase } from '../../db/client';
import { chapters } from '../../db/schema';
import { PluginError, toPluginError } from '../../plugins/pluginErrors';
import type { SourcePlugin } from '../../plugins/types';
import type { FileStore } from '../../services/fileStore';
import { downloadChapter } from './chapterDownload';
import {
  completeDownload,
  failDownload,
  listDownloads,
  nextDownload,
  pauseDownloads,
  setDownloadStatus,
} from './downloadsRepository';

export type StopReason = 'done' | 'stopped' | 'offline' | 'cloudflare';

export interface RunnerProgress {
  novelTitle: string;
  chapterTitle: string;
  /** Chapters of this novel downloaded since the runner started, and their total. */
  done: number;
  total: number;
}

export interface RunnerDeps {
  db: AppDatabase;
  files: FileStore;
  fetch: typeof fetch;
  getPlugin(pluginId: string): SourcePlugin;
  /** Milliseconds between two requests to the same source. */
  delayMs(): number;
  /** False when downloads must wait (no network, or Wi-Fi only and not on Wi-Fi). */
  canDownload(): Promise<boolean>;
  wait(ms: number): Promise<void>;
  now(): number;
  onProgress(progress: RunnerProgress): void;
  /** A chapter was downloaded or a task changed state. */
  onChange(): void;
}

/** Wait before trying a failed chapter again: 4 s, then 8 s. */
export const retryDelay = (attempts: number) => attempts * 4000;

export class DownloadRunner {
  private running = false;
  private stopRequested = false;

  constructor(private readonly deps: RunnerDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Asks the loop to stop after the chapter being downloaded. */
  stop(): void {
    this.stopRequested = true;
  }

  /** Processes the queue until it is empty, stopped, or blocked. */
  async run(): Promise<StopReason> {
    if (this.running) {
      return 'stopped';
    }
    const deps = this.deps;
    const db = deps.db;
    this.running = true;
    this.stopRequested = false;
    const lastRequest = new Map<string, number>();
    const doneByNovel = new Map<number, number>();
    try {
      for (;;) {
        if (this.stopRequested) {
          return 'stopped';
        }
        const task = nextDownload(db);
        if (!task) {
          return 'done';
        }
        if (!(await deps.canDownload())) {
          return 'offline';
        }
        const source = task.pluginId ?? '';
        const since = deps.now() - (lastRequest.get(source) ?? -Infinity);
        if (since < deps.delayMs()) {
          await deps.wait(deps.delayMs() - since);
          if (this.stopRequested) {
            return 'stopped';
          }
        }

        const done = doneByNovel.get(task.novelId) ?? 0;
        const remaining = listDownloads(db).filter(
          (row) =>
            row.novelId === task.novelId && (row.status === 'queued' || row.status === 'running'),
        ).length;
        deps.onProgress({
          novelTitle: task.novelTitle,
          chapterTitle: task.chapterTitle,
          done,
          total: done + remaining,
        });

        setDownloadStatus(db, task.id, 'running');
        deps.onChange();
        let failure: PluginError | null = null;
        try {
          if (!task.pluginId) {
            throw new PluginError('notInstalled', 'This chapter has no source');
          }
          await downloadChapter(db, deps.files, deps.getPlugin(task.pluginId), deps.fetch, {
            id: task.chapterId,
            novelId: task.novelId,
            sourcePath: this.sourcePathOf(task.chapterId),
          });
          completeDownload(db, task.id);
          doneByNovel.set(task.novelId, done + 1);
        } catch (error) {
          failure = toPluginError(error);
        }
        lastRequest.set(source, deps.now());

        if (failure) {
          if (failure.kind === 'cloudflare') {
            // Every other chapter of the site would fail too: wait for the user.
            setDownloadStatus(db, task.id, 'queued');
            pauseDownloads(db);
            deps.onChange();
            return 'cloudflare';
          }
          const retry = failDownload(db, task.id, failure.message);
          deps.onChange();
          if (retry) {
            const attempts = listDownloads(db).find((row) => row.id === task.id)?.attempts ?? 1;
            await deps.wait(retryDelay(attempts));
          }
        } else {
          deps.onChange();
        }
      }
    } finally {
      this.running = false;
    }
  }

  private sourcePathOf(chapterId: number): string | null {
    return (
      this.deps.db
        .select({ sourcePath: chapters.sourcePath })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .get()?.sourcePath ?? null
    );
  }
}
