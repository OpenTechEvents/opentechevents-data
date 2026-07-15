/**
 * The open data gate.
 *
 * The feed only carries events whose license is known and reusable. Nothing is ingested
 * "because it is on the internet". Two ways in, and no third one.
 */
import type { License } from '../ote/types.js';
import type { SourceFile } from './types.js';

/**
 * License the aggregated feed itself is published under. Every event we publish is
 * redistributable under at least these terms.
 */
export const FEED_LICENSE: License = 'CC-BY-4.0';
export const FEED_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';

/**
 * Licenses a source may declare.
 *
 * Deliberately tiny. No share-alike (`CC-BY-SA`, `ODbL`): a single share-alike source
 * would infect the whole aggregate, forcing every downstream directory or app to
 * relicense its own database — which kills the use case the project exists for. No `NC`
 * or `ND` either: those are not open licenses.
 *
 * `CC-BY-4.0` and not `3.0` because 4.0 is the first version that expressly covers the EU
 * sui generis database right, and a directory of events is a database.
 */
export const LICENSE_ALLOWLIST: readonly License[] = ['CC0-1.0', 'CC-BY-4.0'];

export interface GateResult {
  /** License we may publish this source's events under. */
  dataLicense: License;
  /** What the origin itself declares, if anything. */
  originLicense?: License;
}

export class LicenseGateError extends Error {
  constructor(
    readonly sourceId: string,
    message: string,
  ) {
    super(`source "${sourceId}": ${message}`);
    this.name = 'LicenseGateError';
  }
}

/**
 * Way 1 — the source declares an open license, and it is on the allowlist.
 * Way 2 — the organiser granted written permission, and the `permission` block links to it.
 *
 * Without a license and without permission, it does not get in.
 */
export function passesLicenseGate(source: SourceFile): GateResult {
  const { id, license, permission } = source;

  if (license) {
    if (!LICENSE_ALLOWLIST.includes(license)) {
      throw new LicenseGateError(
        id,
        `license "${license}" is not on the allowlist (${LICENSE_ALLOWLIST.join(', ')}). ` +
          'Share-alike and NC/ND licenses cannot be redistributed in the aggregated feed. ' +
          'If the organiser is willing to grant permission instead, use the `permission` block.',
      );
    }
    return { dataLicense: license, originLicense: license };
  }

  if (permission) {
    if (!permission.grantedBy?.trim()) {
      throw new LicenseGateError(id, 'permission.grantedBy is empty: who granted it?');
    }
    if (!/^https?:\/\//.test(permission.evidence ?? '')) {
      throw new LicenseGateError(
        id,
        'permission.evidence must be a URL where the permission is on the record ' +
          '(normally the issue that registered this source).',
      );
    }
    // The organiser granted permission to publish as open data; the feed's own license
    // is the terms under which that is done. The origin declares nothing, so we claim
    // nothing on its behalf.
    return { dataLicense: FEED_LICENSE };
  }

  throw new LicenseGateError(
    id,
    'no `license` and no `permission`. A source needs one of the two: an open license ' +
      `on the allowlist (${LICENSE_ALLOWLIST.join(', ')}), or the organiser's written ` +
      'permission, linked from the `permission` block.',
  );
}
