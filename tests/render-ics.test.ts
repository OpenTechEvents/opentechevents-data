import { describe, expect, it } from 'vitest';

import ICAL from 'ical.js';

import type { OteEvent, OteFeed } from '../src/ote/types.js';
import { renderIcs } from '../src/pipeline/render/ics.js';
import { NOW } from './helpers.js';

const feed = (events: OteEvent[]): OteFeed => ({
  specVersion: '0.1.0',
  title: 'OpenTechEvents',
  license: 'CC-BY-4.0',
  updatedAt: NOW.toISOString(),
  events,
});

const event = (overrides: Partial<OteEvent> = {}): OteEvent => ({
  id: 'https://rustmadrid.example/events.ics#a',
  name: 'Rust Madrid',
  timezone: 'Europe/Madrid',
  startDate: '2026-09-10T19:00:00',
  ...overrides,
});

/** Parse our own output back, so the assertions are about iCalendar, not about strings. */
function reparse(ics: string) {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  return calendar.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
}

describe('renderIcs', () => {
  it('round-trips through a real iCalendar parser', () => {
    const ics = renderIcs(feed([event()]), NOW);
    const [parsed] = reparse(ics);

    expect(parsed?.summary).toBe('Rust Madrid');
  });

  it('writes wall-clock + zone as an unambiguous UTC instant', () => {
    // 19:00 in Madrid in September is CEST (UTC+2). Emitting TZID + VTIMEZONE would also be
    // legal, but UTC is the form every calendar client on earth handles correctly.
    const ics = renderIcs(feed([event()]), NOW);

    expect(ics).toContain('DTSTART:20260910T170000Z');
  });

  it('respects DST when converting back out', () => {
    const ics = renderIcs(feed([event({ startDate: '2026-11-05T19:00:00' })]), NOW);

    expect(ics).toContain('DTSTART:20261105T180000Z'); // CET, UTC+1
  });

  it("restores iCalendar's exclusive all-day DTEND", () => {
    // OTE's endDate is the last day, inclusive. iCal's DTEND is the day after. A round trip
    // through the aggregator must not grow or shrink the event.
    const ics = renderIcs(feed([event({ startDate: '2026-09-18', endDate: '2026-09-20' })]), NOW);

    expect(ics).toContain('DTSTART;VALUE=DATE:20260918');
    expect(ics).toContain('DTEND;VALUE=DATE:20260921');
  });

  it('escapes the characters iCalendar treats as special', () => {
    const ics = renderIcs(
      feed([event({ name: 'Rust; Madrid, edición #1\\2', description: 'línea 1\nlínea 2' })]),
      NOW,
    );

    expect(ics).toContain('SUMMARY:Rust\\; Madrid\\, edición #1\\\\2');
    // And it survives a real parser, which is the assertion that actually matters.
    const [parsed] = reparse(ics);
    expect(parsed?.summary).toBe('Rust; Madrid, edición #1\\2');
  });

  it('folds long lines on codepoint boundaries, not mid-character', () => {
    // RFC 5545 folds at 75 OCTETS. Folding by character count would split an accented
    // letter or an emoji in half — and event titles are full of both.
    const name = `Ñandú ${'á'.repeat(100)} 🎉`;
    const ics = renderIcs(feed([event({ name })]), NOW);

    for (const line of ics.split('\r\n')) {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    }
    expect(reparse(ics)[0]?.summary).toBe(name);
  });

  it('carries the attribution CC-BY requires into the description', () => {
    const ics = renderIcs(
      feed([
        event({
          description: 'Charla sobre tokio.',
          source: { name: 'Rust Madrid', url: 'https://rustmadrid.example' },
        }),
      ]),
      NOW,
    );

    expect(reparse(ics)[0]?.description).toContain('Source: Rust Madrid — https://rustmadrid.example');
  });

  it('marks a cancelled event as CANCELLED rather than dropping it', () => {
    const ics = renderIcs(feed([event({ status: 'cancelled' })]), NOW);

    expect(ics).toContain('STATUS:CANCELLED');
  });

  it('uses CRLF line endings, as RFC 5545 requires', () => {
    const ics = renderIcs(feed([event()]), NOW);

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\n').every((line) => line === '' || line.endsWith('\r'))).toBe(true);
  });
});
