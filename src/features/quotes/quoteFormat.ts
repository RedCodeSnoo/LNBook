/** Text shown under a quote and export of quotes to Markdown or plain text. */
import type { TFunction } from 'i18next';

import { formatChapterNumber } from '../novel/chapterNumber';
import type { QuoteView } from './quotesRepository';

/** "Chapter 87 – The Fall · Vol. 3" */
export function quoteLocation(quote: QuoteView, t: TFunction): string {
  if (quote.chapterTitle === null) {
    return t('quotes.chapterDeleted');
  }
  const number =
    quote.chapterNumber !== null
      ? t('novel.chapterNumber', { number: formatChapterNumber(quote.chapterNumber) })
      : null;
  // Titles such as "Chapter 87: The Fall" already hold the number.
  const title =
    number && /\d/.test(quote.chapterTitle) ? quote.chapterTitle : [number, quote.chapterTitle];
  const chapter = Array.isArray(title) ? title.filter(Boolean).join(' – ') : title;
  return quote.volumeTitle ? `${chapter} · ${quote.volumeTitle}` : chapter;
}

export type QuoteExportFormat = 'md' | 'txt';

/** Quotes grouped by novel, in the order given. */
export function exportQuotes(list: QuoteView[], format: QuoteExportFormat, t: TFunction): string {
  const byNovel = new Map<number, QuoteView[]>();
  for (const quote of list) {
    const group = byNovel.get(quote.novelId) ?? [];
    group.push(quote);
    byNovel.set(quote.novelId, group);
  }
  const parts: string[] = [];
  for (const group of byNovel.values()) {
    parts.push(format === 'md' ? `# ${group[0].novelTitle}` : group[0].novelTitle.toUpperCase());
    for (const quote of group) {
      const lines =
        format === 'md'
          ? quote.text.split(/\n+/).map((line) => `> ${line}`)
          : [`« ${quote.text.replace(/\n+/g, '\n')} »`];
      const details = [quoteLocation(quote, t)];
      if (quote.folders.length > 0) {
        details.push(quote.folders.map((folder) => folder.name).join(', '));
      }
      lines.push('', format === 'md' ? `— *${details.join(' · ')}*` : `— ${details.join(' · ')}`);
      if (quote.note) {
        lines.push('', quote.note);
      }
      parts.push(lines.join('\n'));
    }
  }
  return `${parts.join('\n\n')}\n`;
}
