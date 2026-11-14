/** Formatting of durations, dates and numbers shown in the interface. */
import type { DateFormatSetting } from '../features/settings/settings';

type Translate = (key: string) => string;

/**
 * "45 s", "12 min", "3 h 20 min", "4 j 6 h" (days beyond 24 hours).
 * Units come from the translations (units.second, units.minute, units.hour, units.day).
 */
export function formatDuration(ms: number, t: Translate): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const s = t('units.second');
  const min = t('units.minute');
  const h = t('units.hour');
  const d = t('units.day');
  if (totalSeconds < 60) {
    return `${totalSeconds} ${s}`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} ${min}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return minutes > 0 ? `${totalHours} ${h} ${minutes} ${min}` : `${totalHours} ${h}`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days} ${d} ${hours} ${h}` : `${days} ${d}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Numeric date following the "date format" setting. */
export function formatDate(timestamp: number, format: DateFormatSetting, language: string): string {
  const date = new Date(timestamp);
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const resolved = format === 'system' ? (language === 'en' ? 'mdy' : 'dmy') : format;
  if (resolved === 'ymd') {
    return `${year}-${month}-${day}`;
  }
  return resolved === 'mdy' ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Start of the local day containing the timestamp. */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "24 %" from a 0–1 ratio. */
export function formatPercent(ratio: number): string {
  return `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)} %`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** "Today", "Yesterday", or "Monday 9 November" for the day of a timestamp. */
export function formatDayLabel(
  timestamp: number,
  language: string,
  labels: { today: string; yesterday: string },
  now = Date.now(),
): string {
  const day = startOfDay(timestamp);
  const today = startOfDay(now);
  if (day === today) {
    return labels.today;
  }
  // Noon avoids daylight saving time surprises when stepping back one day.
  const yesterday = new Date(today);
  yesterday.setHours(12);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === startOfDay(yesterday.getTime())) {
    return labels.yesterday;
  }
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const text = date.toLocaleDateString(language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}
