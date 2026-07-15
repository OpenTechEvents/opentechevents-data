/**
 * Step [8] render — `feed.ics`. The killer feature: a URL people subscribe to once in their
 * calendar app and never touch again.
 *
 * Times go out as UTC instants (`20261015T170000Z`) rather than `TZID=` + a `VTIMEZONE`.
 * Both are legal iCalendar; only one of them is unambiguous in every client that will ever
 * read this, including the ones that mishandle VTIMEZONE. The wall-clock + IANA zone pair
 * OTE stores is exactly what we need to compute that instant correctly.
 */
import { DateTime } from 'luxon';

import type { OteEvent, OteFeed } from '../../ote/types.js';

const PRODID = '-//OpenTechEvents//OTE Aggregator//EN';

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are special in TEXT values. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1: lines are folded at 75 OCTETS, not characters. Folding by character would
 * split a multi-byte codepoint in half — and event titles are full of accents and emoji.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Back off until we are on a codepoint boundary (continuation bytes are 10xxxxxx).
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end -= 1;

    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // Continuation lines start with a space, which counts towards the 75.
  }

  return chunks.join('\r\n ');
}

const utcStamp = (date: Date): string =>
  DateTime.fromJSDate(date, { zone: 'UTC' }).toFormat("yyyyMMdd'T'HHmmss'Z'");

/** All-day → `VALUE=DATE`. Timed → the UTC instant the wall clock + zone resolve to. */
function dtProperty(name: string, wallClock: string, timezone: string): string {
  if (!wallClock.includes('T')) {
    return `${name};VALUE=DATE:${wallClock.replace(/-/g, '')}`;
  }
  const instant = DateTime.fromISO(wallClock, { zone: timezone });
  return `${name}:${instant.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
}

/**
 * iCalendar's all-day DTEND is exclusive, OTE's `endDate` is inclusive. Converting back out
 * means adding the day we subtracted on the way in.
 */
function endProperty(event: OteEvent): string | undefined {
  if (!event.endDate) return undefined;

  if (!event.endDate.includes('T')) {
    const exclusive = DateTime.fromISO(event.endDate).plus({ days: 1 }).toFormat('yyyyMMdd');
    return `DTEND;VALUE=DATE:${exclusive}`;
  }
  return dtProperty('DTEND', event.endDate, event.timezone);
}

const STATUS_TO_ICAL: Record<string, string> = {
  scheduled: 'CONFIRMED',
  cancelled: 'CANCELLED',
  postponed: 'TENTATIVE',
  rescheduled: 'CONFIRMED',
};

/**
 * CC-BY requires attribution, and an `.ics` that travels into someone's calendar has to
 * carry it: the description is the only field every calendar client actually shows.
 */
function describe(event: OteEvent): string | undefined {
  const parts: string[] = [];
  if (event.description) parts.push(event.description);
  if (event.url) parts.push(event.url);

  const source = event.source;
  if (source?.name) {
    parts.push(source.url ? `Source: ${source.name} — ${source.url}` : `Source: ${source.name}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function renderEvent(event: OteEvent, now: Date): string[] {
  const lines: string[] = ['BEGIN:VEVENT'];

  lines.push(`UID:${event.id}`);
  lines.push(`DTSTAMP:${utcStamp(now)}`);
  lines.push(dtProperty('DTSTART', event.startDate, event.timezone));

  const dtend = endProperty(event);
  if (dtend) lines.push(dtend);

  lines.push(`SUMMARY:${escapeText(event.name)}`);

  const description = describe(event);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  const location = event.location?.venue ?? event.location?.onlineUrl;
  if (location) lines.push(`LOCATION:${escapeText(location)}`);

  if (event.location?.onlineUrl) lines.push(`CONFERENCE;VALUE=URI:${event.location.onlineUrl}`);
  if (event.url) lines.push(`URL:${event.url}`);

  const status = event.status ? STATUS_TO_ICAL[event.status] : undefined;
  if (status) lines.push(`STATUS:${status}`);

  lines.push('END:VEVENT');
  return lines;
}

export interface IcsRenderOptions {
  /** Stable URL this calendar is served from — RFC 7986 `SOURCE`, so clients can refresh it. */
  feedUrl?: string;
}

export function renderIcs(feed: OteFeed, now: Date, options: IcsRenderOptions = {}): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `NAME:${escapeText(feed.title)}`,
    `X-WR-CALNAME:${escapeText(feed.title)}`,
  ];

  if (feed.description) {
    lines.push(`DESCRIPTION:${escapeText(feed.description)}`);
    lines.push(`X-WR-CALDESC:${escapeText(feed.description)}`);
  }
  if (options.feedUrl) lines.push(`SOURCE;VALUE=URI:${options.feedUrl}`);
  if (feed.licenseUrl) lines.push(`X-OTE-LICENSE:${escapeText(feed.license)}`);

  for (const event of feed.events) lines.push(...renderEvent(event, now));

  lines.push('END:VCALENDAR');

  // CRLF is not optional in RFC 5545, and the file must end with one.
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
