/**
 * EPUB 2 and 3 reader: metadata, cover, reading order, hierarchical table of contents
 * (volumes) and images. Pure function: bytes in, ParsedBook out.
 */
import { Document, isTag, type AnyNode, type Element, type ParentNode } from 'domhandler';
import { appendChild, removeElement, textContent } from 'domutils';
import { XMLParser } from 'fast-xml-parser';
import { strFromU8, unzipSync } from 'fflate';
import { parseDocument } from 'htmlparser2';

import { countWords, htmlToText, sanitizeNodes } from '../services/html';
import { basename, dirname, extension, resolvePath, splitHref } from './paths';
import {
  BookImportError,
  type EpubParseOptions,
  type ParsedBook,
  type ParsedChapter,
  type ParsedImage,
  type ParsedVolume,
} from './types';
import { detectVolumes } from './volumes';

type Xml = Record<string, unknown>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) =>
    ['item', 'itemref', 'navPoint', 'meta', 'creator', 'title', 'language', 'rootfile'].includes(
      name,
    ),
});

/** Font obfuscation is not DRM: the text stays readable. */
const FONT_OBFUSCATION = ['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'];

const HTML_TYPES = ['application/xhtml+xml', 'text/html', 'application/html'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif'];

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function xmlText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return xmlText(value[0]);
  }
  return xmlText((value as Xml)['#text']);
}

function attr(node: unknown, name: string): string {
  const value = (node as Xml | undefined)?.[`@_${name}`];
  return typeof value === 'string' ? value : '';
}

class Archive {
  private readonly lowerCase = new Map<string, string>();

  constructor(private readonly files: Record<string, Uint8Array>) {
    for (const name of Object.keys(files)) {
      this.lowerCase.set(name.toLowerCase(), name);
    }
  }

  /** Finds a file, tolerating a wrong letter case (common in hand-made EPUBs). */
  find(path: string): string | null {
    if (this.files[path]) {
      return path;
    }
    return this.lowerCase.get(path.toLowerCase()) ?? null;
  }

  bytes(path: string): Uint8Array | null {
    const name = this.find(path);
    return name ? this.files[name] : null;
  }

  text(path: string): string | null {
    const bytes = this.bytes(path);
    if (!bytes) {
      return null;
    }
    // Skip a UTF-8 byte order mark.
    const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    return strFromU8(start ? bytes.subarray(start) : bytes);
  }
}

interface ManifestItem {
  id: string;
  path: string;
  mediaType: string;
  properties: string[];
}

interface TocNode {
  title: string;
  path: string | null;
  fragment: string | null;
  children: TocNode[];
}

interface ChapterPoint {
  title: string;
  path: string;
  fragment: string | null;
  volumeIndex: number | null;
}

function checkDrm(archive: Archive): void {
  if (archive.find('META-INF/rights.xml')) {
    throw new BookImportError('drm', 'The file is protected by DRM');
  }
  const encryption = archive.text('META-INF/encryption.xml');
  if (!encryption) {
    return;
  }
  const algorithms = [
    ...encryption.matchAll(/EncryptionMethod[^>]*Algorithm\s*=\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  const encrypted = /<(?:\w+:)?EncryptedData/.test(encryption);
  if (
    encrypted &&
    (algorithms.length === 0 || algorithms.some((a) => !FONT_OBFUSCATION.includes(a)))
  ) {
    throw new BookImportError('drm', 'The file is protected by DRM');
  }
}

function parseXml(text: string | null, what: string): Xml {
  if (!text) {
    throw new BookImportError('corrupted', `Missing ${what}`);
  }
  try {
    return xml.parse(text) as Xml;
  } catch {
    throw new BookImportError('corrupted', `Unreadable ${what}`);
  }
}

function parseHtmlDocument(text: string): Document {
  return parseDocument(text, { decodeEntities: true, recognizeSelfClosing: true });
}

function findFirst(root: AnyNode, predicate: (element: Element) => boolean): Element | null {
  if (isTag(root) && predicate(root)) {
    return root;
  }
  if ('children' in root) {
    for (const child of (root as ParentNode).children) {
      const found = findFirst(child, predicate);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function elementChildren(node: ParentNode, name?: string): Element[] {
  return node.children.filter(
    (child): child is Element => isTag(child) && (!name || child.name === name),
  );
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** EPUB 3 navigation document. */
function parseNav(text: string, baseDir: string): TocNode[] {
  const document = parseHtmlDocument(text);
  const nav =
    findFirst(
      document,
      (el) => el.name === 'nav' && /\btoc\b/.test(el.attribs['epub:type'] ?? el.attribs.type ?? ''),
    ) ?? findFirst(document, (el) => el.name === 'nav');
  if (!nav) {
    return [];
  }
  const list = findFirst(nav, (el) => el.name === 'ol' || el.name === 'ul');
  if (!list) {
    return [];
  }
  const readList = (element: Element): TocNode[] =>
    elementChildren(element, 'li').flatMap((li) => {
      const label = elementChildren(li).find(
        (child) => child.name === 'a' || child.name === 'span',
      );
      const sub = elementChildren(li).find((child) => child.name === 'ol' || child.name === 'ul');
      const href = label?.name === 'a' ? label.attribs.href : undefined;
      const title = cleanTitle(label ? textContent(label) : '');
      const children = sub ? readList(sub) : [];
      if (!title && children.length === 0) {
        return [];
      }
      const target = href ? splitHref(href) : null;
      return [
        {
          title,
          path: target && href ? resolvePath(baseDir, href) : null,
          fragment: target?.fragment ?? null,
          children,
        },
      ];
    });
  return readList(list);
}

/** EPUB 2 NCX table of contents. */
function parseNcx(text: string, baseDir: string): TocNode[] {
  const root = parseXml(text, 'table of contents');
  const navMap = (root.ncx as Xml | undefined)?.navMap as Xml | undefined;
  const readPoints = (points: unknown): TocNode[] =>
    asArray(points as Xml[])
      .slice()
      .sort((a, b) => {
        const orderA = Number(attr(a, 'playOrder'));
        const orderB = Number(attr(b, 'playOrder'));
        return Number.isFinite(orderA) && Number.isFinite(orderB) && orderA && orderB
          ? orderA - orderB
          : 0;
      })
      .map((point) => {
        const src = attr(point.content, 'src');
        const target = src ? splitHref(src) : null;
        return {
          title: cleanTitle(xmlText((point.navLabel as Xml | undefined)?.text)),
          path: src ? resolvePath(baseDir, src) : null,
          fragment: target?.fragment ?? null,
          children: readPoints(point.navPoint),
        };
      });
  return readPoints(navMap?.navPoint);
}

function flattenToc(nodes: TocNode[]): TocNode[] {
  return nodes.flatMap((node) => [node, ...flattenToc(node.children)]);
}

function sameTarget(a: { path: string | null; fragment: string | null }, b: typeof a): boolean {
  return a.path === b.path && (a.fragment ?? '') === (b.fragment ?? '');
}

/** Turns the table of contents into volumes (top-level entries with children) and chapters. */
function tocToPoints(toc: TocNode[]): { volumes: ParsedVolume[]; points: ChapterPoint[] } {
  const volumes: ParsedVolume[] = [];
  const points: ChapterPoint[] = [];
  const push = (node: TocNode, volumeIndex: number | null) => {
    if (!node.path) {
      return;
    }
    const last = points[points.length - 1];
    if (last && sameTarget(last, node)) {
      return;
    }
    points.push({ title: node.title, path: node.path, fragment: node.fragment, volumeIndex });
  };

  for (const node of toc) {
    if (node.children.length === 0) {
      push(node, null);
      continue;
    }
    const volumeIndex =
      volumes.push({ title: node.title || `Volume ${volumes.length + 1}`, origin: 'toc' }) - 1;
    const descendants = flattenToc(node.children);
    const first = descendants.find((descendant) => descendant.path);
    // The volume entry itself is a chapter only when it has its own page.
    if (node.path && first && !sameTarget(node, first)) {
      push(node, volumeIndex);
    }
    for (const descendant of descendants) {
      push(descendant, volumeIndex);
    }
  }
  return { volumes, points };
}

function findBody(document: Document): ParentNode {
  return findFirst(document, (el) => el.name === 'body') ?? document;
}

function firstHeading(root: ParentNode): string | null {
  const heading = findFirst(root as AnyNode, (el) => /^h[1-3]$/.test(el.name));
  const title = heading ? cleanTitle(textContent(heading)) : '';
  return title || null;
}

/** True when the first meaningful element of the page is a heading. */
function startsWithHeading(root: ParentNode): boolean {
  let node: ParentNode = root;
  for (let depth = 0; depth < 6; depth += 1) {
    const first = node.children.find(
      (child) => isTag(child) || (child.type === 'text' && child.data.trim() !== ''),
    );
    if (!first || !isTag(first)) {
      return false;
    }
    if (/^h[1-3]$/.test(first.name)) {
      return true;
    }
    node = first;
  }
  return false;
}

function contains(ancestor: AnyNode, node: AnyNode): boolean {
  let current: AnyNode | null = node;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Splits the children of a page at the given anchors. Returns one list of nodes per
 * anchor; content placed before the first anchor goes to the first part.
 */
function splitAtAnchors(body: ParentNode, anchors: (Element | null)[]): AnyNode[][] {
  const real = anchors.filter((anchor): anchor is Element => anchor !== null);
  let container: ParentNode = body;
  // Go down while a single wrapper element holds every anchor.
  for (;;) {
    const elements = elementChildren(container);
    const wrapper = elements.find((el) =>
      real.every((anchor) => anchor !== el && contains(el, anchor)),
    );
    const othersAreEmpty = container.children.every(
      (child) => child === wrapper || (child.type === 'text' && child.data.trim() === ''),
    );
    if (wrapper && othersAreEmpty && real.length > 0) {
      container = wrapper;
    } else {
      break;
    }
  }

  const children = [...container.children];
  let previous = 0;
  const starts = anchors.map((anchor, index) => {
    if (index === 0 || !anchor) {
      return previous;
    }
    const position = children.findIndex((child) => contains(child, anchor));
    previous = position === -1 ? previous : Math.max(previous, position);
    return previous;
  });
  starts[0] = 0;

  return starts.map((start, index) => children.slice(start, starts[index + 1] ?? children.length));
}

export function parseEpub(data: Uint8Array, options: EpubParseOptions = {}): ParsedBook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch {
    throw new BookImportError('corrupted', 'The file is not a readable EPUB archive');
  }
  const archive = new Archive(files);
  checkDrm(archive);

  // 1. Package document
  const container = parseXml(archive.text('META-INF/container.xml'), 'container.xml');
  const rootfiles = asArray(
    ((container.container as Xml | undefined)?.rootfiles as Xml | undefined)?.rootfile as Xml[],
  );
  const opfPath = attr(rootfiles[0], 'full-path');
  if (!opfPath) {
    throw new BookImportError('corrupted', 'The EPUB has no package document');
  }
  const opf = parseXml(archive.text(opfPath), 'package document').package as Xml | undefined;
  if (!opf) {
    throw new BookImportError('corrupted', 'Unreadable package document');
  }
  const opfDir = dirname(archive.find(opfPath) ?? opfPath);
  const metadata = (opf.metadata ?? {}) as Xml;

  const manifest = new Map<string, ManifestItem>();
  for (const item of asArray((opf.manifest as Xml | undefined)?.item as Xml[])) {
    const href = attr(item, 'href');
    if (!href) {
      continue;
    }
    manifest.set(attr(item, 'id'), {
      id: attr(item, 'id'),
      path: resolvePath(opfDir, href),
      mediaType: attr(item, 'media-type').toLowerCase(),
      properties: attr(item, 'properties').split(/\s+/).filter(Boolean),
    });
  }
  const items = [...manifest.values()];

  const spine = opf.spine as Xml | undefined;
  const spinePaths: string[] = [];
  for (const ref of asArray(spine?.itemref as Xml[])) {
    const item = manifest.get(attr(ref, 'idref'));
    if (!item || spinePaths.includes(item.path)) {
      continue;
    }
    const isHtml =
      HTML_TYPES.includes(item.mediaType) ||
      ['xhtml', 'html', 'htm', 'xml'].includes(extension(item.path));
    if (isHtml && archive.find(item.path)) {
      spinePaths.push(item.path);
    }
  }
  if (spinePaths.length === 0) {
    throw new BookImportError('empty', 'The EPUB has no readable chapter');
  }

  // 2. Metadata
  const title = cleanTitle(xmlText(metadata.title)) || options.fallbackTitle || 'Untitled';
  const authors = asArray(metadata.creator as unknown[])
    .map((creator) => cleanTitle(xmlText(creator)))
    .filter(Boolean);
  const languageRaw = xmlText(metadata.language).toLowerCase();
  const language = /^[a-z]{2,3}/.test(languageRaw) ? languageRaw.split(/[-_]/)[0] : null;
  const descriptionRaw = xmlText(metadata.description);
  const description = descriptionRaw ? htmlToText(descriptionRaw) || null : null;

  // 3. Cover
  const metas = asArray(metadata.meta as Xml[]);
  const coverId = attr(
    metas.find((meta) => attr(meta, 'name') === 'cover'),
    'content',
  );
  const isImage = (item: ManifestItem) =>
    item.mediaType.startsWith('image/') || IMAGE_EXTENSIONS.includes(extension(item.path));
  const coverItem =
    items.find((item) => item.properties.includes('cover-image')) ??
    (coverId ? manifest.get(coverId) : undefined) ??
    items.find((item) => isImage(item) && /cover/i.test(item.id)) ??
    items.find((item) => isImage(item) && /cover/i.test(basename(item.path)));
  let cover: ParsedImage | null = null;
  if (coverItem && isImage(coverItem)) {
    const bytes = archive.bytes(coverItem.path);
    if (bytes && bytes.length > 0) {
      cover = { data: bytes, extension: extension(coverItem.path).replace('jpeg', 'jpg') || 'jpg' };
    }
  }

  // 4. Table of contents
  let toc: TocNode[] = [];
  const navItem = items.find((item) => item.properties.includes('nav'));
  if (navItem) {
    const text = archive.text(navItem.path);
    toc = text ? parseNav(text, dirname(navItem.path)) : [];
  }
  if (toc.length === 0) {
    const ncxItem =
      manifest.get(attr(spine, 'toc')) ??
      items.find(
        (item) => item.mediaType === 'application/x-dtbncx+xml' || extension(item.path) === 'ncx',
      );
    const text = ncxItem ? archive.text(ncxItem.path) : null;
    if (ncxItem && text) {
      try {
        toc = parseNcx(text, dirname(ncxItem.path));
      } catch {
        toc = [];
      }
    }
  }
  const resolved = tocToPoints(toc);
  const volumes = resolved.volumes;
  const points = resolved.points
    .map((point) => ({ ...point, path: archive.find(point.path) ?? point.path }))
    .filter((point) => spinePaths.some((path) => archive.find(path) === point.path));
  const hasToc = points.length > 0;

  // 5. Chapters
  const images = new Map<string, Uint8Array>();
  const imageNames = new Map<string, string>();
  const resolveImageFrom = (docDir: string) => (src: string) => {
    if (!src || /^(https?:|data:)/i.test(src)) {
      return null;
    }
    const path = archive.find(resolvePath(docDir, src));
    if (!path) {
      return null;
    }
    let name = imageNames.get(path);
    if (!name) {
      const base = basename(path).replace(/[^A-Za-z0-9._-]/g, '_');
      name = images.has(base) ? `${imageNames.size}_${base}` : base;
      imageNames.set(path, name);
      images.set(name, archive.bytes(path) as Uint8Array);
    }
    return `images/${name}`;
  };

  interface Draft {
    title: string;
    volumeIndex: number | null;
    html: string[];
    fromToc: boolean;
  }
  const drafts: Draft[] = [];
  const render = (nodes: AnyNode[], docDir: string): string => {
    const fragment = new Document([]);
    for (const node of nodes) {
      removeElement(node as never);
      appendChild(fragment, node as never);
    }
    return sanitizeNodes(fragment, {
      keepFormatting: options.keepFormatting,
      resolveImage: resolveImageFrom(docDir),
    });
  };

  for (const spinePath of spinePaths) {
    const path = archive.find(spinePath) as string;
    const text = archive.text(path);
    if (text === null) {
      continue;
    }
    const document = parseHtmlDocument(text);
    const body = findBody(document);
    const docDir = dirname(path);
    const docPoints = points.filter((point) => point.path === path);
    const current = drafts[drafts.length - 1];

    if (docPoints.length === 0) {
      const continues = hasToc && current?.fromToc && !startsWithHeading(body);
      if (continues) {
        current.html.push(render([...body.children], docDir));
        continue;
      }
      const documentTitle = findFirst(document, (el) => el.name === 'title');
      const heading =
        firstHeading(body) ??
        (documentTitle ? cleanTitle(textContent(documentTitle)) || null : null);
      drafts.push({
        title: heading ?? '',
        volumeIndex: hasToc ? (current?.volumeIndex ?? null) : null,
        html: [render([...body.children], docDir)],
        fromToc: false,
      });
      continue;
    }

    const anchors = docPoints.map((point) =>
      point.fragment
        ? findFirst(
            body as AnyNode,
            (el) => el.attribs.id === point.fragment || el.attribs.name === point.fragment,
          )
        : null,
    );
    const parts =
      docPoints.length === 1 ? [[...body.children] as AnyNode[]] : splitAtAnchors(body, anchors);
    parts.forEach((nodes, index) => {
      const point = docPoints[index];
      const html = render(nodes, docDir);
      const last = drafts[drafts.length - 1];
      // Two entries pointing at the same place: the second one adds nothing.
      if (html === '' && index > 0 && last) {
        return;
      }
      drafts.push({
        title: point.title,
        volumeIndex: point.volumeIndex,
        html: [html],
        fromToc: true,
      });
    });
  }

  const chapters: ParsedChapter[] = [];
  for (const draft of drafts) {
    const html = draft.html.filter(Boolean).join('\n');
    if (html === '') {
      continue;
    }
    const wordCount = countWords(htmlToText(html));
    chapters.push({
      title: draft.title || `Chapter ${chapters.length + 1}`,
      volumeIndex: draft.volumeIndex,
      html,
      wordCount,
    });
  }
  if (chapters.length === 0) {
    throw new BookImportError('empty', 'The EPUB has no readable chapter');
  }

  // 6. Volumes: table of contents first, then detection in the chapter titles.
  let finalVolumes = volumes;
  if (volumes.length === 0) {
    const detected = detectVolumes(chapters.map((chapter) => chapter.title));
    finalVolumes = detected.volumes.map((volume) => ({
      title: volume.title,
      origin: 'detected' as const,
    }));
    detected.assignment.forEach((volumeIndex, index) => {
      chapters[index].volumeIndex = volumeIndex;
    });
  } else {
    // Drop volumes that ended up without chapter and renumber.
    const used = [
      ...new Set(chapters.map((c) => c.volumeIndex).filter((v): v is number => v !== null)),
    ].sort((a, b) => a - b);
    finalVolumes = used.map((index) => volumes[index]);
    for (const chapter of chapters) {
      chapter.volumeIndex = chapter.volumeIndex === null ? null : used.indexOf(chapter.volumeIndex);
    }
  }

  let css: string | null = null;
  if (options.keepFormatting) {
    css =
      items
        .filter((item) => item.mediaType === 'text/css' || extension(item.path) === 'css')
        .map((item) => archive.text(item.path) ?? '')
        .join('\n')
        .trim() || null;
  }

  return {
    title,
    author: authors.length > 0 ? authors.join(', ') : null,
    language,
    description,
    cover,
    volumes: finalVolumes,
    chapters,
    images,
    css,
  };
}
