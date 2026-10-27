import { Temporal } from '@phoenix/shared-kernel';
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  isSyncDue,
  parseSyncInterval,
  shouldHalt,
  syncChangeOf,
} from './directory-sync';

const NOW = Temporal.Instant.from('2026-10-27T12:00:00Z');

describe('the staff directory sync rules', () => {
  it('defaults to five minutes (owner decision P6) and accepts 1 to 60 whole minutes', () => {
    expect(DEFAULT_SYNC_INTERVAL_MINUTES).toBe(5);
    for (const minutes of [1, 5, 60])
      expect(parseSyncInterval(minutes)).toEqual({ ok: true, value: minutes });
    for (const minutes of [0, -5, 61, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(parseSyncInterval(minutes)).toEqual({
        ok: false,
        error: { code: 'identity.value.invalid', field: 'intervalMinutes' },
      });
    }
  });

  it('is due when it never ran, or once the interval has passed since the last start', () => {
    expect(isSyncDue(null, 5, NOW)).toBe(true);
    expect(isSyncDue(NOW.subtract({ minutes: 4, seconds: 59 }), 5, NOW)).toBe(false);
    expect(isSyncDue(NOW.subtract({ minutes: 5 }), 5, NOW)).toBe(true);
    expect(isSyncDue(NOW.subtract({ minutes: 30 }), 60, NOW)).toBe(false);
  });

  it('makes a directory account follow its directory user', () => {
    expect(syncChangeOf('active', 'enabled')).toBe('none');
    expect(syncChangeOf('active', 'disabled')).toBe('disable');
    expect(syncChangeOf('active', 'missing')).toBe('disable');
    expect(syncChangeOf('disabled', 'enabled')).toBe('enable');
    expect(syncChangeOf('disabled', 'disabled')).toBe('none');
    expect(syncChangeOf('disabled', 'missing')).toBe('none');
  });

  it('halts when more than half of ten or more accounts would be disabled at once', () => {
    expect(shouldHalt(9, 9)).toBe(false);
    expect(shouldHalt(10, 5)).toBe(false);
    expect(shouldHalt(10, 6)).toBe(true);
    expect(shouldHalt(1000, 500)).toBe(false);
    expect(shouldHalt(1000, 501)).toBe(true);
  });
});
