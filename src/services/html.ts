/**
 * HTML cleaning shared by every content source (EPUB, TXT, plugins).
 * The output is a small, predictable subset of HTML that the reader styles itself.
 */
import { render } from 'dom-serializer';
import {
  Element,
  Text,
  isTag,
  isText,
  type AnyNode,
  type ChildNode,
  type ParentNode,
} from 'domhandler';
import { appendChild, removeElement, replaceElement, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'em',
  'i',
  'b',
  'strong',
  'u',
  's',
  'del',
  'ins',
  'small',
  'sup',
  'sub',
  'mark',
  'blockquote',
  'q',
  'cite',
  'pre',
  'code',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'img',
  'figure',
  'figcaption',
  'a',
  'div',
  'ruby',
  'rt',
  'rp',
  'aside',
]);

/** Removed with everything they contain. */
const DROPPED_TAGS = new Set([
  'script',
  'style',
  'head',
  'title',
  'link',
  'meta',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'noscript',
  'audio',
  'video',
  'canvas',
  'template',
  'nav',
]);

const RENAMED_TAGS: Record<string, string> = {
  center: 'div',
  section: 'div',
  article: 'div',
  main: 'div',
  header: 'div',
  footer: 'div',
};

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'figure',
  'hr',
  'dl',
  'dt',
  'dd',
  'aside',
  'figcaption',
  'br',
]);

export interface SanitizeOptions {
  /** Keep `class` and `style` attributes (EPUB "keep the original formatting"). */
  keepFormatting?: boolean;
  /**
   * Maps the `src` of an image to the value stored in the cleaned HTML.
   * Returning null removes the image.
   */
  resolveImage?: (src: string) => string | null;
  /** Maps the `href` of a link. Returning null unwraps the link (its text stays). */
  resolveLink?: (href: string) => string | null;
}

function defaultResolveLink(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

function unwrap(node: Element): ChildNode[] {
  const children = [...node.children];
  const parent = node.parent;
  if (!parent) {
    return children;
  }
  const index = parent.children.indexOf(node);
  parent.children.splice(index, 1, ...children);
  children.forEach((child, offset) => {
    child.parent = parent;
    child.prev = parent.children[index + offset - 1] ?? null;
    child.next = parent.children[index + offset + 1] ?? null;
  });
  const before = parent.children[index - 1];
  const after = parent.children[index + children.length];
  if (before) {
    before.next = parent.children[index] ?? null;
  }
  if (after) {
    after.prev = parent.children[index + children.length - 1] ?? null;
  }
  return children;
}

function svgImageSource(svg: Element): string | null {
  const stack: AnyNode[] = [svg];
  while (stack.length > 0) {
    const node = stack.pop() as AnyNode;
    if (isTag(node)) {
      if (node.name === 'image') {
        return node.attribs['xlink:href'] ?? node.attribs.href ?? null;
      }
      stack.push(...node.children);
    }
  }
  return null;
}

function cleanNode(node: ChildNode, options: SanitizeOptions): void {
  if (node.type === 'comment' || node.type === 'directive' || node.type === 'cdata') {
    removeElement(node);
    return;
  }
  if (!isTag(node)) {
    return;
  }

  const name = node.name.toLowerCase();

  if (name === 'svg') {
    const src = svgImageSource(node);
    const resolved = src ? (options.resolveImage ? options.resolveImage(src) : src) : null;
    if (resolved) {
      replaceElement(node, new Element('img', { src: resolved, alt: '' }));
    } else {
      removeElement(node);
    }
    return;
  }

  if (DROPPED_TAGS.has(name)) {
    removeElement(node);
    return;
  }

  // Children first: unwrapping a node must expose already cleaned children.
  for (const child of [...node.children]) {
    cleanNode(child, options);
  }

  const finalName = RENAMED_TAGS[name] ?? name;
  if (!ALLOWED_TAGS.has(finalName) && !(options.keepFormatting && finalName === 'span')) {
    unwrap(node);
    return;
  }
  node.name = finalName;

  const attribs: Record<string, string> = {};
  if (finalName === 'img') {
    const src = node.attribs.src ?? node.attribs['data-src'] ?? '';
    const resolved = options.resolveImage ? options.resolveImage(src) : src;
    if (!resolved) {
      removeElement(node);
      return;
    }
    attribs.src = resolved;
    attribs.alt = node.attribs.alt ?? '';
  } else if (finalName === 'a') {
    const href = node.attribs.href;
    const resolved = href ? (options.resolveLink ?? defaultResolveLink)(href) : null;
    if (!resolved) {
      unwrap(node);
      return;
    }
    attribs.href = resolved;
  } else if (finalName === 'td' || finalName === 'th') {
    for (const key of ['colspan', 'rowspan']) {
      if (/^\d+$/.test(node.attribs[key] ?? '')) {
        attribs[key] = node.attribs[key];
      }
    }
  }
  if (options.keepFormatting) {
    for (const key of ['class', 'style']) {
      if (node.attribs[key]) {
        attribs[key] = node.attribs[key];
      }
    }
  }
  node.attribs = attribs;
}

function hasMeaningfulContent(node: AnyNode): boolean {
  if (isText(node)) {
    return node.data.replace(/[\s ]+/g, '') !== '';
  }
  if (isTag(node)) {
    if (node.name === 'img' || node.name === 'hr') {
      return true;
    }
    return node.children.some(hasMeaningfulContent);
  }
  return false;
}

function removeEmptyBlocks(parent: ParentNode): void {
  for (const child of [...parent.children]) {
    if (!isTag(child)) {
      continue;
    }
    removeEmptyBlocks(child);
    const emptyBlock =
      [
        'p',
        'div',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'blockquote',
        'li',
        'ul',
        'ol',
        'figure',
        'aside',
        'a',
      ].includes(child.name) && !hasMeaningfulContent(child);
    if (emptyBlock) {
      removeElement(child);
    }
  }
}

/** Wraps text and inline nodes found directly at the root into paragraphs. */
function wrapLooseInlineNodes(root: ParentNode): void {
  let paragraph: Element | null = null;
  for (const child of [...root.children]) {
    const isBlock = isTag(child) && BLOCK_TAGS.has(child.name) && child.name !== 'br';
    if (isBlock) {
      paragraph = null;
      continue;
    }
    if (isTag(child) && child.name === 'br') {
      // A line break between loose text runs separates paragraphs.
      removeElement(child);
      paragraph = null;
      continue;
    }
    if (!paragraph) {
      if (!hasMeaningfulContent(child)) {
        removeElement(child);
        continue;
      }
      paragraph = new Element('p', {});
      replaceElement(child, paragraph);
      appendChild(paragraph, child);
    } else {
      removeElement(child);
      appendChild(paragraph, child);
    }
  }
}

function findBody(root: ParentNode): ParentNode {
  const stack: AnyNode[] = [...root.children];
  while (stack.length > 0) {
    const node = stack.shift() as AnyNode;
    if (isTag(node)) {
      if (node.name.toLowerCase() === 'body') {
        return node;
      }
      stack.push(...node.children);
    }
  }
  return root;
}

/** Cleans DOM nodes in place and returns the resulting HTML. */
export function sanitizeNodes(root: ParentNode, options: SanitizeOptions = {}): string {
  for (const child of [...root.children]) {
    cleanNode(child, options);
  }
  wrapLooseInlineNodes(root);
  removeEmptyBlocks(root);
  return render(root.children, {
    encodeEntities: 'utf8',
    selfClosingTags: true,
    emptyAttrs: true,
  }).trim();
}

/** Cleans an HTML document or fragment. Only the content of `<body>` is kept. */
export function sanitizeHtml(html: string, options: SanitizeOptions = {}): string {
  const document = parseDocument(html, { decodeEntities: true });
  const body = findBody(document);
  if (body !== document) {
    // Detach the body content so that head, title… are ignored.
    const fragment = parseDocument('');
    for (const child of [...body.children]) {
      removeElement(child);
      appendChild(fragment, child);
    }
    return sanitizeNodes(fragment, options);
  }
  return sanitizeNodes(document, options);
}

/** Plain text of an HTML fragment, one line per block element. */
export function htmlToText(html: string): string {
  const document = parseDocument(html, { decodeEntities: true });
  const parts: string[] = [];
  const walk = (node: AnyNode) => {
    if (isText(node)) {
      parts.push(node.data);
    } else if (isTag(node)) {
      if (node.name === 'rt' || node.name === 'rp') {
        return;
      }
      node.children.forEach(walk);
      if (BLOCK_TAGS.has(node.name)) {
        parts.push('\n');
      }
    }
  };
  document.children.forEach(walk);
  return parts
    .join('')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;

/** Number of words of a text; each CJK character counts as a word. */
export function countWords(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  const others = text.replace(CJK, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return cjk + others;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Turns plain text into paragraphs (one per non-empty line). */
export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
}

export { Element, Text, textContent };
