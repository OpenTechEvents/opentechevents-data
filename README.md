# OpenTechEvents — datos

Una **capa de interoperabilidad y licencia para eventos de comunidades tech**: unifica calendarios
dispersos en un feed común, con la licencia de cada dato explícita, para que otros puedan reutilizarlos.

Este repositorio recoge los calendarios de comunidades tecnológicas (meetups, grupos de usuarios,
conferencias) y directorios ya existentes, los unifica y los publica de dos maneras
complementarias, con la procedencia y la licencia de cada evento explícitas:

- **En formatos estándar que la gente ya usa** — iCalendar (`.ics`), RSS/Atom, JSON Feed. Suscribes el
  feed en el calendario o el lector que ya tienes, sin aprender nada nuevo.
- **En [OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)**, un formato nuevo diseñado
  específicamente para las necesidades de las comunidades técnicas. Los formatos estándar se quedan
  cortos para esto: modela comunidad, temática, tipo de evento (conferencia/meetup), modalidad,
  ubicación, *call for speakers*… con la granularidad que hace falta para construir herramientas
  encima.

Ese es el fin del estándar: **habilitar a la comunidad a crear herramientas** que dejen a cada persona
definir y suscribirse a exactamente lo que le interesa — por comunidad, por temática, por tipo de
evento, por ubicación; descubrir eventos nuevos; o montar feeds personalizados (p. ej. solo *call for
speakers* de una temática). El común de datos abiertos es lo que hace posible todo eso.

Es la pieza de datos del proyecto **[OpenTechEvents](https://opentechevents.org/)**. Aquí vive la
maquinaria y los datos; en la web está el proyecto y su contexto.

## Qué es esto (y qué no)

**No es otro directorio de eventos con su buscador, ni pretende competir con los que ya existen**
([recopilación de calendarios y directorios](https://github.com/ComBuildersES/awesome-community-builders#calendarios)).
Al contrario: quiere ser el **habilitador de interoperabilidad que les ayude a todos** a construir la
mejor herramienta e interfaz para sus usuarios.

Esto resuelve el problema de **antes** de cualquier directorio: que los datos de eventos están
dispersos en mil calendarios y plataformas, en formatos distintos y **sin una licencia clara** que diga
si se pueden reutilizar. Resuelto eso —una vez, en común— cada directorio, app o calendario puede
dedicarse a lo suyo: la mejor experiencia para su gente, sin reinventar la fontanería de datos.

Lo que aporta:

- **Interoperabilidad** — todo evento en un mismo formato ([OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)),
  venga de donde venga. Un consumidor integra una vez, no una por plataforma.
- **Garantía de licencia** — cada evento lleva explícito de dónde sale (`source`) y bajo qué licencia
  se puede reutilizar. Nada entra "porque está en internet" (ver [Licencias](#licencias)).

El objetivo es que **comunidades y directorios existentes se sumen y expliciten la licencia de sus
datos**, para que más organizaciones —directorios, apps, newsletters, calendarios— puedan usarlos con
garantías. Cuantas más fuentes se declaran abiertas, más útil es el común para todos.

> ⚠️ **Estamos en fase inicial.** El feed **ya está en vivo y es suscribible**
> (`https://data.opentechevents.org/feed.ics`), pero se está poblando con las primeras fuentes reales:
> al principio verás pocos eventos. Buscamos feedback de organizadores y de plataformas: qué falla, qué
> falta, qué haría esto útil para ti. [Abre un issue](../../issues/new/choose) o pásate por las
> [discusiones](../../discussions).

---

## Para asistentes (seguir los eventos)

**¿Solo quieres enterarte de los eventos tech y no perdértelos?** Hoy la vía más directa es suscribir
el calendario una vez: los eventos de todas las comunidades registradas aparecen —y se actualizan
solos— en tu app de calendario habitual.

1. Copia la URL del calendario: **`https://data.opentechevents.org/feed.ics`**
2. Añádela como calendario suscrito (no como importación puntual) en tu app:
   - **Google Calendar**: *Otros calendarios* → *Suscribirse a un calendario* → *Desde URL*.
   - **Apple Calendar**: *Archivo* → *Nueva suscripción de calendario*.
   - **Outlook**: *Añadir calendario* → *Suscribirse desde la web*.

Así ves todo en un sitio, con las actualizaciones y cancelaciones que publiquen las comunidades. Si
prefieres un lector de feeds, RSS/JSON Feed llegan en la [Fase 3](#roadmap).

**Lo que viene: apps que filtran por lo que te importa.** El calendario te vuelca *todos* los eventos;
el fin de OTE Spec es que existan herramientas que te dejen suscribirte a exactamente lo que te
interesa —por temática, ciudad, modalidad o tipo de evento— y avisarte (email, Telegram, webhook).
Ese ecosistema está arrancando: **de momento no hay todavía apps de terceros** que consuman el feed,
pero las que se vayan construyendo (lectores por temática, notificaciones, widgets…) se listan en
**[opentechevents.org/#tools](https://opentechevents.org/#tools)**. ¿Echas en falta una? Propónla ahí.

> El feed se está poblando con las primeras fuentes; al principio verás pocos eventos. Cuantas más
> comunidades se registren, más completo será — anima a las tuyas a [darse de alta](#para-organizadores-de-eventos).

---

## Para organizadores de eventos

**¿Organizas un meetup, grupo o conferencia y quieres que tus eventos aparezcan?**

Si tu comunidad ya publica un calendario **iCalendar (`.ics`)** —Meetup, Google Calendar, Luma y casi
cualquier herramienta exportan uno—, registrarlo es un formulario:

1. Abre el **[formulario de alta de fuente](../../issues/new/choose)**.
2. Indica la URL de tu `.ics`, su zona horaria y con qué nombre/web quieres que se te atribuya.
3. Declara que los datos pueden republicarse como open data (eres organizador/a y das permiso, o tu
   calendario ya tiene una licencia abierta). **Este paso es obligatorio**: que un `.ics` sea público
   no lo hace reutilizable.

Un bot leerá el issue y abrirá un PR. Antes de aprobarlo verás un *dry-run*: **cuántos eventos
entrarían y con qué pinta**. Una persona lo revisa y lo integra.

A partir de ahí, tus eventos entran solos en cada actualización diaria — una fuente registrada son
eventos para siempre, sin trabajo manual.

**¿Tu comunidad no publica un `.ics`?** De momento el `.ics` es el único formato soportado (ver
[Roadmap](#roadmap)). Si tienes otra fuente (una API, JSON-LD en tu web, etc.), cuéntanoslo en un
issue: nos ayuda a priorizar qué importadores construir.

### Qué controlas tú

- **Atribución**: cada evento tuyo enlaza a tu comunidad en su campo `source`.
- **Modalidad** (presencial/online/híbrido): la declaras tú en el alta; no la adivinamos.
- **Cancelaciones**: si marcas un evento `CANCELLED` en tu calendario, los suscriptores lo ven
  cancelado en el suyo.
- **Salir**: si retiras tu calendario o pides la baja, tus eventos desaparecen del feed.

---

## Para plataformas y desarrolladores (consumir los datos)

¿Tienes un directorio, una app, un bot o una newsletter y quieres nutrirte de estos eventos? El feed
se publica en formatos estándar bajo URLs estables:

| Feed | Formato | Para qué |
| --- | --- | --- |
| `feed.json` | [OTE Feed](https://github.com/OpenTechEvents/opentechevents-spec) (JSON) | **Canónico.** Todo lo demás se deriva de aquí. Empieza por este. |
| `feed.ics` | iCalendar | Suscripción directa en Google/Apple/Outlook Calendar. |
| `archive/YYYY.json` | OTE Feed | Eventos ya pasados. Dataset histórico. |
| `report.json` | JSON | Salud de la ingesta por fuente: eventos ok, avisos, errores. |

> `feed.xml` (RSS) y `feed.jsonfeed.json` (JSON Feed) llegan en la [Fase 3](#roadmap).

**Por qué empezar por `feed.json`**: es la única fuente de verdad; el `.ics` y el resto se generan a
partir de él. Si integras a nivel de datos, integra contra el JSON y el JSON Schema publicado
([`@opentechevents/schema`](https://www.npmjs.com/package/@opentechevents/schema)); así tu integración
no depende de las rarezas de ningún formato de calendario.

**Estabilidad de URLs**: los feeds se sirven bajo un dominio propio (`data.opentechevents.org`) para
que las URLs sobrevivan a cualquier reorganización del repo. La URL del `.ics` es para siempre — la
gente la suscribe en su calendario y no vuelve a tocarla.

**¿Hay SDKs?** Todavía no, y para leer no hacen falta: OTE es JSON plano, se consume con cualquier
cliente HTTP y se valida con un validador de JSON Schema estándar contra
[`@opentechevents/schema`](https://www.npmjs.com/package/@opentechevents/schema). Hay **SDKs de
referencia** (JS/TS, Python… para leer, escribir y validar, con playground) entre las herramientas
propuestas del ecosistema — si te haría falta una, dilo (abajo).

Al usar el feed, **respeta la atribución**: es CC-BY-4.0 y cada evento indica a quién atribuir en su
`source`.

### El ecosistema está por construir — y buena parte, por reclamar

OTE Spec es reciente: hoy la única pieza en marcha es este agregador. Todo lo demás está **propuesto y
libre para que alguien lo construya** — importadores de Meetup/Luma/Sessionize/Eventbrite, extractores
schema.org/JSON-LD, exportadores a RSS y a schema.org/Event, widgets embebibles, badges de
suscripción, bots de notificación por temática, editores de eventos, SDKs de referencia…

El catálogo completo —lo que ya existe, lo que está en marcha y lo que está *up for grabs*— vive en
**[opentechevents.org/#tools](https://opentechevents.org/#tools)**. Explóralo:

- **Construye algo del feed actual.** Cualquier consumidor (una app, un bot, una newsletter, un
  directorio) que lea `feed.json` ya funciona hoy, sin esperar a nadie.
- **Reclama una herramienta propuesta** para construirla, o **propón la que falte** — si te haría
  falta un importador, un exportador o un SDK concreto, abrir un issue prioriza qué se construye por
  demanda real.

---

## Licencias

- **Código**: MIT.
- **Feed agregado** (`feed.*`): **CC-BY-4.0**, con la atribución de cada evento en su `source`.

Solo entran al feed eventos cuya reutilización está clara, por una de dos vías: una **licencia abierta**
declarada en origen (`CC0-1.0` o `CC-BY-4.0`), o el **permiso explícito del organizador**, que queda
registrado en un issue. Ninguna otra — sin licencia ni permiso, la fuente no entra.

No se admiten licencias *share-alike* (`CC-BY-SA`, `ODbL`) ni `NC`/`ND`: una sola fuente *share-alike*
obligaría a **todo** el feed agregado —y a cualquiera que lo reutilice— a relicenciar su base de datos
igual, lo que mata el caso de uso que justifica el proyecto. El detalle está en
[la puerta de licencia](aggregator.md#puerta-de-licencia-open-data-gate).

---

## Roadmap

| Fase | Qué trae | Estado |
| --- | --- | --- |
| **0** | JSON Schema de OTE v0.1 publicado en npm. | ✅ Hecho |
| **1 (MVP)** | Conector `.ics`, feed `.json` + `.ics`, archivo, actualización diaria. | ✅ Código listo — ⏳ poblando fuentes reales |
| **2** | Alta de fuentes por formulario → PR automático con *dry-run*. | 🔜 En camino |
| **3** | Feeds RSS y JSON Feed; feeds pre-filtrados por temática. | Pendiente |
| **4** | Nuevos importadores (JSON-LD/schema.org, Meetup, Luma, Sessionize…) y deduplicación entre fuentes. | Pendiente — el importador de **feeds OTE** (`type: ote`) ya está |

**Importadores futuros**: la ingesta es modular desde el día 1. Cada plataforma nueva es un conector
independiente que no toca el núcleo. Si te interesa alguno en particular (o quieres aportarlo), dilo en
un issue — priorizamos por demanda real.

---

## Aprender más y colaborar

- **[aggregator.md](aggregator.md)** — el diseño completo, con el porqué de cada decisión.
- **[OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)** — el estándar de datos.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — cómo levantar el proyecto, cómo está organizado el código y
  cómo añadir un importador nuevo.
- **Feedback**: estamos empezando y nos vale de oro. [Abre un issue](../../issues/new/choose) o una
  [discusión](../../discussions) — sobre todo si eres organizador/a o mantienes una plataforma de eventos.
