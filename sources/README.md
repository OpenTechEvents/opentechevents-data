# `sources/` — the source registry

One YAML file per source, `sources/<id>.yml`. The `id` **must** match the file name.

Each file declares where the events come from (`config.url`), which timezone they happen in (`timezone`, required), and under what rights they can be republished (`license` **or** `permission`). CI validates each file against the schema and against the [license gate](../aggregator.md#puerta-de-licencia-open-data-gate), and on every PR runs a *dry-run* that comments how many events would enter.

Normally you don't edit these files by hand: they are opened from the [source registration Issue Form](https://github.com/OpenTechEvents/opentechevents-data/issues/new/choose).

Minimal example:

```yaml
id: rust-madrid
type: ics
timezone: Europe/Madrid
config:
  url: https://rustmadrid.example/events.ics
license: CC-BY-4.0
attribution:
  name: Rust Madrid
  url: https://rustmadrid.example
defaults:
  languages: [es]
```

Without a `license` in the allowlist (`CC0-1.0`, `CC-BY-4.0`), a `permission` block is required, linking the issue where the organiser grants permission in writing. Without one of the two routes, the source does not enter.

## Source types (`type`)

| `type` | Ingests | `config` |
| --- | --- | --- |
| `ics` | An iCalendar (`.ics`). | `url` of the `.ics` |
| `ote` | A `feed.json` that already conforms to [OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec) (another platform/aggregator). | `url` of the `feed.json` |

For `ote`, the file's `timezone` **is not used** (each OTE event already carries it), but the schema still requires it; set the feed's predominant zone. Example:

```yaml
id: another-platform
type: ote
timezone: Europe/Madrid       # formality: ignored by the ote connector
config:
  url: https://another-platform.example/feed.json
license: CC-BY-4.0
attribution:
  name: Another Platform
  url: https://another-platform.example
```
