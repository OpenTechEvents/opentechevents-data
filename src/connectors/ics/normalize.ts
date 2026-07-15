/**
 * Step [4] normalize — iCalendar occurrences into OTE events. The mapping lives here.
 *
 * A connector never invents data. Every rule below either carries a fact the `.ics` stated,
 * or a value the organiser declared in `sources/*.yml`. Where neither exists, the field is
 * omitted and a warning is raised — the feed says "unknown" out loud instead of guessing.
 */
import { DateTime } from 'luxon';

import type { AttendanceMode, EventStatus, OteEvent, OteLocation } from '../../ote/types.js';
import type { Source } from '../../sources/types.js';
import type { Issue } from '../types.js';
import { mintId } from './identity.js';
import type { IcsOccurrence } from './parse.js';
import { resolveTime } from './time.js';

export interface NormalizeResult {
  event?: OteEvent;
  warnings: Issue[];
  errors: Issue[];
}

/** `DESCRIPTION` routinely carries HTML. Reduce it to text rather than leak markup into the feed. */
function toPlainText(raw: string): string {
  const withoutTags = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  return withoutTags
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => entities[m] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

/**
 * `STATUS` mapping.
 *
 * `TENTATIVE` is the awkward one: OTE v0.2 has no equivalent, and the aggregator design
 * maps it to `postponed`. Neither is right — tentative means "not confirmed yet", not
 * "was scheduled and moved" — so this is reported as a spec gap rather than settled here.
 */
function mapStatus(status: string | undefined): EventStatus | undefined {
  switch (status?.toUpperCase()) {
    case 'CONFIRMED':
      return 'scheduled';
    case 'CANCELLED':
      return 'cancelled';
    case 'TENTATIVE':
      return 'postponed';
    default:
      return undefined;
  }
}

/**
 * What is KNOWN about where the event happens.
 *
 * A physical venue is `LOCATION` as free text. Online access is a room link in a dedicated
 * property — or a `LOCATION` that parses as a URL, which is where some publishers put it.
 */
function mapLocation(occurrence: IcsOccurrence): OteLocation | undefined {
  const location = occurrence.location?.trim();
  const locationIsUrl = location !== undefined && isUrl(location);

  const venue = location && !locationIsUrl ? location : undefined;
  const onlineUrl =
    occurrence.conferenceUrls[0] ?? (locationIsUrl ? location : undefined);

  // GEO carries no venue name of its own — the spec's `venue` is free text, `geo` is a point.
  // Only attach coordinates when there is a location to attach them to (the schema requires a
  // venue or an onlineUrl for `location` to exist at all).
  const geo = occurrence.geo;

  if (!venue && !onlineUrl) return undefined;

  return {
    ...(venue ? { venue } : {}),
    ...(onlineUrl ? { onlineUrl } : {}),
    ...(geo ? { geo } : {}),
  };
}

/** Extract `#hashtags` from free text. Requires whitespace/start before `#`, so Markdown
 * headings and `#fragment` inside URLs are left alone. */
const HASHTAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

/**
 * OTE `tags` from the iCalendar occurrence.
 *
 * `CATEGORIES` is the primary source (case preserved). Google Calendar emits no `CATEGORIES`,
 * so when it is absent we fall back to `#hashtags` in the description (lowercased — a hashtag
 * is not case-sensitive). Either way `defaults.tags` are merged in. Deduped; empty → omitted.
 */
function mapTags(occurrence: IcsOccurrence, source: Source, description: string | undefined): string[] | undefined {
  let base: string[];
  if (occurrence.categories.length > 0) {
    base = occurrence.categories;
  } else if (description) {
    base = [...description.matchAll(HASHTAG_RE)].map((m) => m[1]!.toLowerCase());
  } else {
    base = [];
  }

  const merged = [...new Set([...base, ...(source.defaults?.tags ?? [])])];
  return merged.length > 0 ? merged : undefined;
}

/**
 * Attendance mode — asserted only when the signal is unambiguous.
 *
 * iCalendar does not model attendance mode at all, so this is inference, and inference is
 * only allowed where it cannot be wrong:
 *
 *   venue, no link  → in-person
 *   link, no venue  → online
 *   both            → OMITTED, not `hybrid`
 *   neither         → OMITTED
 *
 * "Both" looks hybrid and usually isn't: Google Calendar attaches a Meet link automatically
 * to events you create. The organiser sets up their in-person meetup, touches nothing, and
 * the public `.ics` comes out with `X-GOOGLE-CONFERENCE`. Nobody decided that event was
 * hybrid — a default checkbox did. The `.ics` does not contain the information that
 * separates that from a real hybrid, and no parser can fix that.
 *
 * Symmetrically, no link does not mean in-person: plenty of communities email the link on
 * registration.
 *
 * `defaults.attendanceMode` in `sources/*.yml` always wins. The organiser registering their
 * source knows whether their meetup is hybrid; the parser does not. That is the good way to
 * get this datum — declared at the origin, not deduced.
 */
function inferAttendanceMode(location: OteLocation | undefined): AttendanceMode | undefined {
  const hasVenue = Boolean(location?.venue);
  const hasOnline = Boolean(location?.onlineUrl);

  if (hasVenue && !hasOnline) return 'in-person';
  if (hasOnline && !hasVenue) return 'online';
  return undefined;
}

export function normalizeOccurrence(
  occurrence: IcsOccurrence,
  source: Source,
  retrievedAt: Date,
): NormalizeResult {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  const icsUrl = String(source.config['url'] ?? '');

  const name = occurrence.summary?.trim();
  if (!name) {
    errors.push({
      sourceId: source.id,
      code: 'missing-name',
      message: 'VEVENT has no SUMMARY; an event with no name cannot be published.',
      ...(occurrence.uid ? { eventId: occurrence.uid } : {}),
    });
    return { warnings, errors };
  }

  const start = resolveTime(occurrence.start, source.timezone);
  if (start.warning) {
    warnings.push({
      sourceId: source.id,
      code: start.warning,
      message:
        start.warning === 'floating-time'
          ? `DTSTART has no timezone; assumed the source's declared zone (${source.timezone}).`
          : `DTSTART has a non-IANA TZID ("${occurrence.start.tzid}"); the instant was kept and expressed in ${source.timezone}.`,
      eventName: name,
    });
  }

  const id = mintId({
    sourceUrl: icsUrl,
    ...(occurrence.uid ? { uid: occurrence.uid } : {}),
    ...(occurrence.recurrenceId ? { recurrenceId: occurrence.recurrenceId } : {}),
    name,
    startDate: start.wallClock,
  });

  if (!occurrence.uid) {
    warnings.push({
      sourceId: source.id,
      code: 'missing-uid',
      message:
        'VEVENT has no UID; the id was derived from name + startDate. Renaming the event ' +
        'upstream will mint a new id and drop the old one from the feed.',
      eventId: id,
      eventName: name,
    });
  }

  const endDate = resolveEndDate(occurrence, start, source, id, name, warnings);
  const location = mapLocation(occurrence);
  const attendanceMode = source.defaults?.attendanceMode ?? inferAttendanceMode(location);

  if (!attendanceMode) {
    warnings.push({
      sourceId: source.id,
      code: 'unknown-attendance-mode',
      message:
        'attendanceMode could not be determined from the .ics without guessing. Declare it ' +
        'in this source\'s `defaults.attendanceMode` if you know it.',
      eventId: id,
      eventName: name,
    });
  }

  const status = mapStatus(occurrence.status);
  const description = occurrence.description ? toPlainText(occurrence.description) : undefined;
  const tags = mapTags(occurrence, source, description);

  // LAST-MODIFIED is the edit instant. DTSTAMP is generation — it changes on every export, so
  // leaning on it makes incremental sync noisy. Use it only as a fallback, and say so.
  const updatedAt = occurrence.lastModified ?? occurrence.dtstamp;
  if (!occurrence.lastModified && occurrence.dtstamp) {
    warnings.push({
      sourceId: source.id,
      code: 'updatedAt-from-dtstamp',
      message:
        'VEVENT has no LAST-MODIFIED; updatedAt was taken from DTSTAMP. DTSTAMP marks ' +
        'generation, not edit, so it may report changes that did not happen.',
      eventId: id,
      eventName: name,
    });
  }

  const event: OteEvent = {
    id,
    name,
    timezone: start.timezone,
    startDate: start.wallClock,
    ...(endDate ? { endDate } : {}),
    ...(occurrence.url && isUrl(occurrence.url) ? { url: occurrence.url } : {}),
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
    ...(attendanceMode ? { attendanceMode } : {}),
    ...(source.defaults?.languages ? { languages: source.defaults.languages } : {}),
    ...(tags ? { tags } : {}),
    ...(status ? { status } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    // Always set for an enabled source (the gate guarantees it); a disabled source never
    // reaches normalisation, so the guard is only here to satisfy the optional type.
    ...(source.dataLicense ? { license: source.dataLicense } : {}),
    source: {
      name: source.attribution?.name ?? source.id,
      url: source.attribution?.url ?? icsUrl,
      ...(source.originLicense ? { license: source.originLicense } : {}),
      retrievedAt: retrievedAt.toISOString(),
    },
  };

  return { event, warnings, errors };
}

/**
 * `endDate` must be the same form as `startDate` — the schema's `oneOf` rejects a date
 * paired with a date-time — and it must be expressed in the same zone, since an event
 * carries exactly one `timezone`.
 */
function resolveEndDate(
  occurrence: IcsOccurrence,
  start: ReturnType<typeof resolveTime>,
  source: Source,
  id: string,
  name: string,
  warnings: Issue[],
): string | undefined {
  if (!occurrence.end) return undefined;

  const end = resolveTime(occurrence.end, start.timezone);

  if (end.isDate !== start.isDate) {
    warnings.push({
      sourceId: source.id,
      code: 'mismatched-end-form',
      message:
        'DTEND is not the same form as DTSTART (one is a date, the other a date-time); ' +
        'endDate was dropped rather than fabricated.',
      eventId: id,
      eventName: name,
    });
    return undefined;
  }

  // iCalendar's all-day DTEND is EXCLUSIVE: a one-day event on the 15th is written as
  // DTSTART=2026-10-15, DTEND=2026-10-16. OTE's endDate is the last day, inclusive.
  // Copying DTEND straight across would add a phantom day to every all-day event.
  const value = end.isDate
    ? DateTime.fromISO(end.wallClock).minus({ days: 1 }).toFormat('yyyy-MM-dd')
    : end.wallClock;

  // "If absent, the event is assumed to end on the day it starts" — so an end that adds
  // nothing is noise, not information.
  if (value <= start.wallClock) return undefined;

  return value;
}
