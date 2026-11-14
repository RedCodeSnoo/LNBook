import { formatBytes, formatDate, formatDuration, formatPercent } from '../format';

const UNITS: Record<string, string> = {
  'units.second': 's',
  'units.minute': 'min',
  'units.hour': 'h',
  'units.day': 'j',
};
const t = (key: string) => UNITS[key];

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [45_000, '45 s'],
    [59_999, '59 s'],
    [60_000, '1 min'],
    [12 * 60_000, '12 min'],
    [3 * 3_600_000 + 20 * 60_000, '3 h 20 min'],
    [3 * 3_600_000, '3 h'],
    [24 * 3_600_000, '1 j'],
    [(4 * 24 + 6) * 3_600_000 + 59 * 60_000, '4 j 6 h'],
    [-5, '0 s'],
  ])('%d ms → %s', (ms, expected) => {
    expect(formatDuration(ms, t)).toBe(expected);
  });
});

describe('other formats', () => {
  const date = new Date(2026, 10, 9, 14, 5).getTime();

  it('formats dates following the setting', () => {
    expect(formatDate(date, 'dmy', 'en')).toBe('09/11/2026');
    expect(formatDate(date, 'mdy', 'fr')).toBe('11/09/2026');
    expect(formatDate(date, 'ymd', 'fr')).toBe('2026-11-09');
    expect(formatDate(date, 'system', 'fr')).toBe('09/11/2026');
    expect(formatDate(date, 'system', 'en')).toBe('11/09/2026');
  });

  it('formats percentages and sizes', () => {
    expect(formatPercent(0.2421)).toBe('24 %');
    expect(formatPercent(3)).toBe('100 %');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(30 * 1024 * 1024)).toBe('30 MB');
  });
});
