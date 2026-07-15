/**
 * Step [3] parse — raw `.ics` text into flat occurrences.
 *
 * Nothing here knows about OTE. It produces the facts the file states, and only those.
 * The mapping to OTE lives in `normalize.ts`.
 */
import ICAL from 'ical.js';

import type { IcsTime } from './time.js';

/** A single `VEVENT` occurrence: either a plain event, or one expansion of an `RRULE`. */
export interface IcsOccurrence {
  uid?: string;
  /** Set only on occurrences expanded from an `RRULE`, in iCal basic format. */
  recurrenceId?: string;
  summary?: string;
  description?: string;
  url?: string;
  /** `LOCATION`, verbatim. May be free text OR a URL — the caller decides which. */
  location?: string;
  status?: string;
  /** Room links from `CONFERENCE` (RFC 7986) and the proprietary X- properties. */
  conferenceUrls: string[];
  start: IcsTime;
  end?: IcsTime;

  /**
   * Facts the `.ics` states that OTE v0.1 has nowhere to put. Parsed anyway, so the
   * pipeline can report the gap with real numbers instead of an opinion — that evidence
   * is what a spec change should be argued from.
   */
  unmappable: {
    /** `CATEGORIES`. OTE v0.1 has no `tags`. */
    categories: string[];
    /** `LAST-MODIFIED`/`DTSTAMP`. OTE v0.1 has `updatedAt` on the Feed, not on the Event. */
    lastModified?: string;
    /** `GEO`. OTE v0.1's `location.venue` is a plain string, with no coordinates. */
    geo?: { lat: number; lon: number };
  };
}

export interface ParseOptions {
  /** Occurrences of a recurring event are expanded within [windowStart, windowEnd]. */
  windowStart: Date;
  windowEnd: Date;
  /** Hard stop, so a malformed `RRULE` cannot expand forever. */
  maxOccurrences?: number;
}

const DEFAULT_MAX_OCCURRENCES = 366;

const UTC_TZID = 'UTC';
const FLOATING_TZID = 'floating';

/** Convert an `ICAL.Time` into our decoupled `IcsTime`, preserving what the file said. */
function toIcsTime(time: ICAL.Time, rawTzid?: string): IcsTime {
  const zone = time.zone;
  const isFloating = zone === ICAL.Timezone.localTimezone;
  const isUtc = zone === ICAL.Timezone.utcTimezone;

  // The TZID parameter as written beats the resolved zone. ical.js silently falls back to
  // floating when a TZID has no matching VTIMEZONE in the file — and a `.ics` that says
  // `TZID=Europe/Madrid` while shipping no VTIMEZONE is perfectly common. Trusting the
  // resolved zone there would throw away a zone the file told us in plain sight.
  const tzid = rawTzid ?? (isUtc ? UTC_TZID : isFloating ? FLOATING_TZID : (zone?.tzid ?? FLOATING_TZID));

  const icsTime: IcsTime = {
    isDate: time.isDate,
    wall: {
      year: time.year,
      month: time.month,
      day: time.day,
      hour: time.hour,
      minute: time.minute,
      second: time.second,
    },
    tzid,
  };

  // An instant only exists when the file determines one. For a floating time it does not,
  // and `toJSDate()` would silently resolve it against the machine's local zone — which
  // would make the output depend on where CI happens to run.
  if (!time.isDate && !isFloating) {
    icsTime.instant = time.toJSDate();
  }

  return icsTime;
}

function readUnmappable(vevent: ICAL.Component): IcsOccurrence['unmappable'] {
  const categories = vevent
    .getAllProperties('categories')
    .flatMap((p) => p.getValues() as string[])
    .map((c) => String(c).trim())
    .filter(Boolean);

  const lastModified =
    (vevent.getFirstPropertyValue('last-modified') as ICAL.Time | null) ??
    (vevent.getFirstPropertyValue('dtstamp') as ICAL.Time | null);

  const geoRaw = vevent.getFirstPropertyValue('geo') as unknown;
  let geo: { lat: number; lon: number } | undefined;
  if (Array.isArray(geoRaw) && geoRaw.length === 2) {
    const [lat, lon] = geoRaw.map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) geo = { lat: lat!, lon: lon! };
  }

  return {
    categories,
    ...(lastModified ? { lastModified: lastModified.toJSDate().toISOString() } : {}),
    ...(geo ? { geo } : {}),
  };
}

/**
 * Room links, in order of how much we trust them.
 *
 * `CONFERENCE` is the standard property (RFC 7986)… that almost nobody emits. The X-
 * properties are proprietary, and in practice they are where the data actually is.
 *
 * URLs inside `DESCRIPTION` are deliberately NOT read: registration links, community links
 * and sponsor links all live there. Too much noise to treat as signal.
 */
function readConferenceUrls(vevent: ICAL.Component): string[] {
  const props = ['conference', 'x-google-conference', 'x-microsoft-skypeteamsmeetingurl'];
  const urls = props.flatMap((name) =>
    vevent.getAllProperties(name).map((p) => String(p.getFirstValue() ?? '').trim()),
  );
  return [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))];
}

function readTimeProperty(
  vevent: ICAL.Component,
  name: 'dtstart' | 'dtend',
): { time: ICAL.Time; rawTzid?: string } | undefined {
  const prop = vevent.getFirstProperty(name);
  if (!prop) return undefined;
  const time = prop.getFirstValue() as ICAL.Time | null;
  if (!time) return undefined;
  const rawTzid = prop.getParameter('tzid') as string | undefined;
  return rawTzid ? { time, rawTzid } : { time };
}

function baseOccurrence(vevent: ICAL.Component): Omit<IcsOccurrence, 'start' | 'end'> {
  const str = (name: string): string | undefined => {
    const value = vevent.getFirstPropertyValue(name);
    if (value == null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  };

  const uid = str('uid');
  const summary = str('summary');
  const description = str('description');
  const url = str('url');
  const location = str('location');
  const status = str('status');

  return {
    ...(uid ? { uid } : {}),
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    ...(location ? { location } : {}),
    ...(status ? { status } : {}),
    conferenceUrls: readConferenceUrls(vevent),
    unmappable: readUnmappable(vevent),
  };
}

/**
 * Expand a recurring event into one occurrence per date within the window.
 *
 * `RRULE` is an implementation detail of the connector and must never reach the feed:
 * OTE is "one document = one event", so recurrence is resolved at ingest time. `EXDATE`
 * and `RECURRENCE-ID` overrides are honoured by ical.js's own occurrence machinery.
 */
function expandRecurring(
  event: ICAL.Event,
  vevent: ICAL.Component,
  options: ParseOptions,
): IcsOccurrence[] {
  const max = options.maxOccurrences ?? DEFAULT_MAX_OCCURRENCES;
  const windowStart = options.windowStart.getTime();
  const windowEnd = options.windowEnd.getTime();
  const rawTzid = readTimeProperty(vevent, 'dtstart')?.rawTzid;

  const occurrences: IcsOccurrence[] = [];
  const iterator = event.iterator();

  for (let i = 0; i < max * 4; i += 1) {
    const next = iterator.next();
    if (!next) break;

    const instant = next.toJSDate().getTime();
    if (instant > windowEnd) break;
    if (instant < windowStart) continue;

    // Picks up the RECURRENCE-ID override for this date, when the file has one.
    const details = event.getOccurrenceDetails(next);
    const item = details.item.component;

    occurrences.push({
      ...baseOccurrence(item),
      recurrenceId: next.toString(),
      start: toIcsTime(details.startDate, rawTzid),
      ...(details.endDate ? { end: toIcsTime(details.endDate, rawTzid) } : {}),
    });

    if (occurrences.length >= max) break;
  }

  return occurrences;
}

/**
 * Parse an `.ics` document into occurrences.
 *
 * Throws only when the document as a whole is unparseable — a single broken `VEVENT` is
 * skipped, never fatal.
 */
export function parseIcs(text: string, options: ParseOptions): IcsOccurrence[] {
  const jcal = ICAL.parse(text);
  const calendar = new ICAL.Component(jcal);

  // VTIMEZONEs are registered globally in ical.js, so the registry is reset per document:
  // one source's custom zone definition must not leak into the next source's parse.
  ICAL.TimezoneService.reset();
  for (const vtimezone of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = vtimezone.getFirstPropertyValue('tzid') as string | null;
    if (tzid) ICAL.TimezoneService.register(new ICAL.Timezone(vtimezone), tzid);
  }

  const vevents = calendar.getAllSubcomponents('vevent');
  const masters = vevents.filter((v) => !v.getFirstProperty('recurrence-id'));
  const overrides = vevents.filter((v) => v.getFirstProperty('recurrence-id'));

  const occurrences: IcsOccurrence[] = [];

  for (const vevent of masters) {
    const event = new ICAL.Event(vevent, { strictExceptions: false });

    for (const override of overrides) {
      if (override.getFirstPropertyValue('uid') === event.uid) {
        event.relateException(new ICAL.Event(override));
      }
    }

    const dtstart = readTimeProperty(vevent, 'dtstart');
    if (!dtstart) continue; // A VEVENT with no DTSTART is not an event. The caller reports the count.

    if (event.isRecurring()) {
      occurrences.push(...expandRecurring(event, vevent, options));
      continue;
    }

    const dtend = readTimeProperty(vevent, 'dtend');
    // DURATION instead of DTEND: ICAL.Event.endDate resolves either into an end time.
    const end = dtend?.time ?? (event.endDate as ICAL.Time | null);

    occurrences.push({
      ...baseOccurrence(vevent),
      start: toIcsTime(dtstart.time, dtstart.rawTzid),
      ...(end ? { end: toIcsTime(end, dtend?.rawTzid ?? dtstart.rawTzid) } : {}),
    });
  }

  return occurrences;
}

/** VEVENTs the parser had to skip outright, for the report. */
export function countUnparseableEvents(text: string): number {
  const calendar = new ICAL.Component(ICAL.parse(text));
  return calendar
    .getAllSubcomponents('vevent')
    .filter((v) => !v.getFirstProperty('recurrence-id') && !v.getFirstProperty('dtstart')).length;
}
