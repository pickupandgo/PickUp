import {
  isoWeekKey,
  latestScheduledRun,
  nextScheduledRun,
  zonedParts,
  zonedTimeToUtc,
} from './payout-schedule';

const IST = 'Asia/Kolkata';

describe('payout schedule', () => {
  it('reads wall-clock time in India (UTC+5:30, no DST)', () => {
    const parts = zonedParts(new Date('2026-10-05T04:30:00Z'), IST);
    expect(parts).toMatchObject({ year: 2026, month: 10, day: 5, hour: 10, minute: 0, weekday: 1 });
  });

  it('converts India wall-clock time to UTC', () => {
    expect(zonedTimeToUtc(2026, 10, 5, 10, 0, IST).toISOString()).toBe('2026-10-05T04:30:00.000Z');
    // Midnight IST is the previous day in UTC.
    expect(zonedTimeToUtc(2026, 10, 5, 0, 0, IST).toISOString()).toBe('2026-10-04T18:30:00.000Z');
  });

  it('handles time zones with daylight saving time', () => {
    // New York: EDT (UTC-4) on 2 Nov 2026 is over; EST (UTC-5) from 1 Nov 2026 02:00.
    expect(zonedTimeToUtc(2026, 10, 30, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-10-30T13:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 11, 2, 9, 0, 'America/New_York').toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  describe('latestScheduledRun (Monday 10:00 IST)', () => {
    const run = (now: string) => latestScheduledRun(new Date(now), 1, '10:00', IST).toISOString();

    it('is this Monday once 10:00 IST has passed', () => {
      expect(run('2026-10-05T05:00:00Z')).toBe('2026-10-05T04:30:00.000Z');
    });

    it('is exactly the run instant at 10:00 IST', () => {
      expect(run('2026-10-05T04:30:00Z')).toBe('2026-10-05T04:30:00.000Z');
    });

    it('is the previous Monday before 10:00 IST on a Monday', () => {
      expect(run('2026-10-05T04:29:59Z')).toBe('2026-09-28T04:30:00.000Z');
    });

    it('is the last Monday later in the week', () => {
      expect(run('2026-10-09T12:00:00Z')).toBe('2026-10-05T04:30:00.000Z');
    });

    it('uses the India date, not the UTC date, near midnight', () => {
      // Sunday 23:00 UTC is Monday 04:30 IST: before this Monday's 10:00 run.
      expect(run('2026-10-04T23:00:00Z')).toBe('2026-09-28T04:30:00.000Z');
    });
  });

  describe('approved schedule: every Monday 11:00 IST', () => {
    const latest = (now: string) =>
      latestScheduledRun(new Date(now), 1, '11:00', IST).toISOString();
    const next = (now: string) => nextScheduledRun(new Date(now), 1, '11:00', IST).toISOString();

    it('runs at 05:30 UTC on Mondays', () => {
      // Friday 2 Oct 2026 -> next run Monday 5 Oct 2026 11:00 IST.
      expect(next('2026-10-02T10:00:00Z')).toBe('2026-10-05T05:30:00.000Z');
      expect(latest('2026-10-02T10:00:00Z')).toBe('2026-09-28T05:30:00.000Z');
    });

    it('switches to the new cycle at 11:00:00 IST, not a second earlier', () => {
      expect(latest('2026-10-05T05:29:59Z')).toBe('2026-09-28T05:30:00.000Z');
      expect(latest('2026-10-05T05:30:00Z')).toBe('2026-10-05T05:30:00.000Z');
      expect(next('2026-10-05T05:30:00Z')).toBe('2026-10-12T05:30:00.000Z');
      expect(isoWeekKey(new Date('2026-10-05T05:30:00Z'), IST)).toBe('2026-W41');
    });
  });

  it('rejects an invalid schedule', () => {
    expect(() => latestScheduledRun(new Date(), 0, '10:00', IST)).toThrow(RangeError);
    expect(() => latestScheduledRun(new Date(), 1, '24:00', IST)).toThrow(RangeError);
  });

  it.each([
    ['2026-10-05T04:30:00Z', '2026-W41'],
    ['2026-01-01T06:00:00Z', '2026-W01'],
    ['2027-01-01T06:00:00Z', '2026-W53'],
    ['2024-12-30T06:00:00Z', '2025-W01'],
    // 31 Dec 2025 20:00 UTC is 1 Jan 2026 01:30 IST.
    ['2025-12-31T20:00:00Z', '2026-W01'],
  ])('ISO week of %s in India is %s', (instant, expected) => {
    expect(isoWeekKey(new Date(instant), IST)).toBe(expected);
  });
});
