/**
 * The `ote` connector: steps [2] fetch, [3] parse and [4] normalize for sources that already
 * publish an OTE Feed.
 *
 * This is the strongest dogfooding test the project has: a source is an OTE feed, the output
 * is an OTE feed, and re-aggregating one into the other must be near-identity. If ingesting
 * our own format is lossy, the format is wrong.
 *
 * It is also what interoperability looks like in practice — one platform publishes OTE, and
 * every other aggregator can consume it without a bespoke importer. Because the event `id` is
 * a global URI minted once and never rewritten, two aggregators ingesting the same feed emit
 * the same ids, so they dedupe against each other for free.
 */
import type { OteEvent, OteFeed, OteSource } from '../../ote/types.js';
import { SPEC_VERSION } from '../../ote/types.js';
import type { Source } from '../../sources/types.js';
import type { Connector, Ctx, IngestResult, Issue } from '../types.js';

const configSchema = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: {
    url: {
      description: 'Public URL of the OTE `feed.json` document.',
      type: 'string',
      format: 'uri',
      pattern: '^https?://',
    },
  },
} as const;

/** Structural parse. Enough to tell "this is a feed" from "this is garbage"; per-event schema
 * validation is the pipeline's job, not the connector's. */
function parseFeed(text: string): OteFeed {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new Error(`not valid JSON: ${(cause as Error).message}`);
  }
  if (typeof json !== 'object' || json === null || !Array.isArray((json as OteFeed).events)) {
    throw new Error('not an OTE feed: no `events` array at the top level');
  }
  return json as OteFeed;
}

/**
 * Normalise one upstream event. It is already OTE, so this preserves rather than maps.
 *
 * The three things that are NOT passthrough, and why:
 *
 * - **`id` is kept verbatim.** Re-minting it would defeat the whole point of a global,
 *   decentralised URI: a consumer that already saw this event upstream must recognise it here.
 * - **`license` is resolved out of the feed.** Inside a feed an event omits its own license
 *   when it matches the feed's, so an event with no `license` inherits `feed.license`. We make
 *   that explicit here; `renderFeed` re-applies the omission against OUR feed's license
 *   downstream. Dropping a `CC0-1.0` event's own licence into a `CC-BY-4.0` feed would be a lie.
 * - **`source` provenance is preserved when present.** If the upstream event already carries a
 *   `source`, that points at the TRUE origin (the organiser), possibly several hops back. We do
 *   not overwrite it with this feed's attribution — provenance chains to the origin, not to the
 *   last relay. Only when the event has no `source` do we attribute it to the feed itself.
 */
function normalizeEvent(event: OteEvent, feed: OteFeed, source: Source, ctx: Ctx): OteEvent {
  // Never carried on an in-feed event; both are inherited from the feed. Strip so a feed that
  // put them there anyway does not leak an out-of-place property downstream.
  const { specVersion: _specVersion, license, source: upstreamSource, ...rest } = event;

  const effectiveLicense = license ?? feed.license;
  const provenanceUrl = source.attribution?.url ?? feed.url;

  const provenance: OteSource = upstreamSource ?? {
    name: source.attribution?.name ?? feed.title ?? source.id,
    ...(provenanceUrl ? { url: provenanceUrl } : {}),
    ...(effectiveLicense ? { license: effectiveLicense } : {}),
    retrievedAt: ctx.now.toISOString(),
  };

  // `defaults` fill only what the event does not already carry — the event's own value is
  // declared data and always wins (unlike the .ics connector, where the field is guessed).
  const languages = rest.languages ?? source.defaults?.languages;
  const attendanceMode = rest.attendanceMode ?? source.defaults?.attendanceMode;

  return {
    ...rest,
    ...(languages ? { languages } : {}),
    ...(attendanceMode ? { attendanceMode } : {}),
    ...(effectiveLicense ? { license: effectiveLicense } : {}),
    source: provenance,
  };
}

export const oteConnector: Connector = {
  type: 'ote',
  configSchema,

  async ingest(source: Source, ctx: Ctx): Promise<IngestResult> {
    const url = String(source.config['url']);

    const response = await ctx.fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} → ${response.status} ${response.statusText}`);
    }
    const feed = parseFeed(await response.text());

    const warnings: Issue[] = [];
    const errors: Issue[] = [];

    if (feed.specVersion && feed.specVersion !== SPEC_VERSION) {
      warnings.push({
        sourceId: source.id,
        code: 'spec-version-mismatch',
        message:
          `feed declares specVersion "${feed.specVersion}", this aggregator implements ` +
          `${SPEC_VERSION}. Events were ingested as-is; fields the two versions disagree on ` +
          'may be dropped by validation downstream.',
      });
    }

    const events: OteEvent[] = [];
    for (const [index, raw] of feed.events.entries()) {
      if (typeof raw !== 'object' || raw === null) {
        errors.push({
          sourceId: source.id,
          code: 'malformed-event',
          message: `events[${index}] is not an object.`,
        });
        continue;
      }
      events.push(normalizeEvent(raw as OteEvent, feed, source, ctx));
    }

    ctx.logger.info(`[${source.id}] ingested ${events.length} event(s) from ${url}`);

    return { events, warnings, errors };
  },
};
