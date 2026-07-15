/**
 * Turning iCalendar time into OTE time. This is the sharpest edge of the whole connector.
 *
 * OTE requires, on EVERY event:
 *   - `timezone`: an IANA zone, always present, even for all-day events.
 *   - `startDate`: a WALL-CLOCK value (`2026-10-15T19:00:00`), with no `Z` and no offset —
 *     the schema pattern forbids them.
 *
 * iCalendar gives us neither reliably. A `.ics` may carry a time as UTC (`…T170000Z`), as
 * a floating local time with no zone at all, as a date with no time, or tagged with a TZID
 * that is not an IANA zone (Outlook emits "Romance Standard Time"). So every path has to
 * end at the same place: a wall-clock string plus a real IANA zone.
 *
 * The rule, which follows from "a connector never invents data": the instant always comes
 * from the file, and the ZONE TO DISPLAY IT IN comes from the source's declared `timezone`
 * whenever the file does not state one. The organiser declares their zone in `sources/*.yml`;
 * the parser never guesses it.
 */
import { DateTime, IANAZone } from 'luxon';

/** A time as it literally appears in the `.ics`, decoupled from ical.js. */
export interface IcsTime {
  /** `DTSTART;VALUE=DATE` — an all-day event, no time of day. */
  isDate: boolean;
  /** The components as written in the file. */
  wall: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
  /** TZID as written, or `UTC`, or `floating` when the file states no zone. */
  tzid: string;
  /** The absolute instant, when the file determines one (i.e. not floating). */
  instant?: Date;
}

export type TimeWarning = 'floating-time' | 'non-iana-tzid';

export interface ResolvedTime {
  /** `2026-10-15` for all-day, `2026-10-15T19:00:00` otherwise. */
  wallClock: string;
  /** IANA zone. */
  timezone: string;
  isDate: boolean;
  warning?: TimeWarning;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

const formatDate = (w: IcsTime['wall']) => `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;

const formatDateTime = (w: IcsTime['wall']) =>
  `${formatDate(w)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;

/**
 * Which IANA zone this event's times should be expressed in.
 *
 * `UTC` counts as "no zone declared". A `.ics` writing `…T170000Z` is telling us *when*,
 * not *where*: UTC is a serialisation, not the zone the meetup happens in. Emitting
 * `timezone: UTC` would be technically true and practically useless — a 19:00 Madrid
 * meetup would read as 17:00. So the source's declared zone wins.
 */
function resolveZone(
  tzid: string,
  sourceTimezone: string,
): { timezone: string; warning?: TimeWarning } {
  if (tzid === 'floating') {
    // The file gave a wall-clock time and no zone at all. We adopt the source's zone,
    // which is an assumption — a defensible one, but the maintainer should know we made it.
    return { timezone: sourceTimezone, warning: 'floating-time' };
  }
  if (tzid === 'UTC' || tzid === 'Z') return { timezone: sourceTimezone };
  if (IANAZone.isValidZone(tzid)) return { timezone: tzid };

  // A TZID we cannot map (Outlook's "Romance Standard Time", a custom VTIMEZONE…).
  // The instant is still trustworthy — it came from the file's own VTIMEZONE offsets —
  // so we keep the instant and display it in the source's zone.
  return { timezone: sourceTimezone, warning: 'non-iana-tzid' };
}

/**
 * Resolve one iCalendar time into the wall-clock + IANA zone pair that OTE demands.
 *
 * All-day dates are never shifted: a date has no instant to convert, and moving it between
 * zones is exactly the class of bug that turns "the 15th" into "the 14th".
 */
export function resolveTime(time: IcsTime, sourceTimezone: string): ResolvedTime {
  const { timezone, warning } = resolveZone(time.tzid, sourceTimezone);

  if (time.isDate) {
    return {
      wallClock: formatDate(time.wall),
      timezone,
      isDate: true,
      // An all-day event carries no instant, so nothing was assumed about its time.
      // The zone only contextualises the date; it does not shift it.
      ...(warning === 'non-iana-tzid' ? { warning } : {}),
    };
  }

  // Floating: the wall clock IS the datum. Converting it would invent an instant the file
  // never stated.
  if (time.tzid === 'floating' || !time.instant) {
    return {
      wallClock: formatDateTime(time.wall),
      timezone,
      isDate: false,
      ...(warning ? { warning } : {}),
    };
  }

  // Zoned or UTC: the instant is the datum. Render it in the target zone.
  const wallClock = DateTime.fromJSDate(time.instant, { zone: timezone }).toFormat(
    "yyyy-MM-dd'T'HH:mm:ss",
  );

  return { wallClock, timezone, isDate: false, ...(warning ? { warning } : {}) };
}

/** The absolute instant an event starts, for windowing and for partitioning past vs. future. */
export function toInstant(wallClock: string, timezone: string): Date {
  const dt = wallClock.includes('T')
    ? DateTime.fromISO(wallClock, { zone: timezone })
    : DateTime.fromISO(wallClock, { zone: timezone }).startOf('day');
  return dt.toJSDate();
}
