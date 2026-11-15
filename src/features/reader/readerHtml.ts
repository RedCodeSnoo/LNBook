/** Builds the HTML document shown by the reader web view. */
import { escapeHtml } from '../../services/html';
import { contrastRatio, relativeLuminance } from '../../theme/contrast';
import { READER_RUNTIME } from './readerRuntime';
import {
  findFont,
  findTheme,
  type ReaderFont,
  type ReaderSettings,
  type ReaderTheme,
} from './readerSettings';

/** Anchor of a place in a chapter: block index, character offset, 30 characters of context. */
export interface Anchor {
  b: number;
  o: number;
  c: string;
  /** End of a range (quotes): block index and offset. */
  eb?: number;
  eo?: number;
}

export function parseAnchor(value: string | null | undefined): Anchor | null {
  if (!value) {
    return null;
  }
  try {
    const anchor = JSON.parse(value) as Partial<Anchor>;
    if (typeof anchor.b === 'number' && typeof anchor.o === 'number') {
      return {
        ...anchor,
        b: anchor.b,
        o: anchor.o,
        c: typeof anchor.c === 'string' ? anchor.c : '',
      };
    }
  } catch {
    // Not an anchor.
  }
  return null;
}

export interface ReaderInsets {
  top: number;
  bottom: number;
}

export interface ReaderConfig {
  animation: ReaderSettings['pageAnimation'];
  tapZones: ReaderSettings['tapZones'];
  showQuotes: boolean;
  anchor: Anchor | null;
  /** Used when there is no anchor (chapters read before anchors existed). */
  progress: number;
  /** Place to show and highlight for 2 seconds (opening a quote or a search result). */
  flash: Anchor | null;
  quotes: { id: number; a: Anchor }[];
  /** Same text in the other language, block by block (original of a translation). */
  other?: string[] | null;
  /** Show the other version under every paragraph. */
  bilingual?: boolean;
}

export interface ReaderDocumentInput {
  title: string;
  /** Cleaned chapter HTML. */
  html: string;
  settings: ReaderSettings;
  insets: ReaderInsets;
  config: Omit<ReaderConfig, 'animation' | 'tapZones' | 'showQuotes'>;
  /** Label of the card shown after the text, e.g. "Next chapter". */
  endLabel: string;
  /** Title of the next chapter, or a "last chapter" message. */
  endTitle: string;
  /** file:// URI of the directory holding the embedded fonts. */
  fontsUri: string;
  /** Resolves the path of an imported font file to a file:// URI. */
  fontUri: (path: string) => string;
  /** Language of the text (BCP 47), needed for automatic hyphenation. */
  lang?: string | null;
  /** Extra CSS (original EPUB styles when the user keeps them). */
  extraCss?: string;
}

const isDark = (theme: ReaderTheme) => relativeLuminance(theme.background) < 0.4;

/** Colours derived from the page theme: links, highlights, quote underline. */
export function themeAccents(theme: ReaderTheme) {
  const dark = isDark(theme);
  const candidates = dark ? ['#9CC7FF', '#C8DDFF', '#FFFFFF'] : ['#1A5FBF', '#0B3F80', '#000000'];
  const link =
    candidates.find((color) => contrastRatio(color, theme.background) >= 4.5) ?? theme.text;
  return {
    link,
    search: dark ? 'rgba(255, 214, 10, 0.35)' : 'rgba(255, 214, 10, 0.55)',
    searchCurrent: dark ? 'rgba(255, 149, 0, 0.6)' : 'rgba(255, 149, 0, 0.7)',
    spoken: dark ? 'rgba(156, 199, 255, 0.28)' : 'rgba(26, 111, 214, 0.2)',
    flash: dark ? 'rgba(255, 214, 10, 0.4)' : 'rgba(255, 214, 10, 0.6)',
    quote: link,
    rule: dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.16)',
    card: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
  };
}

export function fontFaces(
  settings: ReaderSettings,
  fontsUri: string,
  fontUri: (path: string) => string,
): string {
  const font = findFont(settings);
  if ('files' in font) {
    return (font as ReaderFont).files
      .map(
        (file) =>
          `@font-face{font-family:"${font.family}";src:url("${fontsUri}/${file.file}");` +
          `font-weight:${file.weight === 400 ? '400' : '600 700'};font-style:${file.italic ? 'italic' : 'normal'};}`,
      )
      .join('\n');
  }
  return `@font-face{font-family:"custom-${font.id}";src:url("${fontUri(font.path)}");}`;
}

function fontFamily(settings: ReaderSettings): string {
  const font = findFont(settings);
  if ('files' in font) {
    return font.id === 'system' ? 'sans-serif' : `"${font.family}", serif`;
  }
  return `"custom-${font.id}", serif`;
}

/** CSS variables driven by the settings; updated live without reloading the chapter. */
export function settingsVars(
  settings: ReaderSettings,
  insets: ReaderInsets,
): Record<string, string> {
  const theme = findTheme(settings);
  const accents = themeAccents(theme);
  // Room for the progress line at the bottom of the screen.
  const footer = settings.showProgress || settings.showClock || settings.showBattery ? 22 : 0;
  return {
    '--bg': theme.background,
    '--fg': theme.text,
    '--link': accents.link,
    '--search': accents.search,
    '--search-current': accents.searchCurrent,
    '--spoken': accents.spoken,
    '--flash': accents.flash,
    '--quote': accents.quote,
    '--rule': accents.rule,
    '--card': accents.card,
    '--font': fontFamily(settings),
    '--size': `${settings.fontSize}px`,
    '--lh': String(settings.lineHeight),
    '--ps': `${settings.paragraphSpacing}em`,
    '--indent': `${settings.textIndent}em`,
    '--mh': `${settings.marginHorizontal}px`,
    '--top': `${settings.marginVertical + insets.top}px`,
    '--bottom': `${settings.marginVertical + insets.bottom + footer}px`,
    '--align': settings.textAlign,
    '--hyphens': settings.textAlign === 'justify' ? 'auto' : 'manual',
    '--weight': settings.semiBold ? '600' : '400',
  };
}

const BASE_CSS = `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html{background:var(--bg);-webkit-text-size-adjust:100%;text-size-adjust:100%;}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:var(--size);
  line-height:var(--lh);font-weight:var(--weight);text-align:var(--align);hyphens:var(--hyphens);
  -webkit-hyphens:var(--hyphens);overflow-wrap:break-word;word-break:normal;}
#flow{padding:var(--top) var(--mh) var(--bottom);}
h1.ln-title{font-size:1.45em;line-height:1.25;margin:0 0 1.2em;text-align:left;font-weight:700;hyphens:manual;}
#content p{margin:0 0 var(--ps);text-indent:var(--indent);}
#content h1,#content h2,#content h3,#content h4,#content h5,#content h6{line-height:1.3;margin:1.2em 0 0.6em;
  text-align:left;text-indent:0;font-weight:700;hyphens:manual;break-after:avoid;}
#content h1{font-size:1.4em;}#content h2{font-size:1.25em;}#content h3{font-size:1.12em;}
#content h4,#content h5,#content h6{font-size:1em;}
#content img{display:block;max-width:100%;height:auto;margin:0.8em auto;break-inside:avoid;}
#content blockquote{margin:0.8em 0;padding-left:1em;border-left:3px solid var(--rule);}
#content hr{border:0;border-top:1px solid var(--rule);margin:1.6em 20%;}
#content a{color:var(--link);}
#content table{border-collapse:collapse;max-width:100%;font-size:0.9em;}
#content td,#content th{border:1px solid var(--rule);padding:0.3em 0.5em;text-indent:0;}
#content pre{white-space:pre-wrap;font-size:0.9em;}
#content ul,#content ol{padding-left:1.4em;}
#content li{text-indent:0;}
#content .ln-original{display:block;opacity:0.72;font-size:0.88em;margin:calc(var(--ps) * -0.6) 0 var(--ps);
  padding-left:0.7em;border-left:2px solid var(--rule);text-indent:0;}
::selection{background:var(--spoken);}
::highlight(search){background-color:var(--search);}
::highlight(search-current){background-color:var(--search-current);}
::highlight(spoken){background-color:var(--spoken);}
::highlight(flash){background-color:var(--flash);}
::highlight(quote){text-decoration:underline;text-decoration-color:var(--quote);text-decoration-thickness:2px;
  text-underline-offset:3px;}
.ln-flash{background:var(--flash);transition:background 0.3s;}
#end{margin:2.4em 0 1em;padding:1.1em 1.2em;border-radius:16px;background:var(--card);text-align:left;
  text-indent:0;hyphens:manual;font-family:sans-serif;}
#end .ln-end-label{font-size:13px;opacity:0.75;line-height:1.3;}
#end .ln-end-title{font-size:16px;font-weight:600;line-height:1.35;margin-top:2px;}
html.paged,html.paged body{height:100%;overflow:hidden;}
html.paged #pager{height:100vh;overflow:hidden;}
html.paged #flow{height:calc(100vh - var(--top) - var(--bottom));margin:var(--top) 0 var(--bottom);padding:0 var(--mh);
  column-width:calc(100vw - 2 * var(--mh));column-gap:calc(2 * var(--mh));column-fill:auto;}
html.paged #content img{max-height:calc(100vh - var(--top) - var(--bottom) - 2em);object-fit:contain;}
html.paged #end{break-before:column;margin-top:0;}
`;

function startsWithHeading(html: string): boolean {
  return /^\s*(?:<div[^>]*>\s*)*<h[1-3][\s>]/i.test(html);
}

/** JSON embedded in a <script>: "<" is escaped so that the content cannot close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, '');
}

export function buildReaderDocument(input: ReaderDocumentInput): string {
  const { settings } = input;
  const vars = settingsVars(settings, input.insets);
  const config: ReaderConfig = {
    ...input.config,
    animation: settings.pageAnimation,
    tapZones: settings.tapZones,
    showQuotes: settings.showQuotes,
  };
  const rootVars = Object.entries(vars)
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  // The chapter title is shown above the text unless the text already starts with a heading.
  const title = startsWithHeading(input.html)
    ? ''
    : `<h1 class="ln-title">${escapeHtml(input.title)}</h1>`;

  return `<!DOCTYPE html>
<html lang="${/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.lang ?? '') ? input.lang : 'und'}"${settings.mode === 'paged' ? ' class="paged"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>:root{${rootVars}}</style>
<style id="ln-fonts">${fontFaces(settings, input.fontsUri, input.fontUri)}</style>
<style>${BASE_CSS}</style>
${input.extraCss ? `<style>${input.extraCss.replace(/<\/style/gi, '')}</style>` : ''}
</head>
<body>
<div id="pager"><div id="flow">${title}<div id="content">${input.html}</div>
<div id="end" role="button"><div class="ln-end-label">${escapeHtml(input.endLabel)}</div><div class="ln-end-title">${escapeHtml(input.endTitle)}</div></div>
</div></div>
<script>window.__LN_CONFIG=${scriptJson(config)};</script>
<script>${READER_RUNTIME}</script>
</body>
</html>`;
}

/** Command sent to the runtime when the settings change (no reload). */
export function settingsCommand(
  settings: ReaderSettings,
  insets: ReaderInsets,
  fontsUri: string,
  fontUri: (path: string) => string,
) {
  return {
    name: 'settings',
    vars: settingsVars(settings, insets),
    fontFaces: fontFaces(settings, fontsUri, fontUri),
    mode: settings.mode,
    animation: settings.pageAnimation,
    tapZones: settings.tapZones,
    showQuotes: settings.showQuotes,
  };
}
