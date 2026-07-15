import { describe, expect, it } from 'vitest';

import { dedupe } from '../src/pipeline/dedupe.js';
import { partition } from '../src/pipeline/partition.js';
import { run } from '../src/pipeline/run.js';
import { memorySnapshotStore } from '../src/pipeline/snapshots.js';
import { validateFeed } from '../src/ote/validate.js';
import type { OteEvent } from '../src/ote/types.js';
import { fakeFetch, fixture, NOW, silentLogger, testSource } from './helpers.js';

const event = (overrides: Partial<OteEvent> = {}): OteEvent => ({
  id: 'https://example.org/events.ics#a',
  name: 'Event',
  timezone: 'Europe/Madrid',
  startDate: '2026-09-10T19:00:00',
  ...overrides,
});

const meta = { title: 'OpenTechEvents' };

describe('dedupe', () => {
  it('drops exact-id duplicates and keeps the first', () => {
    const result = dedupe([
      event({ id: 'x', name: 'first' }),
      event({ id: 'x', name: 'second' }),
      event({ id: 'y' }),
    ]);

    expect(result.events.map((e) => e.name)).toEqual(['first', 'Event']);
    expect(result.duplicates).toBe(1);
  });
});

describe('partition', () => {
  it('keeps an event in the feed until it has ENDED, not until it has started', () => {
    // A three-day conference on its second morning is still happening. The naive
    // `startDate >= today` rule would make it vanish from subscribers' calendars mid-event.
    const ongoing = event({
      id: 'ongoing',
      startDate: '2026-07-13T09:00:00',
      endDate: '2026-07-16T18:00:00',
    });

    const { upcoming, archived } = partition([ongoing], NOW);

    expect(upcoming.map((e) => e.id)).toEqual(['ongoing']);
    expect(archived.size).toBe(0);
  });

  it('archives an event once it is over, filed under the year it started', () => {
    const past = event({ id: 'past', startDate: '2026-03-05T19:00:00' });

    const { upcoming, archived } = partition([past], NOW);

    expect(upcoming).toEqual([]);
    expect(archived.get('2026')?.map((e) => e.id)).toEqual(['past']);
  });

  it('keeps an all-day event through the end of its day', () => {
    const today = event({ id: 'today', startDate: '2026-07-14' });

    const { upcoming } = partition([today], NOW);

    expect(upcoming.map((e) => e.id)).toEqual(['today']);
  });

  it('sorts upcoming events soonest first', () => {
    const { upcoming } = partition(
      [
        event({ id: 'later', startDate: '2026-10-01T19:00:00' }),
        event({ id: 'sooner', startDate: '2026-08-01T19:00:00' }),
      ],
      NOW,
    );

    expect(upcoming.map((e) => e.id)).toEqual(['sooner', 'later']);
  });
});

describe('the pipeline, end to end', () => {
  const source = testSource();
  const url = String(source.config['url']);

  it('publishes a feed that validates against the published OTE schema', async () => {
    const result = await run({
      sources: [source],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(validateFeed(result.feed)).toMatchObject({ valid: true });
    expect(result.feed.license).toBe('CC-BY-4.0');
    expect(result.feed.updatedAt).toBe(NOW.toISOString());
  });

  it('puts future events in the feed and past ones in the archive', async () => {
    const result = await run({
      sources: [source],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(result.feed.events.map((e) => e.name)).toEqual([
      'Rust Madrid — Async runtimes',
      'Rust Madrid — Online office hours',
      'Rust Madrid — Taller de la comunidad',
      'Rust Madrid — Meetup con sala física y enlace automático',
      'Rust Madrid — Sesión cancelada',
    ]);
    expect(result.archive.get('2026')?.map((e) => e.name)).toEqual([
      'Rust Madrid — Sesión ya pasada',
    ]);
  });

  it('omits an event license that merely repeats the feed license', async () => {
    const result = await run({
      sources: [source],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    });

    // The feed's license IS the default for its events; repeating CC-BY-4.0 on every one of
    // them is noise.
    expect(result.feed.events.every((e) => e.license === undefined)).toBe(true);
  });

  it("keeps an event's own license when it differs from the feed's", async () => {
    const cc0 = testSource({ license: 'CC0-1.0', dataLicense: 'CC0-1.0', originLicense: 'CC0-1.0' });

    const result = await run({
      sources: [cc0],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(result.feed.events.every((e) => e.license === 'CC0-1.0')).toBe(true);
  });

  it("carries each source's name and url into its report entry", async () => {
    // The landing lists sources from report.json, so it needs a readable name and homepage,
    // not just the slug. Attribution flows through; when it is absent, name falls back to id.
    const { attribution: _omit, ...anon } = testSource({ id: 'anon' });

    const result = await run({
      sources: [source, anon],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(result.report.sources.find((s) => s.id === 'rust-madrid')).toMatchObject({
      name: 'Rust Madrid',
      url: 'https://rustmadrid.example',
    });
    const anonReport = result.report.sources.find((s) => s.id === 'anon');
    expect(anonReport?.name).toBe('anon');
    expect(anonReport?.url).toBeUndefined();
  });

  it('is idempotent: running twice produces the same ids', async () => {
    // If ids were not stable, every daily run would duplicate the entire feed. This is the
    // condition for an aggregator to exist at all.
    const options = {
      sources: [source],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({ [url]: fixture('rust-madrid.ics') }),
      now: NOW,
      logger: silentLogger,
    };

    const first = await run(options);
    const second = await run(options);

    expect(second.feed.events.map((e) => e.id)).toEqual(first.feed.events.map((e) => e.id));
    expect(second.report.totals.duplicates).toBe(0);
  });
});

describe('the pipeline, when a source is down', () => {
  const source = testSource();
  const url = String(source.config['url']);

  it('serves the last good snapshot and carries on', async () => {
    const snapshots = memorySnapshotStore({ 'rust-madrid': fixture('rust-madrid.ics') });

    const result = await run({
      sources: [source],
      snapshots,
      meta,
      fetch: fakeFetch({ [url]: new Error('ECONNREFUSED') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(result.feed.events).toHaveLength(5);
    expect(result.report.sources[0]).toMatchObject({
      ok: true,
      servedFromSnapshot: { reason: 'ECONNREFUSED' },
    });
  });

  it('reports the failure and still publishes the other sources', async () => {
    // Fail-soft per source, never all-or-nothing: one broken .ics cannot take the feed down.
    const healthy = testSource({
      id: 'edge',
      config: { url: 'https://edge.example/events.ics' },
    });

    const result = await run({
      sources: [source, healthy],
      snapshots: memorySnapshotStore(),
      meta,
      fetch: fakeFetch({
        [url]: new Error('ECONNREFUSED'),
        'https://edge.example/events.ics': fixture('edge-cases.ics'),
      }),
      now: NOW,
      logger: silentLogger,
    });

    expect(result.report.totals.sourcesFailed).toBe(1);
    expect(result.report.sources.find((s) => s.id === 'rust-madrid')).toMatchObject({
      ok: false,
      failure: 'ECONNREFUSED',
    });
    expect(result.feed.events.length).toBeGreaterThan(0);
  });

  it('does not snapshot a failed fetch over a good one', async () => {
    const snapshots = memorySnapshotStore({ 'rust-madrid': fixture('rust-madrid.ics') });

    await run({
      sources: [source],
      snapshots,
      meta,
      fetch: fakeFetch({ [url]: new Error('500 Internal Server Error') }),
      now: NOW,
      logger: silentLogger,
    });

    expect(await snapshots.load('rust-madrid')).toBe(fixture('rust-madrid.ics'));
  });
});
