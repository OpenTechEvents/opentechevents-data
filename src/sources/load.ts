/**
 * Step [1] discover — read and validate the source registry.
 *
 * One file per source (`sources/<id>.yml`), never one giant file: PRs don't conflict,
 * `git blame` works per source, and CI can validate only what changed.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { IANAZone } from 'luxon';
import { parse as parseYaml } from 'yaml';

import { createAjv } from '../ajv.js';
import { getConnector, type Connector } from '../connectors/registry.js';
import { LicenseGateError, passesLicenseGate } from './gate.js';
import type { Source, SourceFile } from './types.js';

const ajv = createAjv();

const sourceFileSchema = {
  type: 'object',
  required: ['id', 'type', 'timezone', 'config'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
    type: { type: 'string', minLength: 1 },
    enabled: { type: 'boolean' },
    timezone: { type: 'string', minLength: 1 },
    config: { type: 'object' },
    license: { type: 'string', minLength: 2 },
    attribution: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        url: { type: 'string', format: 'uri', pattern: '^https?://' },
      },
    },
    permission: {
      type: 'object',
      required: ['grantedBy', 'evidence'],
      additionalProperties: false,
      properties: {
        grantedBy: { type: 'string', minLength: 1 },
        evidence: { type: 'string', format: 'uri', pattern: '^https?://' },
      },
    },
    defaults: {
      type: 'object',
      additionalProperties: false,
      properties: {
        languages: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', pattern: '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$' },
        },
        attendanceMode: { enum: ['in-person', 'online', 'hybrid'] },
        tags: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const;

const validateSourceFile = ajv.compile(sourceFileSchema);

export class SourceError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
    this.name = 'SourceError';
  }
}

/** Parse and fully validate one source file, connector config included. */
export function parseSource(file: string, yaml: string): Source {
  let raw: unknown;
  try {
    raw = parseYaml(yaml);
  } catch (cause) {
    throw new SourceError(file, `not valid YAML: ${(cause as Error).message}`);
  }

  if (!validateSourceFile(raw)) {
    const details = (validateSourceFile.errors ?? [])
      .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
      .join('\n');
    throw new SourceError(file, `does not match the source schema:\n${details}`);
  }
  const source = raw as SourceFile;

  const expectedId = path.basename(file).replace(/\.ya?ml$/, '');
  if (source.id !== expectedId) {
    throw new SourceError(file, `id "${source.id}" must match the file name ("${expectedId}")`);
  }

  if (!IANAZone.isValidZone(source.timezone)) {
    throw new SourceError(file, `timezone "${source.timezone}" is not a valid IANA zone`);
  }

  let connector: Connector;
  try {
    connector = getConnector(source.type);
  } catch (cause) {
    throw new SourceError(file, (cause as Error).message);
  }

  const validateConfig = ajv.compile(connector.configSchema);
  if (!validateConfig(source.config)) {
    const details = (validateConfig.errors ?? [])
      .map((e) => `  config${e.instancePath} ${e.message}`)
      .join('\n');
    throw new SourceError(file, `config is not valid for connector "${source.type}":\n${details}`);
  }

  // The gate protects what gets PUBLISHED. A disabled source publishes nothing, so it may
  // sit in the registry before its license is confirmed — the pending state. It must still
  // clear the gate before it can be enabled, which is enforced here the moment enabled flips.
  const enabled = source.enabled !== false;
  if (!enabled) {
    return { ...source, file };
  }

  let gate;
  try {
    gate = passesLicenseGate(source);
  } catch (cause) {
    if (cause instanceof LicenseGateError) throw new SourceError(file, cause.message);
    throw cause;
  }

  return {
    ...source,
    file,
    dataLicense: gate.dataLicense,
    ...(gate.originLicense !== undefined ? { originLicense: gate.originLicense } : {}),
  };
}

/**
 * Load every source in `dir`. One bad file fails the whole load: the registry is written
 * by humans through reviewed PRs, so a broken file is a bug to fix, not a runtime
 * condition to absorb. (Unreachable sources at *fetch* time are a different story — that
 * is fail-soft, see `pipeline/run.ts`.)
 */
export async function loadSources(dir: string): Promise<Source[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const files = entries.filter((f) => /\.ya?ml$/.test(f)).sort();
  const sources = await Promise.all(
    files.map(async (f) => {
      const file = path.join(dir, f);
      return parseSource(file, await readFile(file, 'utf8'));
    }),
  );

  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.id)) throw new SourceError(s.file, `duplicate source id "${s.id}"`);
    seen.add(s.id);
  }

  return sources;
}
