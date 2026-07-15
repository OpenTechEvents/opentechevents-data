# Contribuir a OpenTechEvents — datos

Gracias por querer aportar. Hay tres formas de contribuir, de menos a más técnica:

1. **Registrar tu comunidad como fuente** — no requiere programar. Ver [README → Para organizadores](README.md#para-organizadores-de-eventos).
2. **Dar feedback** — estamos en fase inicial. Qué falla, qué falta, qué te haría falta para consumir
   los datos. [Abre un issue](../../issues/new/choose) o una [discusión](../../discussions).
3. **Tocar código** — arreglar el conector `.ics`, mejorar el pipeline o añadir un importador nuevo.
   El resto de este documento va de eso.

El diseño completo, con el porqué de cada decisión, está en **[aggregator.md](aggregator.md)**. Léelo
antes de un cambio grande: casi cualquier "¿por qué está hecho así?" está respondido ahí.

---

## Levantar el proyecto

Requiere **Node ≥ 22**.

```bash
npm install
npm test            # tests, sin red (fetch y now se inyectan → deterministas)
npm run check       # typecheck (tsc --noEmit)
npm run aggregate   # ejecuta el pipeline completo → out/
npm run dry-run -- --source <id>   # ingiere una sola fuente sin escribir nada
```

`npm run dry-run` es lo que corre el bot en cada PR de alta de fuente: ingiere, valida y muestra qué
se publicaría, sin tocar datos ni snapshots.

---

## Cómo está organizado

```
src/
  ote/          Tipos de OTE + validación ajv contra @opentechevents/schema (desde npm, no copia local)
  sources/      Registro sources/*.yml + puerta de licencia (open data gate)
  connectors/   Interfaz de conector + registro; ics/ es el único conector del MVP
  pipeline/     validate → dedupe → partition → render (feed.json, feed.ics) → report
  cli.ts        Punto de entrada
tests/          vitest + fixtures .ics
sources/        El registro de fuentes (un .yml por fuente)
```

El pipeline es determinista y cada paso es puro y testeable por separado:

```
sources/*.yml → discover → fetch → parse → normalize → validate → dedupe → partition → render → publish
                          └──── esto lo aporta el conector ────┘ └──── común a todo formato ────┘
```

Los pasos **fetch → parse → normalize** son lo único que aporta un conector. Todo lo demás
(validate → render) es común y **no se toca al añadir una fuente ni un formato nuevo**. Ese es el truco
de la mantenibilidad.

---

## Añadir un conector (importador nuevo)

Un formato nuevo (JSON-LD, Meetup, otro feed OTE…) es:

1. Un fichero en `src/connectors/<tipo>/` que implementa la interfaz `Connector`
   (ver [`src/connectors/types.ts`](src/connectors/types.ts) y el conector `ics/` como referencia).
2. Una línea que lo registra en [`src/connectors/registry.ts`](src/connectors/registry.ts).
3. Sus fixtures y tests en `tests/`.

Reglas que todo conector cumple:

- **Nunca lanza.** Acumula errores y avisos por evento en el `IngestResult`; un evento roto es una
  entrada del `report.json`, no un crash.
- **Nunca inventa datos.** Si el dato no viene, se degrada con un *warning*; no se adivina. (El caso
  de la zona horaria en `.ics` está documentado en detalle en [aggregator.md](aggregator.md#zona-horaria-el-punto-duro).)
- **`fetch` y `now` se reciben por `Ctx`**, nunca se usan los globales — así los tests corren sin red y
  con reloj congelado.

---

## Editar el registro de fuentes a mano

Lo normal es que las fuentes se den de alta por el [formulario](../../issues/new/choose), pero un
`sources/<id>.yml` se puede editar a mano. Formato y reglas: [`sources/README.md`](sources/README.md).

El CI rechaza un `sources/*.yml` que no valide contra el esquema del conector **o** que no pase la
[puerta de licencia](aggregator.md#puerta-de-licencia-open-data-gate). Sin `license` en la allowlist
(`CC0-1.0`, `CC-BY-4.0`) o un bloque `permission` que enlace el permiso del organizador, la fuente no
entra. Esto no es negociable: es lo que hace que el feed sea open data de verdad.

---

## Antes de abrir un PR

- `npm run check` y `npm test` en verde.
- Un cambio de comportamiento lleva su test. Los tests van sin red: usa fixtures `.ics` e inyecta
  `fetch`/`now`, no salgas a internet.
- Si tocas el conector o el pipeline, verifica con `npm run dry-run` sobre una fuente real o fixture.
- Si tu cambio destapa un hueco de la spec OTE, cuéntalo — el valor de este repo es precisamente
  encontrar esos huecos con evidencia (ver [aggregator.md → Lo que esto le exige a la spec](aggregator.md#lo-que-esto-le-exige-a-la-spec)).

---

## Licencia de las contribuciones

El código se publica bajo **MIT**; al contribuir aceptas que tu aportación se licencie igual. Los datos
del feed van bajo **CC-BY-4.0** (ver [README → Licencias](README.md#licencias)).
