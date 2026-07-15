import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Logger } from '../src/connectors/types.js';
import type { Source } from '../src/sources/types.js';

/** Frozen clock. Every fixture is dated relative to this, so the suite never rots. */
export const NOW = new Date('2026-07-14T10:00:00Z');

export const silentLogger: Logger = { info: () => {}, warn: () => {} };

export function fixture(name: string): string {
  return readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');
}

/** A `fetch` that serves fixtures, so tests never touch the network. */
export function fakeFetch(routes: Record<string, string | Error>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const body = routes[url];
    if (body === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (body instanceof Error) throw body;
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

export function testSource(overrides: Partial<Source> = {}): Source {
  return {
    id: 'rust-madrid',
    type: 'ics',
    timezone: 'Europe/Madrid',
    config: { url: 'https://rustmadrid.example/events.ics' },
    license: 'CC-BY-4.0',
    attribution: { name: 'Rust Madrid', url: 'https://rustmadrid.example' },
    file: 'sources/rust-madrid.yml',
    dataLicense: 'CC-BY-4.0',
    originLicense: 'CC-BY-4.0',
    ...overrides,
  };
}
