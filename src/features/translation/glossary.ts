/**
 * Glossary of a novel for a translation direction. For the on-device engine, the terms
 * are replaced by markers the engine leaves alone, and put back after the translation.
 */
export interface GlossaryEntry {
  source: string;
  /** Translation of the term; equal to `source` for "do not translate". */
  target: string;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marker of the n-th protected term: capital letters and digits survive translation. */
const marker = (index: number) => `XGL${String(index).padStart(3, '0')}X`;
/** Engines sometimes add spaces inside the marker or change its case. */
const MARKER = /X\s?G\s?L\s?(\d{3})\s?X/gi;

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);

export interface ProtectedText {
  text: string;
  /** Targets by marker number. */
  targets: string[];
}

/** Usable entries, longest source first so that "Sect Leader" wins over "Sect". */
export function prepareGlossary(entries: GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set<string>();
  return entries
    .map((entry) => ({ source: entry.source.trim(), target: entry.target.trim() }))
    .filter((entry) => {
      const key = entry.source.toLowerCase();
      if (entry.source === '' || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((entry) => ({ ...entry, target: entry.target === '' ? entry.source : entry.target }))
    .sort((a, b) => b.source.length - a.source.length);
}

/** Replaces the glossary terms of a text by markers (whole words, any case). */
export function protectTerms(text: string, glossary: GlossaryEntry[]): ProtectedText {
  if (glossary.length === 0) {
    return { text, targets: [] };
  }
  const targets: string[] = [];
  const pattern = new RegExp(glossary.map((entry) => escapeRegExp(entry.source)).join('|'), 'giu');
  const bySource = new Map(glossary.map((entry) => [entry.source.toLowerCase(), entry.target]));
  const replaced = text.replace(pattern, (match: string, offset: number, whole: string) => {
    if (isWordChar(whole[offset - 1]) || isWordChar(whole[offset + match.length])) {
      return match;
    }
    const target = bySource.get(match.toLowerCase());
    if (target === undefined) {
      return match;
    }
    targets.push(target);
    return marker(targets.length - 1);
  });
  return { text: replaced, targets };
}

/** Puts the translated terms back in place of the markers. */
export function restoreTerms(translated: string, targets: string[]): string {
  if (targets.length === 0) {
    return translated;
  }
  return translated.replace(MARKER, (match: string, digits: string) => {
    const target = targets[Number(digits)];
    return target ?? match;
  });
}

/** Glossary in the tab-separated format of the DeepL glossary API. */
export function glossaryToTsv(glossary: GlossaryEntry[]): string {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, ' ').trim();
  return glossary.map((entry) => `${clean(entry.source)}\t${clean(entry.target)}`).join('\n');
}

/** Stable fingerprint of a glossary, to know when the one stored at DeepL is outdated. */
export function glossaryFingerprint(glossary: GlossaryEntry[]): string {
  const text = glossaryToTsv(glossary);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return `${glossary.length}-${(hash >>> 0).toString(36)}`;
}
