/**
 * Guesses the language of a text without any network: by script for languages that have
 * their own, and by very common words for the others. Good enough to choose a voice and
 * a translation direction; the user can always correct it in "Edit".
 */
const SCRIPTS: [string, RegExp][] = [
  ['ja', /[぀-ヿ]/g],
  ['ko', /[가-힯]/g],
  ['zh', /[一-鿿]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['ar', /[؀-ۿ]/g],
  ['th', /[฀-๿]/g],
];

const COMMON_WORDS: Record<string, string[]> = {
  en: [
    'the',
    'and',
    'of',
    'to',
    'was',
    'that',
    'he',
    'she',
    'it',
    'with',
    'his',
    'her',
    'had',
    'you',
    'not',
    'but',
    'for',
    'at',
    'this',
    'what',
  ],
  fr: [
    'le',
    'la',
    'les',
    'de',
    'des',
    'et',
    'un',
    'une',
    'il',
    'elle',
    'que',
    'qui',
    'dans',
    'pas',
    'ne',
    'est',
    'était',
    'avec',
    'pour',
    'sur',
    'ce',
    'mais',
    'du',
    'au',
  ],
  es: [
    'el',
    'los',
    'las',
    'de',
    'y',
    'que',
    'en',
    'una',
    'con',
    'por',
    'para',
    'pero',
    'su',
    'se',
    'no',
    'del',
    'como',
    'estaba',
    'había',
  ],
  de: [
    'der',
    'die',
    'das',
    'und',
    'nicht',
    'ich',
    'ist',
    'mit',
    'ein',
    'eine',
    'zu',
    'den',
    'war',
    'sich',
    'auf',
    'aber',
    'sie',
    'er',
    'wie',
  ],
  it: [
    'il',
    'di',
    'che',
    'non',
    'una',
    'per',
    'con',
    'gli',
    'della',
    'era',
    'come',
    'ma',
    'più',
    'aveva',
    'sono',
    'nel',
    'lo',
    'si',
  ],
  pt: [
    'o',
    'os',
    'as',
    'de',
    'que',
    'não',
    'uma',
    'com',
    'para',
    'mas',
    'ele',
    'ela',
    'do',
    'da',
    'em',
    'um',
    'se',
    'estava',
    'seu',
  ],
  id: [
    'yang',
    'dan',
    'di',
    'itu',
    'dengan',
    'untuk',
    'tidak',
    'ini',
    'dari',
    'dia',
    'aku',
    'akan',
    'pada',
    'juga',
    'saya',
    'ke',
  ],
  tr: [
    'bir',
    've',
    'bu',
    'için',
    'ile',
    'ama',
    'çok',
    'değil',
    'gibi',
    'daha',
    'ne',
    'ben',
    'sen',
    'kadar',
    'olarak',
  ],
  vi: [
    'và',
    'của',
    'là',
    'không',
    'một',
    'có',
    'người',
    'trong',
    'đã',
    'cho',
    'này',
    'với',
    'được',
    'như',
  ],
  pl: [
    'nie',
    'się',
    'na',
    'że',
    'jest',
    'jak',
    'ale',
    'do',
    'to',
    'tak',
    'był',
    'jego',
    'przez',
    'tylko',
    'już',
  ],
};

/** Language code of a text, or null when it cannot be told. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 6000);
  const letters = sample.replace(/[\s\d\p{P}\p{S}]/gu, '').length;
  if (letters < 20) {
    return null;
  }
  // Japanese text also contains Chinese characters: kana decide first.
  for (const [code, pattern] of SCRIPTS) {
    const count = sample.match(pattern)?.length ?? 0;
    if (count / letters > (code === 'ja' ? 0.08 : 0.3)) {
      return code;
    }
  }
  const words = sample.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 8) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const [code, list] of Object.entries(COMMON_WORDS)) {
    let score = 0;
    for (const word of list) {
      score += counts.get(word) ?? 0;
    }
    if (score > bestScore) {
      second = bestScore;
      bestScore = score;
      best = code;
    } else if (score > second) {
      second = score;
    }
  }
  // At least one word in twelve must be a common word, and the winner must be clear.
  if (best === null || bestScore / words.length < 0.08 || bestScore < second * 1.25) {
    return null;
  }
  return best;
}
