import { describe, expect, it } from 'vitest';

import { LicenseGateError, passesLicenseGate } from '../src/sources/gate.js';
import type { SourceFile } from '../src/sources/types.js';

function source(overrides: Partial<SourceFile> = {}): SourceFile {
  return {
    id: 'test',
    type: 'ics',
    timezone: 'Europe/Madrid',
    config: { url: 'https://example.org/events.ics' },
    ...overrides,
  };
}

describe('the open data gate', () => {
  it('lets an allowlisted license through, and records what the origin declared', () => {
    expect(passesLicenseGate(source({ license: 'CC-BY-4.0' }))).toEqual({
      dataLicense: 'CC-BY-4.0',
      originLicense: 'CC-BY-4.0',
    });
  });

  it('rejects share-alike, because it would infect the whole aggregate', () => {
    // One CC-BY-SA source would force every downstream directory to relicense its own
    // database. That kills the use case the project exists for.
    expect(() => passesLicenseGate(source({ license: 'CC-BY-SA-4.0' }))).toThrow(
      LicenseGateError,
    );
    expect(() => passesLicenseGate(source({ license: 'ODbL-1.0' }))).toThrow(LicenseGateError);
  });

  it('rejects NC and ND: not open licenses', () => {
    expect(() => passesLicenseGate(source({ license: 'CC-BY-NC-4.0' }))).toThrow(
      LicenseGateError,
    );
    expect(() => passesLicenseGate(source({ license: 'CC-BY-ND-4.0' }))).toThrow(
      LicenseGateError,
    );
  });

  it('rejects CC-BY-3.0: only 4.0 covers the EU database right', () => {
    expect(() => passesLicenseGate(source({ license: 'CC-BY-3.0' }))).toThrow(LicenseGateError);
  });

  it("admits a source with no license when the organiser's permission is on the record", () => {
    const result = passesLicenseGate(
      source({
        permission: {
          grantedBy: '@organiser',
          evidence: 'https://github.com/OpenTechEvents/opentechevents-data/issues/42',
        },
      }),
    );

    // The origin declares nothing, so we claim nothing on its behalf: no originLicense.
    expect(result).toEqual({ dataLicense: 'CC-BY-4.0' });
  });

  it('rejects a permission with no evidence to point at', () => {
    expect(() =>
      passesLicenseGate(
        source({ permission: { grantedBy: '@organiser', evidence: 'me lo dijo por Telegram' } }),
      ),
    ).toThrow(/evidence must be a URL/);
  });

  it('rejects a source with neither license nor permission', () => {
    // "It is on the internet" is not a license.
    expect(() => passesLicenseGate(source())).toThrow(/no `license` and no `permission`/);
  });
});
