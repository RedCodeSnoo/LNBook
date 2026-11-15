import { extractBlockTexts } from '../../reader/blocks';
import { prepareGlossary } from '../glossary';
import { translateChapterHtml, translateTitle, type ChapterTranslator } from '../translateHtml';

/** Fake engine: upper case, so that what was translated is visible. */
const upper = (glossary = prepareGlossary([])): ChapterTranslator & { seen: string[] } => {
  const seen: string[] = [];
  return {
    mode: 'text',
    glossary,
    seen,
    translate: async (texts) => {
      seen.push(...texts);
      return texts.map((text) => text.toUpperCase());
    },
  };
};

describe('chapter translation (text engine)', () => {
  it('translates each paragraph and keeps the structure', async () => {
    const html =
      '<h1>Chapter one</h1><p>Hello there.</p><p><img src="a.png" /></p><p>***</p><p>Bye.</p>';
    const engine = upper();
    const out = await translateChapterHtml(html, engine);
    expect(out).toBe(
      '<h1>CHAPTER ONE</h1><p>HELLO THERE.</p><p><img src="a.png" /></p><p>***</p><p>BYE.</p>',
    );
    expect(engine.seen).toEqual(['Chapter one', 'Hello there.', 'Bye.']);
    expect(extractBlockTexts(out)).toHaveLength(extractBlockTexts(html).length);
  });

  it('keeps formatting on whole sentences and line breaks', async () => {
    const out = await translateChapterHtml(
      '<p><i>This is a full sentence of thought.</i><br />Second line here.</p>',
      upper(),
    );
    expect(out).toBe('<p><i>THIS IS A FULL SENTENCE OF THOUGHT.</i><br />SECOND LINE HERE.</p>');
  });

  it('translates a sentence with a few formatted words as a whole', async () => {
    const engine = upper();
    const out = await translateChapterHtml('<p>He was <b>very</b> angry today.</p>', engine);
    expect(engine.seen).toEqual(['He was very angry today.']);
    expect(out).toBe('<p>HE WAS VERY ANGRY TODAY.<b></b></p>');
    expect(extractBlockTexts(out)).toEqual(['HE WAS VERY ANGRY TODAY.']);
  });

  it('applies the glossary around the engine', async () => {
    const glossary = prepareGlossary([
      { source: 'Sect Leader', target: 'Maître de secte' },
      { source: 'Lin Feng', target: '' },
    ]);
    const engine = upper(glossary);
    const out = await translateChapterHtml('<p>The sect leader saw Lin Feng.</p>', engine);
    expect(engine.seen).toEqual(['The XGL000X saw XGL001X.']);
    expect(out).toBe('<p>THE Maître de secte SAW Lin Feng.</p>');
    expect(await translateTitle('Lin Feng returns', engine)).toBe('Lin Feng RETURNS');
  });

  it('fails when the engine fails, leaving nothing half done', async () => {
    const broken: ChapterTranslator = {
      mode: 'text',
      glossary: [],
      translate: async () => {
        throw new Error('model missing');
      },
    };
    await expect(translateChapterHtml('<p>Text here.</p>', broken)).rejects.toThrow(
      'model missing',
    );
  });
});

describe('chapter translation (HTML engine)', () => {
  it('sends the markup of each paragraph and keeps one block per paragraph', async () => {
    const seen: string[] = [];
    const engine: ChapterTranslator = {
      mode: 'html',
      translate: async (fragments) => {
        seen.push(...fragments);
        return fragments.map((fragment) =>
          fragment.replace(/Hello/g, 'Bonjour').replace('world', 'monde'),
        );
      },
    };
    const out = await translateChapterHtml(
      '<p>Hello <i>world</i> &amp; all.</p><p><img src="x.png"/></p><p>Hello.</p>',
      engine,
    );
    expect(seen).toEqual(['Hello <i>world</i> &amp; all.', 'Hello.']);
    expect(out).toBe(
      '<p>Bonjour <i>monde</i> &amp; all.</p><p><img src="x.png" /></p><p>Bonjour.</p>',
    );
    expect(await translateTitle('Hello & world', engine)).toBe('Bonjour & monde');
  });

  it('keeps the original paragraph when the answer would break the structure', async () => {
    const engine: ChapterTranslator = {
      mode: 'html',
      translate: async (fragments) => fragments.map(() => '<p>Un</p><p>Deux</p>'),
    };
    const out = await translateChapterHtml('<p>One.</p>', engine);
    expect(out).toBe('<p>One.</p>');
  });
});
