/** Labels of the statistics charts. */
import type { TFunction } from 'i18next';

import { formatDuration } from '../../services/format';
import type { Bar } from './charts';
import type { ChartBar } from './statistics';

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Bars of the "time per day" chart with their labels for a language. */
export function timeBars(bars: ChartBar[], language: string, t: TFunction): Bar[] {
  // With many bars only some of them get a label, so that labels never overlap.
  const every = bars.length <= 12 ? 1 : Math.ceil(bars.length / 6);
  return bars.map((bar, index) => {
    const date = new Date(bar.start);
    let label: string;
    let name: string;
    if (bar.unit === 'year') {
      label = String(date.getFullYear());
      name = label;
    } else if (bar.unit === 'month') {
      label = capital(date.toLocaleDateString(language, { month: 'short' })).replace('.', '');
      name = capital(date.toLocaleDateString(language, { month: 'long', year: 'numeric' }));
    } else {
      label =
        bars.length <= 7
          ? capital(date.toLocaleDateString(language, { weekday: 'short' })).replace('.', '')
          : String(date.getDate());
      name = capital(
        date.toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' }),
      );
    }
    // The last bar (today) always keeps its label.
    const visible = (bars.length - 1 - index) % every === 0;
    return {
      key: String(bar.start),
      label: visible ? label : '',
      description: `${name} · ${formatDuration(bar.ms, t)}`,
      value: bar.ms,
    };
  });
}

/** Bars of the "favourite hours" chart: one per hour, labelled every six hours. */
export function hourBars(hours: number[], t: TFunction): Bar[] {
  return hours.map((ms, hour) => ({
    key: String(hour),
    label: hour % 6 === 0 ? `${hour} h` : '',
    description: `${hour} h – ${(hour + 1) % 24} h · ${formatDuration(ms, t)}`,
    value: ms,
  }));
}
