import { icsConnector } from './ics/index.js';
import { oteConnector } from './ote/index.js';
import type { Connector } from './types.js';

/**
 * Adding a format = a new file + one line here + its fixtures. The core is not touched.
 *
 * Connectors live in this repo on purpose, and it is not up for debate again: the daily
 * Action runs with a token that writes to the repo, so cloning and running third-party
 * code at HEAD would be remote code execution with write access to the data.
 */
const connectors: ReadonlyMap<string, Connector> = new Map(
  [icsConnector, oteConnector].map((connector) => [connector.type, connector]),
);

export function getConnector(type: string): Connector {
  const connector = connectors.get(type);
  if (!connector) {
    const known = [...connectors.keys()].join(', ');
    throw new Error(`unknown connector type "${type}". Known types: ${known}`);
  }
  return connector;
}

export type { Connector } from './types.js';
