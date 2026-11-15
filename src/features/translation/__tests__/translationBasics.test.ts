import {
  deeplBaseUrl,
  deeplCreateGlossary,
  DeepLError,
  deeplTargetLang,
  deeplTranslate,
  deeplUsage,
} from '../deepl';
import { detectLanguage } from '../detectLanguage';
import {
  glossaryFingerprint,
  glossaryToTsv,
  prepareGlossary,
  protectTerms,
  restoreTerms,
} from '../glossary';

describe('language detection', () => {
  it('recognises English and French prose', () => {
    expect(
      detectLanguage(
        'The sect leader looked at the young man and said that he was not ready for this trial, but she had other plans.',
      ),
    ).toBe('en');
    expect(
      detectLanguage(
        'Le maître de la secte regarda le jeune homme et déclara qu’il n’était pas prêt pour cette épreuve, mais elle avait des plans.',
      ),
    ).toBe('fr');
  });

  it('recognises scripts', () => {
    expect(
      detectLanguage(
        '这是一个很长的中文句子，用来测试语言检测功能是否正常工作。我们需要更多的文字。',
      ),
    ).toBe('zh');
    expect(
      detectLanguage('これは日本語の文章です。言語の検出が正しく動くかどうかを確かめます。'),
    ).toBe('ja');
    expect(
      detectLanguage('Это довольно длинное русское предложение для проверки определения языка.'),
    ).toBe('ru');
  });

  it('gives up on short or ambiguous text', () => {
    expect(detectLanguage('Chapter 1')).toBeNull();
    expect(detectLanguage('')).toBeNull();
    expect(
      detectLanguage('Lorem ipsum dolor sit amet consectetur adipiscing elit sed eiusmod'),
    ).toBeNull();
  });
});

describe('glossary', () => {
  const glossary = prepareGlossary([
    { source: 'Sect', target: 'Secte' },
    { source: 'Sect Leader', target: 'Maître de secte' },
    { source: 'Lin Feng', target: '' },
    { source: ' sect ', target: 'ignored duplicate' },
    { source: '', target: 'x' },
  ]);

  it('keeps usable entries, longest first, and "do not translate" as itself', () => {
    expect(glossary).toEqual([
      { source: 'Sect Leader', target: 'Maître de secte' },
      { source: 'Lin Feng', target: 'Lin Feng' },
      { source: 'Sect', target: 'Secte' },
    ]);
  });

  it('protects whole terms with markers and restores them after translation', () => {
    const protectedText = protectTerms(
      'The sect leader greeted Lin Feng. The Sect was old; insects were not.',
      glossary,
    );
    expect(protectedText.text).toBe(
      'The XGL000X greeted XGL001X. The XGL002X was old; insects were not.',
    );
    expect(protectedText.targets).toEqual(['Maître de secte', 'Lin Feng', 'Secte']);
    // The engine translated around the markers, changing their case and spacing.
    expect(
      restoreTerms('Le xgl000x a salué XGL 001 X. Le XGL002X était vieux.', protectedText.targets),
    ).toBe('Le Maître de secte a salué Lin Feng. Le Secte était vieux.');
    expect(protectTerms('Nothing here', glossary)).toEqual({ text: 'Nothing here', targets: [] });
  });

  it('is sent to DeepL as tab separated values', () => {
    expect(glossaryToTsv(glossary)).toBe(
      'Sect Leader\tMaître de secte\nLin Feng\tLin Feng\nSect\tSecte',
    );
    expect(glossaryFingerprint(glossary)).toBe(glossaryFingerprint([...glossary]));
    expect(glossaryFingerprint(glossary)).not.toBe(glossaryFingerprint(glossary.slice(1)));
  });
});

describe('DeepL', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const answering = (status: number, body: unknown) =>
    (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }) as typeof fetch;
  beforeEach(() => {
    calls.length = 0;
  });

  it('uses the free endpoint for free keys', () => {
    expect(deeplBaseUrl('abc:fx')).toBe('https://api-free.deepl.com');
    expect(deeplBaseUrl('abc')).toBe('https://api.deepl.com');
    expect(deeplTargetLang('en')).toBe('EN-US');
    expect(deeplTargetLang('fr')).toBe('FR');
  });

  it('translates HTML fragments with the key in a header', async () => {
    const out = await deeplTranslate(
      answering(200, { translations: [{ text: '<i>Bonjour</i>' }, { text: 'Monde' }] }),
      'key:fx',
      ['<i>Hello</i>', 'World'],
      { source: 'en', target: 'fr', glossaryId: 'g1' },
    );
    expect(out).toEqual(['<i>Bonjour</i>', 'Monde']);
    expect(calls[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      'DeepL-Auth-Key key:fx',
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      text: ['<i>Hello</i>', 'World'],
      source_lang: 'EN',
      target_lang: 'FR',
      tag_handling: 'html',
      glossary_id: 'g1',
    });
  });

  it('splits long requests', async () => {
    const fragments = Array.from({ length: 95 }, (_, i) => `t${i}`);
    const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const texts = (JSON.parse(String(init?.body)) as { text: string[] }).text;
      calls.push({ url: '', init: init ?? {} });
      return new Response(
        JSON.stringify({ translations: texts.map((text) => ({ text: text.toUpperCase() })) }),
        { status: 200 },
      );
    }) as typeof fetch;
    const out = await deeplTranslate(fetcher, 'k', fragments, { source: 'en', target: 'fr' });
    expect(out).toHaveLength(95);
    expect(out[94]).toBe('T94');
    expect(calls).toHaveLength(3);
  });

  it('reads the quota and names the errors', async () => {
    expect(
      await deeplUsage(answering(200, { character_count: 1200, character_limit: 500000 }), 'k'),
    ).toEqual({ used: 1200, limit: 500000 });
    const kindOf = async (status: number) => {
      try {
        await deeplUsage(answering(status, {}), 'k');
        return 'none';
      } catch (error) {
        return (error as DeepLError).kind;
      }
    };
    expect(await kindOf(403)).toBe('key');
    expect(await kindOf(456)).toBe('quota');
    expect(await kindOf(500)).toBe('server');
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(deeplUsage(offline, 'k')).rejects.toMatchObject({ kind: 'network' });
  });

  it('creates a glossary', async () => {
    const id = await deeplCreateGlossary(
      answering(201, { glossary_id: 'abc' }),
      'k',
      'Novel',
      'en',
      'fr',
      [{ source: 'Sect', target: 'Secte' }],
    );
    expect(id).toBe('abc');
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      source_lang: 'en',
      target_lang: 'fr',
      entries: 'Sect\tSecte',
      entries_format: 'tsv',
    });
  });
});
