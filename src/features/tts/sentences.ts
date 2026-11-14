/**
 * Cuts a chapter into the sentences read aloud. Each sentence keeps its block number and
 * its character range in the block text, so that the reader can highlight it; the text
 * given to the voice is cleaned (footnote marks, decorations).
 */
import { extractBlockTexts } from '../reader/blocks';

export interface Sentence {
  /** Block number (same numbering as the reader). */
  b: number;
  /** Character range in the text of the block. */
  start: number;
  end: number;
  /** Text given to the voice. */
  text: string;
  /** Last sentence of its block: a longer pause follows. */
  endsBlock: boolean;
}

/** Sentences longer than this are cut at a comma or a space (engines have a limit). */
const MAX_LENGTH = 400;

/** Closing marks that belong to the sentence they follow. */
const CLOSERS = '"\'”’»)\\]】」』';
const ENDERS = '.!?…。！？';

/** Common abbreviations that do not end a sentence. */
const ABBREVIATIONS =
  /(?:^|[\s(«"“'])(?:M|MM|Mr|Mrs|Ms|Mme|Mlle|Dr|Pr|Prof|St|Ste|Sr|Jr|vs|etc|cf|vol|chap|ch|no|p|pp|ex|env|av|apr|J\.-C|e\.g|i\.e)\.$/i;

function splitLong(text: string, offset: number, out: { start: number; end: number }[]): void {
  let from = 0;
  while (text.length - from > MAX_LENGTH) {
    const window = text.slice(from, from + MAX_LENGTH);
    let cut = Math.max(
      window.lastIndexOf(', '),
      window.lastIndexOf('; '),
      window.lastIndexOf(': '),
    );
    if (cut < MAX_LENGTH / 3) {
      cut = window.lastIndexOf(' ');
    }
    cut = cut < MAX_LENGTH / 3 ? MAX_LENGTH : cut + 1;
    out.push({ start: offset + from, end: offset + from + cut });
    from += cut;
  }
  if (from < text.length) {
    out.push({ start: offset + from, end: offset + text.length });
  }
}

/** Character ranges of the sentences of a text. */
export function sentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  const push = (end: number) => {
    // Trim the range without losing the offsets.
    let from = start;
    let to = end;
    while (from < to && /\s/.test(text[from])) from += 1;
    while (to > from && /\s/.test(text[to - 1])) to -= 1;
    if (to > from) {
      splitLong(text.slice(from, to), from, ranges);
    }
    start = end;
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\n') {
      push(i + 1);
      continue;
    }
    if (!ENDERS.includes(char)) {
      continue;
    }
    // Several marks in a row ("?!", "...") and closing quotes stay with the sentence.
    let end = i + 1;
    while (end < text.length && (ENDERS.includes(text[end]) || CLOSERS.includes(text[end]))) {
      end += 1;
    }
    const latin = char === '.' || char === '!' || char === '?' || char === '…';
    if (latin) {
      // A sentence ends before a space (or the end); "3.14" and "a.b" do not end one.
      if (end < text.length && !/\s/.test(text[end])) {
        i = end - 1;
        continue;
      }
      if (char === '.' && end === i + 1 && ABBREVIATIONS.test(text.slice(start, end))) {
        continue;
      }
      // An initial ("J. R. R. Tolkien") or a continuation in lower case.
      const next = text.slice(end).trimStart()[0];
      if (char === '.' && end === i + 1 && /(?:^|\s)\p{Lu}\.$/u.test(text.slice(start, end))) {
        continue;
      }
      if (char === '…' && next !== undefined && /\p{Ll}/u.test(next)) {
        i = end - 1;
        continue;
      }
    }
    push(end);
    i = end - 1;
  }
  push(text.length);
  return ranges;
}

/** What the voice says for a piece of text; empty when there is nothing to say. */
export function spokenText(text: string): string {
  const cleaned = text
    // Footnote marks: [1], [12], (1) glued to a word, superscript digits, lone asterisks.
    .replace(/\[\d{1,3}\]/g, '')
    .replace(/(?<=\p{L})\(\d{1,3}\)/gu, '')
    .replace(/[¹²³⁰-⁹]+/g, '')
    .replace(/(?<=\S)\*+(?=[\s\p{P}]|$)/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Separators ("***", "---", "◇◇◇") are a silence, not words.
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : '';
}

/** Sentences of the blocks of a chapter, in reading order. */
export function sentencesOfBlocks(blockTexts: string[]): Sentence[] {
  const sentences: Sentence[] = [];
  blockTexts.forEach((blockText, b) => {
    const before = sentences.length;
    for (const range of sentenceRanges(blockText)) {
      const text = spokenText(blockText.slice(range.start, range.end));
      if (text !== '') {
        sentences.push({ b, start: range.start, end: range.end, text, endsBlock: false });
      }
    }
    if (sentences.length > before) {
      sentences[sentences.length - 1].endsBlock = true;
    }
  });
  return sentences;
}

/** Footnote sections are not read: their blocks are emptied before cutting. */
const FOOTNOTE_BLOCK =
  /<(aside|section|div|ol|ul|p|li)\b[^>]*(?:epub:type\s*=\s*"(?:footnotes?|endnotes?|rearnotes?)"|class\s*=\s*"[^"]*\b(?:footnotes?|endnotes?)\b[^"]*"|role\s*=\s*"doc-(?:footnote|endnotes)")[^>]*>/i;
const NOTE_REFERENCE =
  /<a\b[^>]*(?:epub:type\s*=\s*"noteref"|role\s*=\s*"doc-noteref"|class\s*=\s*"[^"]*\bnoteref\b[^"]*")[^>]*>[\s\S]*?<\/a>|<sup\b[^>]*>\s*(?:<a\b[^>]*>)?\s*[[(]?\d{1,3}[\])]?\s*(?:<\/a>)?\s*<\/sup>/gi;

/**
 * Sentences of a chapter. The block numbering is the one of the displayed text; note
 * references are located in the block text and left out of what is said.
 */
export function chapterSentences(html: string): Sentence[] {
  return spokenSentences(html, extractBlockTexts(html));
}

/** Same as `chapterSentences`, with the block texts already extracted. */
export function spokenSentences(html: string, blocks: string[]): Sentence[] {
  // Without notes in the markup, the displayed text is the spoken text.
  if (!FOOTNOTE_BLOCK.test(html) && !NOTE_REFERENCE.test(html)) {
    return sentencesOfBlocks(blocks);
  }
  NOTE_REFERENCE.lastIndex = 0;
  // Texts of the note references, to drop them from the spoken sentences.
  const marks = new Set<string>();
  for (const match of html.matchAll(NOTE_REFERENCE)) {
    const mark = match[0].replace(/<[^>]+>/g, '').trim();
    if (mark !== '') {
      marks.add(mark);
    }
  }
  // Blocks that belong to a footnote section are skipped entirely.
  const skipped = footnoteBlockTexts(html);
  const sentences = sentencesOfBlocks(blocks.map((text) => (skipped.has(text) ? '' : text)));
  if (marks.size === 0) {
    return sentences;
  }
  const escaped = [...marks].map((mark) => mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<=[\\p{L}\\p{P}])(?:${escaped.join('|')})(?=[\\s\\p{P}]|$)`, 'gu');
  return sentences
    .map((sentence) => ({ ...sentence, text: sentence.text.replace(pattern, '').trim() }))
    .filter((sentence) => sentence.text !== '');
}

/** Texts of the blocks found inside footnote sections. */
function footnoteBlockTexts(html: string): Set<string> {
  const texts = new Set<string>();
  let rest = html;
  for (;;) {
    const match = FOOTNOTE_BLOCK.exec(rest);
    if (!match) {
      break;
    }
    const tag = match[1].toLowerCase();
    const from = match.index;
    // Matching closing tag, counting nested elements of the same name.
    const opener = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    opener.lastIndex = from;
    let depth = 0;
    let end = rest.length;
    for (let found = opener.exec(rest); found; found = opener.exec(rest)) {
      depth += found[1] === '/' ? -1 : 1;
      if (depth === 0) {
        end = found.index + found[0].length;
        break;
      }
    }
    for (const text of extractBlockTexts(rest.slice(from, end))) {
      texts.add(text);
    }
    rest = rest.slice(end);
  }
  return texts;
}

/** Index of the sentence containing a position of the text (block and character). */
export function sentenceIndexAt(sentences: Sentence[], b: number, offset = 0): number {
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];
    if (sentence.b > b || (sentence.b === b && sentence.end > offset)) {
      return i;
    }
  }
  return Math.max(0, sentences.length - 1);
}

/** First sentence of the paragraph before or after the one of `index`. */
export function paragraphStart(sentences: Sentence[], index: number, direction: 1 | -1): number {
  if (sentences.length === 0) {
    return 0;
  }
  const current = sentences[Math.min(index, sentences.length - 1)].b;
  if (direction === 1) {
    for (let i = index + 1; i < sentences.length; i += 1) {
      if (sentences[i].b !== current) {
        return i;
      }
    }
    return sentences.length;
  }
  // Backwards: start of this paragraph when in its middle, else start of the previous one.
  let first = index;
  while (first > 0 && sentences[first - 1].b === current) {
    first -= 1;
  }
  if (first < index || first === 0) {
    return first;
  }
  const previous = sentences[first - 1].b;
  let start = first - 1;
  while (start > 0 && sentences[start - 1].b === previous) {
    start -= 1;
  }
  return start;
}
