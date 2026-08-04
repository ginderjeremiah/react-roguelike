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
  **(Measured 2026-08-04: the second sentence is not true of the build.** GDD §4 rules 0 fuel *a
  desperate state, not a loss state*, and `game/systems/economy.test.ts` asserts a dry crawl reaches
  the stairs on **80 of 80** floors. Fuel gates the lantern and nothing else, so a style that does not
  want the lantern has no clock at all. Recorded rather than rewritten because
  [#144](../../issues/144) rules whether the sentence or the rule is what changes.)
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

**If this fails:** the response is **subtraction and rebuild — never a second mechanic bolted on top.**
That is the whole of what this paragraph promises, and it is a constraint rather than a plan.

> **What *subtract* means, kept verbatim from #63's correction, because deleting it is how the next
> mistake gets made.** *Subtract* is right about the **direction**. What §12 and #63 add is the
> **size**: GDD §12's fallback is **not** "subtract fuel" — it is **pure positional tactics with
> enemies whose fixed patterns force contact**, which means deleting the lantern and the economy that
> makes killing pay and then rebuilding **the enemy, the level generator and the win condition**. A
> rebuild, in the subtractive direction. **Read GDD §12 before acting on this paragraph.**
>
> **This paragraph used to name that design as the *designated* fallback, and it no longer does.** A
> broad playtest reported the second failure condition on 2026-08-03 (PR #136), and
> [#139](../../issues/139) ruled on 2026-08-04 that **it fired**:
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md) supersedes ADR-0012.
>
> **What is withdrawn is the *automatic* consequent — "if the trigger fires, do this, without further
> argument" — and not the design.** Read correctly, the fallback would work: forced contact is an HP
> mechanism, and the finding that fired the arm is about HP. What it loses on is **proportionality**.
> It abandons a concept that the same playtest measures as serving Pillar 1 and Pillar 4 (13 of 38
> sampled turns as real decisions, a named retellable moment) for a design GDD §12 records as losing on
> Pillar 4 — and it does so **before anyone has tried deleting a single clause.** The design stays on
> the table as the strongest named alternative; what it no longer is, is automatic.
>
> **What is being done instead:** the wager's **cost side** is rebuilt — one rule change, its build and
> a playtest, which is far cheaper than the fallback and is the point — against two propositions: *a
> run that never opens the shutter must be able to die of the dark*, and *waking something must be able
> to be worth it*. Which rule is subtracted is [#144](../../issues/144); the trip-wire that judges the
> result is [#145](../../issues/145), and it names the fallback as the leading candidate if this fails.

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
