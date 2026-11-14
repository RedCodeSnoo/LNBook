import { contrastRatio } from '../contrast';
import { ACCENT_NAMES, ACCENTS, BASE_COLORS, type AppThemeName } from '../palette';

const AA_TEXT = 4.5;
const AA_UI = 3;

describe('app themes contrast (WCAG AA)', () => {
  const themes: AppThemeName[] = ['light', 'dark', 'amoled'];

  it.each(themes)('%s: text colours are readable', (name) => {
    const colors = BASE_COLORS[name];
    for (const background of [colors.background, colors.surface, colors.surfaceVariant]) {
      expect(contrastRatio(colors.text, background)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(colors.textSecondary, background)).toBeGreaterThanOrEqual(AA_TEXT);
    }
    expect(contrastRatio(colors.error, colors.background)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(colors.onError, colors.error)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(colors.success, colors.background)).toBeGreaterThanOrEqual(AA_UI);
  });

  it.each(ACCENT_NAMES)('accent %s is readable on every theme', (accent) => {
    const shades = ACCENTS[accent];
    expect(contrastRatio(shades.light, BASE_COLORS.light.background)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    expect(contrastRatio('#FFFFFF', shades.light)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(shades.onLightContainer, shades.lightContainer)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
    for (const name of ['dark', 'amoled'] as const) {
      expect(contrastRatio(shades.dark, BASE_COLORS[name].background)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      expect(contrastRatio(shades.dark, BASE_COLORS[name].surfaceVariant)).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
    expect(contrastRatio('#14151A', shades.dark)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(shades.onDarkContainer, shades.darkContainer)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });
});
