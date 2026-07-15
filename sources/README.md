# `sources/` — el registro de fuentes

Un fichero YAML por fuente, `sources/<id>.yml`. El `id` **debe** coincidir con el nombre del fichero.

Cada fichero declara de dónde salen los eventos (`config.url`), en qué zona horaria ocurren
(`timezone`, obligatoria) y bajo qué derechos pueden republicarse (`license` **o** `permission`).
El CI valida cada fichero contra el esquema y contra la [puerta de licencia](../aggregator.md#puerta-de-licencia-open-data-gate),
y en cada PR hace un *dry-run* que comenta cuántos eventos entrarían.

Lo normal es no editar estos ficheros a mano: se abren desde el
[Issue Form de alta de fuente](https://github.com/OpenTechEvents/opentechevents-data/issues/new/choose).

Ejemplo mínimo:

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

Sin `license` en la allowlist (`CC0-1.0`, `CC-BY-4.0`), se necesita el bloque `permission`
enlazando el issue donde el organizador concede el permiso por escrito. Sin una de las dos vías,
la fuente no entra.

## Tipos de fuente (`type`)

| `type` | Ingiere | `config` |
| --- | --- | --- |
| `ics` | Un calendario iCalendar (`.ics`). | `url` del `.ics` |
| `ote` | Un `feed.json` que ya cumple [OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec) (otra plataforma/agregador). | `url` del `feed.json` |

Para `ote`, el `timezone` del fichero **no se usa** (cada evento OTE ya la trae), pero el esquema lo
sigue exigiendo; pon la zona predominante del feed. Ejemplo:

```yaml
id: otra-plataforma
type: ote
timezone: Europe/Madrid       # formalismo: ignorado por el conector ote
config:
  url: https://otra-plataforma.example/feed.json
license: CC-BY-4.0
attribution:
  name: Otra Plataforma
  url: https://otra-plataforma.example
```
