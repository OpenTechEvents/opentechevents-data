/**
 * Step [8] render — `feed.json`, the canonical output. Everything else derives from it.
 */
import type { OteEvent, OteFeed } from '../../ote/types.js';
import { SPEC_VERSION } from '../../ote/types.js';
import { FEED_LICENSE, FEED_LICENSE_URL } from '../../sources/gate.js';

export interface FeedMeta {
  title: string;
  description?: string;
  url?: string;
}

/**
 * A feed's `license` is the default for every event in it, so an event only carries its own
 * `license` when it differs from the feed's. Repeating `CC-BY-4.0` on every event would be
 * noise; dropping a `CC0-1.0` event's own license would be a lie.
 */
export function renderFeed(events: OteEvent[], meta: FeedMeta, now: Date): OteFeed {
  return {
    specVersion: SPEC_VERSION,
    title: meta.title,
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.url ? { url: meta.url } : {}),
    license: FEED_LICENSE,
    licenseUrl: FEED_LICENSE_URL,
    updatedAt: now.toISOString(),
    events: events.map(({ license, ...event }) =>
      license && license !== FEED_LICENSE ? { ...event, license } : event,
    ),
  };
}
