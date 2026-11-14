/**
 * `@libs/fetch` given to plugins. Requests go through the app fetch: on Android it shares
 * its cookies with the web view, which is what lets a Cloudflare check passed in the web
 * view unlock the plugin requests.
 */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: FormData | string | Uint8Array;
  [key: string]: unknown;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

/** The site answered with a Cloudflare verification page instead of its content. */
export class CloudflareError extends Error {
  constructor(readonly url: string) {
    super(`Cloudflare verification required for ${url}`);
    this.name = 'CloudflareError';
  }
}

export interface FetchEnvironment {
  getUserAgent(): string;
  fetch: typeof fetch;
}

function headerOf(response: Response, name: string): string {
  return response.headers?.get?.(name) ?? '';
}

/** Cloudflare challenge: status 403 or 503 with its usual signature. */
export async function isCloudflareChallenge(response: Response): Promise<boolean> {
  if (response.status !== 403 && response.status !== 503) {
    return false;
  }
  if (headerOf(response, 'cf-mitigated').toLowerCase() === 'challenge') {
    return true;
  }
  if (!/cloudflare/i.test(headerOf(response, 'server'))) {
    return false;
  }
  try {
    const body = await response.clone().text();
    return /Just a moment|cf-chl-|challenge-platform|cf_chl_opt|Attention Required/i.test(body);
  } catch {
    return true;
  }
}

export function createFetchLibrary(environment: FetchEnvironment) {
  const makeInit = (init?: FetchInit): FetchInit => {
    const defaults: Record<string, string> = {
      Connection: 'keep-alive',
      Accept: '*/*',
      'Accept-Language': '*',
      'Sec-Fetch-Mode': 'cors',
      'Accept-Encoding': 'gzip, deflate',
      'Cache-Control': 'max-age=0',
      'User-Agent': environment.getUserAgent(),
    };
    if (init?.headers) {
      if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
        if (!init.headers.get('User-Agent')) {
          init.headers.set('User-Agent', defaults['User-Agent']);
        }
        return init;
      }
      return { ...init, headers: { ...defaults, ...(init.headers as Record<string, string>) } };
    }
    return { ...init, headers: defaults };
  };

  const fetchApi = async (url: string, init?: FetchInit): Promise<Response> => {
    const response = await environment.fetch(url, makeInit(init) as RequestInit);
    if (await isCloudflareChallenge(response)) {
      throw new CloudflareError(url);
    }
    return response;
  };

  const readBlob = (blob: Blob, mode: 'text' | 'dataUrl', encoding?: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Cannot read the response'));
      reader.onabort = () => reject(new Error('Cannot read the response'));
      if (mode === 'text') {
        reader.readAsText(blob, encoding);
      } else {
        reader.readAsDataURL(blob);
      }
    });

  /** Text of a page, decoded with the given encoding (e.g. "gbk"). Empty when it fails. */
  const fetchText = async (url: string, init?: FetchInit, encoding?: string): Promise<string> => {
    let response: Response;
    try {
      response = await fetchApi(url, init);
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
      return '';
    }
    try {
      if (!response.ok) {
        return '';
      }
      if (!encoding || /^utf-?8$/i.test(encoding)) {
        return await response.text();
      }
      if (typeof FileReader !== 'undefined') {
        return await readBlob(await response.blob(), 'text', encoding);
      }
      return new TextDecoder(encoding).decode(await response.arrayBuffer());
    } catch {
      return '';
    }
  };

  /** Content of a file as base64 (older plugins use it for images). Empty when it fails. */
  const fetchFile = async (url: string, init?: FetchInit): Promise<string> => {
    try {
      const response = await fetchApi(url, init);
      if (!response.ok) {
        return '';
      }
      const dataUrl = await readBlob(await response.blob(), 'dataUrl');
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    } catch (error) {
      if (error instanceof CloudflareError) {
        throw error;
      }
      return '';
    }
  };

  /** gRPC-web style request: the protobuf message is framed with a 5 byte header. */
  const fetchProto = async (
    protoInit: { proto: string; requestType: string; requestData?: object; responseType: string },
    url: string,
    init?: FetchInit,
  ): Promise<unknown> => {
    // Loaded on first use: very few plugins need protobuf.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parse } = require('protobufjs') as typeof import('protobufjs');
    const root = parse(protoInit.proto).root;
    const requestType = root.lookupType(protoInit.requestType);
    const data = protoInit.requestData ?? {};
    if (requestType.verify(data)) {
      throw new Error('Invalid Proto');
    }
    const encoded = requestType.encode(data).finish();
    const body = new Uint8Array(5 + encoded.length);
    new DataView(body.buffer).setUint32(1, encoded.length);
    body.set(encoded, 5);
    const response = await fetchApi(url, { method: 'POST', ...init, body });
    const payload = new Uint8Array(await response.arrayBuffer());
    const length = new DataView(payload.buffer, payload.byteOffset).getUint32(1);
    return root.lookupType(protoInit.responseType).decode(payload.slice(5, 5 + length));
  };

  return { fetchApi, fetchText, fetchFile, fetchProto };
}
