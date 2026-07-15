/**
 * Entry point. Reads `sources/`, runs the pipeline, writes the published output.
 *
 *   npm run aggregate                    → writes out/
 *   npm run dry-run -- --source rust-madrid
 *                                        → ingests one source, writes nothing, prints what
 *                                          WOULD be published. This is what the PR bot runs.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import type { OteEvent } from './ote/types.js';
import { run } from './pipeline/run.js';
import { fileSnapshotStore } from './pipeline/snapshots.js';
import { loadSources } from './sources/load.js';

const FEED_TITLE = 'OpenTechEvents';
const FEED_DESCRIPTION = 'Tech community events, aggregated and published as open data.';
const FEED_HOME = 'https://opentechevents.org';
const FEED_ICS_URL = 'https://data.opentechevents.org/feed.ics';

// Logs go to stderr, never stdout: `--dry-run` writes the feed JSON to stdout, and a stray
// log line would corrupt it for whatever parses the preview.
const logger = {
  info: (message: string) => console.error(message),
  warn: (message: string) => console.error(`warning: ${message}`),
};

/**
 * The archive accumulates; it is not a snapshot of what the sources still remember.
 *
 * A `.ics` drops events once they are over, so an archive rebuilt from scratch on every run
 * would lose history as fast as it gained it. Past events are merged into what is already
 * published, and existing entries win: an event that has happened does not change.
 */
async function mergeArchive(
  outDir: string,
  year: string,
  incoming: OteEvent[],
): Promise<OteEvent[]> {
  const file = path.join(outDir, 'archive', `${year}.json`);

  let existing: OteEvent[] = [];
  try {
    const previous = JSON.parse(await readFile(file, 'utf8')) as { events?: OteEvent[] };
    existing = previous.events ?? [];
  } catch {
    // No archive for this year yet.
  }

  const byId = new Map(incoming.map((event) => [event.id, event]));
  for (const event of existing) byId.set(event.id, event);

  return [...byId.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      sources: { type: 'string', default: 'sources' },
      out: { type: 'string', default: 'out' },
      source: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const sourcesDir = values.sources!;
  const outDir = values.out!;
  const dryRun = values['dry-run']!;

  let sources = await loadSources(sourcesDir);

  if (values.source) {
    sources = sources.filter((s) => s.id === values.source);
    if (sources.length === 0) throw new Error(`no source with id "${values.source}"`);
  }

  if (sources.length === 0) {
    logger.info(`no sources in ${sourcesDir}/ — nothing to aggregate`);
  }

  const now = new Date();
  const result = await run({
    sources,
    // In a dry run nothing is written, so nothing is snapshotted either: a PR preview must
    // not be able to poison the published data with whatever the proposed source returned.
    snapshots: dryRun
      ? { load: async () => undefined, save: async () => {} }
      : fileSnapshotStore(path.join(outDir, 'raw')),
    meta: { title: FEED_TITLE, description: FEED_DESCRIPTION, url: FEED_HOME },
    feedUrl: FEED_ICS_URL,
    fetch,
    now,
    logger,
  });

  if (dryRun) {
    console.log(JSON.stringify({ feed: result.feed, report: result.report }, null, 2));
    return;
  }

  await writeJson(path.join(outDir, 'feed.json'), result.feed);
  await writeJson(path.join(outDir, 'report.json'), result.report);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'feed.ics'), result.ics, 'utf8');

  for (const [year, events] of result.archive) {
    const merged = await mergeArchive(outDir, year, events);
    await writeJson(path.join(outDir, 'archive', `${year}.json`), {
      specVersion: result.feed.specVersion,
      title: `${FEED_TITLE} — archive ${year}`,
      license: result.feed.license,
      licenseUrl: result.feed.licenseUrl,
      updatedAt: result.feed.updatedAt,
      events: merged,
    });
  }

  logger.info(`wrote ${outDir}/feed.json, ${outDir}/feed.ics, ${outDir}/report.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
