/**
 * Translates a chapter paragraph by paragraph. The translated chapter has exactly the
 * same blocks as the original, in the same order: a place in one version is the same
 * place in the other (positions, "show the original", bilingual display).
 */
import { isTag, isText, type AnyNode, type Element, type Text } from 'domhandler';
import { parseDocument } from 'htmlparser2';

import { parseChapterBlocks, serializeNodes } from '../reader/blocks';
import { protectTerms, restoreTerms, type GlossaryEntry } from './glossary';

/**
 * How an engine translates. `text` engines (on-device) only take plain text: inline
 * formatting is handled here. `html` engines (DeepL) take the markup of a paragraph and
 * give it back translated, and apply the glossary themselves.
 */
export type ChapterTranslator =
  | { mode: 'text'; translate(texts: string[]): Promise<string[]>; glossary: GlossaryEntry[] }
  | { mode: 'html'; translate(fragments: string[]): Promise<string[]> };

const hasWords = (text: string) => /\p{L}/u.test(text);

/** Text nodes of a block, grouped by line (a <br> starts a new line). */
function textLines(block: Element): Text[][] {
  const lines: Text[][] = [[]];
  const walk = (node: AnyNode) => {
    if (isText(node)) {
      if (node.data.trim() !== '') {
        lines[lines.length - 1].push(node);
      }
    } else if (isTag(node)) {
      if (node.name === 'br') {
        lines.push([]);
      } else if (node.name !== 'img' && node.name !== 'svg') {
        node.children.forEach(walk);
      }
    }
  };
  block.children.forEach(walk);
  return lines.filter((line) => line.length > 0);
}

/** A piece long enough to be translated on its own without losing its meaning. */
const standsAlone = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length >= 24 || /[.!?…。！？"”»]$/.test(trimmed);
};

interface Unit {
  /** Nodes replaced by the translation: it goes in the first one, the others are emptied. */
  nodes: Text[];
  text: string;
}

function unitsOfBlock(block: Element): Unit[] {
  const units: Unit[] = [];
  for (const line of textLines(block)) {
    if (line.length === 1 || line.every((node) => standsAlone(node.data))) {
      // Formatted parts that are whole sentences keep their formatting.
      for (const node of line) {
        units.push({ nodes: [node], text: node.data });
      }
    } else {
      // A few formatted words inside a sentence: the sentence is translated as a whole,
      // which reads better than translating it in pieces.
      units.push({ nodes: line, text: line.map((node) => node.data).join('') });
    }
  }
  return units.filter((unit) => hasWords(unit.text));
}

const edges = (text: string) => {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return { lead: match?.[1] ?? '', core: match?.[2] ?? text, trail: match?.[3] ?? '' };
};

async function translateWithText(
  blocks: Element[],
  translator: Extract<ChapterTranslator, { mode: 'text' }>,
): Promise<void> {
  const units = blocks.flatMap(unitsOfBlock);
  const prepared = units.map((unit) => {
    const { lead, core, trail } = edges(unit.text.replace(/\s+/g, ' '));
    const safe = protectTerms(core, translator.glossary);
    return { lead, trail, safe };
  });
  const translated = await translator.translate(prepared.map((item) => item.safe.text));
  if (translated.length !== units.length) {
    throw new Error('The translation engine returned an unexpected number of texts');
  }
  units.forEach((unit, index) => {
    const { lead, trail, safe } = prepared[index];
    const text = restoreTerms(translated[index] ?? '', safe.targets).trim();
    const [first, ...others] = unit.nodes;
    first.data = `${lead}${text === '' ? unit.text.trim() : text}${trail}`;
    for (const node of others) {
      node.data = '';
    }
  });
}

async function translateWithHtml(
  blocks: Element[],
  translator: Extract<ChapterTranslator, { mode: 'html' }>,
): Promise<void> {
  const targets = blocks.filter((block) => hasWords(serializeText(block)));
  const translated = await translator.translate(
    targets.map((block) => serializeNodes(block.children)),
  );
  if (translated.length !== targets.length) {
    throw new Error('The translation engine returned an unexpected number of texts');
  }
  targets.forEach((block, index) => {
    const fragment = parseDocument(translated[index] ?? '', { decodeEntities: true });
    // A paragraph must stay one paragraph: nested blocks would shift the numbering.
    if (
      translated[index]?.trim() &&
      !/<(p|div|h[1-6]|li|blockquote|pre)\b/i.test(translated[index])
    ) {
      for (const child of fragment.children) {
        child.parent = block;
      }
      block.children = fragment.children;
    }
  });
}

function serializeText(node: AnyNode): string {
  if (isText(node)) {
    return node.data;
  }
  return isTag(node) ? node.children.map(serializeText).join('') : '';
}

/** Translated HTML of a chapter. Throws what the engine throws. */
export async function translateChapterHtml(
  html: string,
  translator: ChapterTranslator,
): Promise<string> {
  const { document, blocks } = parseChapterBlocks(html);
  if (translator.mode === 'text') {
    await translateWithText(blocks, translator);
  } else {
    await translateWithHtml(blocks, translator);
  }
  return serializeNodes(document.children);
}

/** Translates a chapter title (plain text) with the same engine. */
export async function translateTitle(
  title: string,
  translator: ChapterTranslator,
): Promise<string> {
  if (!hasWords(title)) {
    return title;
  }
  if (translator.mode === 'text') {
    const safe = protectTerms(title, translator.glossary);
    const [text] = await translator.translate([safe.text]);
    return restoreTerms(text ?? '', safe.targets).trim() || title;
  }
  const [text] = await translator.translate([title.replace(/&/g, '&amp;').replace(/</g, '&lt;')]);
  return (
    (text ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .trim() || title
  );
}
