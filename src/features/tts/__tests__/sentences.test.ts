import {
  chapterSentences,
  paragraphStart,
  sentenceIndexAt,
  sentenceRanges,
  sentencesOfBlocks,
  spokenText,
} from '../sentences';

const cut = (text: string) =>
  sentenceRanges(text).map((range) => text.slice(range.start, range.end));

describe('sentence cutting', () => {
  it('cuts at sentence ends and keeps closing quotes', () => {
    expect(cut('Hello there. How are you? "Fine!" she said.')).toEqual([
      'Hello there.',
      'How are you?',
      '"Fine!"',
      'she said.',
    ]);
    expect(cut('« Vraiment ?! » Il rit… puis se tut.')).toEqual([
      '« Vraiment ?!',
      '» Il rit… puis se tut.',
    ]);
  });

  it('does not cut numbers, abbreviations or initials', () => {
    expect(cut('Pi is 3.14 exactly. Next.')).toEqual(['Pi is 3.14 exactly.', 'Next.']);
    expect(cut('Mr. Smith met Dr. Who. They left.')).toEqual([
      'Mr. Smith met Dr. Who.',
      'They left.',
    ]);
    expect(cut('M. Dupont et Mme. Martin arrivent.')).toEqual([
      'M. Dupont et Mme. Martin arrivent.',
    ]);
    expect(cut('By J. R. R. Tolkien.')).toEqual(['By J. R. R. Tolkien.']);
  });

  it('cuts Chinese and Japanese punctuation and line breaks', () => {
    expect(cut('你好。我很好！')).toEqual(['你好。', '我很好！']);
    expect(cut('Line one\nLine two')).toEqual(['Line one', 'Line two']);
  });

  it('keeps the offsets of each sentence', () => {
    const text = '  First one.   Second one.  ';
    expect(sentenceRanges(text)).toEqual([
      { start: 2, end: 12 },
      { start: 15, end: 26 },
    ]);
  });

  it('cuts very long sentences at a comma or a space', () => {
    const long = `${'word, '.repeat(150)}end.`;
    const parts = cut(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 400)).toBe(true);
    expect(parts.join('')).toBe(long);
  });
});

describe('spoken text', () => {
  it('drops footnote marks and separators', () => {
    expect(spokenText('The sect[1] leader² spoke*.')).toBe('The sect leader spoke.');
    expect(spokenText('***')).toBe('');
    expect(spokenText(' — ◇ — ')).toBe('');
    expect(spokenText('Chapter 12')).toBe('Chapter 12');
  });
});

describe('chapter sentences', () => {
  const html =
    '<h1>Chapter 1</h1><p>First. Second one!</p><p>***</p><p><img src="a.png"></p><p>Third.</p>';

  it('follow the block numbering of the reader', () => {
    expect(chapterSentences(html)).toEqual([
      { b: 0, start: 0, end: 9, text: 'Chapter 1', endsBlock: true },
      { b: 1, start: 0, end: 6, text: 'First.', endsBlock: false },
      { b: 1, start: 7, end: 18, text: 'Second one!', endsBlock: true },
      { b: 4, start: 0, end: 6, text: 'Third.', endsBlock: true },
    ]);
  });

  it('skip footnotes and their references', () => {
    const withNotes =
      '<p>The sword<sup><a href="#n1">1</a></sup> shone.</p>' +
      '<aside epub:type="footnote"><p>1. A famous sword.</p></aside><p>The end.</p>';
    expect(chapterSentences(withNotes).map((sentence) => sentence.text)).toEqual([
      'The sword shone.',
      'The end.',
    ]);
    const kept = chapterSentences(withNotes);
    expect(kept[kept.length - 1].b).toBe(2);
  });

  it('finds the sentence of a position and the paragraph starts', () => {
    const sentences = sentencesOfBlocks(['Aa. Bb. Cc.', 'Dd. Ee.', 'Ff.']);
    expect(sentenceIndexAt(sentences, 0, 0)).toBe(0);
    expect(sentenceIndexAt(sentences, 0, 4)).toBe(1);
    expect(sentenceIndexAt(sentences, 1, 0)).toBe(3);
    expect(sentenceIndexAt(sentences, 9, 0)).toBe(5);
    expect(paragraphStart(sentences, 1, 1)).toBe(3);
    expect(paragraphStart(sentences, 5, 1)).toBe(6);
    expect(paragraphStart(sentences, 4, -1)).toBe(3);
    expect(paragraphStart(sentences, 3, -1)).toBe(0);
    expect(paragraphStart(sentences, 0, -1)).toBe(0);
  });
});
