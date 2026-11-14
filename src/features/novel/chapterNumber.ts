const PATTERNS = [
  /(?:chapitre|chapter|chap\.?|ch\.?|episode|épisode|ep\.?)\s*(\d+(?:[.,]\d+)?)/i,
  /第\s*(\d+)\s*[章话話回节]/,
  /^\s*(\d+(?:[.,]\d+)?)\s*(?:[-–—:.]|$)/,
];

/** Chapter number written in a title ("Chapter 12.5: …" → 12.5), or null. */
export function chapterNumberFromTitle(title: string): number | null {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(title);
    if (match) {
      const value = Number(match[1].replace(',', '.'));
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

/** "12" or "12.5": chapter numbers without useless decimals. */
export function formatChapterNumber(number: number): string {
  return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
}
