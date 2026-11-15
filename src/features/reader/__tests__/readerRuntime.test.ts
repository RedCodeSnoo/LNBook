import { JSDOM } from 'jsdom';

import { editBlocks, extractBlockTexts, searchBlocks } from '../blocks';
import {
  buildReaderDocument,
  parseAnchor,
  settingsVars,
  themeAccents,
  type Anchor,
} from '../readerHtml';
import { DEFAULT_READER_SETTINGS, READER_THEMES } from '../readerSettings';
import { contrastRatio } from '../../../theme/contrast';

const CHAPTER =
  '<h2>Chapter 1</h2>' +
  '<p>The quick brown fox jumps over the lazy dog near the old stone bridge.</p>' +
  '<div><p>She said: <i>“never again”</i>, and left the room without a word.</p></div>' +
  '<p><img src="images/map.png" alt="" /></p>' +
  '<p>The fox came back the next morning, quick as ever.</p>';

interface Internals {
  makeAnchor(b: number, o: number): Anchor;
  resolveAnchor(anchor: Anchor | null): { b: number; o: number } | null;
  rangeOfAnchor(anchor: Anchor): Range | null;
  runSearch(query: string): void;
  getSearch(): { ranges: { b: number; o: number }[]; index: number };
  setQuotes(list: { id: number; a: Anchor }[]): void;
  getQuotes(): { id: number; range: Range }[];
  getBlocks(): Element[];
}

function load(html = CHAPTER, overrides: Partial<Parameters<typeof buildReaderDocument>[0]> = {}) {
  const messages: { type: string; [key: string]: unknown }[] = [];
  const document = buildReaderDocument({
    title: 'Chapter 1: Start',
    html,
    settings: DEFAULT_READER_SETTINGS,
    insets: { top: 24, bottom: 0 },
    config: { anchor: null, progress: 0, flash: null, quotes: [] },
    endLabel: 'Next chapter',
    endTitle: 'Chapter 2 <Road>',
    fontsUri: 'file:///android_asset/reader-fonts',
    fontUri: (path) => `file:///data/${path}`,
    ...overrides,
  });
  const dom = new JSDOM(document, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
        postMessage: (data: string) => messages.push(JSON.parse(data)),
      };
      window.scrollTo = () => undefined;
    },
  });
  const LN = (
    dom.window as unknown as {
      LN: { _internals: Internals; blockTexts(): string[]; cmd(c: object): void };
    }
  ).LN;
  return { dom, LN, internals: LN._internals, messages, document };
}

describe('reader document', () => {
  it('escapes the texts it embeds and keeps scripts intact', () => {
    const { document, dom } = load('<p>Text</p>', {
      config: {
        anchor: { b: 0, o: 0, c: '</script><script>alert(1)</script>' },
        progress: 0,
        flash: null,
        quotes: [],
      },
    });
    expect(document).toContain('Chapter 2 &lt;Road&gt;');
    expect(document).not.toContain('</script><script>alert(1)');
    expect(dom.window.document.querySelectorAll('script')).toHaveLength(2);
  });

  it('adds the chapter title unless the text starts with a heading', () => {
    expect(load('<p>Text</p>').dom.window.document.querySelector('h1.ln-title')?.textContent).toBe(
      'Chapter 1: Start',
    );
    expect(load().dom.window.document.querySelector('h1.ln-title')).toBeNull();
  });

  it('declares the language of the text for hyphenation, ignoring unsafe values', () => {
    expect(load(CHAPTER, { lang: 'fr' }).dom.window.document.documentElement.lang).toBe('fr');
    expect(load(CHAPTER, { lang: 'pt-BR' }).dom.window.document.documentElement.lang).toBe('pt-BR');
    expect(load(CHAPTER, { lang: '"><x' }).dom.window.document.documentElement.lang).toBe('und');
    expect(load().dom.window.document.documentElement.lang).toBe('und');
  });

  it('switches to paged mode with a class', () => {
    const { dom } = load(CHAPTER, { settings: { ...DEFAULT_READER_SETTINGS, mode: 'paged' } });
    expect(dom.window.document.documentElement.classList.contains('paged')).toBe(true);
  });

  it('reports that it is ready', () => {
    const { messages } = load();
    expect(messages.find((message) => message.type === 'ready')).toEqual({
      type: 'ready',
      blocks: 5,
    });
  });
});

describe('blocks and anchors', () => {
  it('indexes paragraphs, headings and image blocks, not their wrappers', () => {
    const { LN, internals } = load();
    expect(internals.getBlocks().map((el) => el.tagName)).toEqual(['H2', 'P', 'P', 'P', 'P']);
    expect(LN.blockTexts()[2]).toBe('She said: “never again”, and left the room without a word.');
  });

  it('creates anchors with 30 characters of context', () => {
    const { internals } = load();
    expect(internals.makeAnchor(1, 4)).toEqual({ b: 1, o: 4, c: 'quick brown fox jumps over the' });
  });

  it('resolves an unchanged anchor to the same place', () => {
    const { internals } = load();
    const anchor = internals.makeAnchor(2, 10);
    expect(internals.resolveAnchor(anchor)).toEqual({ b: 2, o: 10 });
  });

  it('finds the place again when paragraphs were added before it', () => {
    const anchor = load().internals.makeAnchor(2, 10);
    const edited = load(
      CHAPTER.replace('<h2>Chapter 1</h2>', '<h2>Chapter 1</h2><p>New intro.</p><p>More.</p>'),
    );
    expect(edited.internals.resolveAnchor(anchor)).toEqual({ b: 4, o: 10 });
  });

  it('finds the place again when the text before it changed in the same paragraph', () => {
    const anchor = load().internals.makeAnchor(1, 20);
    const edited = load(CHAPTER.replace('The quick brown', 'The very quick brown'));
    expect(edited.internals.resolveAnchor(anchor)).toEqual({ b: 1, o: 25 });
  });

  it('falls back to the same block when the context disappeared', () => {
    const anchor = load().internals.makeAnchor(1, 20);
    const edited = load(CHAPTER.replace('jumps over the lazy dog near', 'sleeps'));
    expect(edited.internals.resolveAnchor(anchor)?.b).toBe(1);
    expect(edited.internals.resolveAnchor({ b: 99, o: 5, c: 'zzz' })).toEqual({ b: 4, o: 5 });
    expect(edited.internals.resolveAnchor(null)).toBeNull();
  });

  it('builds the range of a quote spanning inline tags and paragraphs', () => {
    const { internals, LN } = load();
    const start = internals.makeAnchor(2, 10);
    const single = internals.rangeOfAnchor({ ...start, eb: 2, eo: 23 });
    expect(single?.toString()).toBe('“never again”');
    const multi = internals.rangeOfAnchor({
      ...internals.makeAnchor(1, LN.blockTexts()[1].indexOf('bridge')),
      eb: 2,
      eo: 8,
    });
    expect(multi?.toString().replace(/\s+/g, ' ')).toBe('bridge.She said');
  });

  it('keeps the length of a quote when its start moved', () => {
    const quote = { ...load().internals.makeAnchor(2, 10), eb: 2, eo: 23 };
    const edited = load(CHAPTER.replace('She said:', 'Then she said:'));
    expect(edited.internals.rangeOfAnchor(quote)?.toString()).toBe('“never again”');
  });
});

describe('search and quotes', () => {
  it('finds every occurrence, ignoring case', () => {
    const { internals, messages } = load();
    internals.runSearch('QUICK');
    expect(internals.getSearch().ranges.map((hit) => [hit.b, hit.o])).toEqual([
      [1, 4],
      [4, 36],
    ]);
    expect(messages.filter((message) => message.type === 'search').pop()).toMatchObject({
      count: 2,
    });
    internals.runSearch('absent');
    expect(messages.filter((message) => message.type === 'search').pop()).toEqual({
      type: 'search',
      count: 0,
      index: -1,
    });
  });

  it('registers the quotes that can be located', () => {
    const { internals } = load();
    internals.setQuotes([
      { id: 7, a: { ...internals.makeAnchor(2, 10), eb: 2, eo: 23 } },
      { id: 8, a: { b: 1, o: 0, c: '', eb: 1, eo: 0 } },
    ]);
    expect(internals.getQuotes().map((quote) => quote.id)).toEqual([7]);
  });
});

describe('other version of the paragraphs', () => {
  const other = ['Chapitre 1', 'Le renard <i>rapide</i>.', 'Elle dit.', '', 'Le renard revint.'];
  const config = { anchor: null, progress: 0, flash: null, quotes: [], other };

  it('shows and hides the other version under one paragraph', () => {
    const { LN, dom, internals } = load(CHAPTER, { config });
    const content = dom.window.document.getElementById('content') as HTMLElement;
    expect(content.querySelectorAll('.ln-original')).toHaveLength(0);
    LN.cmd({ name: 'other', b: 1 });
    const shown = content.querySelectorAll('.ln-original');
    expect(shown).toHaveLength(1);
    expect(shown[0].innerHTML).toBe('Le renard <i>rapide</i>.');
    expect(shown[0].previousElementSibling).toBe(internals.getBlocks()[1]);
    // The numbering of the paragraphs does not change: positions stay valid.
    expect(LN.blockTexts()).toHaveLength(5);
    LN.cmd({ name: 'other', b: 1 });
    expect(content.querySelectorAll('.ln-original')).toHaveLength(0);
  });

  it('shows every paragraph in both versions in bilingual display', () => {
    const { LN, dom } = load(CHAPTER, { config: { ...config, bilingual: true } });
    const content = dom.window.document.getElementById('content') as HTMLElement;
    // The paragraph that is only an image has no other version.
    expect(content.querySelectorAll('.ln-original')).toHaveLength(4);
    expect(LN.blockTexts()).toHaveLength(5);
    LN.cmd({ name: 'bilingual', on: false });
    expect(content.querySelectorAll('.ln-original')).toHaveLength(0);
    LN.cmd({ name: 'bilingual', on: true });
    expect(content.querySelectorAll('.ln-original')).toHaveLength(4);
  });
});

describe('reader themes', () => {
  it.each(READER_THEMES)('$id has readable text, links and variables', (theme) => {
    expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(themeAccents(theme).link, theme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes the settings as CSS variables', () => {
    const vars = settingsVars(
      {
        ...DEFAULT_READER_SETTINGS,
        fontSize: 22,
        textAlign: 'justify',
        semiBold: true,
        marginVertical: 10,
      },
      { top: 30, bottom: 5 },
    );
    expect(vars).toMatchObject({
      '--size': '22px',
      '--align': 'justify',
      '--hyphens': 'auto',
      '--weight': '600',
      '--top': '40px',
      '--bottom': '37px',
    });
  });

  it('parses stored anchors', () => {
    expect(parseAnchor('{"b":3,"o":12,"c":"abc"}')).toEqual({ b: 3, o: 12, c: 'abc' });
    expect(parseAnchor('{"b":3}')).toBeNull();
    expect(parseAnchor('nope')).toBeNull();
    expect(parseAnchor(null)).toBeNull();
  });
});

describe('block numbering shared with React Native', () => {
  const TRICKY =
    '<h2>Title</h2><div><div><p>Nested <b>deep</b></p></div>Loose text</div>' +
    '<ul><li>One</li><li><p>Two</p></li></ul><blockquote>Quote <i>here</i></blockquote>' +
    '<p> </p><p><img src="images/a.png" alt="" /></p><table><tr><td>Cell</td></tr></table>' +
    '<p>Last &amp; least</p>';

  it.each([CHAPTER, TRICKY])('matches the numbering of the web view', (html) => {
    expect(extractBlockTexts(html)).toEqual(load(html).LN.blockTexts());
  });

  it('searches with anchors usable by the reader', () => {
    const hits = searchBlocks(extractBlockTexts(CHAPTER), 'fox');
    expect(hits.map((hit) => [hit.anchor.b, hit.anchor.o])).toEqual([
      [1, 16],
      [4, 4],
    ]);
    expect(hits[0]).toMatchObject({ before: 'The quick brown ', match: 'fox' });
    const { internals } = load();
    expect(internals.rangeOfAnchor(hits[1].anchor)?.toString()).toBe('fox');
    expect(searchBlocks(['aaa'], 'a', 2)).toHaveLength(2);
    expect(searchBlocks(['aaa'], '')).toEqual([]);
  });

  it('edits and removes paragraphs, keeping the others untouched', () => {
    const edited = editBlocks(
      CHAPTER,
      new Map([
        [1, 'A new <first> paragraph.'],
        [4, ''],
        [2, 'She said: “never again”, and left the room without a word.'],
      ]),
    );
    expect(extractBlockTexts(edited)).toEqual([
      'Chapter 1',
      'A new <first> paragraph.',
      'She said: “never again”, and left the room without a word.',
      '',
    ]);
    expect(edited).toContain('<p>A new &lt;first&gt; paragraph.</p>');
    expect(edited).toContain('<i>“never again”</i>');
  });
});
