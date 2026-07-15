/**
 * Step [6] dedupe — by stable `id`, and only by stable `id`.
 *
 * Deduplicating the SAME event coming from two DIFFERENT sources (fuzzy matching on
 * title + date + venue) is a known limitation of the MVP, not an oversight. It is a
 * problem in its own right, and getting it wrong silently merges two real events.
 */
import type { OteEvent } from '../ote/types.js';

export interface DedupeResult {
  events: OteEvent[];
  /** How many events were dropped as exact-id duplicates. */
  duplicates: number;
}

export function dedupe(events: OteEvent[]): DedupeResult {
  const byId = new Map<string, OteEvent>();
  let duplicates = 0;

  for (const event of events) {
    if (byId.has(event.id)) {
      duplicates += 1;
      continue;
    }
    byId.set(event.id, event);
  }

  return { events: [...byId.values()], duplicates };
}
