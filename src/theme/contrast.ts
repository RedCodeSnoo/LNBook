/** WCAG 2.1 contrast helpers, used to check every theme (app and reader). */

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Invalid colour: ${hex}`);
  }
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Black or white, whichever is more readable on the given background. */
export function readableTextOn(background: string): '#000000' | '#FFFFFF' {
  return relativeLuminance(background) > 0.179 ? '#000000' : '#FFFFFF';
}
