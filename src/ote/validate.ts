/**
 * Validation against the OTE JSON Schema — the dogfooding step.
 *
 * The schemas come from the published `@opentechevents/schema` package, never from a
 * private copy: if the aggregator can only validate against its own fork of the spec,
 * it is not really implementing the spec.
 */
import { eventSchema, feedSchema } from '@opentechevents/schema';

import { createAjv, type ErrorObject, type ValidateFunction } from '../ajv.js';
import type { OteEvent, OteFeed } from './types.js';

const EVENT_SCHEMA_ID = 'https://opentechevents.org/schema/v0.2/event.schema.json';

const ajv = createAjv();

// Order matters: the feed schema $refs the event schema by $id, so the event goes in first.
ajv.addSchema(eventSchema);
ajv.addSchema(feedSchema);

/**
 * An event AS IT APPEARS INSIDE A FEED, which is the only shape the aggregator emits.
 * The top-level event schema additionally requires `specVersion` and `license`; inside a
 * feed both are inherited, so validating against that would reject every event we produce.
 */
const validateFeedEventFn: ValidateFunction = ajv.compile({
  $ref: `${EVENT_SCHEMA_ID}#/$defs/event`,
});

const validateFeedFn: ValidateFunction = ajv.getSchema(
  'https://opentechevents.org/schema/v0.2/feed.schema.json',
)!;

/** A schema violation, flattened to something a human can act on. */
export interface SchemaViolation {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; violations: SchemaViolation[] };

function flatten(errors: ErrorObject[] | null | undefined): SchemaViolation[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'is invalid'}${
      e.keyword === 'additionalProperties' ? ` (${JSON.stringify(e.params)})` : ''
    }`,
  }));
}

export function validateEvent(candidate: unknown): ValidationResult<OteEvent> {
  if (validateFeedEventFn(candidate)) return { valid: true, value: candidate as OteEvent };
  return { valid: false, violations: flatten(validateFeedEventFn.errors) };
}

export function validateFeed(candidate: unknown): ValidationResult<OteFeed> {
  if (validateFeedFn(candidate)) return { valid: true, value: candidate as OteFeed };
  return { valid: false, violations: flatten(validateFeedFn.errors) };
}
