/**
 * Resilience: one source being down cannot take the feed down.
 *
 * Every successful fetch is snapshotted. When a fetch fails, the last good snapshot is
 * served in its place, the fact is recorded in `report.json`, and the run carries on.
 * Ingestion is fail-soft PER SOURCE, never all-or-nothing.
 *
 * The snapshots live in the published output and are therefore committed to the `data`
 * branch, which is what makes them survive between runs on ephemeral CI machines.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SnapshotStore {
  load(sourceId: string): Promise<string | undefined>;
  save(sourceId: string, body: string): Promise<void>;
}

export function fileSnapshotStore(dir: string): SnapshotStore {
  const file = (sourceId: string) => path.join(dir, `${sourceId}.raw`);

  return {
    async load(sourceId) {
      try {
        return await readFile(file(sourceId), 'utf8');
      } catch {
        return undefined;
      }
    },
    async save(sourceId, body) {
      await mkdir(dir, { recursive: true });
      await writeFile(file(sourceId), body, 'utf8');
    },
  };
}

/** In-memory store, for tests. */
export function memorySnapshotStore(initial: Record<string, string> = {}): SnapshotStore {
  const store = new Map(Object.entries(initial));
  return {
    async load(sourceId) {
      return store.get(sourceId);
    },
    async save(sourceId, body) {
      store.set(sourceId, body);
    },
  };
}

export interface ResilientFetch {
  fetch: typeof fetch;
  /** Set when the network failed and a snapshot was served instead. */
  fallback(): { reason: string } | undefined;
}

/**
 * Wraps `fetch` so the connector never has to think about any of this: it asks for a URL
 * and gets a body, whether that body came from the network a second ago or from the last
 * run that worked.
 */
export function resilientFetch(
  sourceId: string,
  store: SnapshotStore,
  underlying: typeof fetch,
): ResilientFetch {
  let fallback: { reason: string } | undefined;

  const wrapped: typeof fetch = async (input, init) => {
    try {
      const response = await underlying(input, init);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const body = await response.text();
      await store.save(sourceId, body);
      return new Response(body, { status: 200 });
    } catch (cause) {
      const snapshot = await store.load(sourceId);
      if (snapshot === undefined) throw cause;

      fallback = { reason: (cause as Error).message };
      return new Response(snapshot, { status: 200 });
    }
  };

  return { fetch: wrapped, fallback: () => fallback };
}
