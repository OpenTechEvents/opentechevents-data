import { describe, expect, it } from 'vitest';

import { icsConnector } from '../src/connectors/ics/index.js';
import type { IngestResult } from '../src/connectors/types.js';
import { validateEvent } from '../src/ote/validate.js';
import type { Source } from '../src/sources/types.js';
import { fakeFetch, fixture, NOW, silentLogger, testSource } from './helpers.js';

const URL_ICS = 'https://rustmadrid.example/events.ics';

async function ingest(file: string, source: Source = testSource()): Promise<IngestResult> {
  return icsConnector.ingest(source, {
    fetch: fakeFetch({ [String(source.config['url'])]: fixture(file) }),
    now: NOW,
    logger: silentLogger,
  });
}

const byId = (result: IngestResult, id: string) =>
  result.events.find((event) => event.id === `${URL_ICS}#${encodeURIComponent(id)}`);

describe('the ics connector', () => {
  it('produces events that validate against the published OTE schema', async () => {
    const result = await ingest('rust-madrid.ics');

    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(validateEvent(event), `event ${event.id} must validate`).toMatchObject({
        valid: true,
      });
    }
  });

  it('maps a VEVENT with a physical venue to an in-person event', async () => {
    const event = byId(await ingest('rust-madrid.ics'), 'in-person@rustmadrid.example');

    expect(event).toMatchObject({
      name: 'Rust Madrid — Async runtimes',
      startDate: '2026-09-10T19:00:00',
      endDate: '2026-09-10T21:00:00',
      timezone: 'Europe/Madrid',
      url: 'https://rustmadrid.example/events/async',
      attendanceMode: 'in-person',
      status: 'scheduled',
      location: { venue: 'Campus Madrid, Calle Moreno Nieto 2' },
      // CATEGORIES → tags (case preserved), LAST-MODIFIED → updatedAt.
      tags: ['rust', 'async'],
      updatedAt: '2026-07-01T10:00:00.000Z',
      license: 'CC-BY-4.0',
      source: {
        name: 'Rust Madrid',
        url: 'https://rustmadrid.example',
        license: 'CC-BY-4.0',
        retrievedAt: NOW.toISOString(),
      },
    });
  });

  it('strips the HTML that DESCRIPTION routinely carries', async () => {
    const event = byId(await ingest('rust-madrid.ics'), 'in-person@rustmadrid.example');

    expect(event?.description).toBe('Charla sobre tokio.\n\nApúntate aquí: https://example.org/x');
  });

  it('maps a room link with no venue to an online event', async () => {
    const event = byId(await ingest('rust-madrid.ics'), 'online@rustmadrid.example');

    expect(event).toMatchObject({
      attendanceMode: 'online',
      // 17:00Z rendered in the source's declared zone, which is the whole point.
      startDate: '2026-09-17T19:00:00',
      timezone: 'Europe/Madrid',
      location: { onlineUrl: 'https://meet.google.com/abc-defg-hij' },
    });
    expect(event?.location?.venue).toBeUndefined();
  });

  it('omits attendanceMode when a venue AND a room link are both present', async () => {
    // Google Calendar attaches a Meet link automatically. The organiser set up an in-person
    // meetup and touched nothing; a default checkbox made it look hybrid. The .ics does not
    // contain the information that tells this apart from a real hybrid, so we do not assert.
    const result = await ingest('rust-madrid.ics');
    const event = byId(result, 'ambiguous@rustmadrid.example');

    expect(event?.attendanceMode).toBeUndefined();
    expect(event?.location).toEqual({
      venue: 'Campus Madrid, Calle Moreno Nieto 2',
      onlineUrl: 'https://meet.google.com/zzz-yyyy-xxx',
    });

    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'unknown-attendance-mode', eventName: event?.name }),
    );
  });

  it("lets the source's declared attendanceMode beat the inference", async () => {
    // The organiser registering the source knows their meetup is hybrid. The parser does not.
    const source = testSource({ defaults: { attendanceMode: 'hybrid' } });
    const event = byId(await ingest('rust-madrid.ics', source), 'ambiguous@rustmadrid.example');

    expect(event?.attendanceMode).toBe('hybrid');
  });

  it('keeps a cancelled event, rather than dropping it', async () => {
    // Removing it would leave a dead event sitting in every subscriber's calendar.
    const event = byId(await ingest('rust-madrid.ics'), 'cancelled@rustmadrid.example');

    expect(event?.status).toBe('cancelled');
  });

  it('no longer reports tags/updatedAt/geo as spec gaps: v0.2 maps them', async () => {
    const result = await ingest('rust-madrid.ics');

    const codes = result.warnings.map((w) => w.code);
    expect(codes).not.toContain('spec-gap:tags');
    expect(codes).not.toContain('spec-gap:event-updatedAt');
    expect(codes).not.toContain('spec-gap:venue-geo');
  });

  it('merges defaults.tags into the event tags, deduped', async () => {
    const source = testSource({ defaults: { tags: ['rust', 'madrid'] } });
    const event = byId(await ingest('rust-madrid.ics', source), 'in-person@rustmadrid.example');

    // CATEGORIES [rust, async] ∪ defaults [rust, madrid] — 'rust' not doubled.
    expect(event?.tags).toEqual(['rust', 'async', 'madrid']);
  });

  it('falls back to #hashtags in the description when there are no CATEGORIES (Google Calendar)', async () => {
    const event = byId(await ingest('rust-madrid.ics'), 'gcal-hashtags@rustmadrid.example');

    // Lowercased and deduped; the '#seccion' inside the URL is left alone (no space before '#').
    expect(event?.tags).toEqual(['rust', 'webassembly', 'async']);
    // The hashtags stay in the description — we read them, we do not strip them.
    expect(event?.description).toContain('#Rust');
  });

  it('takes updatedAt from DTSTAMP when LAST-MODIFIED is absent, and warns it is noisy', async () => {
    const result = await ingest('rust-madrid.ics');
    const event = byId(result, 'gcal-hashtags@rustmadrid.example');

    expect(event?.updatedAt).toBe('2026-07-10T08:00:00.000Z');
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'updatedAt-from-dtstamp', eventId: event?.id }),
    );
  });

  it('leaves updatedAt unset, without warning, when neither LAST-MODIFIED nor DTSTAMP exist', async () => {
    const result = await ingest('rust-madrid.ics');
    const event = byId(result, 'online@rustmadrid.example');

    expect(event?.updatedAt).toBeUndefined();
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'updatedAt-from-dtstamp', eventId: event?.id }),
    );
  });
});

describe('the ics connector, on the hard cases', () => {
  const edgeSource = testSource({
    id: 'edge',
    config: { url: 'https://edge.example/events.ics' },
  });
  const edgeUrl = 'https://edge.example/events.ics';
  const edgeId = (uid: string) => `${edgeUrl}#${encodeURIComponent(uid)}`;

  it("converts iCalendar's exclusive all-day DTEND into an inclusive endDate", async () => {
    // DTSTART=18th, DTEND=21st in iCal means the event runs through the 20th. Copying DTEND
    // straight across would add a phantom day to every all-day event in the feed.
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('allday@example.org'));

    expect(event).toMatchObject({ startDate: '2026-09-18', endDate: '2026-09-20' });
  });

  it('maps GEO to location.geo as decimal-degree floats, alongside the venue', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('allday@example.org'));

    expect(event?.location).toEqual({
      venue: 'Palacio de Congresos',
      geo: { lat: 40.4168, lon: -3.7038 },
    });
  });

  it('omits endDate for a single all-day event instead of repeating the start', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('allday-single@example.org'));

    expect(event?.startDate).toBe('2026-10-03');
    expect(event?.endDate).toBeUndefined();
  });

  it('honours a TZID even when the file ships no VTIMEZONE for it', async () => {
    // ical.js silently falls back to floating time here. Reading the raw TZID parameter is
    // what keeps a very common real-world .ics from drifting by an hour.
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('tzid-sin-vtimezone@example.org'));

    expect(event).toMatchObject({
      startDate: '2026-09-20T19:00:00',
      timezone: 'Europe/Madrid',
    });
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'floating-time', eventName: event?.name }),
    );
  });

  it('adopts the source zone for a floating time, and warns that it did', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('floating@example.org'));

    expect(event).toMatchObject({
      startDate: '2026-09-19T18:30:00',
      timezone: 'Europe/Madrid',
    });
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'floating-time', eventName: 'Evento con hora flotante' }),
    );
  });

  it('resolves DURATION into an endDate', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('location-es-url@example.org'));

    expect(event).toMatchObject({
      startDate: '2026-09-22T18:00:00', // 16:00Z in CEST
      endDate: '2026-09-22T19:30:00',
    });
  });

  it('treats a LOCATION that parses as a URL as online access, not a venue', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.id === edgeId('location-es-url@example.org'));

    expect(event?.location).toEqual({ onlineUrl: 'https://zoom.example/j/12345' });
    expect(event?.attendanceMode).toBe('online');
  });

  it('derives an id from the content when the VEVENT has no UID, and warns', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);
    const event = result.events.find((e) => e.name === 'Evento sin UID');

    expect(event?.id).toMatch(/^https:\/\/edge\.example\/events\.ics#[0-9a-f]{16}$/);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'missing-uid', eventName: 'Evento sin UID' }),
    );
  });

  it('drops an event with no SUMMARY and reports why', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);

    expect(result.events.find((e) => e.id === edgeId('sin-summary@example.org'))).toBeUndefined();
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'missing-name' }));
  });

  it('skips a VEVENT with no DTSTART: it is not an event', async () => {
    const result = await ingest('edge-cases.ics', edgeSource);

    expect(result.events.find((e) => e.name === 'Evento sin fecha de inicio')).toBeUndefined();
  });
});

describe('the ics connector, on recurrence', () => {
  const source = testSource({
    id: 'recurring',
    config: { url: 'https://recurring.example/events.ics' },
  });

  it('expands an RRULE into one event per occurrence, each with its own id', async () => {
    // Recurrence is resolved at ingest and never reaches the feed: OTE is one document =
    // one event.
    const result = await ingest('recurring.ics', source);
    const starts = result.events.map((e) => e.startDate).sort();

    // COUNT=6 from 2026-08-05 monthly, minus the EXDATE on 2026-09-05.
    expect(starts).toEqual([
      '2026-08-05T19:00:00',
      '2026-10-05T20:00:00', // RECURRENCE-ID override moved this one to 20:00
      '2026-11-05T19:00:00',
      '2026-12-05T19:00:00',
      '2027-01-05T19:00:00',
    ]);

    expect(new Set(result.events.map((e) => e.id)).size).toBe(result.events.length);
  });

  it('honours EXDATE', async () => {
    const result = await ingest('recurring.ics', source);

    expect(result.events.some((e) => e.startDate.startsWith('2026-09-05'))).toBe(false);
  });

  it('honours a RECURRENCE-ID override', async () => {
    const result = await ingest('recurring.ics', source);
    const overridden = result.events.find((e) => e.startDate.startsWith('2026-10-05'));

    expect(overridden).toMatchObject({
      name: 'Meetup mensual — edición especial',
      startDate: '2026-10-05T20:00:00',
      location: { venue: 'Sede alternativa' },
    });
  });
});
