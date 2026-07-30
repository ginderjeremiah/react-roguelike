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

## The concept seed

*Status: proposed, and **superseded in practice** — the M0 design review kept the skeleton below but
changed what darkness means. [ADR-0007](decisions/0007-emberdepth-sharpened.md) proposes the
amendment and is awaiting the owner; `docs/GDD.md` §1 is the accurate description of the game until
then. Do not build from the bullets below without reading it.*

*Original text, deliberately written as a concrete thing to attack rather than a vague space to
explore:*

**Working title: Emberdepth.**

You descend a lightless ruin carrying a lantern. Light is the core resource and the core tension:

- Your lantern burns fuel every turn it is lit. Fuel is the run timer, and it is scarce.
- Lit tiles are safe and legible — you see enemies, their intent, and the layout.
- Unlit tiles hide the map, but many of the ruin's inhabitants are *dormant in darkness* and wake
  in light. Moving dark is faster and cheaper but blind.
- So the central loop is a wager made every few turns: burn fuel to see and be seen, or move dark
  and gamble on what you cannot see.

Why this concept and not another: it pairs with our technology instead of fighting it. A glyph
grid renders light falloff beautifully as pure cell tinting, so our cheapest rendering primitive
becomes the game's signature look. A small vision radius means a small grid, which is exactly what
a phone screen wants. And light-vs-dark gives Pillar 1 a decision that recurs naturally every
handful of turns without any bolted-on system.

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
