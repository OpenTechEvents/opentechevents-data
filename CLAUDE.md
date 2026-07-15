# CLAUDE.md

Guide for working in this repo. The full design, with the reasoning behind each decision, is in [aggregator.md](aggregator.md) — read it before an architecture change.

## What it is

Aggregator for [OpenTechEvents](https://opentechevents.org/): ingests events from external sources, normalizes them to **OTE Spec**, and publishes a subscribable feed. It is the standard's reference implementation and its test bench — if the data model can't support a real ingestion, the model is wrong.

## Commands

```bash
npm test            # vitest, no network (fetch and now injected). Run it before assuming a change works.
npm run check       # typecheck (tsc --noEmit). Must be clean.
npm run aggregate   # full pipeline → out/
npm run dry-run -- --source <id>   # ingest one source without writing anything (what the PR bot runs)
```

Node ≥ 22. `npm test -- <file>` for a single test.

## Architecture

Deterministic pipeline, each step pure and testable in isolation:

```
sources/*.yml → discover → [fetch → parse → normalize] → validate → dedupe → partition → render → publish
                            └──── this is what the connector provides ────┘ └──── common to every format ────┘
```

- [src/sources/](src/sources/) — loads and validates `sources/*.yml` ([load.ts](src/sources/load.ts)) + license gate ([gate.ts](src/sources/gate.ts)).
- [src/connectors/](src/connectors/) — interface + registry. Connectors: `ics` (iCalendar), `ote` (existing OTE feed).
- [src/ote/](src/ote/) — types + ajv validation against `@opentechevents/schema` (npm, not a local copy).
- [src/pipeline/](src/pipeline/) — validate → dedupe → partition → render (`feed.json`, `feed.ics`) → report.
- [src/cli.ts](src/cli.ts) — entry point; writes `out/`.

**`feed.json` is canonical**; `.ics` and the rest derive from it (never from the raw sources).

## Adding a connector

A new format = a file in `src/connectors/<type>/` implementing `Connector` ([types.ts](src/connectors/types.ts)) + a line in [registry.ts](src/connectors/registry.ts) + fixtures and a test. **The core (validate → render) is not touched.** References: `ics/` (full mapping), `ote/` (near-identity).

## Invariants — do not break

- **A connector never invents data.** If a datum is missing, it degrades with a *warning* and is counted in `report.json`; it is not guessed.
- **Never throws on a broken event.** It accumulates per-event errors/warnings in `IngestResult`. It MAY throw if the source is unreachable → the pipeline falls back to the last good snapshot (fail-soft per source, never all-or-nothing).
- **Stable, global `id`.** Without it, each run duplicates the feed. Do not re-mint an `id` that already exists (see [ics/identity.ts](src/connectors/ics/identity.ts); `ote` preserves the upstream verbatim).
- **License gate.** Only what has an open license in the allowlist (`CC0-1.0`, `CC-BY-4.0`) or explicit permission enters. No share-alike/NC/ND. See [gate.ts](src/sources/gate.ts).
- **Determinism.** Connectors receive `fetch` and `now` via `Ctx`, never the globals — so tests run without network and with a frozen clock.
- **Dogfooding.** Validated against the JSON Schema published on npm, never a private copy. The schema wins: if the TS types and the schema disagree, the schema is right.

## Tests

vitest with fixtures in `tests/fixtures/`. Clock frozen at `NOW` ([helpers.ts](tests/helpers.ts)); the fixtures' dates are relative to it. **No network**: use `fakeFetch` with paths to fixtures, don't go out to the internet. A behaviour change carries its test.

## Conventions

- Comments, names, and repo documentation (README, issue forms, `sources/README.md`) are in **English**. The only exception is the landing page under [web/](web/), which is intentionally bilingual (EN/ES). (`aggregator.md` is still in Spanish, pending translation.)
- One YAML file per source (`sources/<id>.yml`); the `id` = file name.
- The published output lives on the `data` branch (only the bot writes it), never on `main`.
- `git commit`/`push` only if the user asks.
