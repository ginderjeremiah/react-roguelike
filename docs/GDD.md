# Game Design Document

The living spec for how the game actually plays. `VISION.md` says what we are aiming at and
changes rarely; this document says how it works right now and changes often.

**Status: M0 design review complete.** The *Emberdepth* concept was reviewed, attacked, and
**sharpened** — see [ADR-0007](decisions/0007-emberdepth-sharpened.md) for what changed and why,
and §12 for the alternatives that lost. Sections below are marked *Settled*, *Proposed*, or *Open*.
Owned by the `game-designer` agent.

> Rule: nothing lands in this document without saying which pillar it serves. If it serves none,
> it does not belong in the game.

> Numbers marked **(tuning)** are first-playtest starting points, not design. Change them freely
> from playtest evidence without an ADR. Rules are not tuning; changing a rule needs a change-log
> row and a reason.

---

## 1. Core loop — *Settled*

You descend a lightless ruin. Your lantern has a shutter. **Open, you see the world; shuttered,
you see the living.**

- **Open (lit):** terrain, items, creatures, and enemy intent, within radius 4, blocked by walls.
  Burns fuel fast. **Everything inside the radius wakes up.**
- **Shuttered (dark):** terrain only in the 8 tiles you can touch — but *ember-sense* shows you the
  position of every living thing within radius 6, **through walls**. No intent. Burns fuel slowly.

Neither state is "seeing" and neither is "blind". They are two different, incomplete truths, and
the recurring decision (Pillar 1) is **which half of the truth you want right now**.

Three facts make that decision have teeth:

1. **Fuel comes from kills.** Creatures are made of ember. Killing one refuels the lantern. Fuel is
   not just a timer you spend down — it is a currency you must go and earn, in the dark, from
   things that will fight back.
2. **A dormant creature dies to one strike** (double damage, §3). Free kills exist, and they exist
   *only in the dark* — because opening the shutter is what wakes things.
3. **Light finds supplies; dark finds enemies.** Ember caches are terrain, invisible without light.
   Creatures are alive, invisible without dark. You cannot map a floor without the lantern and you
   cannot hunt it without shuttering.

So the loop is **flash and crawl**: crawl dark, using ember-sense to stalk and to steer around what
you cannot fight; flash the lantern for one or two turns to learn a room's shape and find its
cache, accepting that you have just announced yourself to everything in it; shutter and deal with
what you woke. Repeat down eight floors.

**The four M0 open questions, answered:**

| Question | Answer |
| --- | --- |
| Is one resource enough tension? | No — and the second axis already existed. **HP is the second resource, and the two are convertible in one direction only:** fighting spends HP to earn fuel, light spends fuel to preserve HP. That is an economy, not two clocks, and it needs no new UI. |
| What makes dark *actively* attractive? | Ember-sense (positional information light cannot give — it passes through walls) and the dormant-strike (the only free kills in the game). Dark is not the cheap option; it is the **offensive** option. |
| Do you ever want to wake an enemy? | Constantly. Fuel comes from kills, so combat is not optional; it is the income side of the economy. Light is not defensive — light is how you find things to kill and where to kill them. |
| How do you map unlit space? | Remembered terrain (permanent once seen) + touch (radius 1) + ember-sense for creatures. No sound system, no new mechanic. |

*What this rejects from the concept seed:* the seed said unlit tiles "hide the map" and moving dark
is "faster and cheaper but blind". Dark being *only* a cost saving is what would have flattened
this into "keep the lantern off unless lost". Ember-sense is the fix, and it is why the concept
survives. ADR-0007 records the change; VISION.md's concept-seed wording needs the owner's sign-off.

## 2. Turn structure — *Settled for M1*

**Scheduler.** A single integer clock and a priority queue on `(nextActAt, actorId)`. Each action
has a tick cost; the actor with the lowest `nextActAt` acts, ties broken by ascending `actorId`
(never by iteration order — ADR-0004).

**In M1 every action costs 100 ticks, so the observable behaviour is strict alternation.** The
general mechanism is built because it is ~40 lines and retrofitting it later is not; variable speed
is not designed and does not ship until something needs it (M3 at the earliest). Building the
mechanism is not the same as designing with it.

**Enemy intent: commit one turn ahead.** On its turn an awake creature *resolves the action it
declared last turn*, then declares its next action from the state at that moment. It cannot react
to what you do in between. This is Into the Breach's model and it is chosen for two reasons:

- Pillar 2 in its strongest form. The enemy's plan was fixed *before* you moved, so the outcome of
  your turn was fully determined by your decision. Nothing hidden, nothing reactive.
- Pillar 1. "Step off the marked tile" is a real defensive move that costs a turn, which makes
  movement a combat action rather than travel.

The price is that enemies can be baited. That is accepted: baiting is skill expression, and a
legible enemy you can outwit beats a smart enemy you cannot read.

**Telegraph rendering.** A declared attack marks its target tile; a declared move marks its
destination tile. The marker must be carried by **two non-color channels** (e.g. cell background
*and* a bracket/underline treatment) — colour is never the sole carrier (§11). Exact treatment is
the `ui-engineer`'s call.

**Intent is not visible while shuttered.** You see the `*` of a creature through ember-sense; you
do not see what it has committed to. Fighting dark means fighting an opponent whose plan is fixed
and unknown. This does not violate Pillar 2: the information exists and is purchasable for 4 fuel.
"I fought it blind to save fuel and it wound up while I stood still" is a completely legible death.

**Resolution order for one player command:**

1. Player command resolves (move, attack, wait, toggle shutter, descend).
2. Fuel burns at the current shutter rate.
3. Lighting and vision recompute. Any dormant creature now inside the lit radius **wakes** and
   immediately declares.
4. Every actor whose `nextActAt` has arrived: resolve declared action, then declare the next.
5. Deaths resolve; embers drop and are collected by walking over them.
6. Dark-adaptation counter ticks (§4).

**Toggling the shutter is a free action** — it does not consume a turn. A persistent thumb control
that costs a turn feels punitive on a phone (Pillar 3), and the toggle is already expensive in the
two ways that matter: fuel rate, and waking the room. Free of tempo is not free of consequence.

*Open:* variable action speeds; any action costing more or less than one turn. Deliberately not
designed yet.

## 3. Combat — *Model settled for M1, numbers are tuning*

*Settled principles (unchanged, not negotiable):*

- **Deterministic resolution.** No to-hit rolls, no damage ranges. Randomness lives in what the
  level generates and where things are, never in whether your correct decision worked (Pillar 2).
- Enemy intent is visible for the coming turn — when lit (§2).
- Positioning matters more than stats.

*Settled model:*

- **One action per turn. Attacking is your action.** No attack-and-move, no free attacks. This is
  what makes position cost something, and it is why a doorway is worth standing in.
- **Bump to attack.** Tapping an adjacent occupied tile attacks it. One tap, one action.
- **Movement is 4-directional.** No diagonals. Chosen over 8-directional because: tap targets are
  larger and unambiguous on a phone (Pillar 3); "adjacent" has exactly one meaning for attacks and
  dormant strikes; and doorways become genuine chokepoints instead of tiles you slip past
  diagonally — which is the whole reason the level is rooms and doors (§5). The cost is that
  movement is stiffer and fleeing is harder. Fleeing being hard is a feature here.
- **Flat integer damage.** Small numbers so the player can do the arithmetic on a phone without
  reading a log.
- **The dormant strike: attacking a dormant creature deals double damage.** This is the mechanical
  payoff for playing dark and the answer to "what can I only do in darkness". If the target
  survives, it wakes.
- **No healing within a floor.** HP declines monotonically until you descend. This is what makes HP
  a real second resource rather than a refillable buffer.
- **Descending restores 2 HP (tuning).** Creates the macro decision "clear this floor for fuel, or
  dive now and bank the heal", and prevents a slow unwinnable spiral.

*Numbers for M1 (tuning):*

| | Value |
| --- | --- |
| Player HP | 12 |
| Player attack | 3 (6 vs dormant) |
| Cinder HP | 5 |
| Cinder attack | 2 |

Consequences worth checking in playtest: a dormant Cinder dies to one strike and costs 0 HP. An
awake Cinder takes two strikes and costs 2-4 HP if you engage it well, more if it reaches you
first. **The gap between a stalked kill and a botched one is the entire skill gradient**, and it is
under player control, not under the RNG's.

*Open:* status effects (none in M1), any second player attack option, ranged anything.

## 4. Light, fuel, and ember-sense — *Settled for M1-M2*

The signature system.

**Vision states.**

| | Lit (shutter open) | Dark (shuttered) |
| --- | --- | --- |
| Terrain | Radius 4, line-of-sight blocked by walls | Radius 1 only (the 8 tiles you can touch) |
| Remembered terrain | Permanent once seen, dimmed | Permanent once seen, dimmed |
| Creatures | Visible in the lit radius, identified | **Ember-sense: position only, radius 6, through walls** |
| Enemy intent | Visible | Hidden |
| Items / ember caches | Visible in the lit radius | Invisible |
| Effect on creatures | **Every dormant creature in the radius wakes** | Nothing wakes |
| Fuel burn | 4 / turn (tuning) | 1 / turn (tuning) |

Two asymmetries are doing all the work and both are single rules:

- **Ember-sense ignores walls; light does not.** Darkness therefore tells you something light
  physically cannot — what is in the next room. That is the whole answer to "why go dark".
- **Light reveals ~20 tiles per turn; touch reveals 8 once.** Light is by far the cheaper way to
  *explore* (4 fuel for a room versus ~20 turns of feeling along walls), and dark is the cheaper
  way to *travel and stalk*. Neither dominates, and the reason is arithmetic rather than a special
  rule.

**Ember-sense gives position only.** Not identity, not health, not intent. This was deliberately
cut back from a richer version: brightness-encoded health cannot be the sole carrier of meaning
(§11) and "a living thing is there" is already the information that makes stalking work.

**Dark adaptation.** On shuttering, ember-sense radius drops to 2 and recovers +1 per turn back to
6. Purpose: it makes a flash a *commitment* rather than something you strobe every other turn, and
it creates the tensest moment in the game — the four turns after you shutter, when you have woken a
room and cannot yet feel where anything is. Physically intuitive (eyes adapt), one integer of
state, no text needed to explain.

The second brake on strobing is not a fuel tax at all: **opening the shutter wakes things, and
nothing ever un-wakes because you shuttered again.** A player who strobes wakes the floor.

**Fuel.**

- Sources: **kills** (Cinder drops 30, tuning) and **ember caches** in the level (40 each, 1-2 per
  floor, tuning). Caches are terrain and require light to find. Start of run: 80 (tuning).
- Fuel reaching 0: the shutter can no longer be opened. You are not dead — you can still crawl at
  radius 1 with ember-sense, and the stairs are still findable. It is a desperate state, not a
  loss state, and it is exactly the situation Pillar 4 wants people retelling.

**The three tuning invariants** (these are design; the numbers above are not):

1. Avoiding all combat must be **unsustainable** — a pacifist run runs dry.
2. Keeping the shutter open must be **unsustainable** — a floodlit run runs dry faster.
3. A floor played well nets **slightly positive** fuel, so competence is rewarded and greed is the
   thing that kills you.

**Awake-creature behaviour** (M2, but specified here because §6 depends on it): an awake creature
knows the player's tile while the shutter is open **or** while adjacent. Shuttered and not adjacent,
it moves to your last known tile and then searches. After 8 turns (tuning) with no light and no
adjacency it returns to **dormant** — and becomes a legal dormant-strike target again. Darkness is
therefore restorative: a botched flash is recoverable by skilled dark play, within one floor.

*Watch:* re-dormancy is the mechanic most likely to degenerate. If the playtester reports retreating
to a cleared room and pressing wait, it is broken. The fix is a distance requirement, not a fuel
tax.

*Open:* adjustable lit radius, thrown/placed light sources (parked as a candidate M3 item, §12),
whether floors ever have ambient light.

## 5. Level generation — *Settled for M1*

**One algorithm, one theme: chambered ruin.**

**Grid: 11 wide × 15 tall.** Derived from the screen, not chosen aesthetically: a 6-inch phone in
portrait is ~390 logical px wide; 11 columns gives ~35px cells, which is a defensible tap target
with a HUD above and a lantern control below, and no panning ever (Pillar 3). Width is the binding
constraint; 15 rows fits comfortably.

**Structure: a 2 × 3 lattice of rooms separated by 1-tile walls.**

```
width  = 5 + 1 + 5           = 11
height = 4 + 1 + 4 + 1 + 4   = 15
```

Six rooms of ~20 tiles. Six is a graph you can hold in your head, which is the point — the mental
map you build in the dark is *rooms and which wall the door was in*, not a pixel-accurate map.

**Generation steps (all from the seeded RNG):**

1. Lay the lattice. Jitter each room's interior by 0-1 tiles where the lattice allows.
2. Random spanning tree over the 6 rooms; each tree edge becomes a 1-tile doorway at a random
   position on the shared wall. **Guarantees connectivity.**
3. Add 1-2 extra doorways to create loops. Loops are not decoration — they are escape routes, and
   without them waking a room is a death sentence rather than a problem.
4. **0-1 room merges:** delete a shared wall entirely, creating a 5×9 hall. The cheapest source of
   floor-to-floor variety (Pillar 4).
5. Place 0-2 pillars per room (`o`, blocks movement and light, does not block ember-sense). Cover
   for positioning, and something for ember-sense to be "behind".
6. Entrance in one room; **stairs in the room with the greatest graph distance from it**.
7. Creatures: `min(2 + floor, 6)`, dormant, never in the entrance room, never within 2 tiles of the
   entrance.
8. Caches: 1-2, biased toward leaf rooms of the spanning tree — so going off-route for fuel is
   itself the fuel wager VISION asks for.

**No corridors.** Not "short corridors" — none. A corridor is a sequence of turns with one legal
move, which is Pillar 1's definition of a turn that should not exist. Rooms and thresholds only.

**Why this is interesting in darkness:** the unit of memory is a room and its doors. Ember-sense
tells you *there are two things in the room north of me* while giving you no idea whether there is a
door on that wall. The decision "flash to find the door, or feel along the wall and hope" is
generated by the level shape, every floor, for free.

**Run length: 8 floors (tuning).** ~40-70 turns per floor × 8 ≈ 400-550 turns ≈ 15-25 minutes.

**Testable invariants** (for the `test-engineer`, property-tested over many seeds): every floor is
connected; stairs are reachable from the entrance; no creature spawns within 2 tiles of the
entrance; grid is exactly 11×15; the same seed produces the identical floor.

## 6. Entities — *Settled for M1*

**Exactly one enemy: the Cinder.**

| | |
| --- | --- |
| Glyph | `c` dormant (seen in light) · `C` awake · `*` ember-sense contact (identity unknown) |
| HP / attack | 5 / 2 (tuning) |
| Drops | 30 ember (tuning) |
| Dormant | Yes. Wakes when caught in the lit radius, or when attacked and survives. |

**Behaviour worth reading (Pillar 2):** the Cinder is drawn to light. Awake, it paths toward you
while your shutter is open or while it is adjacent to you. Shuttered and non-adjacent, it paths to
where it last saw your light, then searches; after 8 turns of no contact it goes dormant again.

That single rule makes the lantern a **combat** control, not only an exploration one: shuttering
mid-fight trades away the enemy's intent telegraph in exchange for the enemy losing you. "I
shuttered the lantern and let it walk past me in the dark" is the retellable moment (Pillar 4), and
it keeps the light decision alive *inside* a fight instead of settling it at the start.

Case and shape carry dormancy, not colour (§11).

*Open:* every other creature. M3.

## 7. Items and abilities — *Open, M3*

Bias unchanged: few items, each changing how you play. No stat-stick loot, no inventory tetris
(Pillar 1). The strongest parked candidate is a **placeable light source** — see §12.

## 8. Difficulty and pacing — *Proposed*

Target 15-30 minutes, 8 floors. Difficulty comes from the fuel economy tightening and creature
density rising, never from HP inflation.

Per floor: creatures `min(2 + floor, 6)`; caches stay at 1-2 so income per creature falls in
relative terms as the floor takes longer to cross. Player numbers never change during a run in M1 —
there is no progression system, and there will not be one before M3.

## 9. Controls — *Settled*

Touch-first (Pillar 3):

- Tap an adjacent tile to move; tap an adjacent occupied tile to attack. 4-directional, so there
  are exactly four targets and they are large.
- Tap your own tile to wait.
- Tap a distant **remembered** tile to path toward it — **interrupted the moment anything new
  becomes visible or sensed, or any creature wakes.** Auto-travel that walks you into an ambush
  violates Pillar 1.
- Lantern shutter: a persistent, thumb-reachable toggle. **Free action.**
- Stairs: tap them while standing on them.
- Keyboard on web is a convenience layer, never the primary design target.

HUD, minimum: HP, fuel, floor number, shutter state, ember-sense radius (because dark adaptation is
invisible otherwise).

## 10. Presentation — *Settled at the technology level*

Glyph grid, colour-forward (ADR-0003). Light falloff expressed as cell tint and opacity. The
aesthetic goal is "a beautiful terminal," not "a cheap tileset."

Glyph set for M1: `@` player · `#` wall · `·` floor · `o` pillar · `>` stairs down · `♦` ember
cache · `c`/`C` Cinder dormant/awake · `*` ember-sense contact.

Four cell states must be distinguishable at a glance without colour: **lit**, **remembered**,
**unknown**, **sensed-but-unseen** (a `*` on a tile whose terrain you have never seen).

Palette, typography, and animation specified in M4.

## 11. Accessibility — *Requirements settled*

Not deferred to the end as a checklist item; these constrain design from the start.

- Colorblind-safe palette; **colour never the sole carrier of meaning.** This has already cut one
  mechanic (brightness-encoded health in ember-sense, §4) and constrains intent markers (§2).
- Text scaling respected.
- Reduced-motion honored.
- One-handed play on a phone.
- No timing-dependent input anywhere (free, given turn-based).

## 12. Alternatives that lost — *Record*

Kept so we do not relitigate, and so we know what to fall back to.

**Pure positional tactics, no resource at all** (Hoplite-shaped: enemies with fixed, readable
movement patterns; tension entirely from geometry). The genuine runner-up, and the strongest
Pillar 1 and Pillar 3 fit of anything considered. It lost on Pillar 4 — a puzzle produces "I played
well", not "the lantern died on floor six and I crawled to the stairs" — and because it makes the
glyph grid's signature look (ADR-0003) irrelevant. **This is the designated fallback:** if the M2
playtest says the light wager is not tense, the move is to strip fuel and keep the tactics, not to
add a second resource. Its lesson has been stolen regardless: combat should be positionally tight,
and §2's commit-one-turn-ahead is that lesson.

**Light as a ward — things hunt you in the dark, light repels them.** Rejected: it makes darkness a
pure cost saving, which is precisely the flaw that nearly killed the original seed. A "pay money
for safety" slider is a slider, not a decision.

**Sound instead of light** (actions make noise, noise wakes things). Same structure, strictly worse
for this project: sound does not render, and a glyph grid renders light for free.

**Placeable torches** — build a network of permanently lit safe islands. Genuinely interesting, but
it is a logistics game: placement decisions are infrequent and slow, which is the opposite of
Pillar 1's dense turns. **Parked as a single M3 item**, where one placeable light interacting with
an existing system is depth rather than a new system.

**A second resource bar** (heat, sanity, noise) to give the wager a second axis. Rejected because
the second axis already existed: HP. Adding a bar would have been additive design solving a problem
that subtraction solved better.

---

## Change log

Design changes get a line here with the reason. Not a substitute for git history — a reason,
recorded at the moment we made it, is the part git cannot give us.

| Date | Change | Why |
| --- | --- | --- |
| 2026-07-29 | Document created as a skeleton | Groundwork; M0 design review fills it in |
| 2026-07-29 | **Concept sharpened, not replaced: darkness now carries information (ember-sense) instead of only being cheap** | The seed's dark-is-blind-and-cheap framing made light a pure cost with a pure benefit, which flattens to "shutter unless lost". Three of the four M0 open questions were symptoms of that one flaw. ADR-0007 |
| 2026-07-29 | Fuel is earned from kills, not only found | Makes combat the income side of an economy, which is what makes the player *want* to wake things. Answers M0 open question 3, which otherwise had no answer |
| 2026-07-29 | HP named as the second resource; no new bar added | The wager did need a second axis (open question 1). Subtracting was better than adding: fighting converts HP into fuel, light converts fuel into HP |
| 2026-07-29 | Dormant strike deals double damage | Gives darkness a capability, not a discount. The only free kills in the game exist only unlit |
| 2026-07-29 | Enemies commit their action one turn ahead | Strongest available form of Pillar 2 — the enemy's plan is fixed before you move, so your decision alone determined the outcome. Accepts baitability as skill expression |
| 2026-07-29 | Energy scheduler built, but every M1 action costs the same | The mechanism is cheap now and expensive later; designing *with* variable speed before anything needs it is not. Ship alternation, keep the seam |
| 2026-07-29 | Movement is 4-directional | Larger unambiguous tap targets (Pillar 3), one meaning of "adjacent", and doorways become real chokepoints instead of tiles you slip past diagonally. Runner-up 8-dir lost on the chokepoint point |
| 2026-07-29 | Shutter toggle is a free action | A persistent thumb control that costs a turn feels punitive (Pillar 3). It is already expensive in fuel and in waking the room |
| 2026-07-29 | Dark adaptation: ember-sense shrinks to 2 on shuttering, recovers +1/turn | Stops strobing without a fuel tax, and makes the turns right after a flash the tensest in the game (Pillar 4) |
| 2026-07-29 | Ember-sense gives position only — cut brightness-encoded health | Colour/brightness cannot be the sole carrier of meaning (§11), and position alone is already sufficient for stalking. Subtract before adding |
| 2026-07-29 | Level gen: 11×15 chambered ruin, 2×3 rooms, no corridors | Grid size derived from a 390px phone width with ~35px taps and no panning. Corridors are turns with one legal move, which Pillar 1 forbids outright |
| 2026-07-29 | One enemy for M1: the Cinder, drawn to light | Its one rule makes the lantern a combat control, keeping the light decision alive inside a fight rather than settled at the start |
