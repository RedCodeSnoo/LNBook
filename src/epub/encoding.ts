/** Text decoding for imported TXT files (Hermes has no TextDecoder for legacy encodings). */
import { strFromU8 } from 'fflate';

export type TextEncoding = 'utf-8' | 'windows-1252';

/** Code points of bytes 0x80–0x9F in Windows-1252 (the rest matches Latin-1). */
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

/** True when the bytes are well-formed UTF-8. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    let extra: number;
    if (byte < 0x80) {
      extra = 0;
    } else if (byte >= 0xc2 && byte <= 0xdf) {
      extra = 1;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      extra = 2;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      extra = 3;
    } else {
      return false;
    }
    for (let k = 1; k <= extra; k += 1) {
      const next = bytes[i + k];
      if (next === undefined || (next & 0xc0) !== 0x80) {
        return false;
      }
    }
    i += extra + 1;
  }
  return true;
}

export function detectEncoding(bytes: Uint8Array): TextEncoding {
  return isValidUtf8(bytes) ? 'utf-8' : 'windows-1252';
}

export function decodeText(bytes: Uint8Array, encoding: TextEncoding): string {
  if (encoding === 'utf-8') {
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return strFromU8(start ? bytes.subarray(start) : bytes);
  }
  const chunks: string[] = [];
  const CHUNK = 8192;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, offset + CHUNK);
    const codes = new Array<number>(slice.length);
    for (let i = 0; i < slice.length; i += 1) {
      const byte = slice[i];
      codes[i] = byte >= 0x80 && byte <= 0x9f ? CP1252_HIGH[byte - 0x80] : byte;
    }
    chunks.push(String.fromCharCode(...codes));
  }
  return chunks.join('');
}
