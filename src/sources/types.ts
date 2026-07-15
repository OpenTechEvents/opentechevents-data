import type { AttendanceMode, License } from '../ote/types.js';

/** Written by hand (or by the Issue Form workflow) as `sources/<id>.yml`. */
export interface SourceFile {
  /** Unique slug. Must equal the file name. */
  id: string;
  /** Which connector processes this source: "ics", … */
  type: string;
  enabled?: boolean;

  /**
   * IANA timezone of this source's events.
   *
   * Required, and it is the single most important field in the file. OTE requires a
   * `timezone` on every event, but iCalendar routinely omits it (all-day events, floating
   * times) or expresses the instant in UTC. This is the organiser declaring the answer
   * rather than the parser guessing it.
   */
  timezone: string;

  /** Validated against the connector's `configSchema`. */
  config: Record<string, unknown>;

  /** SPDX id or URL. Must pass the license gate — see `gate.ts`. */
  license?: License;

  attribution?: {
    name: string;
    url?: string;
  };

  /** Only when the source does not declare an open license itself. */
  permission?: {
    /** Who granted it (GitHub handle, email…). */
    grantedBy: string;
    /** Where it is on the record — normally the issue that registered the source. */
    evidence: string;
  };

  /** Applied to this source's events when the source data does not carry the value itself. */
  defaults?: {
    languages?: string[];
    /**
     * Beats the connector's inference, always. The organiser knows whether their meetup
     * is hybrid; the parser does not.
     */
    attendanceMode?: AttendanceMode;
    /** Merged into every event's `tags` (union), on top of whatever the source data carries. */
    tags?: string[];
  };
}

/** A `SourceFile` that has been validated and passed the license gate. */
export interface Source extends SourceFile {
  /** Path it was loaded from, for error messages. */
  readonly file: string;
  /**
   * License we publish this source's events under, once the gate has run.
   *
   * Absent only for a source that is `enabled: false` and has not cleared the gate yet — a
   * source pending license confirmation. Such a source publishes nothing, so it has no
   * publish license; it must clear the gate before it can be enabled. Every enabled source
   * has this set.
   */
  readonly dataLicense?: License;
  /** License the ORIGIN declares, if any. Absent for permission-based sources. */
  readonly originLicense?: License;
}
