import { describe, expect, it } from 'vitest';

import { resolveTime, type IcsTime } from '../src/connectors/ics/time.js';

const SOURCE_TZ = 'Europe/Madrid';

function icsTime(overrides: Partial<IcsTime> = {}): IcsTime {
  return {
    isDate: false,
    wall: { year: 2026, month: 9, day: 10, hour: 19, minute: 0, second: 0 },
    tzid: 'Europe/Madrid',
    ...overrides,
  };
}

describe('resolveTime', () => {
  it('keeps a TZID-tagged wall clock exactly as written', () => {
    const resolved = resolveTime(icsTime(), SOURCE_TZ);

    expect(resolved).toEqual({
      wallClock: '2026-09-10T19:00:00',
      timezone: 'Europe/Madrid',
      isDate: false,
    });
  });

  it('expresses a UTC instant in the source timezone, not as UTC', () => {
    // A .ics writing `…T170000Z` tells us WHEN, not WHERE. Emitting `timezone: UTC` would
    // be true and useless: a 19:00 Madrid meetup would read as 17:00 in every calendar.
    const resolved = resolveTime(
      icsTime({
        tzid: 'UTC',
        wall: { year: 2026, month: 9, day: 10, hour: 17, minute: 0, second: 0 },
        instant: new Date('2026-09-10T17:00:00Z'),
      }),
      SOURCE_TZ,
    );

    expect(resolved.wallClock).toBe('2026-09-10T19:00:00'); // CEST = UTC+2
    expect(resolved.timezone).toBe('Europe/Madrid');
    expect(resolved.warning).toBeUndefined();
  });

  it('crosses the DST boundary correctly', () => {
    // 2026-11-05 is CET (UTC+1); the September case above is CEST (UTC+2). A fixed offset
    // would get one of the two wrong.
    const resolved = resolveTime(
      icsTime({
        tzid: 'UTC',
        wall: { year: 2026, month: 11, day: 5, hour: 18, minute: 0, second: 0 },
        instant: new Date('2026-11-05T18:00:00Z'),
      }),
      SOURCE_TZ,
    );

    expect(resolved.wallClock).toBe('2026-11-05T19:00:00');
  });

  it('adopts the source timezone for a floating time, and says so', () => {
    const resolved = resolveTime(icsTime({ tzid: 'floating' }), SOURCE_TZ);

    expect(resolved.wallClock).toBe('2026-09-10T19:00:00');
    expect(resolved.timezone).toBe('Europe/Madrid');
    expect(resolved.warning).toBe('floating-time');
  });

  it('keeps the instant of a non-IANA TZID and re-expresses it in the source zone', () => {
    // Outlook emits things like "Romance Standard Time". The instant is still trustworthy —
    // it came from the file's own VTIMEZONE — but the label is not an IANA zone.
    const resolved = resolveTime(
      icsTime({
        tzid: 'Romance Standard Time',
        instant: new Date('2026-09-10T17:00:00Z'),
      }),
      SOURCE_TZ,
    );

    expect(resolved.wallClock).toBe('2026-09-10T19:00:00');
    expect(resolved.timezone).toBe('Europe/Madrid');
    expect(resolved.warning).toBe('non-iana-tzid');
  });

  it('never shifts an all-day date between zones', () => {
    // Timezone-converting a date is how "the 15th" silently becomes "the 14th".
    const resolved = resolveTime(
      icsTime({
        isDate: true,
        tzid: 'floating',
        wall: { year: 2026, month: 9, day: 18, hour: 0, minute: 0, second: 0 },
      }),
      'Pacific/Auckland',
    );

    expect(resolved.wallClock).toBe('2026-09-18');
    expect(resolved.timezone).toBe('Pacific/Auckland');
    expect(resolved.isDate).toBe(true);
  });
});
