import { describe, expect, it } from 'vitest';

import { parseSource } from '../src/sources/load.js';

const valid = `
id: rust-madrid
type: ics
timezone: Europe/Madrid
config:
  url: https://rustmadrid.example/events.ics
license: CC-BY-4.0
attribution:
  name: Rust Madrid
  url: https://rustmadrid.example
defaults:
  languages: [es]
  attendanceMode: in-person
`;

const parse = (yaml: string, file = 'sources/rust-madrid.yml') => parseSource(file, yaml);

describe('the source registry', () => {
  it('accepts a well-formed source and resolves its license', () => {
    expect(parse(valid)).toMatchObject({
      id: 'rust-madrid',
      type: 'ics',
      timezone: 'Europe/Madrid',
      dataLicense: 'CC-BY-4.0',
      originLicense: 'CC-BY-4.0',
      defaults: { languages: ['es'], attendanceMode: 'in-person' },
    });
  });

  it('requires the id to match the file name, so `git blame` means something', () => {
    expect(() => parse(valid, 'sources/otro-nombre.yml')).toThrow(/must match the file name/);
  });

  it('rejects a timezone that is not a real IANA zone', () => {
    // `timezone` is what rescues every all-day and floating .ics event. A typo here would
    // silently mis-time an entire source.
    expect(() => parse(valid.replace('Europe/Madrid', 'Europe/Madriz'))).toThrow(
      /not a valid IANA zone/,
    );
  });

  it('rejects a source with no timezone at all', () => {
    expect(() => parse(valid.replace('timezone: Europe/Madrid\n', ''))).toThrow(
      /must have required property 'timezone'/,
    );
  });

  it('rejects an unknown connector type', () => {
    expect(() => parse(valid.replace('type: ics', 'type: meetup'))).toThrow(
      /unknown connector type "meetup"/,
    );
  });

  it("validates the config against the connector's own schema", () => {
    expect(() => parse(valid.replace('https://rustmadrid.example/events.ics', 'not-a-url'))).toThrow(
      /config is not valid for connector "ics"/,
    );
  });

  it('runs the license gate', () => {
    expect(() => parse(valid.replace('license: CC-BY-4.0', 'license: CC-BY-SA-4.0'))).toThrow(
      /not on the allowlist/,
    );
  });

  it('lets a disabled source sit in the registry before its license is confirmed', () => {
    // "Pending license" is a first-class state: the gate protects what gets PUBLISHED, and a
    // disabled source publishes nothing. It has no publish license yet, on purpose.
    const pending = `
id: eventos-tech-granada
type: ics
enabled: false
timezone: Europe/Madrid
config:
  url: https://calendar.google.com/calendar/ical/x/public/basic.ics
`;
    const source = parse(pending, 'sources/eventos-tech-granada.yml');

    expect(source.enabled).toBe(false);
    expect(source.dataLicense).toBeUndefined();
  });

  it('still enforces the gate the moment a source is enabled', () => {
    // Flipping `enabled: true` with no license and no permission must fail — that is what
    // stops an unconfirmed source from ever reaching the feed.
    const enabledNoLicense = `
id: test
type: ics
enabled: true
timezone: Europe/Madrid
config:
  url: https://example.org/events.ics
`;
    expect(() => parse(enabledNoLicense, 'sources/test.yml')).toThrow(
      /no `license` and no `permission`/,
    );
  });

  it('accepts defaults.tags, merged into every event by the connector (v0.2)', () => {
    expect(parse(`${valid}\n  tags: [rust, madrid]\n`)).toMatchObject({
      defaults: { tags: ['rust', 'madrid'] },
    });
  });

  it('rejects a defaults field the spec has nowhere to put, instead of accepting it silently', () => {
    // A source declaring an unknown default would look like it worked and then publish nothing.
    expect(() => parse(`${valid}\n  keywords: [rust]\n`)).toThrow(/does not match the source schema/);
  });
});
