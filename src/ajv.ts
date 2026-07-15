/**
 * One configured ajv, shared by every validator in the project.
 *
 * The interop dance below is not decoration: `ajv` and `ajv-formats` are CommonJS packages
 * with no `exports` map, so under Node's ESM resolution the default import lands on the
 * `module.exports` object rather than on the class itself. Importing them "normally" from
 * an ESM/NodeNext project type-checks and then explodes at runtime with
 * "Ajv2020 is not a constructor".
 */
import ajvModule from 'ajv/dist/2020.js';
import ajvFormatsModule from 'ajv-formats';

type AjvConstructor = typeof ajvModule.default;
type AddFormats = typeof ajvFormatsModule.default;

const Ajv2020 = ((ajvModule as unknown as { default?: AjvConstructor }).default ??
  ajvModule) as AjvConstructor;

const addFormats = ((ajvFormatsModule as unknown as { default?: AddFormats }).default ??
  ajvFormatsModule) as AddFormats;

export type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';

/**
 * `strict: false` because the OTE schemas are published for the world, not for ajv: they
 * legitimately use keywords ajv's strict mode nags about. `allErrors` so a bad event
 * reports everything wrong with it at once, rather than one problem per run.
 */
export function createAjv(): InstanceType<AjvConstructor> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}
