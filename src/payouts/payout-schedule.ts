/**
 * Weekly payout schedule arithmetic in an IANA time zone, using only the built-in Intl API.
 * The weekday and time are business configuration (PAYOUT_SCHEDULE_WEEKDAY / _TIME / _TIMEZONE).
 */

export interface ZonedParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** ISO weekday: 1 = Monday ... 7 = Sunday. */
  readonly weekday: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock date and time of `instant` in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  const weekday = WEEKDAYS[parts['weekday'] ?? ''];
  if (!weekday) {
    throw new Error(`Could not read the weekday in ${timeZone}`);
  }
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour']),
    minute: Number(parts['minute']),
    second: Number(parts['second']),
    weekday,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (IST = +5:30). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the wall clock in `timeZone` shows the given local date and time. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = wallClock - offsetMs(new Date(wallClock), timeZone);
  // Second pass corrects for an offset change (DST) between the guess and the answer.
  instant = wallClock - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * The most recent scheduled run at or before `now`: the last `weekday` at `time` (HH:MM) in
 * `timeZone`. Earnings that became payable up to this instant belong to that week's batch.
 */
export function latestScheduledRun(
  now: Date,
  weekday: number,
  time: string,
  timeZone: string,
): Date {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(time);
  if (!match || weekday < 1 || weekday > 7) {
    throw new RangeError('Invalid payout schedule');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const local = zonedParts(now, timeZone);
  const daysBack = (local.weekday - weekday + 7) % 7;

  for (const extra of [0, 7]) {
    // Calendar arithmetic on the local date (UTC is used only as a neutral calendar).
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day - daysBack - extra));
    const run = zonedTimeToUtc(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      date.getUTCDate(),
      hour,
      minute,
      timeZone,
    );
    if (run.getTime() <= now.getTime()) {
      return run;
    }
  }
  throw new Error('Could not compute the latest payout run');
}

/** The first scheduled run strictly after `now`. */
export function nextScheduledRun(now: Date, weekday: number, time: string, timeZone: string): Date {
  // The latest run at or before a week from now is the first one after now.
  return latestScheduledRun(new Date(now.getTime() + 7 * 86_400_000), weekday, time, timeZone);
}

export const WEEKDAY_NAMES: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** ISO 8601 week of `instant` in `timeZone`, e.g. "2026-W41". */
export function isoWeekKey(instant: Date, timeZone: string): string {
  const local = zonedParts(instant, timeZone);
  // Thursday of this week decides the ISO year.
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + 4 - local.weekday));
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
