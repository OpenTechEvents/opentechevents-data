/**
 * Identity — the critical point.
 *
 * Without a stable `id`, every daily run duplicates the entire feed. It is not a nicety:
 * it is the condition for an aggregator to exist at all.
 *
 * The id is a global URI, stable across runs, minted with no central registry — which is
 * the spec's decentralised identity principle applied literally.
 */
import { createHash } from 'node:crypto';

/** The `.ics` URL, minus any fragment, so the fragment we append is the only one. */
function base(sourceUrl: string): string {
  const hash = sourceUrl.indexOf('#');
  return hash === -1 ? sourceUrl : sourceUrl.slice(0, hash);
}

export interface IdentityInput {
  /** URL of the `.ics` the event came from. */
  sourceUrl: string;
  /** `UID` of the VEVENT, when it has one. */
  uid?: string;
  /** Occurrence start, for events expanded from an `RRULE`. */
  recurrenceId?: string;
  /** Fallback material, used only when there is no `UID`. */
  name: string;
  startDate: string;
}

/**
 * `sourceUrl#UID` when the VEVENT carries a UID — which is what iCalendar's own identity
 * is for, and it survives the event being edited upstream.
 *
 * `sourceUrl#sha256(name|startDate)` when it does not. This is weaker on purpose: it is a
 * content hash, so renaming the event upstream mints a new id and the old one drops out of
 * the feed. That is a known limitation of sources that omit UID, not something to paper over.
 *
 * Expanded occurrences get the occurrence start appended, which is iCalendar's own
 * `RECURRENCE-ID` idea: same series, different event.
 */
export function mintId(input: IdentityInput): string {
  const { sourceUrl, uid, recurrenceId, name, startDate } = input;

  const local = uid
    ? encodeURIComponent(uid)
    : createHash('sha256').update(`${name}|${startDate}`).digest('hex').slice(0, 16);

  const occurrence = recurrenceId ? `:${encodeURIComponent(recurrenceId)}` : '';

  return `${base(sourceUrl)}#${local}${occurrence}`;
}
