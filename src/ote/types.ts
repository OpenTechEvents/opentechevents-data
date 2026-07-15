/**
 * TypeScript mirror of OTE Spec v0.2, as published in `@opentechevents/schema`.
 *
 * The JSON Schema is the source of truth: these types exist for editor support,
 * and every document is still validated with ajv against the published schema
 * before it is written (see `validate.ts`). If the two ever disagree, the schema wins.
 */

export const SPEC_VERSION = '0.2.0';

/** Wall-clock date (`2026-10-15`) or local date-time (`2026-10-15T19:00:00`). Never carries an offset. */
export type WallClock = string;

/** Absolute point in time, with `Z` or an offset. Metadata only, never when an event happens. */
export type Instant = string;

/** SPDX identifier (`CC-BY-4.0`) or a URL. */
export type License = string;

export type AttendanceMode = 'in-person' | 'online' | 'hybrid';

export type EventStatus = 'scheduled' | 'cancelled' | 'postponed' | 'rescheduled';

/**
 * What is KNOWN about where the event happens — not the same question as `attendanceMode`,
 * which states the organiser's intent. At least one of the two keys must be present.
 */
export interface OteGeo {
  /** Latitude in decimal degrees, [-90, 90]. */
  lat: number;
  /** Longitude in decimal degrees, [-180, 180]. */
  lon: number;
}

export interface OteLocation {
  /** Human-readable physical location. Its presence means the event has a physical venue. */
  venue?: string;
  /** URL to attend online. Its presence means the event has online access. */
  onlineUrl?: string;
  /** WGS-84 coordinates of the physical venue. A point, not a name — independent of `venue`. */
  geo?: OteGeo;
}

export interface OteSource {
  name: string;
  url?: string;
  /** License under which the ORIGIN publishes the data. */
  license?: License;
  retrievedAt?: Instant;
}

export interface OteEvent {
  /** Only on standalone events; inside a feed it is inherited. */
  specVersion?: typeof SPEC_VERSION;
  /** Stable URI. Minted once, never rewritten — this is what lets consumers update instead of duplicating. */
  id: string;
  url?: string;
  name: string;
  description?: string;
  /** IANA timezone. Required on every event, including all-day ones. */
  timezone: string;
  startDate: WallClock;
  /** Must be the same form as `startDate`: both dates, or both date-times. */
  endDate?: WallClock;
  /** Inside a feed, omitted when it matches the feed's license. */
  license?: License;
  location?: OteLocation;
  attendanceMode?: AttendanceMode;
  languages?: string[];
  /** Free-form topic tags. Non-empty; absent means unknown. Maps to iCal CATEGORIES. */
  tags?: string[];
  status?: EventStatus;
  source?: OteSource;
  /** Instant the event's DATA last changed (iCal LAST-MODIFIED, not DTSTAMP). For incremental sync. */
  updatedAt?: Instant;
}

export interface OteFeed {
  specVersion: typeof SPEC_VERSION;
  title: string;
  description?: string;
  url?: string;
  license: License;
  licenseUrl?: string;
  updatedAt: Instant;
  events: OteEvent[];
}
