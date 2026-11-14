/**
 * Blocks of a chapter (paragraphs, headings, list items…), computed exactly like the
 * reader runtime does in the web view. Anchors, search in the book, reading aloud and
 * chapter editing all rely on the same block numbering.
 */
import { render } from 'dom-serializer';
import { isTag, isText, Text, type AnyNode, type Element, type ParentNode } from 'domhandler';
import { removeElement } from 'domutils';
import { parseDocument } from 'htmlparser2';

import type { Anchor } from './readerHtml';

const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'blockquote',
  'pre',
  'div',
  'dt',
  'dd',
  'figcaption',
  'td',
  'th',
]);

function textOf(node: AnyNode): string {
  if (isText(node)) {
    return node.data;
  }
  return isTag(node) ? node.children.map(textOf).join('') : '';
}

function hasDescendant(node: Element, predicate: (element: Element) => boolean): boolean {
  return node.children.some(
    (child) => isTag(child) && (predicate(child) || hasDescendant(child, predicate)),
  );
}

function collectBlocks(parent: ParentNode, out: Element[]): void {
  for (const child of parent.children) {
    if (!isTag(child)) {
      continue;
    }
    if (BLOCK_TAGS.has(child.name) && !hasDescendant(child, (el) => BLOCK_TAGS.has(el.name))) {
      const hasText = textOf(child).trim() !== '';
      if (hasText || hasDescendant(child, (el) => el.name === 'img')) {
        out.push(child);
      }
    } else {
      collectBlocks(child, out);
    }
  }
}

function parse(html: string) {
  const document = parseDocument(html, { decodeEntities: true });
  const blocks: Element[] = [];
  collectBlocks(document, blocks);
  return { document, blocks };
}

/** Text of every block of a chapter, in order. */
export function extractBlockTexts(html: string): string[] {
  return parse(html).blocks.map(textOf);
}

export interface SearchHit {
  anchor: Anchor;
  /** Text around the match, for the list of results. */
  before: string;
  match: string;
  after: string;
}

/** Finds every occurrence of a text in a chapter (case insensitive). */
export function searchBlocks(blockTexts: string[], query: string, limit = 50): SearchHit[] {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  if (needle === '') {
    return hits;
  }
  for (let b = 0; b < blockTexts.length && hits.length < limit; b += 1) {
    const text = blockTexts[b];
    const haystack = text.toLowerCase();
    let from = 0;
    let at: number;
    while ((at = haystack.indexOf(needle, from)) !== -1 && hits.length < limit) {
      const end = at + needle.length;
      hits.push({
        anchor: { b, o: at, c: text.substr(at, 30), eb: b, eo: end },
        before: text.slice(Math.max(0, at - 40), at),
        match: text.slice(at, end),
        after: text.slice(end, end + 60),
      });
      from = end;
    }
  }
  return hits;
}

/**
 * Applies paragraph edits: `edits` maps a block index to its new text. An empty text
 * removes the block. Untouched blocks keep their formatting.
 */
export function editBlocks(html: string, edits: ReadonlyMap<number, string>): string {
  const { document, blocks } = parse(html);
  for (const [index, value] of edits) {
    const block = blocks[index];
    if (!block) {
      continue;
    }
    const text = value.replace(/\s*\n\s*/g, ' ').trim();
    if (text === '') {
      removeElement(block);
      continue;
    }
    if (text === textOf(block).trim()) {
      continue;
    }
    const node = new Text(text);
    node.parent = block;
    block.children = [node];
  }
  return render(document.children, {
    encodeEntities: 'utf8',
    selfClosingTags: true,
    emptyAttrs: true,
  });
}
