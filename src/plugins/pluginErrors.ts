/** Turns whatever a plugin call throws into an error the interface can explain. */
import { CloudflareError } from './libs/fetch';

export type PluginErrorKind = 'timeout' | 'cloudflare' | 'network' | 'notInstalled' | 'plugin';

export class PluginError extends Error {
  constructor(
    readonly kind: PluginErrorKind,
    message: string,
    /** Page to open in the web view to pass a Cloudflare check. */
    readonly url?: string,
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

export const PLUGIN_TIMEOUT_MS = 30_000;

export function toPluginError(error: unknown): PluginError {
  if (error instanceof PluginError) {
    return error;
  }
  if (error instanceof CloudflareError) {
    return new PluginError('cloudflare', error.message, error.url);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    /network request failed|failed to fetch|fetch failed|ENOTFOUND|ECONN|timed? ?out/i.test(message)
  ) {
    return new PluginError('network', message);
  }
  return new PluginError('plugin', message);
}

/** Runs a plugin call with the 30 second limit and normalised errors. */
export async function runPluginCall<T>(
  call: () => Promise<T>,
  timeoutMs = PLUGIN_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new PluginError('timeout', 'The site did not answer in time')),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    throw toPluginError(error);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
