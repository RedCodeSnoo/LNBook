/**
 * Journal of the errors and warnings of the app, kept on the phone only. The user can
 * export it from Settings → Advanced to explain a problem; nothing is ever sent anywhere.
 */
import type { FileStore } from './fileStore';

export const ERROR_LOG_FILE = 'logs/errors.log';
const MAX_ENTRIES = 300;
const MAX_ENTRY_LENGTH = 2000;

export type LogLevel = 'error' | 'warn';

function describe(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ? `${value.message}\n${value.stack}` : value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One line (or block) of the journal. */
export function formatLogEntry(level: LogLevel, parts: unknown[], now: number): string {
  const text = parts.map(describe).join(' ').slice(0, MAX_ENTRY_LENGTH);
  return `${new Date(now).toISOString()} [${level}] ${text}`;
}

export class ErrorLog {
  private entries: string[] = [];
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly files: FileStore,
    private readonly now: () => number = Date.now,
  ) {}

  private load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      if (this.files.exists(ERROR_LOG_FILE)) {
        const stored = this.files.readText(ERROR_LOG_FILE).split('\n\u001e').filter(Boolean);
        this.entries = [...stored, ...this.entries].slice(-MAX_ENTRIES);
      }
    } catch {
      // An unreadable journal starts again from nothing.
    }
  }

  add(level: LogLevel, parts: unknown[]): void {
    this.entries.push(formatLogEntry(level, parts, this.now()));
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    // Written a moment later: several errors in a row cost one write.
    this.timer ??= setTimeout(() => this.flush(), 1500);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.load();
    try {
      this.files.writeText(ERROR_LOG_FILE, this.entries.join('\n\u001e'));
    } catch {
      // The journal must never break the app.
    }
  }

  /** The journal as text, oldest entry first. */
  text(): string {
    this.load();
    return this.entries.join('\n');
  }

  get size(): number {
    this.load();
    return this.entries.length;
  }

  clear(): void {
    this.loaded = true;
    this.entries = [];
    this.flush();
  }
}

interface GlobalErrorUtils {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

/** Records uncaught errors, console.error and console.warn in the journal. */
export function installErrorLog(log: ErrorLog): void {
  const original = { warn: console.warn, error: console.error };
  console.warn = (...parts: unknown[]) => {
    log.add('warn', parts);
    original.warn(...parts);
  };
  console.error = (...parts: unknown[]) => {
    log.add('error', parts);
    original.error(...parts);
  };
  const errorUtils = (globalThis as { ErrorUtils?: GlobalErrorUtils }).ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      log.add('error', [isFatal ? 'Fatal:' : 'Uncaught:', error]);
      log.flush();
      previous(error, isFatal);
    });
  }
}
