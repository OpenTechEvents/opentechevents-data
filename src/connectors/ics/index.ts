/**
 * The `ics` connector: steps [2] fetch, [3] parse and [4] normalize for iCalendar sources.
 *
 * This is the inverse of the iCalendar mapping the spec already documents — validating it
 * in both directions is a strong test of the model.
 */
import type { Source } from '../../sources/types.js';
import type { Connector, Ctx, IngestResult } from '../types.js';
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
      warnings: [],
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
