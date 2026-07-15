# Contributing to OpenTechEvents — data

Thanks for wanting to help. There are three ways to contribute, from least to most technical:

1. **Register your community as a source** — no coding required. See [README → For event organisers](README.md#for-event-organisers).
2. **Give feedback** — we're in an early phase. What breaks, what's missing, what you'd need to consume the data. [Open an issue](../../issues/new/choose) or a [discussion](../../discussions).
3. **Touch code** — fix the `.ics` connector, improve the pipeline, or add a new importer. The rest of this document is about that.

The full design, with the reasoning behind each decision, is in **[aggregator.md](aggregator.md)**. Read it before a big change: almost any "why is it done this way?" is answered there.

---

## Getting the project up

Requires **Node ≥ 22**.

```bash
npm install
npm test            # tests, no network (fetch and now are injected → deterministic)
npm run check       # typecheck (tsc --noEmit)
npm run aggregate   # runs the full pipeline → out/
npm run dry-run -- --source <id>   # ingest a single source without writing anything
```

`npm run dry-run` is what the bot runs on every source-registration PR: it ingests, validates, and shows what would be published, without touching data or snapshots.

---

## How it's organised

```
src/
  ote/          OTE types + ajv validation against @opentechevents/schema (from npm, not a local copy)
  sources/      sources/*.yml registry + license gate (open data gate)
  connectors/   Connector interface + registry; ics/ is the only MVP connector
  pipeline/     validate → dedupe → partition → render (feed.json, feed.ics) → report
  cli.ts        Entry point
tests/          vitest + .ics fixtures
sources/        The source registry (one .yml per source)
```

The pipeline is deterministic and every step is pure and testable in isolation:

```
sources/*.yml → discover → fetch → parse → normalize → validate → dedupe → partition → render → publish
                          └──── this is what the connector provides ────┘ └──── common to every format ────┘
```

The **fetch → parse → normalize** steps are the only thing a connector provides. Everything else (validate → render) is common and **is not touched when adding a source or a new format**. That is the maintainability trick.

---

## Adding a connector (a new importer)

A new format (JSON-LD, Meetup, another OTE feed…) is:

1. A file in `src/connectors/<type>/` that implements the `Connector` interface (see [`src/connectors/types.ts`](src/connectors/types.ts) and the `ics/` connector as a reference).
2. A line registering it in [`src/connectors/registry.ts`](src/connectors/registry.ts).
3. Its fixtures and tests in `tests/`.

Rules every connector follows:

- **Never throws.** It accumulates per-event errors and warnings in the `IngestResult`; a broken event is a `report.json` entry, not a crash.
- **Never invents data.** If a datum is missing, it degrades with a *warning*; it does not guess. (The timezone case in `.ics` is documented in detail in [aggregator.md](aggregator.md#zona-horaria-el-punto-duro).)
- **`fetch` and `now` are received via `Ctx`**, never the globals — so tests run without network and with a frozen clock.

---

## Editing the source registry by hand

Sources are normally registered through the [form](../../issues/new/choose), but a `sources/<id>.yml` can be edited by hand. Format and rules: [`sources/README.md`](sources/README.md).

CI rejects a `sources/*.yml` that does not validate against the connector's schema **or** that does not pass the [license gate](aggregator.md#puerta-de-licencia-open-data-gate). Without a `license` in the allowlist (`CC0-1.0`, `CC-BY-4.0`) or a `permission` block that links the organiser's grant, the source does not enter. This is non-negotiable: it is what makes the feed genuinely open data.

---

## Before opening a PR

- `npm run check` and `npm test` green.
- A behaviour change carries its test. Tests run without network: use `.ics` fixtures and inject `fetch`/`now`, don't go out to the internet.
- If you touch the connector or the pipeline, verify with `npm run dry-run` against a real source or fixture.
- If your change uncovers a gap in the OTE spec, tell us — the value of this repo is precisely finding those gaps with evidence (see [aggregator.md → What this demands of the spec](aggregator.md#lo-que-esto-le-exige-a-la-spec)).

---

## License of contributions

The code is published under **MIT**; by contributing you accept that your contribution is licensed the same. The feed data is under **CC-BY-4.0** (see [README → Licensing](README.md#licensing)).
