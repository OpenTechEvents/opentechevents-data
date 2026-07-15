/**
 * Step [7] partition — future events go to the feed, past ones to the archive.
 */
import { toInstant } from '../connectors/ics/time.js';
import type { OteEvent } from '../ote/types.js';

export interface Partitioned {
  /** Sorted by start, soonest first. */
  upcoming: OteEvent[];
  /** Keyed by the year the event started, for `archive/YYYY.json`. */
  archived: Map<string, OteEvent[]>;
}

/**
 * An event stays in the feed until it has ENDED, not until it has started.
 *
 * The obvious rule — `startDate >= today` — quietly drops a three-day conference from the
 * feed on its second morning, while people are still attending it. Subscribers would watch
 * the event vanish from their calendar halfway through.
 */
function endInstant(event: OteEvent): Date {
  const end = event.endDate ?? event.startDate;
  const instant = toInstant(end, event.timezone);

  // An all-day end date means "through the end of that day".
  if (!end.includes('T')) {
    return new Date(instant.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return instant;
}

const byStart = (a: OteEvent, b: OteEvent): number =>
  toInstant(a.startDate, a.timezone).getTime() - toInstant(b.startDate, b.timezone).getTime() ||
  a.id.localeCompare(b.id);

export function partition(events: OteEvent[], now: Date): Partitioned {
  const upcoming: OteEvent[] = [];
  const archived = new Map<string, OteEvent[]>();

  for (const event of events) {
    if (endInstant(event) >= now) {
      upcoming.push(event);
      continue;
    }
    const year = event.startDate.slice(0, 4);
    const bucket = archived.get(year) ?? [];
    bucket.push(event);
    archived.set(year, bucket);
  }

  upcoming.sort(byStart);
  for (const bucket of archived.values()) bucket.sort(byStart);

  return { upcoming, archived };
}
