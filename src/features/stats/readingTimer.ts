/**
 * Counts the time really spent reading or listening. Time only counts while the reader
 * is active: after 3 minutes without any interaction the timer pauses by itself, and the
 * silent time after those 3 minutes is never counted.
 */
export const IDLE_LIMIT_MS = 3 * 60 * 1000;

export class ReadingTimer {
  private activeMs = 0;
  /** Time of the last sign of activity, or null while paused (app in the background). */
  private lastActivity: number | null;
  readonly startedAt: number;
  private lastCountedAt: number;

  constructor(now: number) {
    this.startedAt = now;
    this.lastActivity = now;
    this.lastCountedAt = now;
  }

  /** Time elapsed since the last activity, limited to the idle allowance. */
  private pending(now: number): number {
    if (this.lastActivity === null) {
      return 0;
    }
    return Math.max(0, Math.min(now - this.lastActivity, IDLE_LIMIT_MS));
  }

  /** The reader touched the screen, scrolled, or the voice is speaking. */
  activity(now: number): void {
    const counted = this.pending(now);
    this.activeMs += counted;
    if (this.lastActivity !== null && counted > 0) {
      this.lastCountedAt = this.lastActivity + counted;
    }
    this.lastActivity = now;
  }

  /** The app left the foreground: nothing counts until the next activity. */
  pause(now: number): void {
    const counted = this.pending(now);
    this.activeMs += counted;
    if (this.lastActivity !== null && counted > 0) {
      this.lastCountedAt = this.lastActivity + counted;
    }
    this.lastActivity = null;
  }

  /** Active time so far. */
  elapsed(now: number): number {
    return this.activeMs + this.pending(now);
  }

  /** Moment of the last counted millisecond (end of the session). */
  endedAt(now: number): number {
    return this.lastActivity === null ? this.lastCountedAt : this.lastActivity + this.pending(now);
  }
}
