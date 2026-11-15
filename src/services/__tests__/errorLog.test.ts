import { ErrorLog, ERROR_LOG_FILE, formatLogEntry } from '../errorLog';
import { MemoryFileStore } from '../fileStore';

describe('error journal', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('formats errors, texts and objects', () => {
    const line = formatLogEntry('error', ['Import failed', { id: 3 }, new Error('bad zip')], 0);
    expect(line).toContain('1970-01-01T00:00:00.000Z [error] Import failed {"id":3} bad zip');
    expect(formatLogEntry('warn', ['x'.repeat(5000)], 0).length).toBeLessThan(2100);
  });

  it('keeps the journal from one launch to the next', () => {
    const files = new MemoryFileStore();
    const first = new ErrorLog(files, () => 1000);
    first.add('warn', ['one']);
    first.add('error', ['two\nwith a second line']);
    expect(files.exists(ERROR_LOG_FILE)).toBe(false);
    jest.advanceTimersByTime(2000);
    expect(files.exists(ERROR_LOG_FILE)).toBe(true);

    const second = new ErrorLog(files, () => 2000);
    second.add('warn', ['three']);
    expect(second.size).toBe(3);
    expect(second.text().split('[warn]')).toHaveLength(3);
    expect(second.text()).toContain('with a second line');
    second.clear();
    expect(second.size).toBe(0);
    expect(new ErrorLog(files).text()).toBe('');
  });

  it('keeps only the most recent entries', () => {
    const log = new ErrorLog(new MemoryFileStore(), () => 0);
    for (let i = 0; i < 350; i += 1) {
      log.add('warn', [`entry ${i}`]);
    }
    expect(log.size).toBe(300);
    expect(log.text()).not.toContain('entry 49\n');
    expect(log.text()).toContain('entry 349');
  });
});
