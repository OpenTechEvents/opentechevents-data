import type { OteEvent } from '../ote/types.js';
import type { Source } from '../sources/types.js';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * Everything a connector is allowed to touch from the outside world. Injected so tests
 * run with no network and no clock: same fixture in, same events out, forever.
 */
export interface Ctx {
  fetch: typeof fetch;
  now: Date;
  logger: Logger;
}

/** Something that happened to one event (or one source), reported instead of swallowed. */
export interface Issue {
  sourceId: string;
  /** Machine-readable reason, e.g. "missing-timezone", "unmappable-field". */
  code: string;
  message: string;
  /** The event it happened to, when known. */
  eventId?: string;
  eventName?: string;
}

export interface IngestResult {
  /** Normalised to OTE. Not yet schema-validated — that is the pipeline's job. */
  events: OteEvent[];
  /** Events that made it through, but degraded (e.g. no timezone in source → source default). */
  warnings: Issue[];
  /** Events that were dropped, with the reason. */
  errors: Issue[];
}

/**
 * Steps [2] fetch, [3] parse and [4] normalize — the only thing a plugin contributes.
 * Everything downstream (validate, dedupe, partition, render, publish) is shared and does
 * not change when a new source format is added. That is the whole trick to maintainability.
 */
export interface Connector {
  /** Identifies the source type: "ics", "meetup", "jsonld"… */
  readonly type: string;

  /** JSON Schema for the `config` block this connector accepts in `sources/*.yml`. */
  readonly configSchema: Record<string, unknown>;

  /**
   * Fetch + parse + normalise.
   *
   * Never throws for a single bad event: it accumulates per-event errors. It MAY throw if
   * the source itself is unreachable — the pipeline handles that as a source-level failure
   * and falls back to the last good snapshot.
   */
  ingest(source: Source, ctx: Ctx): Promise<IngestResult>;
}
