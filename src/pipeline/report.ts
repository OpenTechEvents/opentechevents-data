/**
 * `report.json` — the health of the ingestion, per source.
 *
 * This is what stops the aggregator from failing silently. An event that was dropped, a
 * field that could not be mapped, a source served from a stale snapshot: all of it is
 * counted here, with a reason, so a maintainer can act on it.
 */
import type { Issue } from '../connectors/types.js';

export interface SourceReport {
  id: string;
  type: string;
  /** False when the source could not be ingested at all. */
  ok: boolean;
  /** Events that passed validation and made it into the output. */
  events: number;
  /** Events dropped, with the reason. */
  errors: Issue[];
  /** Events that made it through but degraded, plus fields the spec cannot express. */
  warnings: Issue[];
  /** Set when the network failed and the last good snapshot was used instead. */
  servedFromSnapshot?: { reason: string };
  /** Set when the source failed and there was no snapshot to fall back to. */
  failure?: string;
}

export interface Report {
  generatedAt: string;
  totals: {
    sources: number;
    sourcesFailed: number;
    upcoming: number;
    archived: number;
    /** Events dropped because they did not validate against the OTE schema. */
    invalid: number;
    /** Events dropped as exact-id duplicates. */
    duplicates: number;
  };
  sources: SourceReport[];
}
