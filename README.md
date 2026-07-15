# OpenTechEvents — data

An **interoperability and licensing layer for tech community events**: it unifies scattered calendars into a common feed, with each datum's license made explicit, so others can reuse them.

This repository collects the calendars of tech communities (meetups, user groups, conferences) and existing directories, unifies them, and publishes them in two complementary ways, with the provenance and license of each event made explicit:

- **In standard formats people already use** — iCalendar (`.ics`), RSS/Atom, JSON Feed. Subscribe to the feed in the calendar or reader you already have, without learning anything new.
- **In [OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)**, a new format designed specifically for the needs of technical communities. Standard formats fall short here: it models community, topic, event type (conference/meetup), attendance mode, location, *call for speakers*… with the granularity needed to build tools on top.

That is the point of the standard: **to enable the community to build tools** that let each person define and subscribe to exactly what they care about — by community, by topic, by event type, by location; discover new events; or assemble custom feeds (e.g. only *call for speakers* on a topic). The open-data commons is what makes all of that possible.

It is the data piece of the **[OpenTechEvents](https://opentechevents.org/)** project. The machinery and the data live here; the project and its context live on the website.

## What this is (and isn't)

**It is not yet another event directory with its own search, nor does it aim to compete with the ones that already exist** ([a roundup of calendars and directories](https://github.com/ComBuildersES/awesome-community-builders#calendarios)). On the contrary: it wants to be the **interoperability enabler that helps them all** build the best tool and interface for their users.

This solves the problem *before* any directory: that event data is scattered across a thousand calendars and platforms, in different formats, and **with no clear license** stating whether it can be reused. Solve that — once, in common — and every directory, app, or calendar can focus on its own thing: the best experience for its people, without reinventing the data plumbing.

What it brings:

- **Interoperability** — every event in the same format ([OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)), wherever it comes from. A consumer integrates once, not once per platform.
- **License guarantee** — every event states explicitly where it comes from (`source`) and under what license it can be reused. Nothing enters "because it's on the internet" (see [Licensing](#licensing)).

The goal is for **existing communities and directories to join and make the license of their data explicit**, so that more organisations — directories, apps, newsletters, calendars — can use it with guarantees. The more sources declare themselves open, the more useful the commons is for everyone.

> ⚠️ **We are in an early phase.** The feed is **already live and subscribable** (`https://data.opentechevents.org/feed.ics`), but it is being populated with the first real sources: at first you will see few events. We are looking for feedback from organisers and platforms: what breaks, what is missing, what would make this useful for you. [Open an issue](../../issues/new/choose) or drop by the [discussions](../../discussions).

---

## For platforms and developers (consuming the data)

Do you have a directory, an app, a bot, or a newsletter and want to feed on these events? The feed is published in standard formats under stable URLs:

| Feed | Format | For what |
| --- | --- | --- |
| `feed.json` | [OTE Feed](https://github.com/OpenTechEvents/opentechevents-spec) (JSON) | **Canonical.** Everything else derives from here. Start with this one. |
| `feed.ics` | iCalendar | Direct subscription in Google/Apple/Outlook Calendar. |
| `archive/YYYY.json` | OTE Feed | Past events, by year. Historical dataset. Browsable index at [`archive/`](https://data.opentechevents.org/archive/). |
| `archive/index.json` | JSON | Manifest of available years (`{ "years": [...] }`). Consumed by the archive index. |
| `report.json` | JSON | Ingestion health per source: events ok, warnings, errors. |

> `feed.xml` (RSS) and `feed.jsonfeed.json` (JSON Feed) are coming in [Phase 3](#roadmap).

**Why start with `feed.json`**: it is the single source of truth; the `.ics` and the rest are generated from it. If you integrate at the data level, integrate against the JSON and the published JSON Schema ([`@opentechevents/schema`](https://www.npmjs.com/package/@opentechevents/schema)); that way your integration does not depend on the quirks of any calendar format.

**URL stability**: the feeds are served under their own domain (`data.opentechevents.org`) so the URLs survive any reorganisation of the repo. The `.ics` URL is forever — people subscribe to it in their calendar and never touch it again.

**Are there SDKs?** Not yet, and to read you don't need them: OTE is plain JSON, consumed with any HTTP client and validated with a standard JSON Schema validator against [`@opentechevents/schema`](https://www.npmjs.com/package/@opentechevents/schema). There are **reference SDKs** (JS/TS, Python… to read, write, and validate, with a playground) among the proposed ecosystem tools — if you'd need one, say so (below).

When you use the feed, **respect attribution**: it is CC-BY-4.0 and each event states whom to attribute in its `source`.

### The ecosystem is yet to be built — and much of it, up for grabs

OTE Spec is recent: today the only piece running is this aggregator. Everything else is **proposed and free for someone to build** — Meetup/Luma/Sessionize/Eventbrite importers, schema.org/JSON-LD extractors, exporters to RSS and to schema.org/Event, embeddable widgets, subscription badges, topic-notification bots, event editors, reference SDKs…

The full catalogue — what already exists, what is in progress, and what is *up for grabs* — lives at **[opentechevents.org/#tools](https://opentechevents.org/#tools)**. Explore it:

- **Build something on the current feed.** Any consumer (an app, a bot, a newsletter, a directory) that reads `feed.json` already works today, without waiting for anyone.
- **Claim a proposed tool** to build it, or **propose the one that's missing** — if you'd need a specific importer, exporter, or SDK, opening an issue prioritises what gets built by real demand.

---

## For event organisers

**Do you run a meetup, group, or conference and want your events to show up?**

If your community already publishes an **iCalendar (`.ics`)** — Meetup, Google Calendar, Luma, and almost every tool export one — registering it is a form:

1. Open the **[source registration form](../../issues/new/choose)**.
2. Provide your `.ics` URL, its timezone, and the name/website you want to be attributed as.
3. Declare that the data can be republished as open data (you are an organiser and grant permission, or your calendar already has an open license). **This step is required**: a public `.ics` is not the same as a reusable one.

A bot reads the issue and opens a PR. Before it is approved you will see a *dry-run*: **how many events would enter and what they look like**. A human reviews and integrates it.

From then on, your events enter on their own with each daily update — a registered source means events forever, with no manual work.

**Your community doesn't publish an `.ics`?** For now `.ics` is the only supported format (see [Roadmap](#roadmap)). If you have another source (an API, JSON-LD on your site, etc.), tell us in an issue: it helps us prioritise which importers to build.

### What you control

- **Attribution**: each of your events links to your community in its `source` field.
- **Attendance mode** (in-person/online/hybrid): you declare it at registration; we do not guess it.
- **Cancellations**: if you mark an event `CANCELLED` in your calendar, subscribers see it cancelled in theirs.
- **Leaving**: if you take down your calendar or ask to be removed, your events disappear from the feed.

---

## For attendees (following events)

**Just want to keep up with tech events and not miss them?** Today the most direct way is to subscribe to the calendar once: events from every registered community show up — and update on their own — in your usual calendar app.

1. Copy the calendar URL: **`https://data.opentechevents.org/feed.ics`**
2. Add it as a subscribed calendar (not a one-off import) in your app:
   - **Google Calendar**: *Other calendars* → *Subscribe to calendar* → *From URL*.
   - **Apple Calendar**: *File* → *New Calendar Subscription*.
   - **Outlook**: *Add calendar* → *Subscribe from web*.

That way you see everything in one place, with the updates and cancellations the communities publish. If you prefer a feed reader, RSS/JSON Feed are coming in [Phase 3](#roadmap).

**What's coming: apps that filter by what matters to you.** The calendar dumps *all* events on you; the point of OTE Spec is for tools to exist that let you subscribe to exactly what interests you — by topic, city, attendance mode, or event type — and notify you (email, Telegram, webhook). That ecosystem is just starting: **there are no third-party apps consuming the feed yet**, but the ones that get built (readers by topic, notifications, widgets…) are listed at **[opentechevents.org/#tools](https://opentechevents.org/#tools)**. Missing one? Propose it there.

> The feed is being populated with the first sources; at first you will see few events. The more communities register, the more complete it gets — encourage yours to [sign up](#for-event-organisers).

---

## Licensing

- **Code**: MIT.
- **Aggregated feed** (`feed.*`): **CC-BY-4.0**, with each event's attribution in its `source`.

Only events whose reuse is clear enter the feed, by one of two routes: an **open license** declared at the origin (`CC0-1.0` or `CC-BY-4.0`), or the **organiser's explicit permission**, recorded in an issue. No other — without a license or permission, the source does not enter.

*Share-alike* licenses (`CC-BY-SA`, `ODbL`) and `NC`/`ND` are not accepted: a single *share-alike* source would force **the whole** aggregated feed — and anyone who reuses it — to relicense their database the same way, which kills the use case that justifies the project. The detail is in [the license gate](aggregator.md#puerta-de-licencia-open-data-gate).

---

## Roadmap

| Phase | What it brings | Status |
| --- | --- | --- |
| **0** | OTE v0.1 JSON Schema published on npm. | ✅ Done |
| **1 (MVP)** | `.ics` connector, `.json` + `.ics` feed, archive, daily update. | ✅ Code ready — ⏳ populating real sources |
| **2** | Source registration by form → automatic PR with a *dry-run*. | 🔜 On the way |
| **3** | RSS and JSON Feed feeds; pre-filtered feeds by topic. | Pending |
| **4** | New importers (JSON-LD/schema.org, Meetup, Luma, Sessionize…) and cross-source deduplication. | Pending — the **OTE feed** importer (`type: ote`) is already here |

**Future importers**: ingestion is modular from day 1. Each new platform is an independent connector that does not touch the core. If you're interested in a particular one (or want to contribute it), say so in an issue — we prioritise by real demand.

---

## Learn more and get involved

- **[aggregator.md](aggregator.md)** — the full design, with the reasoning behind each decision.
- **[OTE Spec](https://github.com/OpenTechEvents/opentechevents-spec)** — the data standard.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to set up the project, how the code is organised, and how to add a new importer.
- **Feedback**: we're just starting and it's worth gold to us. [Open an issue](../../issues/new/choose) or a [discussion](../../discussions) — especially if you're an organiser or maintain an events platform.
