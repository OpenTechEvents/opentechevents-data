import { describe, expect, it } from 'vitest';

import { oteConnector } from '../src/connectors/ote/index.js';
import type { IngestResult } from '../src/connectors/types.js';
import { validateEvent } from '../src/ote/validate.js';
import type { Source } from '../src/sources/types.js';
import { fakeFetch, fixture, NOW, silentLogger } from './helpers.js';

const FEED_URL = 'https://upstream.example/feed.json';

function oteSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'upstream',
    type: 'ote',
    // Unused by this connector (every OTE event carries its own), but the source schema
    // requires it. Kept as a formality until the schema makes it connector-conditional.
    timezone: 'Europe/Madrid',
    config: { url: FEED_URL },
    license: 'CC-BY-4.0',
    attribution: { name: 'Upstream Mirror', url: 'https://upstream.example' },
    file: 'sources/upstream.yml',
    dataLicense: 'CC-BY-4.0',
    originLicense: 'CC-BY-4.0',
    ...overrides,
  };
}

async function ingest(body: string, source: Source = oteSource()): Promise<IngestResult> {
  return oteConnector.ingest(source, {
    fetch: fakeFetch({ [String(source.config['url'])]: body }),
    now: NOW,
    logger: silentLogger,
  });
}

const byId = (result: IngestResult, id: string) => result.events.find((e) => e.id === id);

describe('the ote connector', () => {
  it('re-emits every event so it validates against the published OTE schema', async () => {
    const result = await ingest(fixture('upstream-feed.json'));

    expect(result.events.length).toBe(4);
    for (const event of result.events) {
      expect(validateEvent(event), `event ${event.id} must validate`).toMatchObject({
        valid: true,
      });
    }
  });

  it('keeps the upstream id verbatim, so aggregators dedupe against each other', async () => {
    const result = await ingest(fixture('upstream-feed.json'));

    expect(result.events.map((e) => e.id)).toEqual([
      'https://origin.example/events.ics#meetup-1',
      'https://upstream.example/feed#first-party',
      'https://upstream.example/feed#cc0-event',
      'https://upstream.example/feed#declared-mode',
    ]);
  });

  it("preserves an event's own source, pointing at the true origin, not this relay", async () => {
    const event = byId(await ingest(fixture('upstream-feed.json')), 'https://origin.example/events.ics#meetup-1');

    expect(event?.source).toEqual({
      name: 'Rust Origin',
      url: 'https://origin.example',
      license: 'CC-BY-4.0',
      retrievedAt: '2026-06-30T00:00:00Z',
    });
  });

  it('attributes an event with no source to the feed itself', async () => {
    const event = byId(await ingest(fixture('upstream-feed.json')), 'https://upstream.example/feed#first-party');

    expect(event?.source).toEqual({
      name: 'Upstream Mirror',
      url: 'https://upstream.example',
      license: 'CC-BY-4.0',
      retrievedAt: NOW.toISOString(),
    });
  });

  it('resolves the feed license onto an event that inherited it', async () => {
    const event = byId(await ingest(fixture('upstream-feed.json')), 'https://upstream.example/feed#first-party');

    expect(event?.license).toBe('CC-BY-4.0');
  });

  it("keeps an event's own license when it differs from the feed's, rather than flattening it", async () => {
    const event = byId(await ingest(fixture('upstream-feed.json')), 'https://upstream.example/feed#cc0-event');

    expect(event?.license).toBe('CC0-1.0');
  });

  it('applies source defaults only where the event does not already carry the value', async () => {
    const source = oteSource({ defaults: { languages: ['es'], attendanceMode: 'hybrid' } });
    const result = await ingest(fixture('upstream-feed.json'), source);

    // Event with no attendanceMode inherits the default; its languages come from the default too.
    const inherited = byId(result, 'https://upstream.example/feed#first-party');
    expect(inherited?.attendanceMode).toBe('hybrid');
    expect(inherited?.languages).toEqual(['es']);

    // Event that declares its own attendanceMode keeps it — declared data beats a default.
    const declared = byId(result, 'https://upstream.example/feed#declared-mode');
    expect(declared?.attendanceMode).toBe('online');
  });

  it('warns when the feed declares a different spec version', async () => {
    const body = JSON.stringify({
      specVersion: '0.2.0',
      title: 'Future feed',
      license: 'CC-BY-4.0',
      updatedAt: '2026-07-01T00:00:00Z',
      events: [
        { id: 'https://x.example#a', name: 'A', timezone: 'Europe/Madrid', startDate: '2026-09-01T10:00:00' },
      ],
    });

    const result = await ingest(body);

    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'spec-version-mismatch' }),
    );
    expect(result.events.length).toBe(1);
  });

  it('reports a malformed event and skips it, rather than dropping the whole feed', async () => {
    const body = JSON.stringify({
      title: 'Mixed feed',
      license: 'CC-BY-4.0',
      updatedAt: '2026-07-01T00:00:00Z',
      events: [
        'not an object',
        { id: 'https://x.example#ok', name: 'OK', timezone: 'Europe/Madrid', startDate: '2026-09-01T10:00:00' },
      ],
    });

    const result = await ingest(body);

    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'malformed-event' }));
    expect(result.events.map((e) => e.id)).toEqual(['https://x.example#ok']);
  });

  it('fails at the source level when the body is not JSON', async () => {
    await expect(ingest('<html>nope</html>')).rejects.toThrow(/not valid JSON/);
  });

  it('fails at the source level when there is no events array', async () => {
    await expect(ingest(JSON.stringify({ title: 'x', events: 'nope' }))).rejects.toThrow(
      /no `events` array/,
    );
  });

  it('throws on an unreachable feed, so the pipeline can fall back to a snapshot', async () => {
    const failing = (async () =>
      new Response('', { status: 502, statusText: 'Bad Gateway' })) as typeof fetch;
    await expect(
      oteConnector.ingest(oteSource(), { fetch: failing, now: NOW, logger: silentLogger }),
    ).rejects.toThrow(/502/);
  });
});
