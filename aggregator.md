# Agregador OTE — diseño del MVP (propuesta)

Herramienta que **ingiere eventos de fuentes externas, los normaliza a OTE Spec y publica un feed**. Es la primera implementación de referencia del estándar y su mejor banco de pruebas: si el modelo de datos no soporta una ingesta real, es que el modelo está mal.

- **MVP**: una única familia de fuentes, **iCalendar (`.ics`)**.
- **A futuro**: Meetup, Luma, Sessionize, JSON-LD/schema.org, RSS, otros feeds OTE… → por eso la ingesta es **modular** desde el día 1.

## Principio rector: todo dato es open data

El feed publicado solo contiene eventos cuya **licencia es conocida y reutilizable**. No se ingiere nada "porque está en internet". Cada evento del feed viaja con su `source` (de dónde salió) y su `license` (cómo puede reutilizarse). Ver [Puerta de licencia](#puerta-de-licencia-open-data-gate).

---

## Dónde vive

**Repositorio aparte**: `OpenTechEvents/opentechevents-data`.

| Repo | Responsabilidad |
| --- | --- |
| `opentechevents-spec` (este) | El estándar: modelo de datos, feed, JSON Schema, versionado. |
| `opentechevents-data` | El directorio: fuentes registradas, conectores, Action diaria y datos publicados. |

Se llama `-data` y no `-aggregator` porque **lo que el proyecto le ofrece al mundo son los datos**; el agregador es la maquinaria que los produce. El nombre debe describir el producto, no la implementación.

Motivo de la separación respecto a la spec: el debate del estándar no debe mezclarse con bugs de implementación, y el agregador debe ser **un consumidor más** de la spec (dogfooding: consume el JSON Schema publicado, no una copia privada).

### Los conectores viven dentro, no en repos aparte

Decisión tomada y documentada aquí para no volver a debatirla. Los importadores son **paquetes dentro de `opentechevents-data`**, no repos externos que la Action diaria clona y ejecuta.

Clonar y ejecutar código de terceros en la tarea diaria sería, en este orden:

- **Un agujero de seguridad.** La Action corre con un token que **escribe en el repo**. Ejecutar código externo en HEAD es ejecución remota de código con permisos de escritura sobre el directorio de datos.
- **El fin de los cambios atómicos.** Cuando la spec cambie un nombre de campo, hacen falta spec-consumer, conectores y datos regenerados **en un mismo PR revisable**. Repartidos en N repos, eso es una coreografía entre N versiones.
- **El fin del *dry-run* en el PR** (ver [Alta de fuentes](#alta-de-fuentes-y-eventos-issue-form--pr)), que es lo que hace usable el alta: para previsualizar cuántos eventos traería una fuente nueva habría que resolver y ejecutar código externo dentro del PR de un tercero.

El coste real de tenerlo todo junto (coordinar a muchos mantenedores externos) solo aparece **cuando hay muchos mantenedores externos**. Cuando llegue ese día, un conector se saca como **paquete publicado y fijado a una versión** (npm/PyPI) — una dependencia auditable. Nunca como un `git clone` de HEAD.

### Los datos, en una rama aparte

Dentro de `opentechevents-data`:

| Rama | Contiene | Quién escribe |
| --- | --- | --- |
| `main` | Conectores, `sources/*.yml`, workflows, tests. | Personas, vía PR. |
| `data` | La salida publicada (`feed.json`, `feed.ics`, `feed.xml`, `archive/`, `report.json`). | **Solo el bot**, en cada ejecución. |

Así el historial humano no queda sepultado bajo cientos de commits de bot, y quien solo quiere el dataset puede clonar una rama sin arrastrar el *toolchain*. Se conserva lo bueno de commitear los datos: **cada ejecución deja un diff auditable** (qué evento apareció, cuál cambió, cuál se fue) y el historial de git prueba que un evento existió.

GitHub Pages sirve la rama `data`, idealmente bajo un subdominio propio (`data.opentechevents.org`), de modo que **las URLs de los feeds no dependen de esta decisión** y pueden sobrevivir a cualquier reorganización futura del repo. La URL del `.ics` es para siempre: la gente la suscribe en su calendario y no vuelve a tocarla.

## Arquitectura

Pipeline determinista. Cada paso es puro y testeable por separado:

```
sources/*.yml
    │
    ▼
[1] discover ── lee y valida el registro de fuentes
    │
    ▼
[2] fetch ───── el conector descarga el dato crudo (HTTP, API…)
    │
    ▼
[3] parse ───── crudo → objetos intermedios del formato (VEVENT, JSON de API…)
    │
    ▼
[4] normalize ─ objetos del formato → Event OTE (aquí vive el mapeo)
    │
    ▼
[5] validate ── ajv contra el JSON Schema de OTE Spec  ── evento inválido = descartado + reportado
    │
    ▼
[6] dedupe ──── por `id` estable (ver más abajo)
    │
    ▼
[7] partition ─ futuros → feed;  pasados → archivo
    │
    ▼
[8] render ──── feed.json (canónico) → .ics, .xml (RSS), .feed.json (JSON Feed)
    │
    ▼
[9] publish ─── commit a la rama `data` + GitHub Pages
```

Los pasos 2-4 son **lo único que aporta un plugin**. El resto (5-9) es común a todos los formatos y no se toca al añadir una fuente nueva. Ese es todo el truco de la mantenibilidad.

### Interfaz de conector (plugin)

```ts
export interface Connector<Config = unknown> {
  /** Identificador del tipo de fuente: "ics", "meetup", "jsonld"… */
  readonly type: string;

  /** JSON Schema de la config que este conector acepta en sources/*.yml */
  readonly configSchema: JSONSchema;

  /** Descarga + parsea + normaliza. Nunca lanza: acumula errores por evento. */
  ingest(source: Source<Config>, ctx: Ctx): Promise<IngestResult>;
}

interface IngestResult {
  events: OteEvent[];      // ya normalizados a OTE
  warnings: Issue[];       // eventos degradados (p.ej. sin timezone → asumida)
  errors: Issue[];         // eventos descartados, con motivo
}

interface Ctx {
  fetch: typeof fetch;     // inyectado → tests sin red
  now: Date;               // inyectado → tests deterministas
  logger: Logger;
}
```

Registro de conectores: un `Map<type, Connector>` en `src/connectors/index.ts`. Añadir un formato = un fichero nuevo + una línea en el registro + sus fixtures. Sin tocar el core.

**Un conector nunca inventa datos.** Si el ICS no trae zona horaria, el evento se degrada con un *warning*, no se adivina.

### El conector `ote` — ingerir otro feed OTE

`type: ote` toma una fuente que **ya publica un `feed.json` OTE** y la reagrega. Es la prueba de
*dogfooding* más fuerte del proyecto: entra OTE, sale OTE, y la reagregación debe ser **casi la
identidad**. Si ingerir nuestro propio formato pierde datos, el formato está mal.

Es también cómo se ve la interoperabilidad en la práctica: una plataforma publica OTE y **cualquier
agregador la consume sin importador a medida**. Como el `id` es una URI global acuñada una vez y nunca
reescrita, dos agregadores que ingieren el mismo feed emiten los mismos `id` → **deduplican entre sí
gratis**.

El conector preserva, no mapea. Tres cosas que **no** son *passthrough*:

- **`id` se conserva tal cual.** Reacuñarlo rompería la identidad descentralizada — un consumidor que ya
  vio el evento aguas arriba debe reconocerlo aquí.
- **`license` se resuelve heredando del feed.** Dentro de un feed, un evento omite su licencia cuando
  coincide con la del feed; se hace explícita al ingerir, y `renderFeed` vuelve a omitirla contra **nuestra**
  licencia de feed. Un evento `CC0-1.0` conserva su licencia — aplanarlo a `CC-BY-4.0` sería mentir.
- **La procedencia (`source`) se preserva si el evento ya la trae**, apuntando al **origen real** (el
  organizador, quizá a varios saltos), no a este relevo. Solo se sintetiza `source` desde el feed cuando
  el evento no la trae.

> **`timezone` de `sources/*.yml` no se usa para `ote`**: cada evento OTE ya la trae obligatoriamente.
> El esquema de fuente la sigue exigiendo (es común a todos los tipos); para `ote` es hoy un formalismo.
> Hacerla condicional al conector es un *follow-up* pequeño y aún pendiente.

## El registro de fuentes: `sources/*.yml`

**Un fichero por fuente** (no un fichero gigante): PRs sin conflictos, `git blame` por fuente, y el CI puede validar solo lo que cambia.

```yaml
# sources/rust-madrid.yml
id: rust-madrid                 # slug único, = nombre de fichero
type: ics                       # qué conector lo procesa
enabled: true

# Zona horaria IANA de los eventos de esta fuente. OBLIGATORIA.
# OTE exige `timezone` en TODO evento, y iCalendar la omite constantemente (eventos de
# día completo, horas flotantes) o expresa la hora en UTC. Este campo es el organizador
# declarando la respuesta, en vez del parser adivinándola. Ver "Zona horaria" abajo.
timezone: Europe/Madrid

config:                         # validado contra el configSchema del conector "ics"
  url: https://rustmadrid.example/events.ics

# Procedencia y derechos → obligatorio, esto es lo que hace que el feed sea open data
license: CC-BY-4.0              # SPDX o URL
attribution:
  name: Rust Madrid
  url: https://rustmadrid.example
permission:                     # solo si la fuente no declara licencia por sí misma
  grantedBy: "@handle-del-organizador"
  evidence: https://github.com/OpenTechEvents/opentechevents-data/issues/42

# Valores por defecto aplicados a los eventos de esta fuente (no los sobrescriben si vienen)
defaults:
  languages: [es]
  attendanceMode: in-person
```

> **`defaults` solo admite lo que la spec sabe representar.** No hay `defaults.tags` ni
> `defaults.community` porque **OTE v0.1 no define `tags` ni `community`** — un `defaults.tags`
> parecería funcionar y no publicaría nada. El CI rechaza esas claves en vez de aceptarlas en
> silencio. Ver [Lo que esto le exige a la spec](#lo-que-esto-le-exige-a-la-spec).

### Puerta de licencia (open data gate)

El CI **rechaza** un `sources/*.yml` que no cumpla una de las dos vías:

1. **Licencia abierta declarada por la fuente**: `license` ∈ allowlist (**`CC0-1.0`** o **`CC-BY-4.0`**) y verificable en origen.

   > ⚠️ **Nada de *share-alike* (`CC-BY-SA`, `ODbL`) en la allowlist, y el motivo es el feed agregado.** Basta una fuente *share-alike* para que **el agregado entero herede la obligación**: cualquier directorio, app o newsletter que reutilice el feed quedaría obligado a relicenciar su propia base de datos igual. Eso mata el caso de uso que justifica todo el proyecto. `NC` y `ND` tampoco: no son licencias abiertas.
   >
   > `CC-BY-4.0` y no `3.0` porque la 4.0 es la primera que cubre expresamente el **derecho *sui generis* de bases de datos** de la UE — y un directorio de eventos es una base de datos.
2. **Permiso explícito del organizador**: la mayoría de comunidades no ha puesto licencia a su `.ics`. Se admite si el organizador lo concede por escrito → el bloque `permission` enlaza el issue donde consta. El alta por Issue Form (abajo) captura ese permiso de forma natural: **quien da de alta la fuente suele ser el propio organizador**.

Ninguna otra vía. Sin licencia ni permiso, no entra.

> **Meetup, Eventbrite y similares tienen Términos de Servicio que restringen la reutilización**, incluso cuando exponen un `.ics` público. Que un endpoint sea accesible no lo hace reutilizable. Cada plataforma necesita su propio análisis antes de admitirla como fuente — pendiente en [research/](https://github.com/OpenTechEvents/opentechevents-spec/tree/main/research).

El feed agregado se publica como **CC-BY-4.0**, con la atribución de cada evento en su `source`. No se relicencia nada a CC0: no se puede relicenciar lo que no es tuyo.

## Mapeo iCalendar → OTE

El conector `ics` implementa esto. Es, además, el **inverso** del mapeo que ya documenta la spec ([data-model.md](https://github.com/OpenTechEvents/opentechevents-spec/blob/main/spec/data-model.md)) — validarlo en ambos sentidos es una prueba fuerte del modelo.

| VEVENT | OTE v0.1 | Notas |
| --- | --- | --- |
| `UID` | `id` | Ver estrategia de identidad abajo. |
| `SUMMARY` | `name` | Sin `SUMMARY` no hay evento: se descarta y se reporta. |
| `DESCRIPTION` | `description` | Suele traer HTML; se reduce a texto plano. |
| `DTSTART` (+ `TZID`) | `startDate` + `timezone` | El punto duro. Ver [Zona horaria](#zona-horaria-el-punto-duro). |
| `DTEND` / `DURATION` | `endDate` | **No hay `duration` en v0.1**: `DURATION` se resuelve a `endDate`. En día completo, `DTEND` es **exclusivo** en iCal e **inclusivo** en OTE → se le resta un día. |
| `URL` | `url` | Si falta, se deja vacío (no se inventa la URL del `.ics`). |
| `LOCATION` (texto) | `location.venue` | **String plano** en v0.1. Texto libre, sin geocodificar. |
| `LOCATION` (si parsea como URL) | `location.onlineUrl` | Emisores que meten el enlace de la sala ahí. |
| `CONFERENCE` (RFC 7986) | `location.onlineUrl` | La propiedad **estándar**… que casi nadie emite. |
| `X-GOOGLE-CONFERENCE`, `X-MICROSOFT-SKYPETEAMSMEETINGURL` | `location.onlineUrl` | Propiedades propietarias. En la práctica, la fuente real del dato. |
| `STATUS` | `status` | `CONFIRMED`→`scheduled`, `CANCELLED`→`cancelled`, `TENTATIVE`→`postponed` ⚠️ (ver abajo). |
| `RRULE` | (expandir) | Ver abajo. |
| — | `source` | Inyectado por el agregador: `{name, url, license, retrievedAt}`. |
| — | `license` | De `sources/*.yml`. Omitido en el feed cuando coincide con la licencia del feed. |
| — | `languages` | De `defaults.languages`. iCal no lo modela. |
| — | `attendanceMode` | **iCal no lo modela.** Ver [Inferencia de modalidad](#inferencia-de-modalidad-attendancemode). |
| `CATEGORIES` | ❌ **nada** | **v0.1 no tiene `tags`.** Se parsea y se descarta, contándolo en `report.json`. |
| `LAST-MODIFIED` / `DTSTAMP` | ❌ **nada** | **v0.1 tiene `updatedAt` en el Feed, no en el Event.** |
| `GEO` | ❌ **nada** | **`location.venue` es un string**, sin sitio para coordenadas. |

> ⚠️ **`TENTATIVE` → `postponed` es un mapeo malo**, y se hace solo porque no hay otro. `TENTATIVE`
> significa "aún sin confirmar"; `postponed` significa "estaba fijado y se movió". No son lo mismo.
> v0.1 no tiene un valor para "tentativo" — está en la lista de huecos a llevar a la spec.

### Zona horaria: el punto duro

**OTE exige `timezone` en todos los eventos** (`required: [id, name, startDate, timezone]`) y **`startDate`
es *wall-clock*: el schema prohíbe la `Z` y cualquier offset**. iCalendar no da ni una cosa ni la otra de
forma fiable. Un `.ics` puede traer la hora en UTC (`DTSTART:20261015T170000Z`), flotante (sin zona
ninguna), como fecha sin hora, o con un `TZID` que no es IANA (Outlook emite `Romance Standard Time`).

La regla, que se deriva de *"un conector nunca inventa datos"*: **el instante siempre sale del fichero; la
zona en la que se expresa sale de `timezone` de `sources/*.yml` cuando el fichero no la declara.**

| Lo que trae el `.ics` | `timezone` | `startDate` | |
| --- | --- | --- | :---: |
| `TZID` IANA válido | ese `TZID` | la hora tal cual | |
| `DTSTART:…Z` (UTC) | la de la fuente | el instante, convertido a esa zona | |
| Hora flotante (sin zona) | la de la fuente | la hora tal cual | ⚠️ warning |
| `TZID` no-IANA | la de la fuente | el instante (vía su `VTIMEZONE`), convertido | ⚠️ warning |
| `VALUE=DATE` (día completo) | la de la fuente | la fecha, **nunca desplazada** | |

**UTC cuenta como "sin zona declarada".** Un `.ics` que escribe `…T170000Z` nos dice *cuándo*, no *dónde*:
UTC es una serialización, no la zona en la que ocurre el meetup. Emitir `timezone: UTC` sería cierto e
inútil — un meetup de Madrid a las 19:00 se leería como las 17:00 en todos los calendarios.

> **Trampa real de `ical.js`**: un `TZID=Europe/Madrid` **sin su `VTIMEZONE`** (frecuentísimo) hace que la
> librería caiga a hora flotante en silencio. El conector lee el parámetro `TZID` **crudo** en vez de fiarse
> de la zona ya resuelta. Sin eso, esas fuentes se desplazan una hora.

**Recurrencia (`RRULE`)**: detalle de implementación del conector, **no afecta a la spec**. Algunos `.ics` de meetups mensuales publican un único `VEVENT` con `RRULE` en lugar de un `VEVENT` por ocurrencia. El conector lo **expande** dentro de la ventana (hoy → +12 meses), respetando `EXDATE` y `RECURRENCE-ID`, y produce un `Event` por ocurrencia con su propio `id`. Coherente con *"un documento = un evento"*: la recurrencia se resuelve en la ingesta y nunca llega al feed.

### Inferencia de modalidad (`attendanceMode`)

**iCalendar no modela la modalidad de asistencia.** Hay que decidir qué hacer con eso, y la respuesta correcta **no** es adivinar.

Lo que sí se puede extraer con confianza son **hechos observados**, no conclusiones:

- **Hay acceso online** si aparece un enlace de sala en una propiedad dedicada: `CONFERENCE` (RFC 7986, estándar pero poco emitido), `X-GOOGLE-CONFERENCE`, `X-MICROSOFT-SKYPETEAMSMEETINGURL`, o un `LOCATION` que parsea como URL. → `location.online.url`.
- **Hay lugar físico** si `LOCATION` es texto y no una URL. → `location.venue.name`.

> **URLs sueltas en `DESCRIPTION`: no se usan.** Ahí conviven enlaces de registro, de la comunidad y de patrocinadores. Demasiado ruido para tratarlas como señal.

De esos dos hechos, la modalidad **solo se afirma cuando la señal es inequívoca**:

| Lugar físico | Enlace online | `attendanceMode` |
| :---: | :---: | --- |
| sí | no | `in-person` |
| no | sí | `online` |
| sí | sí | **se omite** |
| no | no | **se omite** |

El caso "ambos" parece híbrido, pero **no lo es necesariamente**, y el motivo no es rebuscado: **Google Calendar adjunta un enlace de Meet automáticamente** a los eventos que creas (opción activada por defecto en muchas cuentas). El organizador crea su meetup presencial, no toca nada, y su `.ics` público sale con `X-GOOGLE-CONFERENCE`. Nadie decidió que ese evento fuera híbrido: lo decidió una casilla por defecto. El ICS **no contiene** la información que distingue eso de un híbrido real; ningún parser lo puede arreglar.

Simétricamente, la ausencia de enlace no implica presencial: muchas comunidades mandan el enlace por email al registrarse.

**Precedencia**: `defaults.attendanceMode` de `sources/*.yml` **gana siempre** sobre la heurística. El organizador que da de alta su fuente sabe si su meetup es híbrido; el parser no. Esa es la vía buena de conseguir el dato — declararlo en el origen, no deducirlo.

Cuando se omite por ambigüedad, se emite un *warning* a `report.json` ("fuente X: 12 eventos sin `attendanceMode` determinable") para que el mantenedor de esa fuente lo declare en sus `defaults`, en lugar de que el sistema se invente el dato en silencio.

> Esto exige que la spec permita representar *"no lo sé"*: `attendanceMode` **opcional y sin valor por defecto**. Si tuviera `in-person` por defecto, toda ingesta desde `.ics` convertiría los eventos online en presenciales, sin avisar.

### Identidad (`id`) — el punto crítico

Sin `id` estable, cada ejecución diaria duplica el feed entero. Regla:

```
id = source.url + "#" + UID                      (si el VEVENT trae UID)
id = source.url + "#" + sha256(name|startDate)   (fallback, si no lo trae)
```

Para ocurrencias expandidas de un `RRULE`, se sufija la fecha de la ocurrencia (equivalente al `RECURRENCE-ID` de iCal).

Es una URI global, estable entre ejecuciones y sin registro central — coherente con el principio de identidad descentralizada de la spec.

> **Dedupe entre fuentes distintas** (el mismo evento en dos ICS) **queda fuera del MVP**. Requiere *matching* difuso (título+fecha+lugar) y es un problema en sí mismo. El MVP deduplica solo por `id` idéntico. Documentarlo como limitación conocida.

## Alta de fuentes y eventos: Issue Form → PR

Dos plantillas (GitHub Issue Forms, `.github/ISSUE_TEMPLATE/*.yml`). Un workflow parsea el issue y **abre un PR**; una persona revisa y mergea. El bot nunca mergea solo.

```
Issue Form ──▶ workflow (on: issues.opened, label)
                  │
                  ├─ parsea el cuerpo del issue (formato estructurado)
                  ├─ valida (JSON Schema + puerta de licencia)
                  │     └─ inválido → comenta en el issue qué falta, no abre PR
                  └─ abre PR con el fichero nuevo, enlazando el issue
                          │
                          └─ CI del PR: valida + hace un dry-run de la ingesta
                                        y comenta cuántos eventos traería
```

| Plantilla | Produce | Para quién |
| --- | --- | --- |
| **Añadir fuente** (`.ics`) | `sources/<slug>.yml` | Comunidades con calendario publicado. Escala: una fuente = eventos para siempre. |
| **Añadir evento suelto** | `events/<slug>.json` | Comunidades sin `.ics`. Trabajo manual, pero permite arrancar con contenido el día 1. |

Ambas plantillas incluyen un **checkbox de licencia obligatorio** ("declaro que estos datos pueden publicarse como open data bajo CC-BY / soy el organizador y doy permiso"). Ahí es donde el proyecto captura el permiso de forma verificable y trazable.

El *dry-run* en el PR es lo que hace el sistema usable: quien propone una fuente **ve en su PR** cuántos eventos entrarían y con qué pinta, antes de mergear.

## Salidas publicadas

Feed global en el MVP (los feeds pre-filtrados por `scope` vienen después):

| Fichero | Formato | Para qué |
| --- | --- | --- |
| `data/feed.json` | **OTE Feed** ([spec/feed.md](https://github.com/OpenTechEvents/opentechevents-spec/blob/main/spec/feed.md)) | **Canónico**. Todo lo demás se deriva de aquí. |
| `data/feed.ics` | iCalendar | Suscripción en Google/Apple/Outlook Calendar. La *killer feature*. |
| `data/feed.xml` | RSS 2.0 | Lectores de feeds. |
| `data/feed.jsonfeed.json` | JSON Feed 1.1 | Lectores modernos. |
| `data/archive/YYYY.json` | OTE Feed | Eventos ya pasados. Dataset histórico. |
| `data/archive/index.json` | — | Manifest de años del archivo (`{ years, updatedAt }`). Lo escribe el CLI leyendo los `YYYY.json` en disco; lo lee el índice de archivo (`archive/index.html`) para no adivinar el rango. |
| `data/report.json` | — | Salud de la ingesta: por fuente, eventos ok / *warnings* / errores. |

Servidos por GitHub Pages en URLs estables. El `.ics` **debe** tener URL estable para siempre: la gente lo suscribe en su calendario y no vuelve a tocarlo.

### Retención

- `feed.*` → **eventos que aún no han terminado**, no "que aún no han empezado".

  > La regla obvia (`startDate >= hoy`) **borra del feed una conferencia de tres días en su segunda
  > mañana**, mientras la gente sigue asistiendo: los suscriptores verían el evento desaparecer de su
  > calendario a mitad. Se usa `endDate` (o `startDate` si no hay `endDate`).
- Al terminar, el evento migra a `archive/YYYY.json`, indexado por el año en que **empezó**.
- **El archivo acumula**: un `.ics` deja de listar los eventos pasados, así que un archivo reconstruido
  desde cero en cada ejecución perdería historia tan rápido como la gana. Los eventos pasados se
  **fusionan** con lo ya publicado, y gana lo existente (un evento que ya ocurrió no cambia).
- Si un evento **desaparece de su fuente**, desaparece del feed (el feed es un espejo del estado actual). El historial de git preserva que existió.
- Si la fuente lo marca `CANCELLED`, se mantiene con `status: cancelled` → los suscriptores del `.ics` ven la cancelación en su calendario.

## Publicación y ejecución

```yaml
# .github/workflows/aggregate.yml
on:
  schedule: [{ cron: "0 5 * * *" }]   # diario, 05:00 UTC
  workflow_dispatch:                   # ejecución manual
  push: { paths: ["sources/**"] }      # una fuente nueva se ingiere al instante
```

El bot commitea la salida a la **rama `data`** (nunca a `main`, ver [Dónde vive](#los-datos-en-una-rama-aparte)) → cada ejecución deja un **diff revisable**: qué evento apareció, cuál cambió, cuál se fue. Auditoría e historial gratis, sin sepultar el historial humano. GitHub Pages sirve esa rama.

**Resiliencia** (una fuente caída no puede tumbar el feed):
- Fallo de red en una fuente → se **conserva el último dato bueno** de esa fuente, se marca en `report.json` y el commit sigue adelante.
- N fallos consecutivos → issue automático avisando al mantenedor de esa fuente.
- La ingesta es **fail-soft por fuente**, nunca *all-or-nothing*.

## Stack

TypeScript + Node 22. `ical.js` para parsear, `luxon` para zonas horarias, `ajv` para validar contra el
**JSON Schema publicado de OTE** (`@opentechevents/schema`, desde npm — *dogfooding*: se consume el
paquete público, no una copia privada), `vitest` con fixtures `.ics` (tests sin red y deterministas:
`fetch` y `now` se inyectan).

---

## Lo que esto le exige a la spec

**Aquí está el valor real de construir el agregador**: obliga a decidir cosas que la spec tiene abiertas.
El [issue #5](https://github.com/OpenTechEvents/opentechevents-spec/issues/5) declaraba como **no-objetivos**
de la v0.1 los *identificadores únicos*, la *deduplicación* y los *importadores* — y un agregador es
exactamente eso.

**Resuelto**: `id`, `source` y `license` **están en el núcleo de la v0.1 publicada**. La tesis se sostuvo:
sin `id` estable cada ejecución diaria duplicaría el feed entero, y sin `license` el feed no sería open data.

### Huecos que la ingesta real destapa

Escribir el conector `ics` contra el schema publicado encontró estos, y **el agregador ya los cuenta en
`report.json`** — la idea es discutirlos con evidencia ("37 eventos de 4 fuentes traen `CATEGORIES` que no
podemos publicar") y no con opiniones ("la spec debería tener tags"):

| Hueco en v0.1 | Qué se pierde | Impacto |
| --- | --- | --- |
| **No hay `tags`** (ni `scope` en el Feed) | `CATEGORIES` del ICS se descarta. | Sin esto **no hay feeds filtrados por tema** — la Fase 3 se queda sin su función principal. |
| **`updatedAt` solo en el Feed, no en el Event** | `LAST-MODIFIED`/`DTSTAMP` se descarta. | Un consumidor **no puede saber qué eventos cambiaron** desde su última lectura. Sincronización incremental imposible. |
| **`location.venue` es un string** | `GEO` se descarta. | Sin coordenadas no hay mapas ni búsqueda "cerca de mí". |
| **`status` no tiene "tentativo"** | `TENTATIVE` se mapea a `postponed`, que significa otra cosa. | Se afirma algo que el ICS no dijo. |
| **No hay `duration`** | Menor: `DURATION` se resuelve a `endDate` sin pérdida. | Ninguno. |

También conviene fijar en la spec, porque el agregador ya tuvo que decidirlo:

- **`endDate` de día completo es inclusivo** (en iCal, `DTEND` es **exclusivo**). No está escrito, y quien lo
  asuma al revés añadirá o quitará un día a cada evento.
- **`events` completos, no reducidos**: un `.ics` suscribible no puede depender de resolver enlaces.
- **JSON canónico**, con YAML como sintaxis de autoría y el resto (ICS/RSS/JSON Feed) como derivados.

## Fases

| Fase | Alcance | Estado |
| --- | --- | --- |
| **0** | JSON Schema de OTE v0.1 publicado. | ✅ `@opentechevents/schema@0.1.0` en npm. |
| **1 (MVP)** | Conector `ics` + pipeline + `feed.json`/`.ics` + Action diaria + 3-5 fuentes reales. | ✅ Código y CI listos. ⏳ **Faltan las fuentes reales.** |
| **2** | Issue Forms (fuente + evento) → PR automático. | Pendiente. La puerta de licencia y el *dry-run* en el PR **ya están**. |
| **3** | RSS/JSON Feed, feeds pre-filtrados por `scope`. | Pendiente. **Bloqueado por la falta de `tags`/`scope` en la spec.** |
| **4** | Conectores nuevos (JSON-LD, Meetup…), dedupe entre fuentes. | Pendiente. El conector **`ote`** (ingerir otro feed OTE) **ya está** — ver abajo. |

La fase 1 es deliberadamente pequeña: **un `.ics` que la gente pueda suscribir en su calendario ya es un producto útil**, aunque solo tenga 3 fuentes. Todo lo demás es amplificación de eso.
