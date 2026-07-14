# Cards are convictions; the deck is home; the feed is the archive

The Build 1 demo slice (docs/hack/hackathon.md) introduced desk-authored "cards" with a five-part anatomy: position / thesis / why-now timeline / what-breaks-it / gate report. Three linked decisions fix how that fits the existing model.

**A card is a conviction, not a new entity.** The conviction schema grows optional anatomy fields (why-now timeline, what-breaks-it, gate report) and `postConviction` accepts them. One entity, one verb — consistent with ADR 0008 (feed seeded with real convictions) and with the desk posting through the verb layer like any other author.

**The deck is the home surface.** After login the user lands on the swipeable card stack (skip / save / back). The list feed and concierge remain reachable but secondary; the demo path needs zero navigation.

**The feed is the archive.** Swiped cards land in the feed, newest drop first — "scroll back through the drops" happens there, reusing the shipped surface. Saved cards are a "Saved" filter chip on the feed, not a new surface. An exhausted deck shows a considered end state ("next drop tomorrow", pointing to feed + saved), never a blank screen.

## Alternatives rejected

- **Presentation-only cards** (anatomy hand-authored in static content keyed to a conviction id): fastest, but the gate report becomes cosmetic — nothing ties a card's backability to a passed gate check.
- **Separate desk-card entity**: cleanest match to the Build 2 desk vision, but forks the data model and the verb layer during demo week.
- **Deck as a sibling route** with the feed still home: two competing ways to browse convictions, and judges land on the weaker surface first.
- **Re-browsable / looping deck** for history: re-showing skipped cards reads as broken and needs per-user swipe-state rules there is no time to design.

## Consequences

- Plain user convictions render as cards with sparse anatomy; that is acceptable — desk cards carry the full anatomy and the demo deck is desk-authored.
- The anatomy fields are optional at the schema level; what gates deck inclusion and backability is product policy (gate report present), not the type system.
- The feed's job changes from primary surface to archive + Saved; the concierge summarizer (issue #6) operates over it unchanged.
- `gate-check.ts` output lands directly in the conviction's gate-report field — the seed of `src/lib/gate/*` for Build 2.
