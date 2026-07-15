/**
 * The `ics` connector: steps [2] fetch, [3] parse and [4] normalize for iCalendar sources.
 *
 * This is the inverse of the iCalendar mapping the spec already documents — validating it
 * in both directions is a strong test of the model.
 */
import type { Source } from '../../sources/types.js';
import type { Connector, Ctx, IngestResult, Issue } from '../types.js';
import { normalizeOccurrence } from './normalize.js';
import { parseIcs } from './parse.js';

/** How far ahead recurring events are expanded. */
const WINDOW_MONTHS_AHEAD = 12;

/**
 * How far back. Non-recurring past events are already in the file and get archived; this
 * makes recently-past occurrences of a recurring event behave the same way.
 */
const WINDOW_DAYS_BEHIND = 30;

const configSchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: {
      description: 'Public URL of the .ics document.',
      type: 'string',
      format: 'uri',
      pattern: '^https?://',
    },
  },
} as const;

function window(now: Date): { windowStart: Date; windowEnd: Date } {
  const windowStart = new Date(now);
  windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_DAYS_BEHIND);

  const windowEnd = new Date(now);
  windowEnd.setUTCMonth(windowEnd.getUTCMonth() + WINDOW_MONTHS_AHEAD);

  return { windowStart, windowEnd };
}

/**
 * Facts the `.ics` states that OTE v0.1 cannot express.
 *
 * These are counted, not dropped in silence. The aggregator exists partly to put pressure
 * on the spec, and "37 events across 4 sources carry CATEGORIES we cannot publish" is an
 * argument; "the spec should have tags" is an opinion.
 */
function reportSpecGaps(source: Source, occurrences: ReturnType<typeof parseIcs>): Issue[] {
  const gaps: Issue[] = [];

  const count = (predicate: (o: (typeof occurrences)[number]) => boolean) =>
    occurrences.filter(predicate).length;

  const withCategories = count((o) => o.unmappable.categories.length > 0);
  if (withCategories > 0) {
    gaps.push({
      sourceId: source.id,
      code: 'spec-gap:tags',
      message:
        `${withCategories} event(s) carry CATEGORIES, but OTE v0.1 has no \`tags\` field. ` +
        'The data was parsed and discarded.',
    });
  }

  const withLastModified = count((o) => Boolean(o.unmappable.lastModified));
  if (withLastModified > 0) {
    gaps.push({
      sourceId: source.id,
      code: 'spec-gap:event-updatedAt',
      message:
        `${withLastModified} event(s) carry LAST-MODIFIED/DTSTAMP, but OTE v0.1 has ` +
        '`updatedAt` on the Feed only, not on the Event. Consumers cannot tell which ' +
        'events changed since they last read the feed.',
    });
  }

  const withGeo = count((o) => Boolean(o.unmappable.geo));
  if (withGeo > 0) {
    gaps.push({
      sourceId: source.id,
      code: 'spec-gap:venue-geo',
      message:
        `${withGeo} event(s) carry GEO coordinates, but OTE v0.1's \`location.venue\` is a ` +
        'plain string with no place for them.',
    });
  }

  return gaps;
}

export const icsConnector: Connector = {
  type: 'ics',
  configSchema,

  async ingest(source: Source, ctx: Ctx): Promise<IngestResult> {
    const url = String(source.config['url']);

    // A source that is unreachable is a source-level failure: it throws, and the pipeline
    // falls back to the last good snapshot. A single malformed event is not — that is
    // accumulated below and reported per event.
    const response = await ctx.fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
    }
    const text = await response.text();

    const occurrences = parseIcs(text, window(ctx.now));
    ctx.logger.info(`[${source.id}] parsed ${occurrences.length} occurrence(s) from ${url}`);

    const result: IngestResult = {
      events: [],
      warnings: reportSpecGaps(source, occurrences),
      errors: [],
    };

    for (const occurrence of occurrences) {
      const { event, warnings, errors } = normalizeOccurrence(occurrence, source, ctx.now);
      if (event) result.events.push(event);
      result.warnings.push(...warnings);
      result.errors.push(...errors);
    }

    return result;
  },
};
