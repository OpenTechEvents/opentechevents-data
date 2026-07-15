/**
 * The pipeline, end to end.
 *
 *   sources/*.yml → discover → fetch → parse → normalize → validate → dedupe → partition → render
 *
 * Steps 2-4 are the connector's. Everything from `validate` on is shared by every format
 * and is not touched when a new source is added.
 */
import { getConnector } from '../connectors/registry.js';
import type { Ctx, Logger } from '../connectors/types.js';
import type { OteEvent, OteFeed } from '../ote/types.js';
import { validateEvent, validateFeed } from '../ote/validate.js';
import type { Source } from '../sources/types.js';
import { dedupe } from './dedupe.js';
import { partition } from './partition.js';
import { renderFeed, type FeedMeta } from './render/feed.js';
import { renderIcs } from './render/ics.js';
import type { Report, SourceReport } from './report.js';
import { resilientFetch, type SnapshotStore } from './snapshots.js';

export interface RunOptions {
  sources: Source[];
  snapshots: SnapshotStore;
  meta: FeedMeta;
  /** Injected: tests run with no network and a frozen clock. */
  fetch: typeof fetch;
  now: Date;
  logger: Logger;
  /** Stable URL of the published `.ics`, for its RFC 7986 `SOURCE` property. */
  feedUrl?: string;
}

export interface RunResult {
  feed: OteFeed;
  ics: string;
  archive: Map<string, OteEvent[]>;
  report: Report;
}

/** An event, plus which source produced it — so every count in the report is attributable. */
interface OwnedEvent {
  event: OteEvent;
  sourceId: string;
}

/** Ingest one source. Never throws: a source that blows up is a report entry, not a crash. */
async function ingestSource(
  source: Source,
  options: RunOptions,
): Promise<{ events: OwnedEvent[]; report: SourceReport }> {
  const report: SourceReport = {
    id: source.id,
    type: source.type,
    name: source.attribution?.name ?? source.id,
    ...(source.attribution?.url ? { url: source.attribution.url } : {}),
    ok: true,
    events: 0,
    errors: [],
    warnings: [],
  };

  if (source.enabled === false) {
    options.logger.info(`[${source.id}] disabled, skipped`);
    return { events: [], report };
  }

  const resilient = resilientFetch(source.id, options.snapshots, options.fetch);
  const ctx: Ctx = { fetch: resilient.fetch, now: options.now, logger: options.logger };

  try {
    const result = await getConnector(source.type).ingest(source, ctx);
    report.errors.push(...result.errors);
    report.warnings.push(...result.warnings);

    const fallback = resilient.fallback();
    if (fallback) {
      report.servedFromSnapshot = fallback;
      options.logger.warn(
        `[${source.id}] unreachable (${fallback.reason}); served from the last good snapshot`,
      );
    }

    return {
      events: result.events.map((event) => ({ event, sourceId: source.id })),
      report,
    };
  } catch (cause) {
    // No network AND no snapshot: this source contributes nothing to this run. The other
    // sources still publish — the feed is never all-or-nothing.
    report.ok = false;
    report.failure = (cause as Error).message;
    options.logger.warn(`[${source.id}] FAILED: ${report.failure}`);
    return { events: [], report };
  }
}

/**
 * Step [5] validate — against the published OTE JSON Schema. An invalid event is discarded
 * and reported; it never reaches the feed. If our own normaliser produces something the
 * spec rejects, that is a bug in us, and the report is where it surfaces.
 */
function validateAll(
  owned: OwnedEvent[],
  reports: Map<string, SourceReport>,
): { valid: OwnedEvent[]; invalid: number } {
  const valid: OwnedEvent[] = [];
  let invalid = 0;

  for (const item of owned) {
    const result = validateEvent(item.event);
    if (result.valid) {
      valid.push(item);
      continue;
    }

    invalid += 1;
    reports.get(item.sourceId)?.errors.push({
      sourceId: item.sourceId,
      code: 'schema-invalid',
      message: `does not validate against OTE v0.2: ${result.violations
        .map((v) => `${v.path} ${v.message}`)
        .join('; ')}`,
      eventId: item.event.id,
      eventName: item.event.name,
    });
  }

  return { valid, invalid };
}

export async function run(options: RunOptions): Promise<RunResult> {
  const { now, logger } = options;

  const ingested = await Promise.all(options.sources.map((s) => ingestSource(s, options)));

  const reports = new Map<string, SourceReport>();
  const owned: OwnedEvent[] = [];
  for (const result of ingested) {
    reports.set(result.report.id, result.report);
    owned.push(...result.events);
  }

  const { valid, invalid } = validateAll(owned, reports);

  const { events: unique, duplicates } = dedupe(valid.map((o) => o.event));
  const survivors = new Set(unique.map((e) => e.id));
  for (const item of valid) {
    if (!survivors.delete(item.event.id)) continue; // Already counted, or lost to dedupe.
    const report = reports.get(item.sourceId);
    if (report) report.events += 1;
  }

  const { upcoming, archived } = partition(unique, now);
  const feed = renderFeed(upcoming, options.meta, now);

  // The feed is validated as a whole before it is written. Publishing a feed that does not
  // validate against the spec we are trying to prove would be the one unforgivable bug.
  const feedCheck = validateFeed(feed);
  if (!feedCheck.valid) {
    throw new Error(
      `the rendered feed does not validate against OTE v0.2:\n${feedCheck.violations
        .map((v) => `  ${v.path} ${v.message}`)
        .join('\n')}`,
    );
  }

  const report: Report = {
    generatedAt: now.toISOString(),
    totals: {
      sources: options.sources.length,
      sourcesFailed: [...reports.values()].filter((r) => !r.ok).length,
      upcoming: upcoming.length,
      archived: [...archived.values()].reduce((n, bucket) => n + bucket.length, 0),
      invalid,
      duplicates,
    },
    sources: [...reports.values()],
  };

  logger.info(
    `${upcoming.length} upcoming, ${report.totals.archived} archived, ` +
      `${invalid} invalid, ${duplicates} duplicate(s), ${report.totals.sourcesFailed} source(s) failed`,
  );

  return {
    feed,
    ics: renderIcs(feed, now, options.feedUrl ? { feedUrl: options.feedUrl } : {}),
    archive: archived,
    report,
  };
}
