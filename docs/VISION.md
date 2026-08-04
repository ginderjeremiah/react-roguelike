# Vision

The north star. When a decision is contested, it is settled here. Changing this document is a
deliberate act that requires an ADR in `docs/decisions/`, not a casual edit.

## What we are building

A short-run, turn-based roguelike that is genuinely good to play on a phone, and equally good in a
browser. Runs last 15-30 minutes. Death is permanent, the world is regenerated from a seed each
time, and the interesting decisions happen turn to turn rather than in menus.

## Design pillars

These are load-bearing. A feature that violates a pillar gets cut, no matter how fun it sounds in
isolation.

**1. Every turn is a decision.**
If the optimal move is obvious, the turn should not exist. No corridors you walk down on
autopilot, no "attack until it dies" grind. Prefer few, dense turns over many, thin ones. This is
the pillar that most often kills features — it is the reason we will not have inventory management
for its own sake, or resource gathering, or filler encounters.

**2. Legible, not hidden.**
The player can always see why they died. Damage numbers, enemy intent, and turn order are visible
before you commit. Randomness decides *what situation you are in*, never *whether your good
decision worked*. Prefer deterministic combat resolution with random encounters over random
combat resolution.

**3. Touch-native, not touch-tolerated.**
Designed for a thumb on a 6-inch screen first, then scaled up — never a desktop game with bigger
buttons. Small grids. No text the size of a footnote. Every action reachable one-handed. If a
mechanic requires a keyboard to be pleasant, it is the wrong mechanic.

**4. A run is a story you can retell.**
Because runs are deterministic and seeded, a run is a shareable artifact. Design toward memorable
swings — the moment the lantern died, the gamble that paid — rather than a smooth difficulty
curve.

## The concept

*Status: **settled**, as amended by [ADR-0007](decisions/0007-emberdepth-sharpened.md) following
the M0 design review. `docs/GDD.md` is the detailed specification; this is the one-paragraph
version. The original seed's wording is preserved in ADR-0007's Context section — it claimed
something this game no longer does.*

**Working title: Emberdepth.**

You descend a lightless ruin carrying a lantern. Light is the core resource and the core tension —
but the wager is not "see or be blind", it is **which half of the truth you want**:

- Your lantern burns fuel every turn, faster when open than when shuttered. Fuel is the run timer.
- **Open, you see stone:** terrain, items, creatures, and their intent — but only within a short
  radius, and not through walls. Light is also what wakes the ruin's dormant inhabitants, so an
  open lantern announces you.
- **Shuttered, you see souls:** *ember-sense* gives you the position of every living thing around
  you, **through walls** — but no identity, no health, no intent, and no map.
- Fuel is **earned by killing**, because the ruin's creatures are made of ember. So you often want
  to wake something.
- Attacking a dormant creature deals double damage. Free kills exist, and exist only in the dark.

So the loop is **flash and crawl**: crawl dark to stalk and steer, flash to learn a room's shape
and find its cache, accept that the flash announced you, then deal with what you woke. The second
resource the wager needs is HP, which already exists — fighting spends HP to earn fuel, light
spends fuel to preserve HP.

Why this concept and not another: it pairs with our technology instead of fighting it. A glyph
grid renders light falloff beautifully as pure cell tinting, and ember-sense is a dim mark on an
unknown tile — so our cheapest rendering primitive becomes the game's signature look. A small
vision radius means a small grid, which is exactly what a phone screen wants.

**If this fails:** GDD §12 records pure positional tactics with no resource clock as the designated
fallback. If the M2 playtest reports the light decision is not tense, or that the lantern is opened
only when lost, the response is to *subtract* fuel — not to add another mechanic on top.

> **A playtest has now reported the second condition** (2026-08-03, PR #136), and whether that
> spends the fallback is being ruled on [#139](../../issues/139) — **open, and not to be inferred
> from this line.** ADR-0012 restated the trigger as two arms and a bound; the bound is now spent.
> Cutting against firing: arm 1 came back emphatically negative and the playtest classifies its own
> finding as *tuning*, with #109 — the measurement of the invariant at issue — not yet run. Cutting
> for it: ADR-0012 restated the trigger precisely because a trip-wire that survives its own firing
> condition never trips, and **arm 2 has no tuning escape clause**.
>
> **One clarification on the word above, because this note is not overruling it.** *Subtract* is
> right about the **direction** — the answer to a failed wager is never a second mechanic bolted on.
> What §12 and #63 add is the **size**: subtracting fuel means deleting the lantern and the economy
> that makes killing pay, then rebuilding the enemy, the generator and the win condition around
> forced contact. A rebuild, in the subtractive direction. **Read GDD §12 before acting on either
> paragraph.**

## Non-goals

Stated plainly so we stop relitigating them:

- **No multiplayer, no realtime.** Turn-based, single-player.
- **No accounts or backend** until there is a game worth competing over. See ADR-0006.
- **No procedural narrative or dialogue trees.** The story is the run.
- **No sprite art pipeline.** Glyphs and color. See ADR-0003.
- **No monetization, no ads, no analytics.** This is not a commercial product.
- **No "content volume" as a goal.** Thirty well-tuned enemies beat three hundred variants.

## How we know it is working

Not metrics for their own sake — these are the questions the `playtester` agent is asked to answer
after every milestone:

- Can a new player understand why they died, without being told?
- In a typical run, how many turns were genuinely decisions vs. autopilot? (Pillar 1, measured by
  the playtester's honest count over a sample of turns.)
- Does a run finish in 15-30 minutes?
- Does it feel good with one thumb on a phone-sized viewport?
- Would you immediately start another run?

A milestone is not done until the playtester answers these and the answers are recorded in
`docs/JOURNAL.md`.
