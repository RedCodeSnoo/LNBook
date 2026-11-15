/** Text of the bottom progress bar of the reader (pure, for the tests). */
import { formatPercent } from '../../services/format';

/** Height of the band under the text, without the system navigation inset. */
export const READER_FOOTER_HEIGHT = 30;

export interface FooterProgress {
  /** 0 to 1. */
  progress: number;
  /** Page shown, from 0 (page by page mode). */
  page: number;
  /** Number of pages; 0 in scroll mode. */
  pages: number;
}

/** "34 %", or "5 / 12 · 34 %" in page by page mode. */
export function footerProgressText({ progress, page, pages }: FooterProgress): string {
  const percent = formatPercent(Math.min(1, Math.max(0, progress)));
  return pages > 0 ? `${Math.min(page + 1, pages)} / ${pages} · ${percent}` : percent;
}

/** Width of the thin progress line, from 0 to 100. */
export function footerFillPercent(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, progress)) * 1000) / 10;
}
