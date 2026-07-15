# CLAUDE.md

Guía para trabajar en este repo. El diseño completo, con el porqué de cada decisión, está en
[aggregator.md](aggregator.md) — léelo antes de un cambio de arquitectura.

## Qué es

Agregador de [OpenTechEvents](https://opentechevents.org/): ingiere eventos de fuentes externas, los
normaliza a **OTE Spec** y publica un feed suscribible. Es la implementación de referencia del estándar
y su banco de pruebas — si el modelo de datos no soporta una ingesta real, el modelo está mal.

## Comandos

```bash
npm test            # vitest, sin red (fetch y now inyectados). Ejecútalo antes de dar por hecho un cambio.
npm run check       # typecheck (tsc --noEmit). Debe estar limpio.
npm run aggregate   # pipeline completo → out/
npm run dry-run -- --source <id>   # ingiere una fuente sin escribir nada (lo que corre el PR bot)
```

Node ≥ 22. `npm test -- <fichero>` para un solo test.

## Arquitectura

Pipeline determinista, cada paso puro y testeable por separado:

```
sources/*.yml → discover → [fetch → parse → normalize] → validate → dedupe → partition → render → publish
                            └──── esto lo aporta el conector ────┘ └──── común a todo formato ────┘
```

- [src/sources/](src/sources/) — carga y valida `sources/*.yml` ([load.ts](src/sources/load.ts)) + puerta de licencia ([gate.ts](src/sources/gate.ts)).
- [src/connectors/](src/connectors/) — interfaz + registro. Conectores: `ics` (iCalendar), `ote` (feed OTE existente).
- [src/ote/](src/ote/) — tipos + validación ajv contra `@opentechevents/schema` (npm, no copia local).
- [src/pipeline/](src/pipeline/) — validate → dedupe → partition → render (`feed.json`, `feed.ics`) → report.
- [src/cli.ts](src/cli.ts) — punto de entrada; escribe `out/`.

**`feed.json` es canónico**; `.ics` y el resto se derivan de él (nunca de las fuentes crudas).

## Añadir un conector

Un formato nuevo = un fichero en `src/connectors/<tipo>/` que implementa `Connector`
([types.ts](src/connectors/types.ts)) + una línea en [registry.ts](src/connectors/registry.ts) +
fixtures y test. **El core (validate → render) no se toca.** Referencias: `ics/` (mapeo completo),
`ote/` (near-identidad).

## Invariantes — no romper

- **Un conector nunca inventa datos.** Si el dato no viene, se degrada con un *warning* y se cuenta en
  `report.json`; no se adivina.
- **Nunca lanza por un evento roto.** Acumula errores/avisos por evento en `IngestResult`. SÍ puede
  lanzar si la fuente es inalcanzable → el pipeline hace fallback al último snapshot bueno (fail-soft
  por fuente, nunca all-or-nothing).
- **`id` estable y global.** Sin él, cada ejecución duplica el feed. No reacuñar un `id` que ya existe
  (ver [ics/identity.ts](src/connectors/ics/identity.ts); `ote` preserva el upstream verbatim).
- **Puerta de licencia.** Solo entra lo que tiene licencia abierta en la allowlist (`CC0-1.0`,
  `CC-BY-4.0`) o permiso explícito. Nada de share-alike/NC/ND. Ver [gate.ts](src/sources/gate.ts).
- **Determinismo.** Los conectores reciben `fetch` y `now` por `Ctx`, nunca usan los globales — así los
  tests corren sin red y con reloj congelado.
- **Dogfooding.** Se valida contra el JSON Schema publicado en npm, nunca contra una copia privada. El
  schema manda: si los tipos TS y el schema discrepan, gana el schema.

## Tests

vitest con fixtures en `tests/fixtures/`. Reloj congelado en `NOW` ([helpers.ts](tests/helpers.ts));
las fechas de los fixtures son relativas a él. **Sin red**: usa `fakeFetch` con rutas a fixtures, no
salgas a internet. Un cambio de comportamiento lleva su test.

## Convenciones

- Comentarios y nombres en el repo van en **inglés**; la documentación de cara al público
  (README, aggregator.md, issue forms, `sources/README.md`) en **español**.
- Un fichero YAML por fuente (`sources/<id>.yml`); el `id` = nombre de fichero.
- La salida publicada vive en la rama `data` (solo la escribe el bot), nunca en `main`.
- `git commit`/`push` solo si el usuario lo pide.
