/**
 * Detects volumes from chapter titles ("Volume 2 Chapter 5", "Tome 3 – …", "第二卷 …").
 * Used when a book has no hierarchical table of contents.
 */

const WORD_PATTERN =
  /(?:^|[^\p{L}])(volume|vol\.?|tome|livre|book|arc)\s*[.:#-]?\s*(\d{1,4}|[IVXLCDM]{1,7})(?![\p{L}\d])/iu;
const CJK_PATTERNS = [
  /第\s*([0-9０-９一二三四五六七八九十百零〇两]+)\s*[卷部]/u,
  /卷\s*([0-9０-９一二三四五六七八九十百零〇两]+)/u,
];

const WORD_LABELS: Record<string, string> = {
  volume: 'Volume',
  vol: 'Volume',
  'vol.': 'Volume',
  tome: 'Tome',
  livre: 'Livre',
  book: 'Book',
  arc: 'Arc',
};

export interface VolumeMarker {
  /** Identity of the volume, used to know when the volume changes. */
  key: string;
  /** Display title, e.g. "Volume 2". */
  label: string;
}

export function detectVolumeMarker(title: string): VolumeMarker | null {
  const word = WORD_PATTERN.exec(title);
  if (word) {
    const kind = word[1].toLowerCase();
    const number = word[2];
    // Roman numerals must be upper case ("Arc IV"), to avoid matching ordinary words.
    if (/^[ivxlcdm]+$/i.test(number) && number !== number.toUpperCase()) {
      return null;
    }
    const label = WORD_LABELS[kind] ?? 'Volume';
    return { key: `${label.toLowerCase()}:${number.toUpperCase()}`, label: `${label} ${number}` };
  }
  for (const pattern of CJK_PATTERNS) {
    const match = pattern.exec(title);
    if (match) {
      return { key: `卷:${match[1]}`, label: `第${match[1]}卷` };
    }
  }
  return null;
}

export interface DetectedVolumes {
  volumes: { title: string }[];
  /** For each chapter, the index of its volume or null. */
  assignment: (number | null)[];
}

/**
 * Groups consecutive chapters by the volume named in their title. A chapter without
 * marker stays in the current volume. Nothing is detected with fewer than two volumes.
 */
export function detectVolumes(titles: string[]): DetectedVolumes {
  const volumes: { title: string }[] = [];
  const assignment: (number | null)[] = [];
  const indexByKey = new Map<string, number>();
  let current: number | null = null;

  for (const title of titles) {
    const marker = detectVolumeMarker(title);
    if (marker) {
      let index = indexByKey.get(marker.key);
      if (index === undefined) {
        index = volumes.push({ title: marker.label }) - 1;
        indexByKey.set(marker.key, index);
      }
      current = index;
    }
    assignment.push(current);
  }

  if (volumes.length < 2) {
    return { volumes: [], assignment: titles.map(() => null) };
  }
  return { volumes, assignment };
}
