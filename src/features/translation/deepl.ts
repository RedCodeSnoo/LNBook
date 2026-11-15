/**
 * DeepL API client. The key belongs to the user and is given at call time: it is never
 * stored here. Free keys (ending with ":fx") use the free endpoint.
 */
import { glossaryToTsv, type GlossaryEntry } from './glossary';

export type DeepLErrorKind = 'key' | 'quota' | 'network' | 'server' | 'language';

export class DeepLError extends Error {
  constructor(
    readonly kind: DeepLErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'DeepLError';
  }
}

export function deeplBaseUrl(key: string): string {
  return key.trim().endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
}

/** Language codes as DeepL wants them. */
export function deeplSourceLang(code: string): string {
  return code.split(/[-_]/)[0].toUpperCase();
}

export function deeplTargetLang(code: string): string {
  const short = code.split(/[-_]/)[0].toUpperCase();
  // DeepL wants a variant for these targets.
  if (short === 'EN') {
    return 'EN-US';
  }
  if (short === 'PT') {
    return 'PT-PT';
  }
  return short;
}

async function request(
  fetcher: typeof fetch,
  key: string,
  path: string,
  init: { method: string; body?: unknown },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${deeplBaseUrl(key)}${path}`, {
      method: init.method,
      headers: {
        Authorization: `DeepL-Auth-Key ${key.trim()}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    throw new DeepLError('network', error instanceof Error ? error.message : 'Network error');
  }
  if (response.status === 401 || response.status === 403) {
    throw new DeepLError('key', 'The DeepL key was refused');
  }
  if (response.status === 456) {
    throw new DeepLError('quota', 'The DeepL quota is used up');
  }
  if (response.status === 400) {
    throw new DeepLError('language', `DeepL refused the request: ${await safeText(response)}`);
  }
  if (!response.ok) {
    throw new DeepLError('server', `DeepL answered ${response.status}`);
  }
  if (response.status === 204) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    throw new DeepLError('server', 'Unreadable DeepL answer');
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

export interface DeepLUsage {
  used: number;
  limit: number;
}

/** Characters used and allowed in the current period. */
export async function deeplUsage(fetcher: typeof fetch, key: string): Promise<DeepLUsage> {
  const data = (await request(fetcher, key, '/v2/usage', { method: 'GET' })) as {
    character_count?: unknown;
    character_limit?: unknown;
  } | null;
  return {
    used: typeof data?.character_count === 'number' ? data.character_count : 0,
    limit: typeof data?.character_limit === 'number' ? data.character_limit : 0,
  };
}

/** DeepL accepts at most 50 texts per request; requests are also kept under ~100 KB. */
const MAX_TEXTS = 40;
const MAX_CHARS = 60_000;

/** Translates HTML fragments, keeping their tags. The answer has one text per input. */
export async function deeplTranslate(
  fetcher: typeof fetch,
  key: string,
  fragments: string[],
  options: { source: string; target: string; glossaryId?: string | null },
): Promise<string[]> {
  const out: string[] = [];
  let start = 0;
  while (start < fragments.length) {
    let end = start;
    let size = 0;
    while (
      end < fragments.length &&
      end - start < MAX_TEXTS &&
      (end === start || size + fragments[end].length <= MAX_CHARS)
    ) {
      size += fragments[end].length;
      end += 1;
    }
    const data = (await request(fetcher, key, '/v2/translate', {
      method: 'POST',
      body: {
        text: fragments.slice(start, end),
        source_lang: deeplSourceLang(options.source),
        target_lang: deeplTargetLang(options.target),
        tag_handling: 'html',
        ...(options.glossaryId ? { glossary_id: options.glossaryId } : {}),
      },
    })) as { translations?: { text?: unknown }[] } | null;
    const translations = data?.translations ?? [];
    if (translations.length !== end - start) {
      throw new DeepLError('server', 'DeepL returned an unexpected number of texts');
    }
    for (const item of translations) {
      out.push(typeof item.text === 'string' ? item.text : '');
    }
    start = end;
  }
  return out;
}

/** Creates a glossary at DeepL and returns its identifier. */
export async function deeplCreateGlossary(
  fetcher: typeof fetch,
  key: string,
  name: string,
  source: string,
  target: string,
  entries: GlossaryEntry[],
): Promise<string> {
  const data = (await request(fetcher, key, '/v2/glossaries', {
    method: 'POST',
    body: {
      name,
      source_lang: deeplSourceLang(source).toLowerCase(),
      target_lang: target.split(/[-_]/)[0].toLowerCase(),
      entries: glossaryToTsv(entries),
      entries_format: 'tsv',
    },
  })) as { glossary_id?: unknown } | null;
  if (typeof data?.glossary_id !== 'string') {
    throw new DeepLError('server', 'DeepL did not return a glossary');
  }
  return data.glossary_id;
}

export async function deeplDeleteGlossary(
  fetcher: typeof fetch,
  key: string,
  glossaryId: string,
): Promise<void> {
  try {
    await request(fetcher, key, `/v2/glossaries/${encodeURIComponent(glossaryId)}`, {
      method: 'DELETE',
    });
  } catch {
    // An old glossary left at DeepL does no harm.
  }
}
