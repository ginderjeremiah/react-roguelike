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
  position of every living thing within radius 5, **through walls**. No intent. Burns fuel slowly.

Every radius in this document is **Chebyshev** — a square, `max(|dx|, |dy|) ≤ r` — with one
deliberate exception, §5's creature spawn exclusion, which counts steps. §4 gives the reasoning.

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
what you woke. Repeat down eight floors — taking the stairs on the last one is how a run is won
(§13).

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
survives. ADR-0007 records the change and is **Accepted**; VISION.md was amended to match on
2026-07-30 (#8), and the original seed's wording survives only in ADR-0007's Context section.

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

1. Player command resolves (move-or-attack, wait, set the shutter, descend — §3 and §9 give the
   whole vocabulary, and it is four commands, not five).
2. Fuel burns at the current shutter rate.
3. Lighting and vision recompute. Any dormant creature now inside the lit radius **wakes** and
   immediately declares.
4. Every actor whose `nextActAt` has arrived: resolve declared action, then declare the next.
5. Deaths resolve; embers drop and are collected by walking over them.
6. Dark-adaptation counter ticks (§4).

**Toggling the shutter is a free action** — it does not consume a turn. A persistent thumb control
that costs a turn feels punitive on a phone (Pillar 3), and the toggle is already expensive in the
two ways that matter: fuel rate, and waking the room. Free of tempo is not free of consequence.

Concretely, in terms of the six phases above: a free action runs **1, 2, 3 and 5** and skips **4 and
6**. It resolves and it is paid for; it just does not hand the floor a turn.

- It skips **4 (actors)**, because that is what "does not consume a turn" means. A command that
  merely declines to charge the player still gets charged by phase 4 *and* gives every creature on
  the floor a free turn.
- It skips **6 (dark adaptation)**, because §4 recovers ember-sense "+1 per *turn*". If a free action
  ticked it, strobing would climb the ramp without spending turns.
- It **runs 2 (fuel)**, because §4's exploration arithmetic is priced in it: a flash costs its 4.
  This is not the fuel tax §4 rules out — there is no surcharge for toggling, the lantern simply
  burns at the rate the shutter is set to.
- It **runs 3 (lighting and waking)**, because opening the shutter must wake the room *immediately*.
  That is the whole cost of the toggle.

One consequence worth knowing: a creature woken *during* a free action sees two player commands
before its declared action resolves. That is more conservative than commit-one-turn-ahead requires.

**Refused actions run no phases at all.** A free action runs four of the six phases. **Four**
well-formed commands run **none**, because the situation leaves them nothing to do:

| Refused | Because |
| --- | --- |
| A move into a wall, a pillar, or off the grid | There is nowhere to step |
| `descend` while not standing on the stairs | §9 — the stairs are where you take them |
| `setShutter(to)` where the shutter already reads `to` | Re-asserting a setting is not a change — below |
| Any command at all once the run has ended | §13 |

A refusal costs nothing: no fuel, no creature turn, no adaptation tick, no change to any field of
the state. It is not an error either — `step()` throws only on a **malformed** command (an unknown
kind, a direction that is not one of four). A tap that arrives a frame after the killing blow, or a
thumb that lands one cell off, is an ordinary thing for a phone to produce and crashing on it is
not an option (Pillar 3).

**This is not a licence to probe the dark for free**, and the reason is a rule §4 states: *you always
know your own four neighbours.* The tile you bumped was already in your perceived set at the start
of the turn — in light, in darkness, and at the very bottom of the adaptation ramp. Nothing is
learned by walking into a wall, so nothing is being bought for free. What charging a turn for it
*would* buy is a fat-fingered tap that also hands every creature on the floor a turn: punishing the
interface rather than the decision, which is the same argument that made the shutter toggle free.

**Re-asserting the shutter is not toggling it.** What this section makes free is *changing* the
shutter, and it is free of **tempo**, not of **fuel** — a flash costs its 4. So a `setShutter`
command naming the setting the shutter already holds must not resolve: it would charge 4 fuel for a
double-tap on a control that already reads *open*, which is the same fat-fingered tap refused
everywhere else here (Pillar 3). Nor is it exploitable the other way — the command it refuses was
free of tempo anyway, so refusing it skips no turn and hands nobody an extra one. The rule is small
and easy to lose, and it exists only because a **setting** can be re-asserted where a **toggle**
could not; §9 has the distinction.

**The input layer refuses first and `step()` is the backstop.** An impassable neighbour is not a tap
target and the descend control is absent unless you are on the stairs (§9), so a refusal should be
rare in play. And **a refused tap must still produce feedback** — a tap that does nothing at all
reads on a phone as "the touch did not register", which is a UI failure wearing the costume of a
rule. The treatment is the `ui-engineer`'s call; that there is one is not.

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
- **One directional command, not two. There is no separate `attack`.** What a tap on an adjacent
  tile does is decided by what is standing there at the moment of the tap — never by a mode, never
  by a modifier. So "attack an empty tile" is not something the player can ask for: the same tap is
  a move. The only reason to want it would be to strike a tile a creature is *about to* enter, and
  player attacks resolve immediately against what is there **now**, so it buys nothing and costs a
  second tap target per direction on a 6-inch screen (Pillar 3).
- **Movement is 4-directional.** No diagonals. Chosen over 8-directional because: tap targets are
  larger and unambiguous on a phone (Pillar 3); "adjacent" has exactly one meaning for attacks and
  dormant strikes; and doorways become genuine chokepoints instead of tiles you slip past
  diagonally — which is the whole reason the level is rooms and doors (§5). The cost is that
  movement is stiffer and fleeing is harder. Fleeing being hard is a feature here.
- **Flat integer damage.** Small numbers so the player can do the arithmetic on a phone without
  reading a log.
- **The dormant strike: attacking a dormant creature deals double damage.** This is the mechanical
  payoff for playing dark and the answer to "what can I only do in darkness". If the target
  survives, it wakes — **and against a Cinder it cannot survive**: 6 against 5 HP. The clause is
  reserved for creatures that do not exist yet (§6 has one, the rest is M3), and the numbers are
  deliberately *not* moved to make it live. §2's phase order is the reason: the player acts in phase
  1 and creatures in phase 4, so a survivor declares on the turn it wakes and resolves on the next —
  it gets a swing in only if it survives the strike **and** a full follow-up attack, which needs 10
  HP, which makes an awake Cinder a four-hit grind. That is Pillar 1's "attack until it dies", bought
  to make one sentence true. **Written down because an unreachable clause reads as a live branch** —
  the same defect as #80's undrawable `c` glyph, found the same week.
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

**Every vision radius is Chebyshev — a square.** `max(|dx|, |dy|) ≤ r`. This holds for the lit
radius, the dark touch radius, the ember-sense radius, and every value the dark-adaptation ramp
passes through. Reasoning in *Why a square*, below.

**Vision states.**

| | Lit (shutter open) | Dark (shuttered) |
| --- | --- | --- |
| Terrain | **Chebyshev radius 4**, line-of-sight blocked by walls and pillars | **Chebyshev radius 1** only — all 8 tiles you can touch, no line-of-sight check |
| Remembered terrain | Permanent once seen, dimmed | Permanent once seen, dimmed |
| Creatures | Visible in the lit radius, identified | **Ember-sense: position only, Chebyshev radius 5 (tuning), through walls** |
| Enemy intent | Visible | Hidden |
| Items / ember caches | Visible in the lit radius, and **lighting one is what makes it takeable** | **Invisible — an unlit cache tile is felt as ordinary floor, and pays nothing** |
| Effect on creatures | **Every dormant creature in the lit radius wakes** | Nothing wakes |
| Fuel burn | 4 / turn (tuning) | 1 / turn (tuning) |

Two asymmetries are doing all the work and both are single rules:

- **Ember-sense ignores walls; light does not.** Darkness therefore tells you something light
  physically cannot — what is in the next room. That is the whole answer to "why go dark".
- **A flash buys a room; touch buys a step.** Opening the shutter inside a 5×4 or 5×5 room reveals
  the entire room and the walls around it, from any tile in it — that is what radius 4 Chebyshev
  *is* (see below) — **and it reveals the room's cache, which is the only way a cache ever becomes
  takeable** (*What the dark may take*, below). Feeling the same room out by touch is 10-15 turns at
  1 fuel each; it gives you the shape and the exits, and it gives you **no cache**, because an unlit
  cache tile is remembered as ordinary floor.

  **The arithmetic this bullet used to state was wrong in the unit that mattered, and the correction
  is not a tuning change.** A flash is `open` then `shut`: 4 fuel at the lit rate plus 1 at the dark
  rate, and **both are free actions, so it costs no turns at all** (§2, ruled 2026-08-02). So light
  is **two to three times cheaper in fuel** for exploring and is **not measured in turns** — which
  means the thing this paragraph was really pricing does not appear in it. **The flash's price is
  neither fuel nor tempo. It is what it wakes**, which is the same conclusion §12 reached from the
  other end and the reason #83 exists. Dark stays four times cheaper for crossing space you have
  already seen, and that is where a cache is actually *collected*: **the lantern prospects, the dark
  hauls.** Neither dominates, and the reason is still arithmetic rather than a special rule.

**You always know your own four neighbours.** The dark touch radius and the adaptation floor are
the same 1, deliberately (below), and that has a consequence worth stating as its own rule: however
the shutter is set and however blind you currently are, **all four tiles you could step to are
perceived at the start of your turn.** Touch reaches them for stone; ember-sense reaches them for
the living, even at the bottom of the ramp; and with the shutter open the radius-4 field covers them
too, since an orthogonal neighbour is never behind a wall from where you stand. There is no unknown
among your move targets, ever. This is the guarantee that lets §2 refuse an illegal move for free —
walking into a wall teaches you nothing you did not already know.

**Why a square — the metric ruling.**

The radii were written before anyone said what measured them. Three candidates: Chebyshev (a
square), Euclidean (a rough disc), Manhattan (a diamond). Chebyshev wins on four counts.

1. **§4 had already committed to it and did not notice.** "Radius 1 — the 8 tiles you can touch"
   is only true under Chebyshev. Manhattan radius 1 is 4 tiles; Euclidean radius 1 is 4 tiles.
   Touch is 8 and should be 8: in the dark you must be able to feel a wall corner and a diagonal
   doorway, or feeling your way along a wall stops working entirely. Lit and dark terrain vision
   are the *same sense at different reach*, so the metric that governs one governs the other.
2. **A square is the only shape the player can state as a rule (Pillar 2).** The lit region is the
   most visible object in the game — it is rendered as tint on every cell, every turn. A square
   edge is countable and grid-aligned. A digitised disc at r=4 has single-tile nubs at the four
   compass points and a jagged silhouette the player can only memorise as a picture. A diamond
   leaves the corners of a rectangular room dark for no visible cause, which on a glyph grid reads
   as a rendering bug rather than a rule. "The player can see why they died" requires that the
   player can see where the light ended.
3. **The alternatives create an autopilot turn (Pillar 1).** In a 5×4 room, Euclidean radius 4
   leaves 4-5 tiles dark unless you stand near the middle; Manhattan radius 4 lights the whole
   room *only* from the exact centre tile. Both therefore make "walk to the middle of the room,
   then flash" the always-correct move — an obvious optimal turn, which is the definition of a
   turn that should not exist. Under Chebyshev the flash decision is purely *when*, never *where*,
   and "when" is the axis that carries fuel, waking, and adaptation state.
4. **Radius 4 becomes a statement instead of a number.** The largest unmerged room is 5×5, whose
   corner-to-corner Chebyshev distance is exactly 4. So the rule is: **one flash lights one room,
   from anywhere in it, and no further.** The merged hall (§5) is the sole exception — 9 or 10
   tall, Chebyshev 9 end to end, so it is the one space on the floor a single flash cannot reveal.
   That was not designed; it falls out, and it is worth keeping.

**Why this does not contradict §5's Manhattan spawn rule.** The line is:

> **Anything the player reads as a region on the screen is Chebyshev. Anything counted as steps of
> movement is Manhattan.**

Light is a field; it does not walk, and the player measures it by looking at it. The entrance
exclusion asks "how many turns before that thing can be on me", which is steps, and the player
never sees it at all — it is a generator guardrail. Two questions, two metrics, and only one of
them is ever counted by a human. Ember-sense sits on the vision side of that line for the reason
below.

**Ember-sense shares light's metric, and that is the load-bearing part.** With ember-sense at
Chebyshev 5 and light at Chebyshev 4, the lit region is *always a subset of the sensed region* —
light additionally requires line-of-sight, and 4 ≤ 5. So:

> **Everything a flash can wake, you can already feel.**

You know the price of opening the shutter, in creatures, before you pay it. That is Pillar 2 at
full strength: randomness decides what is in the room, never whether flashing was a mistake. It
holds only while ember-sense is at full radius — which is exactly what makes the dark-adaptation
window (below) the tensest state in the game, and why the HUD must show the current sense radius
(§9). Giving ember-sense a different metric would break this containment for a handful of corner
tiles and produce the one genuinely unfair death this system can generate: a creature woken inside
your own light that you had no way to know about.

**It also holds only on a floor you have already felt**, and that clause was missed for a while.
Ember-sense does not operate while the shutter is open, so if you arrive somewhere with the lantern
already lit, there was no moment at which you could have felt anything: the light and the floor
arrive together. **Arrival is the third case where containment does not apply** — the other two
being the adaptation ramp and, trivially, a shutter that never closed. What replaces it there is not
another containment claim but a *spatial* bound §5 provides, and it is weaker than it looks; see
*Where a run starts*, below.

**Ember-sense gives position only.** Not identity, not health, not intent. This was deliberately
cut back from a richer version: brightness-encoded health cannot be the sole carrier of meaning
(§11) and "a living thing is there" is already the information that makes stalking work.

**Why 5 and not 6 — a correction forced by the ruling.** Ember-sense was written as radius 6 with
no metric attached. Under Chebyshev on an 11×15 grid, radius 6 is a 13×13 box on a 165-tile map:
from anywhere in the middle band it covers 11 columns by 13 rows, ~87% of the floor, and it stops
varying with position. A radius that always covers everything is not a radius, and it takes two
other rules down with it — §5's "ember-sense tells you *there are two things in the room north of
me*" becomes "ember-sense tells you about all six creatures on the floor", and the top two steps of
the adaptation ramp become provable no-ops. **Radius 5 (tuning)** keeps the number honest: from the
middle of a room it reaches two columns into the room across the separator and two rows into the
bands above and below — enough to say *something is in the room north of me*, not enough to say
where the door is. This is a consequence of the metric, not a balance opinion; whether 5 should be
4 or 3 is an M2 playtest question. It supersedes the radius 6 recorded in ADR-0007.

**Dark adaptation.** On shuttering, ember-sense radius drops to **1** and recovers **+1 per turn**
back to 5. Purpose: it makes a flash a *commitment* rather than something you strobe every other
turn, and it creates the tensest moment in the game — the four turns after you shutter, when you
have woken a room and cannot yet feel where anything is. Physically intuitive (eyes adapt), one
integer of state, no text needed to explain.

The floor is 1 rather than 2 for two reasons. It preserves the four-turn ramp (1→2→3→4→5) that this
paragraph has always claimed, which a floor of 2 against a ceiling of 5 would cut to three. And it
reuses a number the game already has: **the instant you shutter, you know only what you can touch —
stone and ember alike — and your sense of the living grows one tile a turn back to five.** One
sentence, three rules, no tutorial. During the ramp the containment guarantee above is suspended:
flashing while your sense radius is under 4 can wake something you could not feel. That is the
gamble the ramp exists to create, and it stays legible because the HUD shows the number.

The second brake on strobing is not a fuel tax at all: **opening the shutter wakes things, and
nothing ever un-wakes because you shuttered again.** A player who strobes wakes the floor.

**A wake is announced, and it is announced with a number — *ruled 2026-07-31 (#79)*.**

> **Every turn in which one or more creatures transition dormant → awake says so, in the turn line,
> and says how many.** Nothing else that turn may take the line except player damage and player
> death.

This is a rule and not a presentation detail, which is why it lives here rather than being left to
the `ui-engineer`. §4's whole containment claim is *"you know the price of opening the shutter, in
creatures, before you pay it"* — a promise about the moment **before** the press. Nothing said what
the player is owed **after** it, and the M1 exit playtest measured the consequence: seven turns, two
Cinders woken, an empty line the whole way, and the player did not notice until one was adjacent.
The wager was priced in a currency the game never printed a receipt for.

Three clauses, each of which was a live way to get this wrong:

- **The count is spoken.** Not because the player could not count `C`s — a woken creature is lit or
  adjacent by construction, so it is always on screen — but because a flash reveals *a whole room at
  once*, and a new glyph among twenty new glyphs is not a signal. The number is the part that cannot
  be read off the board in the half-second a phone player gives it. It is also what makes the line
  checkable against the `*` marks the player felt before pressing, which is the containment
  guarantee's only observable form until #82.
- **The wake line outranks the shutter line, so the turn line reports the *outcome* of the flash and
  never the input to it.** Both fire on the same turn by construction and only one line fits. "The
  shutter opens" restates the single most visible change in the game — the entire board's tint — on
  the one turn the player pressed the control themselves. It is the least informative sentence
  available at the most consequential moment. The useful consequence of the precedence is that on a
  flash turn the shutter line now *means something*: it is what you see when the flash woke nothing.
- **It covers arrival, not only the press.** Phase 3 runs on `descend` and on the opening of a run,
  and §4 measures **one arrival in five as waking something**. An unannounced wake on arrival is the
  worst instance of this bug, not an edge of it: the player has a new floor, a sense radius of 1, and
  no reason to suspect anything. Silence there is what turns *"you sometimes arrive in sight of
  something"* into an ambush.

**Re-lighting an already-awake creature says nothing.** There is no transition, and a line that fired
every turn a `C` stood in the light would speak on every turn of every fight — which is how a player
learns to stop reading the line, and would cost us the one turn it matters. A creature that goes
re-dormant and is woken *again* does speak again: after eight turns the player has been treating it
as a sleeper, and it is a new hunter.

**#83 is what makes this a precondition rather than a polish item.** While a woken creature parked,
an unannounced wake cost the player a fact. Now that it pursues, an unannounced wake is an
unannounced hunter — and a death you cannot retell is a Pillar 2 and Pillar 4 failure at once.
**#79 ships before #83.**

*How loudly the line is drawn is §10's, ruled in #94 — a wake is an `alarm`, and the shutter line it
outranks is a `report`. Pointed at rather than restated, so the two cannot drift apart.*

**The wake takes the line. It may also *share* it — with one other sentence and no more — *ruled
2026-08-01 (#107)*.** The cache rule below made a flash able to **pay** on the same free action it
wakes on, so `Two things wake.` suppressed `You gather 21 ember.` and the pickup was announced by
nothing at all. **The blockquote above is unamended and there is no fourth tier**: the wake still
takes the line, and what #107 rules is that on a turn which also paid, the turn's fuel receipt is
appended to it — `Two things wake. You gather 21 ember.` — wake first, both halves verbatim, and only
this pair. §10 owns the ruling, the level, and the character budget that makes it fit; it is stated
there rather than here so the copy and the emphasis cannot drift apart.

*Watch:* the line is wrong if it becomes wallpaper. The signal is a playtest that reports reading
the turn line for damage and skipping it otherwise, or one in which the wake line appears on more
than roughly one turn in six. Either means the announcement is competing with itself, and the fix is
fewer things speaking, not louder copy.

**Where a run starts, and what crosses the stairs.**

**A run begins at the entrance with the lantern open and 80 fuel**, and the entrance room is already
on screen — the opening perception is not something the first command pays for. Three reasons, none
of them fiction:

1. **§5 bounds the opening flash without making it safe.** This reason was originally written as
   *"the opening flash wakes nothing, guaranteed by the generator"*, and **that was measured and it
   is false** — one arrival in five wakes something (below). The false step was reading a *room*
   exclusion as a *light* exclusion. §5 step 7 constrains where a creature may **stand**: not in the
   entrance room, not in the room merged with it, not within 2 tiles of the entrance. It says
   nothing about what is **visible** from the entrance, and the lit field is Chebyshev 4 *with line
   of sight* — which runs straight through a doorway into the next room, where §5 is perfectly happy
   to put creatures. Over 480 generated floors, **97 (20%) wake at least one creature on arrival.**

   What §5 actually promises is weaker and worth having:

   > **You never arrive on top of something. You sometimes arrive in sight of something.**

   Anything the arriving flash wakes is at least three tiles off, in another room, with a doorway it
   must cross to reach you — and it is lit, so you can see it, its intent is telegraphed (§4's
   table), and §2 phase 3 wakes it into a declaration rather than an action, so the telegraph
   arrives before the blow. §4's re-dormancy rule is the answer the rules already contain: shutter,
   stay away and out of its light for 8 turns, and it goes back to sleep as a dormant-strike target.
   A run that opens this way opens by posing the exact problem the game is about, with the tools to
   solve it already in the player's hand.
2. **Starting shuttered creates an autopilot opening.** At the adaptation floor you know nothing, on
   a floor §5 guarantees is safe to *stand* on and which nothing can wake up on you while the
   shutter is shut — so the correct opening is four turns of *wait* while the ramp climbs. An
   obvious optimal sequence is the turn Pillar 1 says should not exist, and it would happen at the
   start of a run rather than buried in one. **The correction above strengthens this reason rather
   than weakening it:** now that the lit opening is known to cost something one time in five, the
   shuttered opening is the only *guaranteed*-safe one on offer, which makes the ritual more
   attractive, not less. This reason and reason 3 carry the ruling on their own.
3. **The first frame of a game with no tutorial text has to be readable.** A lit room teaches what
   light is and lets the player discover darkness by choosing it. Nine tiles of stone and two `*`
   marks teaches nothing, and the player learns the rule by losing (Pillar 2).

**Full adaptation is always earned.** Ember-sense reaches 5 only after four turns spent shuttered,
so a run's sense radius **starts at the floor, 1, not at the ceiling.** With the shutter open the
number is unobservable — shuttering resets it to 1 regardless — but §9 puts it on the HUD, and a HUD
that reads 5 before the player has ever been dark is a lie the player will act on.

**On descent, the lantern and the eyes carry; the floor does not.** Fuel, shutter state and the
current ember-sense radius all cross the stairs unchanged; remembered terrain does not, because it
is memory of a place you have never been. §13 states the whole rule and why the alternative was
rejected.

**Fuel.**

- Sources: **kills** (Cinder drops 20, tuning) and **ember caches** in the level (25 each, 1-2 per
  floor, tuning). Caches are terrain, and **the lantern has to have found them** — the rule and its
  three clauses are below. Start of run: 80 (tuning).
- Fuel reaching 0: the shutter can no longer be opened. You are not dead — you can still crawl at
  radius 1 with ember-sense, and the stairs are still findable. It is a desperate state, not a
  loss state, and it is exactly the situation Pillar 4 wants people retelling.
  **A dry lantern is not a fifth vision state**: it is the shuttered column of the table above,
  permanently. Touch still reaches one tile, ember-sense still climbs back to five, the dormant
  strike still works, and a kill — or **a cache the lantern found before it died** — re-opens the
  shutter the moment it lands. Ember-sense is the player's dark-adapted eyes, not the lamp — if it
  went out with the fuel, 0 fuel would be unrecoverable in practice, which is the "unplayable rather
  than desperate" failure this rule exists to avoid.
  **The cache clause is a gain rather than a narrowing**, and it is the answer to a measured hole: a
  bot ran 143 turns at fuel 0 with nothing to do and no way to finish. A `♦` you lit two rooms ago
  and never picked up is still on the map when the lamp dies, so a dry run has a **destination**
  rather than a wander. That is the shape Pillar 4 wants out of 0 fuel.

**What the dark may take, and what it may not — *ruled 2026-08-01, built 2026-08-01 (#31, #41)*.**

§4 has said since it was written that caches are invisible while shuttered, and §1 has said since
before that: *light finds supplies; dark finds enemies.* **Neither was enforced anywhere.**
`computeTouchField` returned the cache tile as a cache, §2 phase 3 folded that into permanent
memory, and `collectFuelUnderfoot` paid on the tile kind. Measured over the economy corpus, a style
that never opens the shutter took **119 of 121 caches** — light's whole income stream, ~37 fuel a
floor, handed to the one style the design says has none.

*Read that last clause as scoped to the corpus, which is what it was measured over.* Every style in
the corpus is a pacifist or near it, so caches really were its whole income. A never-flash **fighter**
is a different animal and always was: it banks 20 a kill, and a floor **holds** 60-120 fuel of
creature ember against 25-50 in caches (#108) — **arithmetic on the constants, not an observed
take**, since reaching the top of that range means killing everything on the floor. That style is
what invariant 4 is for, and it is the case this ruling explicitly does not reach — see the
blockquote at the end of this block. **Whether a fighter actually banks it is #109's measurement**,
not something §4 knows today.

The ruling is that **the code is wrong and the document is right**:

> **A cache is terrain the lantern has to have shown you. Until it has, the tile is floor to you —
> you feel it, you walk over it, and nothing happens. Once it has, it is yours whenever you stand on
> it, lit or not.**

Three clauses, each of which was a live way to get this wrong:

- **Touch perceives a cache tile as ordinary floor.** Not as a cache, and **not as nothing** — the
  tile still enters remembered terrain. Skipping it was the cheaper option (one predicate, no new
  state) and it is *refuted* rather than out-voted, twice over. A permanent blank cell in the middle
  of ground you have crawled is **more** informative than the `♦` would have been, because nothing
  else on the board is ever skipped — the leak runs the other way and it is worse. And it would
  break *You always know your own four neighbours* above, which §2 spends to refuse an illegal move
  for free. **A rule that says items are invisible may not make the item's tile the only unknown on
  the board.**
- **A cache pays when its tile has *ever* been lit** — not when it is lit at the moment you stand on
  it. The stricter reading loses twice and neither loss is a matter of taste. It **contradicts a
  settled sentence three paragraphs up**: at 0 fuel the shutter cannot open, so *"a kill or a cache
  re-opens the shutter"* would be false in exactly the desperate state that sentence exists to
  protect. And it **manufactures an autopilot**: the shutter is a free action and §2 runs phase 5 on
  free actions, so standing on a cache in the dark, `open`-`shut` takes it for 4 fuel and no turns —
  a sequence with an obvious right answer whenever ember-sense is clear, which is the permission
  check both playtests already complained about, rebuilt on a new tile. Under the ruling as stated
  there is exactly **one** decision and it is the flash the player was already deciding.
- **Ember a kill drops is not covered, and must not be.** A drop is an actor-layer value on a tile
  you chose to fight on, and you know it is there because you made it. §1 makes kills the income
  side of the economy, and a dormant strike in the dark whose ember you could not collect would
  delete darkness's one capability. **Ember you made is yours; ember the ruin hid belongs to the
  lantern.** #81 is about *drawing* that drop in the dark and is untouched by this ruling.

**Rejected, and recorded so it is not re-proposed: a cue when you scuff an unlit cache underfoot.**
It is the most attractive wrong answer here — it preserves the good moment of stumbling on fuel in
the dark, and it turns the dark into a scout and light into the claim. It loses because it hands the
information straight back in a costume: a marked-but-unclaimed tile is routable, so dark cache
routing returns, and the follow-up flash is *obviously correct* whenever nothing is sensed, which
makes the wager a permission check for +21 fuel. It also adds a mechanic to enforce a rule that one
predicate already enforces.

**Rejected, and recorded so it is not re-proposed: that the shutter may not pay a cache underfoot —
*ruled 2026-08-01 (#107)*.** Proposed there because opening the shutter on an unlit cache both takes
it and wakes the room, and the pickup went unannounced (§10). It is a **simulation** answer to a
**copy** defect, and it costs the thing this block was written to protect. Every version of it —
*pay only on entering the tile*, or *phase 5 does not collect on a free action* — leaves the player
standing on ember they can now see and cannot have, and the cure is **step off, step back**: two
turns with one legal answer each, which is the same autopilot the *ever lit* clause rejected
*currently lit* for, rebuilt from the other side and charged in tempo instead of fuel. It also
re-falsifies *"a kill or a cache re-opens the shutter"* at 0 fuel, where the shutter cannot open and
the step-off-step-back ritual would be the only route to a cache under your own feet. Nothing about
the payment is wrong: the fuel arrived, the rule fired as designed, and the player was better off.
**The *ever lit* clause is not reopened.** #107 is ruled in §10, in copy.

**What it costs, said plainly.** The simulation must record which tiles the **lantern** has revealed,
separately from which tiles have been perceived at all: one more monotone per-tile channel in run
state, which a replay has to reproduce and which resets on descent exactly as remembered terrain does
(§13). That is a real widening of run state and it is the price of the rule. It is **not** the "map
of known tile kinds" this looked like from the outside — there is exactly one kind whose knowledge
diverges, and it diverges one way only (cache reads as floor), so a single boolean plane covers it.
One channel buys both halves with one predicate, which is why this is one rule and not two: **the
glyph and the payout read the same bit.** The representation is the `gameplay-engineer`'s.

**It teaches itself, once, with no text.** The first time a player flashes a room they had already
crawled and a `♦` appears on a tile they walked over, they have learned what the lantern is for and
what the crawl costs — in one frame, at no risk, on a turn nobody died. That is the whole tutorial
this rule needs. It is carried by the glyph and by the dimming already used for remembered terrain,
**never by colour alone** (§11), and §10's glyph list does not change: a disguised cache draws the
floor glyph that is already in it.

*Watch:* it is wrong if a playtest reports flashing because it **must** rather than because it chose
to — light stops being a wager and becomes a bill the moment cache income is the only way to stay
solvent. It is wrong in the other direction if the corpus shows a **flashing** style losing caches
too: the intervention is aimed at the never-flash line, so `STALKER`'s cache take should barely move,
and if it collapses instead, the fault is §5's leaf-room bias rather than this rule.

**This ruling is what makes `CACHE_FUEL` a dial for invariant 4, and it is why no number moves before
it.** Today cache fuel is paid to every style, so raising it favours nobody; afterwards it is light's
exclusive income, so it and the 1-2 cache count become the direct lever on *"a style that never opens
the shutter must not out-earn one that flashes"*. Expect the ruling to be **necessary and not
sufficient** on its own: it removes ~37 fuel a floor from every dark style, which narrows the gap
invariant 4 names without closing it, because a never-flash **fighter** still banks 20 a kill. The
`HARVESTER` measurement is what says whether anything further is owed.

**The four tuning invariants** (these are design; the numbers above are not):

1. Avoiding all combat must be **unsustainable** — a pacifist run runs dry.
2. Keeping the shutter open must be **unsustainable** — a floodlit run runs dry faster.
3. A floor played well nets **slightly positive** fuel, so competence is rewarded and greed is the
   thing that kills you.
4. **At comparable combat, a style that never opens the shutter must not out-earn one that flashes.**
   Light has to have a product darkness cannot buy, or the wager has only one side.

   **The scoping clause is load-bearing and was added on review.** Stated unscoped, invariant 4
   contradicts invariant 2, which asserts the *opposite* ordering as a required property —
   `economy.test.ts` pins `expect(flashed).toBeLessThan(never)` and passes at 163 turns against 206,
   with the comment that "the ordering is monotone in how much light the style buys". On a
   pacifist pair that is the same axis, because income is caches only, so satisfying an unscoped
   invariant 4 would mean deleting invariant 2's monotonicity assertion. The two are only compatible
   between styles that fight comparably — which is what the `HARVESTER`-vs-`STALKER` comparison the
   build plan calls for actually measures. **Invariant 4 is about fighters.**

**Invariant 4 is new, and the reason it was missing is the reason nothing caught the problem.**
Invariants 1 and 2 are both about *avoiding* something, and **the degenerate line avoids nothing** —
it fights everything on the floor and simply never opens the lantern. Two playtests found that line
within two runs each; `game/systems/economy.test.ts`'s corpus does not contain it, so all three older
invariants passed green for the entire time it was dominant. `STALKER`, the corpus's idea of competent
play, is strictly worse than a line a human found by accident.

> **Until the corpus contains a never-flash *fighter*, no number in §4 should be moved.** The
> instrument does not currently measure the thing being tuned, and a re-tune against it would
> calibrate the game to the second-best strategy.
>
> **The cache rule above is now built (#31/#41, 2026-08-01), and this paragraph is moved the day it
> shipped as the previous version of it demanded.** What it removed is the half of invariant 4 that
> was a bug rather than a number: dark play is no longer handed light's income stream. Measured over
> the same corpus, before and after, `DARK_PACIFIST`'s cache take went **119 of 121 → 0 of 121** and
> its income to zero, while `STALKER`'s went 121/121 → 114/121 and its net per floor +8 → +7. That
> is the ruling's own prediction and not its falsifier: the flashing style barely moved, so the
> intervention is aimed where it was pointed rather than at §5's leaf-room bias. **The rest of
> invariant 4 is still open**, exactly as the ruling said it would be — it was necessary and not
> sufficient, and a never-flash *fighter* still banks 20 a kill. Every fuel figure in the two
> playtest reports predates this and still includes income darkness cannot have; re-measure before
> quoting one.
>
> **How much is still open now has a number (#108), and its two halves have different provenance.**
> **Arithmetic on the constants, not observation:** caches are `CACHE_SLOTS = 2` with
> `count = int(rng, 0, 1)` at `CACHE_FUEL = 25` — **25-50 a floor, gated behind light**; creatures
> are `min(2 + floor, 6)` at `CINDER.emberDrop = 20` — **60-120 a floor, gated behind nothing**, and
> a dormant dies to one strike and never swings back. That is a **2.4x gap in what a floor holds**,
> which is a ceiling: taking it means killing everything. **Measured in play, by hand:** clear the
> room dark, *then* flash is now the best floor-1 line, at +18 fuel over never flashing — the first
> measurement in this project where light wins anything. Neither half is a ruling and **nothing in §4
> is amended by them.** Converting the ceiling into what a fighter actually banks is **#109**, which
> is why invariant 4 is still estimated rather than asserted.

**Awake-creature behaviour — *ruled 2026-07-31, implemented 2026-08-02 (#83)*.** Specified here
because §6 depends on it.

> **Waking it is what tells it where you are, and it does not forget. A woken Cinder comes for you;
> eight turns (tuning) after the last one in which it saw your light or stood next to you, it sleeps
> where it stands.**

- **Awake, it paths toward the player every turn**, shutter open or shut, adjacent or across the
  floor. There is no last-known tile, no search, and no state in which it holds still **by
  decision**. It can still fail to move — every improving step blocked by another creature, or the
  player walled off from it entirely — and it waits that turn out. **That is not the parked state
  this rule deleted**, and the difference is the counter: a creature with nowhere to step is still
  counting down to sleep, where the old case 5 held position *and* had reached its goal, so waiting
  was the plan rather than the absence of one. Named because "no state in which it holds still" is
  the sentence an implementation would have to violate, and it is better to say which violation is
  legal than to have someone discover the two `wait` branches and think the rule was not followed.
- **The eight-turn counter runs on *contact*, not on pursuit.** It resets on light or on adjacency
  and increments otherwise — unchanged from the rule this replaces. So a creature that catches you
  starts its eight over, and a creature you hold at arm's length in the dark sleeps on schedule.
- **Re-dormancy survives, and becomes a payoff instead of a refund.** A creature that gives up is
  asleep wherever it ended — usually near you — and is a legal dormant-strike target again. Darkness
  is still restorative; it now restores you for **surviving** the consequence of a flash rather than
  for walking away from it.
- **You cannot shake it. You can outlast it, kill it, or take the stairs.** §13 already says the
  stairs are the one escape nothing follows you down; this is the rule that makes that sentence worth
  having.

**Status is load-bearing here, and this block has now been stale in both directions.** It read *"the
code is a ruling behind this section until #83 closes"* until 2026-08-02, when #83 closed. `nextMind`
now implements this section: three cases, pursuit that does not consult contact, and the counter as
the only thing contact still governs. **The paragraph is kept rather than deleted** because the pair
of corrections is the record — a marker that said "not built" while the code was built cost a
playtest verdict (§4's blockquote below), and a marker that said "not implemented" after it shipped
would have been the same defect with the sign flipped.

**What is still owed is the measurement, not the build.** §4's watch names one number — the fraction
of woken creatures that reach adjacency at least once before re-dormanting — and it is a playtest
number, so it is not settled by this section closing. Until it is taken, do not re-tune the 8 in
either direction. Fuel numbers remain frozen for a separate reason (#109).

**Why this replaces a *Settled* rule.** The old rule sent a creature that lost contact to your
last-known tile, where it waited indefinitely. The exit playtest measured the consequence and it was
not a behaviour, it was a **procedure**: shutter, step out of adjacency, walk anywhere for eight
turns, walk back, one-shot a dormant target. Measured, same seed: a flash that woke a Cinder on floor
2 cost 16 turns of walking and paid 20, so **waking it was net +4 fuel *profitable* after paying for
the entire retreat**; on floor 8, three flashes woke five Cinders at 10 HP and the situation resolved
itself into `fuel 23 -> 60` with no damage taken. There was no decision inside the retreat and no way
to fail it. Three things follow, and the third is the one that matters:

1. **The flash's price was never fuel.** It is what wakes — and the price was refundable at a profit.
2. **§3's "fleeing is hard, and that is a feature" was false.** You only had to break contact, not
   outrun anything.
3. **Nothing was ever coming, so several other rules had nothing to do.** §5's loop doorways
   ("escape routes, and without them waking a room is a death sentence rather than a problem"), §2's
   step-off-the-marked-tile, §4's own adaptation ramp, and §13's un-followable stairs were all
   answers to a pressure the rules never applied. This ruling is what makes them load-bearing; it
   adds no mechanic and no UI, and it deletes two of `nextMind`'s five cases.

*Watch:* the new rule can fail in **either** direction and both are measurements rather than matters
of taste. **Too weak:** a same-speed pursuer that starts four tiles off and never closes turns the
eight turns into eight more steps of walking away — the autopilot this ruling exists to delete,
wearing a `*`. **Too strong:** every wake becomes a forced fight, and the flash stops being a wager
and becomes a bill. One number tells you which: **the fraction of woken creatures that reach adjacency
at least once before re-dormanting.** Near 0 and the pursuit is theatre; near 1 and 8 is too long.

**The 8 is the dial for the too-strong arm only, and §4 declines to name one for the other.** On the
too-weak arm the 8 is not a fix: the player and a creature share `ACTION_COST`, so **a pursuer never
closes on a player who keeps stepping away**, and raising the number lengthens the pursuit window
rather than tightening it. It would buy adjacency only by giving the floor's geometry more chances to
pin you — paid for in exactly the forced-walking turns this ruling exists to delete, which is
word-for-word the argument that rejected the distance requirement three paragraphs above. **If the
too-weak arm fires, the fix is something not currently named** (cadence, or geometry-aware pathing)
and it needs its own ruling. Naming a dial that cannot move the outcome is how a session burns a
cycle turning 8 into 12, re-measuring, and finding the adjacency fraction unmoved and the walking
demonstrably worse. A distance requirement is not the dial either — see the change log.

> **The watch this block used to carry has fired, and the history is worth keeping.** It read: *"re-
> dormancy is the mechanic most likely to degenerate. If the playtester reports retreating to a
> cleared room and pressing wait, it is broken. The fix is a distance requirement, not a fuel tax."*
> The exit playtest reported it — not pressing wait, but walking in a circle, which is the same thing
> at 1 fuel a turn. **The prediction was right and the prescribed fix was wrong**, and the reason is
> the useful part: the watch assumed the degenerate case was the player re-dormanting something from
> two tiles away, so distance was the natural brake. The measured case was already at distance, and a
> distance requirement would only have made the retreat *longer* — more autopilot turns, which is the
> cost this rule was already paying. **A watch can name the right symptom and the wrong organ.** The
> block above is the replacement.
>
> Separately, this paragraph said **"(M2, ...)"** until 2026-07-31 while `nextMind` had shipped
> re-dormancy in #16 under M1, and the stale marker cost a playtest verdict (#31, #63): a playtester
> read it, concluded a counterweight was missing, and built a recommendation on top. *A milestone
> marker left on an implemented rule reads as "not built", and nobody consuming this document can tell
> the difference from the outside.* The block above then carried the opposite marker — ruled, not
> built — and this sentence predicted it *"will be just as wrong the day #83 lands if nobody moves
> it."* **#83 landed on 2026-08-02 and the marker was moved in the same PR**, which is the only
> reason the prediction is recorded here as discharged rather than as a third instance. The
> transferable rule, now with an example on each side: **a status marker is a claim about the code,
> so it is the PR that changes the code that owes the edit** — not the docs pass afterwards, by
> which time somebody has already read it.

*Open:* adjustable lit radius, thrown/placed light sources (parked as a candidate M3 item, §12),
whether floors ever have ambient light. **The metric is no longer open** — it is Chebyshev for
every vision radius, settled above (issue #25).

## 5. Level generation — *Settled for M1*

**One algorithm, one theme: chambered ruin.**

**Grid: 11 wide × 15 tall.** Derived from the screen, not chosen aesthetically: a 6-inch phone in
portrait is ~390 logical px wide; 11 columns gives ~35px cells, which is a defensible tap target,
and no panning ever (Pillar 3). **Width is the binding constraint. Rows are not:** 15 rows × ~35px
is ~525px of a ~844px portrait viewport, leaving ~240px after safe areas for the HUD above and the
lantern control below — comfortable for a one-line HUD and a thumb-sized shutter toggle. 14 rows
would also fit. We take the fifteenth row because board area is the scarce commodity on a phone and
vertical space is the space we actually have; a bigger board is where the doorway chokepoints and
the loop escape routes get room to matter. **Changing the column count needs an ADR; the row count
does not.**

**Structure: a 2 × 3 lattice of rooms separated by 1-tile walls.**

```
width  = 5 + 1 + 5           = 11
height = 4 + 1 + 5 + 1 + 4   = 15
```

**The middle band is 5 tall, the outer bands 4** — rooms are 5×4 / 5×5 / 5×4 before jitter
(20 / 25 / 20 tiles). The odd row goes to the middle band because rooms 2 and 3 are the only
lattice rooms with three neighbours: they carry the most doors and are where you are most likely to
be pressed from two sides, so they are the rooms most worth having floor in. Vertical symmetry is
the second reason — no band is systematically roomier than its mirror, so there is no north/south
fact for the player to exploit and no north/south bias in any spawn or cache statistic.

Six rooms of ~20 tiles. Six is a graph you can hold in your head, which is the point — the mental
map you build in the dark is *rooms and which wall the door was in*, not a pixel-accurate map.

**Generation steps (all from the seeded RNG):**

1. Lay the lattice. Jitter each room's interior by 0-1 tiles **only on a side facing the screen
   edge** — never on a side facing a separator wall. That is what "where the lattice allows" means,
   and it is what makes connectivity structural rather than something to verify afterwards: both
   rooms always touch their shared wall, so a doorway carved anywhere in it has floor on both
   sides. Middle-band rooms are pinned between both separator rows and so never jitter vertically.
2. Random spanning tree over the 6 rooms; each tree edge becomes a 1-tile doorway at a random
   position on the shared wall. **Guarantees connectivity.**
3. Add 1-2 extra doorways to create loops. Loops are not decoration — they are escape routes, and
   without them waking a room is a death sentence rather than a problem.
4. **0-1 room merges:** delete a shared wall entirely, creating a hall of **up to 5 × 10** — 9 or
   10 tall, and not always a clean rectangle, since jitter can leave one half a tile narrower. The
   cheapest source of floor-to-floor variety (Pillar 4).
   **Only vertically stacked pairs may merge.** A side-by-side merge would delete a stretch of the
   column separator, which is the only wall running the full height of the level — the wall that
   makes "which side of the floor am I on" a question ember-sense can answer *through stone*, and
   the thing the mental map is organised around. It would also leave that band with no threshold in
   it at all: a floor whose entrance and stairs both landed there would contain no doorway decision,
   and standing in a doorway is one of the densest turns in the game (§3). The hall's exact
   dimensions are not load-bearing; what a merge is *for* is deleting a chokepoint and leaving one
   space on the floor that no doorway lets you hold.
5. Place 0-2 pillars per room (`o`, blocks movement and light, does not block ember-sense). Cover
   for positioning, and something for ember-sense to be "behind".
6. Entrance in one room; **stairs in the room with the greatest graph distance from it, counted in
   doors crossed.** **A merged pair counts as one room**, not as two rooms one hop apart: there is
   no wall, no door and no threshold between its halves, and the player perceives one chamber. It
   follows that if the entrance is in a merged hall, neither half can hold the stairs. Ties among
   equally distant rooms are broken by a draw rather than by lowest room id, so symmetric layouts do
   not favour a fixed room.
7. Creatures: `min(2 + floor, 6)`, dormant, never in the entrance room — **including the room it is
   merged with, if any**, since the two are one space — and **never within 2 tiles of the entrance,
   measured in orthogonal steps (Manhattan)**. Manhattan and not Chebyshev because movement and
   attacks are 4-directional (§3): the player counts steps, and a creature two tiles diagonally away
   is four steps away by every other rule in the game. A distance metric with no referent anywhere
   in the rules cannot be verified by looking at the board, which is what Pillar 2 asks of a rule.
   (This settles the metric for *this* rule only. The vision radii are **Chebyshev** — settled
   separately in §4, which also records why the game deliberately holds two metrics and where the
   line between them falls.) Note that the entrance-room rule
   already subsumes most of this one: with merged pairs counted as one room, the 2-tile rule can only
   ever exclude tiles on the far side of a wall. It is a guardrail, which is a further reason to take
   the reading that means what it says rather than the stricter one.
8. Caches: 1-2, biased toward leaf rooms of the spanning tree — so going off-route for fuel is
   itself the fuel wager VISION asks for.

**Nothing is ever placed on a doorway tile** — no creature, cache, entrance or stairs. A doorway is
the one tile in the level with exactly two opposite exits; anything standing in it converts a
threshold into a passage that must be cleared before the floor is crossable, which is the corridor
problem (below) wearing a different hat.

**No corridors.** Not "short corridors" — none. A corridor is a sequence of turns with one legal
move, which is Pillar 1's definition of a turn that should not exist. Rooms and thresholds only.

**Why this is interesting in darkness:** the unit of memory is a room and its doors. Ember-sense
tells you *there are two things in the room north of me* while giving you no idea whether there is a
door on that wall. The decision "flash to find the door, or feel along the wall and hope" is
generated by the level shape, every floor, for free.

**Run length: 8 floors (tuning).** ~40-70 turns per floor × 8 ≈ 400-550 turns ≈ 15-25 minutes.

**Testable invariants** (for the `test-engineer`, property-tested over many seeds): every floor is
connected; stairs are reachable from the entrance; no creature spawns in the entrance room (or the
room merged with it) or within Manhattan distance 2 of the entrance; nothing occupies a doorway
tile; a merge only ever deletes a row separator; grid is exactly 11×15; the same seed produces the
identical floor.

## 6. Entities — *Settled for M1*

**Exactly one enemy: the Cinder.**

| | |
| --- | --- |
| Glyph | `c` dormant (seen in light) · `C` awake · `*` ember-sense contact (identity unknown) |
| HP / attack | 5 / 2 (tuning) |
| Drops | 20 ember (tuning) |
| Dormant | Yes. Wakes when caught in the lit radius, or when attacked and survives — which a Cinder cannot do at these numbers (§3) |

**Behaviour worth reading (Pillar 2) — *ruled 2026-07-31, implemented 2026-08-02 (#83)*:** the Cinder is
drawn to light, and light is what **wakes** it — and waking it is what tells it where you are. Awake,
it paths toward you every turn, lit or shuttered, adjacent or across the floor. Eight turns after the
last one in which it saw your light or stood next to you, it sleeps where it stands (§4 has the whole
rule, the reason it replaced the previous one, and its watch).

That single rule still makes the lantern a **combat** control rather than only an exploration one,
but the trade it offers inside a fight is sharper than the one this section used to describe.
**Shuttering no longer makes it lose you — it makes you lose its intent.** So the mid-fight decision
is "do I want to see what it has committed to, at 4 fuel a turn, with everything else in the room
waking up", not "do I want to disappear". The retellable moment (Pillar 4) moves with it. It was **"I
shuttered the lantern and let it walk past me in the dark"** — which two playtests measured as free,
automatic and available every single time, which is not a moment. It is now **"I shuttered, it came
anyway, and I kept a doorway between us for eight turns."** §5 puts 1–2 extra doorways on every floor
and calls them escape routes; that is the sentence they were generated for.

Case and shape carry dormancy, not colour (§11). **Waking is announced in the turn line, with a
count** — §4 has the rule, its precedence, and why it is a precondition for the behaviour above
(#79).

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
- **Auto-travel — *Settled (design) — deferred to M2 (build)*.** Tap a distant **remembered** tile
  to path toward it. **Still not implemented**, and still not in M1.
  [ADR-0009](decisions/0009-auto-travel-command-shape.md) settles its rules so that #20 could be
  built against a decision without the decision being built. **The playtest gate that `ROADMAP.md`
  held it behind has now been answered and the recommendation is build it** (#32) — the friction is
  real but it is not where the gate assumed: it is forward travel across rooms a single flash has
  already revealed, not backtracking. Nothing below changes; a tap on a distant tile is currently
  `unbound` in `render/taps.ts` and travel becomes one more `TapAction` kind. The rules, in full:
  - **It is one command, `travel(to)`**, resolving many turns inside `step()` — never a loop above
    the simulation. **A travel must be indistinguishable from the sequence of `move` commands it
    stands for** — identical in every field but `commandsResolved`, which is 1 against N because
    the player made one decision. It is not allowed to be a mechanic.
  - **The route runs over remembered, passable terrain only**, unknown tiles treated as walls. So
    **travel can never enter unmapped space** — it is a *return* tool, not an exploration one — and
    the route is legible, because it is computed from the map the player is looking at.
  - **You stop for the living.** Travel stops after a step in which you perceive **more** creatures
    than you did, **a creature you perceive changed tiles**, a creature woke, or your HP went down;
    and before a step into an occupied tile, because **travel never attacks**. **Terrain never
    interrupts** — the narrowing is argued in the change log below.
  - **The moved-tile clause is new (*Proposed*), and #65 must not be built without it.** It amends
    [ADR-0009](decisions/0009-auto-travel-command-shape.md), which has not yet been given a
    superseding note. It is forced by §4's new awake-creature rule: a woken creature now walks toward
    you every turn, so without this clause a hunted player taps a far tile and the simulation resolves
    the eight tensest turns in the game on their behalf — auto-travel would automate the exact
    decisions §4 was rewritten to create. With it, travel is unavailable precisely while something is
    coming and unaffected across a floor of sleepers, because **a dormant creature never moves.** It
    keys on a thing the player can see — *a mark that is not where it was* — which is the constraint
    ADR-0009 put on every stop clause, and it needs no identity: any mark moving is enough.

    **Scope it to creatures perceived both before and after the step.** Evaluated loosely as "the
    set of perceived positions changed", it also fires when the *player* walks a creature out of
    sense range — which re-introduces the losing-contact interrupt ADR-0009 deliberately rejected
    ("an absence is the least legible interrupt trigger available"). Added on review; the clause was
    written without it and would have shipped that way.

    **And be honest about what this does: with pursuit, it does not interrupt travel while something
    is coming — it disables it.** The clause fires on every step for the whole eight-turn window,
    and whenever any awake creature sits inside ember-sense. That is the intent. But `ROADMAP.md`
    names "it stops on nearly every step" as auto-travel's *kill* condition, so whoever builds #65
    must know that this is by design and not the signal to kill it — the kill condition is about
    stopping with nothing coming.
  - **Clause 1 is keyed to the *count* of perceived creatures, never to identity or to tiles.**
    Ember-sense gives position and nothing else (§4), so the player cannot tell one mark from
    another — and travel may not key on anything the player cannot see. "More marks than there were"
    is checkable by looking. *Losing* contact therefore never interrupts, and a creature arriving as
    another leaves does not either — that swap is sometimes visible as a mark that moved further than
    one step, and the rule deliberately does not chase it (ADR-0009). It is judged
    on the finished state of each step, which is the state a player tapping one step at a time would
    have been looking at.
  - **An interrupted travel costs every turn it spent.** No rewind, at any granularity — a rewind
    would make travel a free scout (Pillar 2).
  - **Refused** (§2: no phases, no cost) when the destination is your own tile, is not remembered,
    is impassable, or has no route over remembered tiles. Adjacent is *not* refused; it is a
    one-step travel.
  - **Travel never touches the shutter**, and needs no rule to make it a dark tool: lit travel burns
    4/turn and wakes every room it crosses, which the economy punishes on its own.
- Lantern shutter: a persistent, thumb-reachable toggle. **Free action.**
  **The control is a toggle; the command is not** — stated once, here, because everything else in
  the document says "toggle" and means the thing under the thumb. What the thumb sends names a
  *setting*, absolutely: open, or shuttered. A toggle's meaning depends on the state before it, so
  one dropped or duplicated command silently inverts the rest of a stored run — and a run is a
  stored artifact (Pillar 4). The cost is one rule: naming the setting the shutter already holds is
  refused (§2).
- **Descend: its own control, present only while you are standing on the stairs**, in the thumb zone
  beside the shutter. Not the self-tap — that is `wait`, and **waiting on the stairs is a real
  move**: the stairs are exactly where §3's macro decision is made ("clear this floor for fuel, or
  dive now and bank the heal"), so it is the worst tile in the game to take a turn's worth of choice
  away from. The control appearing is also unambiguous confirmation that you are on the stairs,
  which is worth something in the dark.
- **An impassable neighbour is not a tap target**, and a refused tap still gives feedback (§2).
- Keyboard on web is a convenience layer, never the primary design target.

HUD, minimum: HP, fuel, floor number, shutter state, ember-sense radius (because dark adaptation is
invisible otherwise).

## 10. Presentation — *Settled at the technology level*

Glyph grid, colour-forward (ADR-0003). Light falloff expressed as cell tint and opacity. The
aesthetic goal is "a beautiful terminal," not "a cheap tileset."

Glyph set for M1, as shipped in `render/glyphs.ts`: `@` player · `#` wall · `·` floor · `o` pillar ·
`+` doorway · `<` entrance · `>` stairs down · `♦` ember cache **and an ember drop** · `c`/`C` Cinder
dormant/awake · `*` ember-sense contact · ` ` unknown. (`+` and `<` were missing from this list until
2026-07-31 — §5 has had doorways and an entrance since #13, and the list simply never grew. No
decision changed; a `+` in the dark is the kind of thing a playtester reads a glyph table to
identify.)

Four cell states must be distinguishable at a glance without colour: **lit**, **remembered**,
**unknown**, **sensed-but-unseen** (a `*` on a tile whose terrain you have never seen).

> **These two sentences do not match what `render/` shipped in #19, and `render/` is probably
> right.** `CellState` is `visible | sensed | remembered | unknown` — `lit` is named `visible`
> because shuttered you perceive nine tiles by *touch* with no light involved, and `sensed` is
> widened to "a contact on any tile not perceived this turn", because §10's literal wording draws a
> living creature at remembered opacity. **#46 owns the amendment** and it is a `game-designer`
> call. Until it lands, the code is the truth and this paragraph is the stale copy — anyone reading
> §10 to brief a playtest or build a screen should use `render/cell.ts`'s names.

Palette, typography, and animation specified in M4.

**The turn line has two levels of emphasis, and which messages sit in each is a rule — *ruled
2026-08-01 (#94)*.**

> **Every message the turn line can show is either an `alarm` or a `report`.** An `alarm` is a fact
> that is *against* the player and that the board does not already state at full volume: a wake,
> damage taken, the player's death. Everything else — every receipt for a press the player made, and
> every refusal — is a `report`. **The two must differ in at least two channels, one of which is not
> colour.**

This is ruled here and not left to the `ui-engineer` for the same reason §4's wake announcement was:
the failure it fixes is a design failure. §4 made the wake a rule and #79 built it, and the playtest
of that build measured what the rule was worth in pixels. At 390×844 dark, the HUD's values are
17px/600 and coloured, the shutter button's label is 14px/700, and the turn line is **13px/400 in the
same grey as the button's sub-caption and the build note** — the second-smallest text on the screen.
So `The shutter opens. Light spills out.` and `Two things wake.` — *you got away with it* and *you
have company*, the two outcomes of one press — are **typographically identical**, and at the
half-second a phone player gives the line the difference between them is which dim grey letters are
present. A rule that fires correctly and cannot be read is not a rule the player has.

The levels are named for the criterion, not for the volume, so that an assignment can be argued
rather than bikeshedded. **`alarm`: something is now against you that was not before. `report`: here
is what your press did.** In full, over every message the game can produce:

| Message | Level | Why |
| --- | --- | --- |
| `Something wakes.` / `N things wake.` | **alarm** | A hunter exists that did not exist before, and under #83 it is walking toward you |
| `Something wakes. You gather N ember.` / `N things wake. You gather N ember.` | **alarm** | The only compound the line has (#107, below). Both wake forms compound — n = 1 is reachable and the singular row above is the half that composes. The level is the winning cue's, and the wake won it — a hunter is still what is against you |
| `You take N.` | **alarm** | At 12 HP and 2-4 a blow, three of these is the run (#20's finding) |
| `The lantern goes out.` | **alarm** | The run ended |
| `You strike for N.` | report | You chose it, you aimed it, and the target is on screen |
| `It burns out.` | report | A `C` left the board and the fuel meter moved |
| `You gather N ember.` | report | The FUEL readout is 17px and says it louder |
| `The shutter opens. Light spills out.` / `The shutter closes.` | report | The board's entire tint says it louder — §4 already calls this the least informative sentence at the most consequential moment |
| `You climb down to floor N.` | report | You pressed the control and the HUD's floor number confirms it |
| `Nothing happens.` | report | §2's receipt for a tap. The world did not change |
| `The way is blocked.` / `Too far to step.` / `The run is over.` | report | §9's and §13's refusals. Same — a receipt for a thumb |

Two things fall out of that table and both are worth stating, because they are what make the levels
cheap:

- **The levels agree with §4's precedence order, exactly.** `player death > player damage > woke >
  recency` — and the first three *are* the `alarm` set, while every message recency can reach is a
  `report`. So a turn never pre-empts a louder line with a quieter one, and that is an invariant a
  unit test can pin over the real-run corpus rather than a property we hope holds.
- **`report` is not a consolation prize; it is what makes `alarm` mean something.** The shutter line
  survived #79's demotion because *you got away with it* is a real sentence, and it only reads that
  way when the line that would have replaced it is visibly louder. The same contrast lands free on
  the descend press — see the descent ruling below.

> **As implemented, the `alarm` set has three members and a player can only ever see two.**
> `app/index.tsx` blanks the turn line on any turn that produces a summary, and the player's death
> always produces one, so `The lantern goes out.` is levelled `alarm` in `messages.ts` and **never
> reaches a pixel.** That is #80's undrawable-branch shape, it predates #94, and it is tracked on
> **#98** — the ruling above is not amended for it, because which level the sentence *deserves* does
> not depend on whether today's screen draws it. Stated here because §10 is what a designer reads
> before ruling **#103** (does `You take N.` earn `alarm`?), and that ruling explicitly turns on how
> many members the set has: **on screen it is two, not three.** Note also that `The run is over.`, the
> `report` in the last row, *is* drawn on a finished run — in the summary panel's note row, not in the
> turn line — and `e2e/run-loop.spec.ts` already asserts it.

**A wake and a gain on the same press are one line with two sentences — *ruled 2026-08-01 (#107)*.**

> **When a turn both wakes and pays, the line is the wake sentence followed by the fuel receipt, in
> that order, both verbatim, joined by one space: `Two things wake. You gather 21 ember.` It is an
> `alarm`. This is the only compound the turn line has, and the two player tiers — damage and death —
> never compound.**

§4's cache rule (#31/#41) created a turn shape the precedence had never been asked about. The pickup
condition is *ever lit* and the shutter is a free action, so **opening the shutter while standing on
an unlit cache lights the tile and pays it on the same press** — and that press wakes what the light
touches, by construction, because the flash is what lit the tile. `woke` outranks recency and
`You gather N ember.` lives in recency, so the turn read `Two things wake.` and the pickup was
announced by nothing: `FUEL 66 → 87`, no `♦` drawn for a single frame, the only evidence a number
that moved. The precedence was ruled when a cache could be taken **only by stepping onto one**, and
stepping wakes nothing, so the two could not collide. That rationale was not wrong; its premise
expired.

**There is no fourth tier, because no precedence can fix this.** A tier list is a total order over
*which single fact gets said*, and the complaint is that this turn has **two** headline facts and a
one-line channel. Reordering only moves the silence — from the goods to the price. The reordering it
would take is also the wrong one twice over: `fuelGained` above `woke` inverts §4's own accounting,
where the flash's price is what it wakes and the fuel is the part the HUD already meters; and it gets
**worse** under #83, where the suppressed sentence stops being a fact and becomes a hunter. A
precedence that only works while creatures park is one that expires again in a step. `fuelGained`
placed *below* `woke` changes nothing at all, which is the other half of why the tier is not the
instrument.

**The rule change — the shutter may not pay a cache underfoot — loses in §4, and is recorded there.**
It is a simulation answer to a copy defect and it rebuilds the autopilot the *ever lit* clause exists
to prevent. **That clause is not reopened.**

**Doing nothing was the real runner-up, and it loses on attribution.** The table above levels
`You gather N ember.` a `report` because *the FUEL readout is 17px and says it louder* — and **that
reasoning assumes the player can attribute the change.** On every other paying turn they can: they
stepped onto a `♦` they had already seen lit, or they killed the thing that dropped it. On this one
the meter shows a single net number containing a burn and a gain (+25, −4, and the HUD moves 21), the
source glyph never rendered, and there is no body. It is the one turn in the game where fuel arrives
from a source the player never saw, which is exactly where the sentence stops being redundant. The
sentence does not restate the meter; it **attributes** it. The meter has the amount, the words have
the source.

**Why the compound is safe here and was not on the descent.** Three reasons, all measurable:

- **It never costs the alarm its glance.** The wake sentence is first and unchanged, so a player who
  reads only the first half reads exactly what they read today; the compound is strictly *additive*
  to a glance. That is also why the two player tiers are excluded rather than merely unhandled:
  `You take N.` and `The lantern goes out.` are the two lines whose entire value is being read
  instantly, and each states a fact about the player's own survival that nothing else on screen
  states. The wake tier can afford a second clause because the board carries the woken creature as
  well — it is lit or adjacent by construction, and #94's playtest measured the player noticing the
  red `C` *first*.
- **It fits on one line at the default text size, and the descend compound was long enough not to be
  safe.** The budget is **41 characters**. The longest compound the game can produce is
  `Three things wake. You gather 41 ember.` at **39** — `Three things wake.` is the longest of the six
  wake sentences and the amount is two digits at every reachable value. `You climb down to floor 8.
  Something wakes.` is **43**, over budget, which is one of the three reasons #94 refused it and not
  the load-bearing one.

  **41 is a budget, it is not the measured capacity, and it is only safe above a viewport width
  nothing has ever stated — which took two passes to establish and is worth all three drafts.**
  Measured in the shipped build at 390 wide, mono resolves to ~7.7pt per character against ~362pt of
  row, so roughly **47** characters fit. An earlier draft derived 41 from a different per-character
  figure and called the result *arithmetic rather than taste*; it is neither, because the resolved
  font is a **stack** (`SFMono-Regular, Menlo, …, monospace`) whose advance width is device-dependent.

  The second draft then called 41 *conservative*, on the strength of that 390-wide measurement. **A
  playtest measured it across widths and falsified that**: capacity is 46 at 390, 43 at 360, 41 at
  344 and **37 at 320** — so the 39-character worst case **wraps at 320**, and 41 is not a margin
  there, it is over budget. What is genuinely arithmetic remains the comparison, 39 against 43.
  **41 is therefore a budget that presumes a viewport floor this document has never defined**, which
  is **#115** and is a design decision, not a number to quietly raise or lower. Do not "fix" it by
  moving it in either direction before that floor exists: raising it to the measured 47 loses the
  headroom the stack requires, and lowering it to 37 prices every line for a device we may not
  support.
- **It invents no sentence.** Both halves are strings already ruled — #79's wake line and this
  table's receipt — with one space between them. Nothing is re-worded, so §4's *no cause-variant
  string* ruling is untouched: this is not a variant of the wake line, it is the wake line followed by
  another line. The standing objection to compounds bites on *authored* pairs, which are
  combinatorial; a concatenation of two ruled strings, defined for exactly one pair, adds no copy to
  maintain and no branch to word.

**The level is the wake's, and that is what keeps §10 cheap.** The compound is an `alarm` because the
cue that won the line is the `woke`, and the level has always been a property of the winning cue
rather than of the string. It keeps the invariant §10 and §4 share exactly true — *a turn whose cues
contain a `woke`, a player `damaged` or a player `died` draws an `alarm`* — so the corpus test that
pins it does not change shape, only the enumerated table grows a row. Levelling the compound a
`report` would quietly demote every wake that happened to coincide with a pickup, which is #94's
defect reintroduced by the fix to #107.

**One `fuelGained` per turn, so there is nothing to aggregate.** `render/cues.ts` emits a single
`fuelGained` carrying the turn's **net** delta, which is why the receipt says 21 on a flash that took
a 25 cache and burned 4: the words and the meter agree, deliberately. Unchanged here, and it is the
reason the compound needs no second aggregation rule beside the wake count.

**The `♦` that never renders is not part of this ruling, and does not need to be.** The tile is lit
and emptied in the same step, so no frame draws it, and the sentence is now the whole receipt. That
is enough for a reason particular to this event: **a pickup is always underfoot.** Both income
sources are collected by standing on the tile, so the spatial question a visual beat would answer has
a constant answer — under `@` — and `@` is the most located thing on the screen. This is not the
`woke` case, where one new glyph among twenty needed a count. A beat would also cost more than it
looks: `fuelGained` deliberately carries **no `at`**, being an aggregate net delta, so giving a pickup
a pulse means widening `render/`'s cue vocabulary *and* it lands on #82's mechanism, which is
explicitly last in the build order. It stays a Watch rather than an issue, and #81 — drawing a kill's
ember drop in the dark — is untouched either way.

*Watch:* three signals, with three different fixes. If a playtest reports reading only the first
sentence and being surprised by the fuel anyway, the words are the wrong instrument and the answer is
the spatial beat above — an `at` on `fuelGained` plus #82's pulse, filed then and not before. If the
line wraps at the default text size on any supported viewport, the 41-character budget is wrong and
**the second clause is what gets cut**, never the wake. And once #83 lands, if a playtest reports
missing the hunter on compound turns *specifically*, with plain wake turns as the control, the second
clause is stealing the glance and it goes — back to the runner-up, which is doing nothing.

**Emphasis is carried by weight and colour together, and the words do not count as a carrier.** §11
forbids colour as the sole carrier, and the tempting defence is that the sentences differ so the
distinction survives a greyscale screen. **Reject that**, because it is the same defence that would
justify changing nothing at all: §11's real test is whether the distinction survives *the way the
element is actually read*, and the finding behind #94 is that this line is caught at a glance or not
at all. A carrier that works only once you have read the sentence is not a second carrier for a
signal whose entire job is to be caught before you read the sentence. So:

- **Weight is the non-colour carrier.** `alarm` is drawn strictly heavier than `report`, and at least
  as heavy as the control labels. It survives greyscale, every colourblindness, and both schemes.
- **Colour is the second, and it gets its own tokens.** The theme grows a closed pair — `alarm` and
  `report` — named separately from `text` and `textDim`, and **a theme may not map both to the same
  value** (the same assertion `tests/unit/play-theme.test.ts` already makes of `ColorToken`). Not `token.creature`,
  which the issue proposed: that is a *board* role meaning "a creature seen in light", it is wrong for
  `You take N.` and `The lantern goes out.`, and reusing it would let a retune intended for the board
  silently move the chrome. `report`'s **value** may stay where `textDim` is today; what is ruled is
  that it stops *being* `textDim`, so the two can move apart when M4 looks at a screenshot.
- **The two levels share one size, and the shared size goes up.** Ordinally: the turn line must rank
  above every caption and control sub-label on the screen, may equal the control-label size, and only
  the HUD's values may be larger. It is the one place the game speaks in sentences and it currently
  sits between two captions, which is Pillar 3's "no text the size of a footnote" independent of any
  of this. **A per-level size is rejected** — the line is a fixed height so that a message appearing
  does not move the board, and §11's text scaling multiplies whatever we pick, so a larger `alarm`
  makes reflow risk land on precisely the message that must not reflow.

**No motion, and no persistence: an alarm lives exactly one turn.** The line's freedom from animation
is an asset under §11 and it is not being spent. Persistence was the other free-of-motion option and
it loses on a clean argument: **it protects the line only in the case that does not need protecting.**
The player it is meant to help is the one tapping fast — and a tap produces a press, a press produces
a line, and §2 requires even a refused press be acknowledged, so a persisting `alarm` is pre-empted on
the very next tap. It survives only while the player is idle, and an idle player already had time to
read. The tense makes it worse: `Two things wake.` is a sentence about *this* turn, so a line that
outlives its turn re-asserts it falsely — carrying it forward would need a re-wording into a state
readout (*two are awake*), which is a copy change made by the presentation layer, and if the game
wants that fact continuously it belongs in the HUD beside the other continuous facts, not in the
sentence row. **One turn is also positively right, not merely tolerable:** an ordinary dark step says
nothing, so the row is usually empty, and an `alarm` appearing on an empty row is a change in how much
ink is on the screen — which is the nearest thing to motion available to something that has none.

**The descent keeps §4's precedence: on an arrival that wakes, the line is the wake and not the
floor.** The complaint is fair on its face — one arrival in five wakes something, so `You climb down
to floor N.` is withheld on exactly the arrivals that matter, and the player gets the outcome of a
wager without its context. It is still the right call, three times over. The floor number is on the
HUD in the largest type on the screen and the hunter is nowhere. A compound sentence would overturn
§4's own cause-variant ruling — *the causal link is carried by **when** the line appears* — for a
press that is at least as visible a cause as the flash that ruling was written about, and it would be
the one message that reliably wraps at increased text scale, on the arrival where reading fast matters
most. **And `messages.ts`'s argument against the dormant-strike compound does not apply here**, which
is worth saying plainly: that argument is about *unreachability* — a special case for a branch that
cannot fire is #80's undrawable glyph — and a branch measured at 20% of arrivals is not that. It
survives on the other two reasons, not on that one. What actually closes the gap is the level: an
arrival that wakes now draws in `alarm` and an arrival that does not draws `You climb down to floor N.`
in `report`, so **the two outcomes of the descend press become distinguishable at a glance by the same
ruling that separates the two outcomes of the flash press.** The level is what the compound was
reaching for.

**This must be checkable without a human looking at a screenshot**, which is a constraint on the shape
and not only on the wording. The level is a property of *the cue that won the line*, never of the
string — a component matching on text would be a second copy of the copy. So the turn's line carries
its level with it, three tests hold the ruling, and each holds one thing: a pure unit test that every
message lands in the level this table names and that any turn containing a `woke`, a player `damaged`
or a player `died` cue yields an `alarm`; a component unit test that the two levels differ in at least
two channels, one of them not colour, in **both** schemes (this is the §11 test); and an E2E that
reads the level off the DOM as an attribute rather than off computed styles, so it asserts the rule
and survives M4 repainting everything. **#107's compound adds a fourth thing to pin and it is a
number:** the longest line the game can produce must be **≤ 41 characters**, asserted over every
reachable `n`, because that budget is the only thing standing between the second clause and a wrap
that moves the board.

*Watch:* two signals, with different fixes. If a playtest reports the `alarm` level firing often
enough to stop reading as one — §4's Watch sets the threshold at roughly one turn in six — the fix is
**fewer things speaking**, never a third level. And if a playtest still reports noticing the red `C`
first and reading the line second, then the sentence is the wrong instrument for this job entirely,
#82's tile pulse is the right one, and the response is to **revert this emphasis rather than escalate
it** — not to reach for motion, which §11 has already priced.

## 11. Accessibility — *Requirements settled*

Not deferred to the end as a checklist item; these constrain design from the start.

- Colorblind-safe palette; **colour never the sole carrier of meaning.** This has already cut one
  mechanic (brightness-encoded health in ember-sense, §4), constrains intent markers (§2), and forces
  the turn line's two emphasis levels to differ in weight as well as colour (§10, #94) — where it also
  settles that *the sentences differ* is **not** an admissible second carrier for something read at a
  glance.
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
glyph grid's signature look (ADR-0003) irrelevant. **This is the designated fallback:** if the
**first** playtest says the light wager is not tense, the move is to strip fuel and keep the
tactics, not to add a second resource. (This said "the M2 playtest". `ROADMAP.md` moved the concept
checkpoint up to **M1's exit** when the simulation finished a milestone early, so the fallback is
now spent — if it is spent — one milestone sooner than this section assumed.) Its lesson has been
stolen regardless: combat should be positionally tight, and §2's commit-one-turn-ahead is that
lesson.

> **Ruled 2026-07-31 on #63 and #83: the fallback is NOT spent.** Two playtests have run. The first
> recommended keeping fuel for a reason that was false (it believed re-dormancy unimplemented); the
> conclusion survives and the whole of the reasoning is replaced here.
>
> **This section's trigger is "the first playtest says the light wager is not tense". Neither playtest
> says that.** What the exit playtest says is that the wager is tense **and rare**: with an awake
> creature inside three tiles it measured **8 of 8 commands as real decisions**, twice, and called it
> the best five minutes of the playtest; across a whole run the rate was ~19%, and the flash decision
> was made about a dozen times in 359 turns and never after floor 3. Three of the four tense moments
> it could name are the light system working — the containment read before a flash, fighting blind
> with intent hidden, and the adaptation ramp. **That is a frequency problem, not a concept failure,
> and this fallback is the wrong instrument for a frequency problem.**
>
> **The argument for spending it, and why it fails.** The playtester's case was *fuel is the least
> load-bearing part of the system and it is the part that is broken*. Half of that is right and it is
> the important half: **the flash's price is not fuel and cannot be made to be.** A kill pays 20 and a
> flash costs 4, so pricing light in fuel means either raising the flash toward the value of a kill —
> which prices exploration out of the game — or dropping the kill toward the cost of a flash, which
> removes the reason to fight. **Fuel's job is not to stop you flashing; it is to make you fight**
> (§1: "fuel comes from kills"). The other half is wrong, and it is fatal: strip fuel and *nothing
> pays for a fight*, every fight is pure HP loss, and the optimal line becomes engaging nothing, ever
> — which deletes the one state both playtests found excellent. Note also what this section actually
> offers: not "subtract fuel" but **pure positional tactics with enemies whose fixed patterns force
> contact**. That is a different enemy, a different level generator and a different win condition. It
> is a rebuild, and nothing measured justifies one.
>
> **What was spent instead:** §4's awake-creature rule, replaced (#83), and §4's fourth invariant,
> added. The two levers #63 held open — charging a turn for the shutter, and cutting ember-sense below
> 4 — are both **rejected**; the change log gives the reasons.

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

## 13. Descent and the end of a run — *Settled for M1*

The rules that span floors. §5 owns what a floor *is*; this owns what happens between them and what
stops the run.

**Descent is legal only on the stairs, and it costs a turn.** §9 gives the control; §3 gives the
+2 HP. Only the shutter toggle is free (§2), and it is called out as an exception precisely because
everything else is not.

**What crosses the stairs:**

> **Down the stairs you take your lantern, your eyes and your wounds. You leave the map behind.**

| Carries | Does not |
| --- | --- |
| Fuel — the run's reserve is run-long (§4) | **Remembered terrain.** Memory is of a place, and you have never been to this one |
| Shutter state — walking downstairs does not touch a setting on a lamp you are holding | Ember on the ground you did not pick up. Fuel you did not collect is fuel you did not earn |
| Ember-sense radius. The ramp is triggered by the *act* of shuttering (§4), and descending is not shuttering | The creatures. A new floor's are all dormant, and re-dormancy timers (§4) are per creature, so nothing about the clock is floor-crossing |
| HP, plus §3's +2 | |

**The turn descent costs is paid on the floor below.** Phase 1 puts you at the new entrance; phases
2-6 then run there. Three consequences, all of them the point:

- **The creatures on the floor you left get no parting shot.** A creature adjacent to you had
  declared an attack on your tile, and you are not on that tile any more — descending *is* §2's
  "step off the marked tile", which has always been a defensive move that costs a turn. **The stairs
  are the one escape nothing follows you down.** This is what makes running for them at 3 HP a play
  rather than a prayer (Pillar 4), and it is not free: you forfeit the floor's remaining kills and
  caches, which is exactly §3's "clear this floor, or dive now" wager.
- **Arriving with the shutter open is a wager. It is not a safe reset.** This was written here as a
  guarantee — *§5 keeps the entrance room empty, so the arriving flash wakes nothing* — and the
  guarantee is false. §5's exclusion governs where creatures **stand**; the lit field is Chebyshev 4
  **with line of sight**, and line of sight goes through a doorway into the next room. Measured over
  480 generated floors, **97 of them (20%) wake at least one creature on arrival.** §4's containment
  guarantee cannot cover this: you were on a different floor a moment ago, so there was nothing you
  could have felt. The true promise is spatial, not sensory — **you never arrive on top of
  something; you sometimes arrive in sight of something** (§4).

  **Keep it. It is better than the guarantee it replaces.** A safe arrival makes the stairs a reset
  button and the descent decision a formality. A one-in-five arrival makes "which way do I go down"
  a real question asked one turn before it is answered, which is what Pillar 1 wants from the
  densest tile on the floor. It is also the mechanism that makes the shutter *carrying* across the
  stairs (above) worth something rather than a tidiness rule: the choice only exists because the
  setting persists.
- **Arriving shuttered, nothing wakes, and you arrive with the sense radius you earned above** — so
  the floor below announces its neighbours to you before you decide whether to spend 4 fuel looking
  at the room. That is §4's containment restored by the player's own choice, one turn later, instead
  of by construction. Resetting adaptation on descent was the runner-up and lost badly: it would
  make the four turns after every descent a guaranteed-safe wait-and-adapt ritual, seven times a
  run — Pillar 1's autopilot turn with a fresh coat of paint.

**A run ends in exactly two ways, and neither of them is running out of fuel.**

| Ending | When |
| --- | --- |
| **Died** | The player's HP reaches 0 |
| **Reached the bottom** | The player takes the stairs on the last floor (**8, tuning** — §5) |

- **0 fuel is not an ending.** §4 is explicit: it is a desperate state, not a loss state, and it is
  recoverable. Saying so here because it is the first thing anyone assumes.
- **There is no floor 9 and there is no boss.** §6 has one creature and every other one is M3. The
  eighth descent *is* the ending; inventing something at the bottom now would be M3 content wearing
  a milestone it does not belong to.
- **A terminal state stops the turn where it happens.** If the player dies in phase 4, the actor
  sweep stops there and phases 5 and 6 do not run — the final state is the frame of the killing
  blow, which is Pillar 2 in its most literal form: the last thing on screen is the thing that
  killed you, not three Cinders shuffling around a corpse. If the run ends by descending from the
  last floor, it ends in phase 1 and nothing else runs, because there is no floor below to burn fuel
  on. One rule, both endings.
- **Once the run has ended it accepts no more commands.** They are refused, exactly as §2 refuses an
  illegal move — not resolved, and not thrown. A tap landing a frame after the killing blow is an
  ordinary thing for a touchscreen to produce, and a stored run whose command log runs past the
  death must still replay.
- **Death is permanent and a run is not resumable.** No continue, no rewind. VISION.md.

*What this section deliberately does not own:* the summary screen. The **state** is settled here so
that it does not have to be re-decided later; what is drawn on top of it — floors reached, kills,
fuel spent, turns taken, the seed (Pillar 4) — is the run-loop work. Note for whoever builds it: the
terminal state is a snapshot of the moment the run ended, not a tidied-up world, so counters must be
accumulated as they happen rather than derived from it afterwards.

**What the ending copy may say.** The summary states the fact and the shape of the world; it does
not assert a reason for the descent, anything waiting at the bottom, or anything above it. There is
no such fiction to be faithful to — VISION's non-goal is "the story is the run" — and copy that
implies one is a design decision made in a string. The endings read `† DIED` / *The lantern goes
out.* and `> REACHED THE BOTTOM` / *The dark goes no deeper.*: **the verdict names the player's fate,
the headline is an image of the world**, and neither names a number, because floor count and fuel are
both tuning. A headline must also hold in every legal state it can be shown in — a win with a dry
lantern is legal (§4), which is why the win line cannot mirror the death line by claiming the lantern
still burns.

*Watch, and it is one string to change if it fires:* §4 says 0 fuel is **not** an ending and adds
that this is "the first thing anyone assumes" — while VISION's Pillar 4 uses "the moment the lantern
died" to mean running dry. So `The lantern goes out.` is the sentence a confused player would have
written for the wrong rule. It is kept because the image is true without knowing any rule, the wrong
rule un-teaches itself in play long before the summary, and the panel shows fuel *spent* rather than
fuel remaining. **The signal to change it** is a playtester attributing a death to fuel when fuel was
not the cause — a presentation failure with a one-string fix (drop the lantern noun), and explicitly
not an argument about the fuel rule.

---

## Change log

Design changes get a line here with the reason. Not a substitute for git history — a reason,
recorded at the moment we made it, is the part git cannot give us.

> **Rows are in append order, and the order is authoritative — the dates are not.** Some rows in the
> middle of this table carry invented dates (same defect as `docs/JOURNAL.md`'s headings; #50 owns
> the fix), so the last rows read as *earlier* than the ones above them. They are not: they were
> written on 2026-07-31, by reading a clock. Cite a PR or an issue number, never a date.

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
| 2026-07-29 | **§5 band arithmetic corrected: the middle band is 5 tall (`4+1+5+1+4 = 15`), not 4** | The old decomposition summed to 14 and contradicted the bolded, screen-derived, property-tested 11×15. The grid size wins. The odd row goes to the middle band because rooms 2 and 3 are the only three-neighbour rooms — most doors, most flanking, most need of floor — and because a symmetric split leaves no north/south bias for the player or for balance statistics |
| 2026-07-29 | Grid stays 11×15; 11×14 rejected | 14 was defensible (three uniform 4-tall bands make every §5 sentence true at once) but it buys doc tidiness, which this correction supplies for free, and pays for it in board area. Rows are not the binding screen constraint — 15 rows leaves ~240px for HUD and lantern control on a 844px viewport — so a row we can afford is a row worth having. No ADR: 11 columns, the constraint that is screen-derived, did not move |
| 2026-07-29 | The merged hall is "up to 5 × 10", not "5 × 9" | Follows from the 5-tall middle band. The hall's size was never load-bearing: a merge exists to delete a chokepoint and create the floor's one unholdable, un-flashable space. Changing the band split to preserve a 9 would be tuning dictating structure |
| 2026-07-29 | **Only vertically stacked room pairs may merge** | A side-by-side merge deletes the column separator — the only wall spanning the level's full height, the one ember-sense reads through to answer "which side am I on", and the axis the mental map is built on. It would also leave a full-width band with no threshold in it, so a floor could contain no doorway decision at all (Pillar 1) |
| 2026-07-29 | **The 2-tile entrance exclusion is Manhattan, not Chebyshev** | Movement and attacks are 4-directional, so the player's unit of distance is the step. A creature two tiles diagonally away is four steps away; excluding it means the rule cannot be checked by looking at the board (Pillar 2). Stricter is not safer when the strictness has no referent in the rules. Confirmed against the runner-up (Chebyshev) on legibility, not on candidate-count |
| 2026-07-29 | **A merged pair counts as one room when measuring graph distance to the stairs** | The generator already treated a merged pair as one room for spawn exclusion and as two for distance; one of them had to give. "No wall, no door, no threshold, one perceived chamber" is the reading that matches §5's own claim that the unit of memory is a room and its doors — a merge crosses no door |
| 2026-07-29 | Doorway tiles hold nothing — no creature, cache, entrance or stairs | A doorway is the only tile with exactly two opposite exits; occupying it turns a threshold into a passage that must be cleared, which is the corridor problem in another costume |
| 2026-07-29 | §4: flagged the vision-radius metric (Chebyshev / Euclidean / Manhattan) as unsettled | It was never stated, and §5's Manhattan ruling makes it likely to be wrongly inferred. Must be settled before field-of-view is built |
| 2026-07-29 | **Every vision radius is Chebyshev — lit, touch, ember-sense, and the whole adaptation ramp** | §4 had already committed to it without noticing: "radius 1 — the 8 tiles you can touch" is only true under Chebyshev (Manhattan and Euclidean radius 1 are 4 tiles). Beyond that: a square is the only edge a player can state as a rule, and the lit region is the most-rendered object in the game (Pillar 2); and radius 4 Chebyshev is exactly the corner-to-corner span of the largest room, so a flash lights one room from anywhere in it. Runner-up Euclidean lost on Pillar 1, not on looks — a disc leaves 4-5 tiles of a 5×4 room dark unless you stand near the middle, making "walk to the centre, then flash" the always-correct move, which is an autopilot turn. Manhattan lost twice over: same autopilot, plus a diamond of light reads as a rendering bug |
| 2026-07-29 | Light and ember-sense share the metric, and ember-sense radius (5) exceeds the lit radius (4) | It buys a containment guarantee: the lit region is always a subset of the sensed region, so **everything a flash can wake, you can already feel**. The price of opening the shutter is knowable before you pay it (Pillar 2). A separate metric for ember-sense would break containment at the corners and produce this system's one genuinely unfair death — a creature woken inside your own light that you had no way to sense |
| 2026-07-29 | The two-metric split is now a stated rule: **regions on screen are Chebyshev, steps of movement are Manhattan** | §5's spawn exclusion stays Manhattan. Recorded as a line rather than an exception so the next agent applies it instead of relitigating it. Light is a field the player measures by looking; spawn distance asks how many turns until that thing reaches me, and no human ever counts it |
| 2026-07-29 | **Ember-sense radius corrected 6 → 5 (tuning)** | Forced by the metric, not a balance opinion. Chebyshev 6 is a 13×13 box on an 11×15 map — ~87% of the floor from the middle band, and it stops varying with position. That falsifies §5's "there are two things in the room north of me" and makes the top two steps of the adaptation ramp provable no-ops. Whether 5 should be 4 or 3 is an M2 playtest question; whether 6 was a radius at all is not |
| 2026-07-29 | **Dark-adaptation floor corrected 2 → 1**; ramp is 1→2→3→4→5 | Knock-on from the ceiling drop: floor 2 against ceiling 5 gives a three-turn ramp, and §4 has always claimed four turns. Floor 1 restores it *and* subtracts a constant — it is the same 1 as the dark touch radius, so the rule states itself: shuttered, you know only what you can touch, and your sense of the living grows a tile a turn back to five |
| 2026-07-29 | §4's "light reveals ~20 tiles per turn" replaced with the room-level arithmetic | Wrong number and wrong unit. A first flash into a fresh room reveals ~40 tiles (20-25 floor plus its walls) and every flash after reveals roughly none, so there is no per-turn rate. On this map **walls, not the radius, are what bound a flash** — that is the fact the fuel economy actually rests on, and it was not written down |
| 2026-08-02 | **Cinder ember drop 30 → 20 and cache 40 → 25 (both tuning)** | **§4's third invariant failed measurement.** At 30/40 a scripted competent run netted about **+85 fuel a floor** against a starting reserve of 80 — one good floor bought the next two, and the lantern stopped being a resource somewhere on floor one. That is "trivially winnable", not "slightly positive". At 20/25 the same corpus nets +11 a floor at an income/spend ratio of 1.10, roughly one floor in five is a net loss, and a competent eight-floor run ends with about twice the reserve it started with rather than five times. The two moved **together** so the ratio between a kill and a cache is preserved (1.25 against the old 1.33): shrinking only the drop would have made exploration the income side of the economy and combat the garnish, which inverts §1. The invariant is the design; these numbers are not. `game/systems/economy.test.ts` is what caught it and what will catch the next drift |
| 2026-08-02 | **§2: a free action runs phases 1, 2, 3 and 5, and skips 4 and 6** | `turn.ts` settled phase 4 and left 2 and 6 open for the fuel work; this closes them, and each answer is read off the GDD rather than chosen. Fuel **runs**, because §4's exploration arithmetic is priced in it — "a flash buys a room ... for 4 fuel ... light is roughly three times cheaper in fuel ... neither dominates, and the reason is arithmetic" is false if a flash is free, and light would simply dominate exploring. This is not the fuel *tax* §4 rules out: there is no surcharge for toggling. Dark adaptation **skips**, because §4 recovers ember-sense "+1 per turn" and a free action is not a turn; ticking it would let a player climb the ramp by strobing |
| 2026-08-02 | §4: a dry lantern is the shuttered column of the vision table, permanently — not a fifth state | The smallest reading of "you can still crawl at radius 1 with ember-sense", and the only one that keeps 0 fuel recoverable. Ember-sense belongs to the player's dark-adapted eyes rather than to the lamp; if it went out with the fuel you could not find anything to kill and could not earn your way back, which is the unplayable-rather-than-desperate failure the rule exists to prevent |
| 2026-08-03 | **§4: a run starts with the lantern open, at the entrance, with the entrance room already perceived** | **Reason 1 below was measured false — see the 2026-08-04 row. The ruling stands; only the reasoning moved.** §4 never said, and the two systems that need to know both refused to guess. Read off §5 rather than chosen: step 7 guarantees no creature in the entrance room or the room merged with it, so the opening flash is the one flash whose safety the *generator* provides — it costs 4 fuel and wakes nothing. The runner-up, starting shuttered at the adaptation floor, loses on Pillar 1: on a floor guaranteed safe to stand on, the correct opening becomes four turns of *wait* while the ramp climbs, which is an obvious optimal sequence at the most visible moment in the run. It also loses on Pillar 2 — a first frame of nine tiles of stone teaches nothing, and a game with no tutorial text has to be readable on turn 1 |
| 2026-08-03 | **§4: full ember-sense adaptation is always earned; a run's sense radius starts at 1, not 5** | The implementation's default was full adaptation whichever way the shutter started, which silently hands out a radius-5 wall-piercing sense for free. Unobservable at M1 (shuttering resets to 1 anyway), but §9 puts the number on the HUD and a HUD reading 5 before the player has ever been dark is a lie they will act on. Stating it as *earned* also closes the door on the next start-state (a debug mode, a new floor) reintroducing the gift |
| 2026-08-03 | **§2: an illegal-but-well-formed action runs no phases and costs nothing** | Walking into a wall, descending off the stairs, or commanding a finished run. The "harsh" option — charge the turn to stop free probing of the dark — was refuted rather than out-voted: §4's touch radius and adaptation floor are both 1, so *you always know your own four neighbours*, and a bumped wall was in your perceived set before you tapped it. There is no information to buy, so charging a turn only punishes a fat-fingered tap on a 6-inch screen — and hands every creature on the floor a free turn while doing it (Pillar 3, the same argument that made the shutter toggle free). The input layer refuses first; `step()` refusing is the backstop that keeps the simulation total. A refused tap must still give feedback: a dead tap on a phone reads as a missed touch, not as a rule |
| 2026-08-03 | **§3/§9: there is no separate `attack` command — the command set is move-or-attack, wait, toggle shutter, descend** | §3 already settled bump-to-attack ("what a tap does is decided by what is standing there, never by a mode"); a separate attack command reintroduces the mode it removed. It also dissolves one of the three illegal-action cases instead of answering it: attacking an empty tile stops being expressible. The only thing it could buy — striking a tile a creature is about to enter — is worth nothing, because player attacks resolve immediately against what is there now. Subtraction over a ruling |
| 2026-08-03 | **§9: descend is its own control, shown only while standing on the stairs — not the self-tap** | §9's old wording ("tap them while standing on them") collided with "tap your own tile to wait" and silently deleted *waiting on the stairs*. That is the worst tile in the game to lose a turn's worth of choice on: it is exactly where §3's "clear this floor for fuel, or dive now and bank the heal" decision is made. A second, *conditional* thumb control is not clutter — its presence is also unambiguous confirmation you are standing on the stairs, which is worth something in the dark |
| 2026-08-03 | **New §13: descent costs a turn, the turn is paid on the floor below, and the lantern and the eyes cross the stairs while the map does not** | Fuel, shutter and ember-sense radius carry (the ramp is triggered by the *act* of shuttering, and descending is not shuttering); remembered terrain does not, because memory is of a place. Paying the turn below rather than above means the creatures you fled get no parting shot — descending *is* §2's "step off the marked tile", which has always been a defensive move that costs a turn — so **the stairs are the one escape nothing follows you down**, at the price of the floor's remaining kills and caches. Resetting dark adaptation on descent was the runner-up and lost on Pillar 1: it would make the four turns after every descent a guaranteed-safe wait-and-adapt ritual, seven times a run |
| 2026-08-03 | **New §13: a run ends in exactly two ways — died, or took the stairs on the last floor — and a terminal state stops the turn where it happens** | The GDD had never said the run could be *won*; §1 said "repeat down eight floors" and stopped. There is no floor 9 and no boss (§6 has one creature; the rest is M3), so the eighth descent is the ending. Death stops the actor sweep mid-phase so the final frame is the killing blow rather than three Cinders shuffling around a corpse (Pillar 2, most literally). Commands after the end are **refused**, not thrown — a tap landing a frame after the killing blow is ordinary touchscreen behaviour, and a stored run whose log runs past the death must still replay. This also dissolves the frozen-clock hazard by construction: a finished run consults no schedule, so it cannot matter that the schedule is empty |
| 2026-08-04 | **Correction, measured: the arriving flash does *not* wake nothing. §4 and §13 both claimed it did; 20% of arrivals wake something** | **The ruling ("a run starts open", 2026-08-03) survives; one of its three reasons does not.** The bad step was reading a **room** exclusion as a **light** exclusion: §5 step 7 constrains where a creature may *stand* (not the entrance room, not its merged partner, not within 2 tiles), and I concluded the entrance was therefore safe to light. But the lit field is Chebyshev 4 **with line of sight**, and line of sight runs through a doorway into the next room — which is exactly where §5 is happy to put creatures. #18's implementation measured it over 480 generated floors: **97 (20%) wake at least one creature on arrival.** Reasons 2 and 3 carry the ruling alone, and reason 2 is *strengthened* — a shuttered opening is now the only guaranteed-safe one, so the four-turn wait-and-adapt ritual it invites is more attractive, not less, and Pillar 1 wants it gone more than before. Three edits follow. §4's containment guarantee gains the clause it was always missing — it holds only on a floor you have **already felt**, so **arrival is the third case where it does not apply** (with the adaptation ramp and an open shutter); you cannot have sensed a floor you were not standing on. The promise becomes spatial rather than sensory: **you never arrive on top of something; you sometimes arrive in sight of something** — at least three tiles off, through a doorway, lit, telegraphed, and woken into a *declaration* rather than an action (§2 phase 3), with §4's re-dormancy rule already in the player's hand as the answer. And §13 keeps the behaviour deliberately rather than patching it: a guaranteed-safe arrival makes the stairs a reset button and the descent a formality, where one-in-five makes "which way do I go down" a real question — and it is what gives the *shutter carries across the stairs* ruling a mechanism instead of a tidiness argument. A first-turn exemption was never on the table: it would be a fifth vision state invented to protect a sentence |
| 2026-08-04 | **§2: a fourth refusal — `setShutter(to)` where the shutter already reads `to` runs no phases** | The refusal block was written as exhaustive ("three well-formed commands"), so a fourth rule had nowhere to live but a comment inside the reducer — which is where a rule gets tidied away by someone who cannot see why it is there. **The block was not wrong; it predated the command.** It was written when the shutter command was a *toggle*, and a toggle cannot be re-asserted. `setShutter(to)` can, and the command shape changed for a determinism reason: a toggle's meaning depends on the state before it, so one dropped or duplicated command silently inverts the rest of a stored run, and a run is a stored artifact (Pillar 4). The rule itself reads off §2 rather than being chosen — what §2 makes free is *changing* the shutter, and free of **tempo**, not of **fuel**; a flash costs its 4. Resolving a re-assertion would therefore charge 4 fuel for a double-tap on a control already reading *open*, which is precisely the fat-fingered tap §2 refuses everywhere else (Pillar 3). Not exploitable in the other direction either: the command it refuses was free of tempo anyway, so refusing it skips no turn and gives nobody an extra one. §9 now carries the control/command distinction once — the thumb control is still a toggle; what it emits is a setting |
| 2026-08-05 | **§9: auto-travel is one `travel(to)` command; its interrupt rule narrows to creatures only — terrain never interrupts; and the build is deferred to M2** | ADR-0009, from #32. §9 had marked auto-travel settled as a *feature* without ever saying how it is commanded, and that turned out to be a determinism question: the interrupt rule is computed from the lit field, the sensed set and the wake set, so a loop above `game/` would put resolution in the presentation layer — which `command.ts`'s "a command carries intent, not resolution" already forbids, and which lets a backgrounded app leave a run half-travelled with nothing in `game/` knowing. **The interrupt narrowing is the substantive change.** §9's "anything new becomes visible or sensed" never says what *new* is measured against, and the two available readings disagree: **stone is remembered, ember is not** — terrain would have to be judged new against permanent memory, the living against the previous step. Under the memory reading a shuttered travel across mapped space is well behaved; under the previous-step reading, touch radius 1 makes nearly every step perceive a tile it did not perceive last turn, and travel never travels. The lit direction has no good reading at all: "anything new becomes visible" at radius 4 through a doorway has no edge a player can state (Pillar 2). Terrain is cut rather than qualified because **the route runs over remembered tiles only**, so a travel cannot enter unmapped space, and because the only mode travel is economically sensible in is dark — where items are invisible, terrain reaches one tile, and nothing wakes. That is not a balance opinion: **lit travel is self-punishing by arithmetic**, 4 fuel a turn and a woken room per crossing, so a rule written to make it comfortable would be a rule protecting a move the economy already rejects. What is left is one sentence a player can hold: *you walk until something living appears, or something touches you.* **The stop is keyed to the *count* of perceived creatures and not to identity**, which is not a detail: ember-sense gives position only (§4), so a rule that knew one mark from another would stop for a reason the player could not see — and, because the stop is itself observable, would hand back one bit of identity §4 promises does not exist. Travel may not key on anything the player cannot see. §4's promise is therefore untouched by this ruling, which is the whole reason the key is the count. **Deferred because the friction has never been felt** — nothing above `game/` exists, so tuning the stop rule now is tuning it against imagination. #20 needed a ruling, not a feature |
| 2026-07-31 | **Correction: §4's awake-creature/re-dormancy block was labelled "(M2)" long after #16 shipped it in M1** | Not a design change — a status marker that had gone stale, and it cost a real verdict. The first `playtester` run read it, concluded re-dormancy was unbuilt, and recommended against re-tuning the wager on the grounds that light was being measured with one of its two counterweights missing (#31). It is built: `nextMind` sleeps a creature at `TURNS_TO_REDORMANCY = 8` turns without light or adjacency, `behaviour.test.ts` pins "on the eighth turn and not before", and `replay.test.ts`'s fixture walks it end to end and calls itself the only fixture in the repo that pins it. #63 re-rules the recommendation. The transferable lesson: **a milestone marker left on an implemented rule reads as "not built", and nobody consuming the GDD can tell the difference from the outside** |
| 2026-07-31 | **§10's M1 glyph list gains `+` doorway, `<` entrance and the blank unknown cell, and says the ember glyph covers a drop as well** | Documentation catching up to `render/glyphs.ts`; no decision changed. §5 has had doorways and an entrance since #13 and the list never grew, so a playtester briefing themselves off §10 would meet two glyphs the document does not name — in a game whose central mechanic is not being able to see |
| 2026-07-31 | **§9's auto-travel bullet: the playtest gate is answered and the recommendation is build it** | The build stays in M2 and every rule below the bullet is unchanged. Recorded because the *reason* §9 gave for deferring ("the friction has never been felt, nothing above `game/` exists") expired the day #20 shipped. The friction was felt, but not where the gate looked: it is forward travel across rooms one flash has already revealed, not backtracking — the roadmap's disambiguating probe for backtracking returned no, not once, in six runs. Full evidence on #32, split arms preserved in `ROADMAP.md` |
| 2026-07-31 | **§12 records that the first playtest has run and that the fallback is not spent** *(superseded the same day by the §12 row below — read that one)* | §12's trigger is "if the **first** playtest says the light wager is not tense". It ran and the wager is not tense today, so the trigger has fired while the conclusion has not — the playtester recommended keeping fuel, and the recommendation needs re-ruling (#63) because the reason it gave was false. Written into §12 rather than left in the roadmap because a future session reaching for the fallback will reach for this section |
| 2026-07-31 | **New in §13: a constraint on what the ending copy may claim, and the win headline changes from *You reach the bottom.* to *The dark goes no deeper.*** | §13 disclaimed the summary screen ("what is drawn on top of it... is the run-loop work") and then said nothing about what that copy may assert — so the tone at the game's emotional peak became the property of whoever was holding the file, which is how this came up. **The rewrite is caused by #21, not inherited:** putting the verdict `> REACHED THE BOTTOM` above the old headline left two lines sharing a subject, reading as one thought said twice at the one moment a player has earned something. The death pair works because of a structure the win pair had lost — **the verdict names the player's fate, the headline is an image of the world** — so any fix keeping "you" as the subject would have been a reword rather than a second line. `The dark goes no deeper.` is §13's own settled fact ("there is no floor 9 and there is no boss; the eighth descent *is* the ending") stated as an image, and it answers the live question a player has on winning a roguelike with no boss: *is that it, or did I miss something?* Two constraints fall out and are now written down, because both were easy to trip: **it may name no number** (`LAST_FLOOR` is tuning, so "eight floors down" becomes a lie the first time it moves, in a string that cannot read state), and **it must hold in every legal state it can be shown in** — a win with a dry lantern is legal under §4, which kills the tempting mirror `The lantern still burns.` in exactly the most retellable runs. Meaning was never the open question: VISION's "the story is the run" plus Pillar 4 already settle that the bottom is where the run *stops*, not a destination with content in it — but it was settled distributively across three documents, which is why it read as unwritten. Rejected outright, recorded so they are not re-proposed: daylight, escape, climbing out, the ruin conquered, or something waiting at the bottom |
| 2026-07-31 | **§4/§6: a woken Cinder no longer parks — it comes for you until eight turns pass with no light and no touch, then sleeps where it stands** | #83, from the M1 exit playtest. §4's own watch fired: *"if the playtester reports retreating to a cleared room and pressing wait, it is broken."* It reported walking in a circle instead, which is the same thing at 1 fuel a turn. Measured, same seed: a flash woke a Cinder on floor 2, the retreat cost 16 turns of walking and the kill paid 20, so **waking it was net +4 fuel *profitable* after paying for the whole retreat**; on floor 8, three flashes woke five Cinders with the run on the line at 10 HP and the situation resolved into `fuel 23 -> 60` with no damage taken. **Re-dormancy is not the counterweight to light, it is the cause** — the flash's price is what it wakes, and the price was refundable at a profit. The old rule's real defect was upstream of re-dormancy: an awake creature that lost contact *parked*, so breaking contact was free and §3's "fleeing is hard, and that is a feature" was simply false. This is subtraction, not addition — it deletes two of `nextMind`'s five cases (`lastSeen` pathing and the search-then-wait that `behaviour.ts` itself flagged as "a statue"), adds no mechanic, no state and no UI, and makes four existing rules load-bearing that had nothing to do: §5's loop doorways, §2's step-off-the-marked-tile, §4's adaptation ramp (which now creates the window where things can feel you and you cannot feel them) and §13's un-followable stairs. **The runner-up was cutting re-dormancy outright** — simpler, one constant deleted, and certain to kill the loop. It lost because it removes the loop without creating the pressure: a permanently-awake parked Cinder is furniture you route around, the decision rate does not move, and the flash's price becomes "one room is now annoying". It also deletes §4's "darkness is restorative" permanently, where this ruling makes it *earned*. **§4's own named fix, a distance requirement, was rejected**: the measured degenerate case was already at distance, so requiring more of it lengthens the retreat — more autopilot turns, which is the cost being paid. The 8 stays and is the dial **for the too-strong arm only** — see §4's watch for why it cannot fix the other one |
| 2026-07-31 | **§4 gains a fourth tuning invariant: at comparable combat, a style that never opens the shutter must not out-earn one that flashes** | **The "at comparable combat" scoping is load-bearing and was added on review** — stated unscoped, invariant 4 contradicts invariant 2, which pins the *opposite* ordering as a required property (`expect(flashed).toBeLessThan(never)`, passing at 163 turns against 206). On a pacifist pair those are the same axis, so an unscoped invariant 4 could only be satisfied by deleting invariant 2. The two are compatible between styles that fight comparably, which is what the `HARVESTER`-vs-`STALKER` comparison measures. | Invariants 1 and 2 are both about *avoiding* something — combat, darkness — and **the degenerate line avoids nothing.** It fights every creature on the floor and simply never opens the lantern, so all three older invariants stayed green through two playtests that both found that line within two runs. The corpus's `STALKER`, its model of competent play, is strictly worse than a line a human found by accident, which means §4's numbers have been tuned against the second-best strategy since #17. Stated as an invariant rather than filed as a finding because the failure was structural: the instrument could not see the axis. **No §4 number moves until the corpus contains a never-flash fighter**, and invariant 4 is unsatisfiable before #31/#41 land regardless — `collectFuelUnderfoot` pays on tile kind, so dark play currently collects 119 of 121 caches that §4 says are invisible to it, and every fuel figure in both playtest reports includes income the design says darkness cannot have |
| 2026-07-31 | **§12: ruled — the fallback is not spent, and its trigger has not fired** | #63's re-ruling, and **a reversal of the §12 row above**, which said "the trigger has fired while the conclusion has not". Both rows are dated today and only position says which is current, so: **this one is.** The earlier row read the trigger as fired because the wager is not tense *today*; the reversal is that §12's trigger names a playtest *saying the wager is not tense*, and neither said that — both said it is tense and rare. Recorded as a reversal rather than a correction because the earlier reading is defensible and the next person may prefer it. The first playtest's recommendation stands; none of its reasoning does. The trigger is *"the first playtest says the light wager is not tense"* and **neither playtest says that** — the exit playtest measured **8 of 8 commands as real decisions** with an awake creature inside three tiles, twice, and named three species of tense light moment (the containment read, fighting blind, the adaptation ramp). The wager is tense and **rare**, which is a frequency problem this fallback cannot fix. The strongest argument for spending it — *fuel is the least load-bearing part of the system and it is the part that is broken* — is right that the flash's price is not fuel and cannot be made to be (a kill pays 20 against a 4-fuel flash; closing that gap either prices out exploration or removes the reason to fight), and wrong that fuel can therefore go: **fuel's job is to make you fight, not to stop you flashing** (§1), and without it every fight is pure HP loss and the optimal line is engaging nothing — which deletes the one state both playtests found excellent. §12's fallback is also not "subtract fuel"; it is enemies with fixed patterns that force contact, which is a different enemy, generator and win condition. **Both levers #63 held open are rejected.** Charging a turn for the shutter loses on Pillar 3 (§2's argument is unchanged) and on aim — it prices tempo when the thing that needs pricing is waking. Cutting ember-sense below 4 loses because #82 measured the containment guarantee as **unexecutable on screen**: a playtester who had read §4 and knew the metric miscounted a column and woke a Cinder. You cannot tune away a permission check nobody can perform, and the cut would spend Pillar 2's strongest expression to do it |
| 2026-07-31 | **§9: travel also stops when a creature you perceive changes tiles (*Proposed*; amends ADR-0009)** | Forced by the awake-creature ruling above, and cheap only because #65 has not started. A woken creature now walks toward you every turn, so under ADR-0009's three stop clauses a hunted player could tap a far tile and have `step()` resolve the eight tensest turns in the game for them — auto-travel automating the exact decisions §4 was rewritten to create, which is a worse version of the kill condition ADR-0009 already names. The clause keys on *a mark that is not where it was*, which satisfies ADR-0009's binding constraint that travel may never stop for a reason the player cannot see, and needs no identity — any mark moving is enough. It costs nothing across a floor of sleepers, because **a dormant creature never moves**, which is exactly the case travel exists for |
| 2026-07-31 | **§3/§6: recorded that the dormant strike's "if the target survives, it wakes" clause is unreachable at M1's numbers** | Not a change — an honesty fix, and the second dead branch found this week (#80's `c` glyph is the first). 6 damage against 5 HP means a dormant strike against a Cinder is always lethal, so the *survive-and-wake* branch is dead. **The gradient §3 names is not** — it is the dormant kill (one strike, no damage) against the awake fight (two strikes, 2-4 damage), which is two points and unaffected. An earlier draft of this row said §3 describes a one-point gradient; that overstates it, and the correction matters because the next reader of this row might otherwise re-tune Cinder HP to fix a gradient that is not broken. The numbers are deliberately **not** moved to make the clause live: §2's phase order means a survivor declares on the turn it wakes and resolves on the next, so it only ever swings if it survives the strike *and* a full follow-up, which needs 10 HP, which turns an awake Cinder into a four-hit grind — Pillar 1's "attack until it dies", bought to make one sentence true. The clause is kept for creatures that do not exist yet (M3). Written down because an unreachable clause reads as a live branch, and the next person to tune Cinder HP needs to know which of the two things they are doing |
| 2026-07-31 | **§4/§6: a wake is announced in the turn line, with a count, and it outranks the shutter line** | #79, from the M1 exit playtest: seven turns, two Cinders woken, the line under the board empty the whole way. §4 promised the player the price of a flash *in creatures* **before** the press ("everything a flash can wake, you can already feel") and said nothing about what they are owed **after** it — so the game's most consequential event was the only one it never acknowledged, which is §2's own standard applied to the wager instead of to a refused tap. Ruled here rather than left to the `ui-engineer` because two of the three clauses are design, not copy. **The count is spoken** — not to substitute for looking, since a woken creature is lit or adjacent by construction, but because a flash reveals a *whole room at once* and one new glyph among twenty is not a signal; the number is also the only executable form of the containment guarantee until #82 draws the footprint. **The wake line beats `shutterChanged`**, which competes for the same single line every flash turn: "The shutter opens" restates the board's entire tint change on the one turn the player pressed the control themselves, and demoting it means the turn line reports the flash's *outcome*, with the shutter line surviving as the sentence that means *you got away with it*. **It covers arrival** — phase 3 runs on `descend` and on `beginRun`, and §4 measures one arrival in five as waking something, where the player has a new floor, sense radius 1 and no reason to suspect anything. On a fresh floor every creature spawns dormant, so awake-in-`after` **is** woken-this-turn and no cross-floor diff is needed; if that spawn invariant ever moves, the census is wrong and must become a diff. Precedence is player death > player damage > **woke** > recency: player damage keeps the tier it won in #20 (three silent turns from death at 12 HP), and woke sitting directly under it resolves the §3 dormant-strike case with no special branch — a survivor's wake takes the line over `You strike for 6.`, which is right, since the strike was chosen and visible and the waking is the surprise. **Re-lighting an awake creature is silent**: no transition, and a line that fired every turn a `C` stood in the light would speak on every turn of every fight, which is how a player learns to stop reading the line. The runner-up shape was a single aggregated cue carrying only a count (`fuelGained`'s shape); it lost to one cue per creature carrying `at` (`damaged`/`died`'s shape) because `render/cues.ts`'s bar for a new kind is *a renderer would draw it differently*, and a count can only ever become text where a position can become a pulse on the tile that woke — the treatment most likely to fix the playtest's "I did not notice" without the line at all. The count comes free as the list's length, and `at` is what lets #82's spatial promise be checked against a spatial receipt rather than a scalar one |
| 2026-08-01 | **§10: the turn line gets two emphasis levels, `alarm` and `report`, and which messages sit in each is a rule** | #94, from the playtest of #79. #79's rule, copy, count and precedence all held in play; what failed was the volume knob. Measured at 390×844 dark, the turn line is 13px/400 in the same grey as the shutter button's sub-caption and the build note — the second-smallest text on the screen — so `The shutter opens. Light spills out.` and `Two things wake.`, the two outcomes of one press, are **typographically identical**, and at the half-second a phone player gives the line the difference between *you got away with it* and *you have company* is which dim grey letters are present. A rule that fires correctly and cannot be read is not a rule the player has, which is why this is ruled rather than left to the `ui-engineer`. **Two levels, not three.** `alarm` is *something is now against you that was not before* — a wake, damage taken, the player's death; `report` is *here is what your press did*, which is everything else including every refusal. A third level below `report` for refusals was rejected because it has nowhere to go: `report` already sits one step above the captions and dropping under them is Pillar 3's footnote-sized text. A third level splitting *hunted* from *hit* was rejected because §4's precedence means those two never appear side by side, and a distinction the player can never contrast is a costume rather than a tier. The levels turn out to **agree with §4's precedence exactly** — `death > player damage > woke` *is* the `alarm` set and everything recency can reach is a `report` — so no turn ever pre-empts a louder line with a quieter one, and that is pinnable over the real-run corpus. **Weight and colour both carry it, and the words carry nothing.** The tempting §11 defence is that the sentences differ, so the distinction survives greyscale; it is rejected because it is the same defence that would justify doing nothing, and §11's real test is whether the distinction survives *how the element is read* — at a glance, which is a channel words do not reach. So weight is the non-colour carrier, and colour gets a closed `alarm`/`report` token pair that a theme may not collapse — not `token.creature` as proposed, which is a board role, is wrong for `You take N.`, and would let a board retune move the chrome. `report` may keep `textDim`'s value; what is ruled is that it stops *being* `textDim`. One shared size for both levels, raised to rank above every caption — a per-level size was rejected because the row is fixed-height so the board does not jump and §11's text scaling multiplies it, which puts reflow risk on exactly the message that must not reflow. **No persistence and no motion.** Persistence was the serious runner-up and it is free of motion, but it protects the line only in the case that does not need protecting: it exists for the player tapping fast, and a tap makes a press, a press makes a line, and §2 requires even a refused press be acknowledged — so it is pre-empted by the very next tap and survives only while the player is idle. It also lies by tense, since `Two things wake.` is a sentence about *this* turn, and carrying it forward would need a re-wording into a state readout, which is a copy change made by the presentation layer and belongs in the HUD if it is wanted at all. One turn is positively right: an ordinary dark step says nothing, so an `alarm` appearing on an empty row is a change in how much ink is on screen — the nearest thing to motion available to something that has none. **The descent keeps its precedence:** on an arrival that wakes, the line stays the wake. A compound was the runner-up and `messages.ts`'s standing argument against compounds does **not** defeat it — that argument is about *unreachability*, and 20% of arrivals is not unreachable — but it loses anyway on three: the floor number is on the HUD in the largest type on screen and the hunter is nowhere; a compound overturns §4's cause-variant ruling (*the causal link is carried by when the line appears*) for a press at least as visible as the flash that ruling was written about; and it is the one message that reliably wraps at increased text scale, on the arrival where reading fast matters most. The level closes the gap instead — a waking arrival draws `alarm`, a quiet one draws `You climb down to floor N.` in `report` — so the descend press gets the same glanceable contrast the flash press does, which is what the compound was reaching for. **Checkable by construction:** the level is a property of the cue that won the line, never of the string, so a pure unit test pins the assignment, a component test pins that the two levels differ in two channels in both schemes, and an E2E reads the level off the DOM as an attribute rather than off computed styles. Cut signals in §10: `alarm` firing more than ~1 turn in 6 means fewer things should speak, not a third level; a playtest still reporting the `C` read first and the line second means the sentence is the wrong instrument and #82's pulse is the right one, and the response is to revert this rather than escalate it |
| 2026-08-01 | **§4: a cache is terrain the lantern has to have shown you — touch feels it as floor, and it pays once its tile has *ever* been lit. The code is wrong; §4 and §1 are right** | #31 and #41, ruled together because answering one alone yields a cache you can see and not take, or take and not see. Both issues leaned the other way (amend §4, let the dark keep its caches) and **both were reasoning without the number.** #41 priced the leak as "probably not by much" on the grounds that touch is radius 1, so finding a cache that way is the 10-15-turn expensive path; the corpus falsifies it — a dark crawler walks the floor to find the *stairs* anyway, so the cache comes free with an activity it was already doing, and `DARK_PACIFIST` takes **119 of 121**. Restricting only *routing* still takes 89 of 121, so reading (c) is a 26% haircut, not a rule. **The amend-§4 option is also mispriced as "a line of the GDD".** §1's settled core loop names *light finds supplies; dark finds enemies* as one of the **three facts that give the light decision teeth**, and the other two (fuel from kills, the dormant strike) are both *dark* advantages — so deleting it leaves light with no product darkness cannot buy, which is invariant 4's exact wording, and makes the invariant unsatisfiable by design rather than by bug. That is an ADR against ADR-0007's territory and a new mechanic to replace what it deletes, against **one boolean plane** to enforce what is already written. **The three clauses each refute an option rather than out-voting it.** Touch renders the tile as *floor*, not as nothing: a permanent hole at exactly the cache tile is **more** informative than the `♦`, and it would break §4's four-neighbour guarantee, which §2 spends to refuse an illegal move for free. Payment keys on **ever lit**, not *currently* lit: the strict reading falsifies §4's own "a kill or a cache re-opens the shutter" at 0 fuel, where the shutter cannot open, and it manufactures an autopilot — the shutter is a free action and §2 runs phase 5 on free actions, so `open`-`shut` on a cache tile takes it for 4 fuel and no turns whenever ember-sense is clear, which is the permission check both playtests named, rebuilt on a new tile. **Ember a kill drops is explicitly excluded** — you know it is there because you made it, and a dormant strike whose ember you could not collect would delete darkness's one capability. Runner-up rejected and recorded: a *scuff* cue when you step on an unlit cache, which preserves the good stumble but hands the information back in a costume, restores dark cache routing, and makes the follow-up flash obviously correct for +21. **Cost, admitted:** one more monotone per-tile channel in `Vision` — the tiles the *lantern* has revealed — which a replay must reproduce and which resets on descent like remembered terrain. Not the "map of known kinds" it looked like: one kind diverges, one way only. §4's exploration arithmetic is corrected in the same pass and the correction is factual, not tuning — a flash is 5 fuel and **zero turns**, both toggles being free actions, so "ten times cheaper in *turns*" was never true and light is 2-3× cheaper in fuel and unmeasured in tempo; **the flash's price is what it wakes**, which is what §12 and #83 already say. Expected effect, for the re-measurement to be checked against: dark cache income ~37/floor → near zero (only the entrance room, lit on arrival, survives), `STALKER`'s take should barely move, and `CACHE_FUEL` becomes light's exclusive income and therefore the dial for invariant 4. **Necessary, not sufficient** — a never-flash *fighter* still banks 20 a kill, and `HARVESTER` is what says whether more is owed. Numbers deliberately **not** moved here: that is the roadmap's later step and moving one now would re-tune against the contaminated corpus this ruling exists to clean |
| 2026-08-01 | **§10: a turn that both wakes and pays says both — `Two things wake. You gather 21 ember.`, one line, `alarm`, and the only compound the turn line has. §4: the shutter still pays a cache underfoot** | #107, from the playtest of #31/#41. That ruling created a turn shape the precedence had never been asked about: the pickup condition is *ever lit* and the shutter is a free action, so opening the shutter on an unlit cache lights the tile and pays it on the same press — and that press wakes what the light touches, by construction, because the flash is what lit the tile. `woke` outranks recency and `You gather N ember.` lives in recency, so the turn read `Two things wake.`, the `♦` never rendered for a frame, and the only evidence a cache existed was `FUEL 66 → 87`. **The receipt #79 built printed the price and not the goods, on the one turn that is step 3's entire claim.** The old rationale was not wrong — it reasons about `woke` vs `shutterChanged`, written when a cache could be taken only by *stepping onto* one, and stepping wakes nothing. Its premise expired. **No fourth tier**, because no precedence can fix this: a tier list is a total order over which *single* fact gets said, and this turn has two, so reordering only moves the silence from the goods to the price — and the reorder it would need (`fuelGained` above `woke`) inverts §4's accounting, where the flash's price is what it wakes, and gets **worse** under #83, where the suppressed line stops being a fact and becomes a hunter. Below `woke` it changes nothing. **No rule change**: *the shutter may not pay a cache underfoot* is a simulation answer to a copy defect, and every version of it (pay only on entry; phase 5 skips free actions) leaves the player on ember they can see and cannot have, curable by **step off, step back** — the same autopilot the *ever lit* clause rejected *currently lit* for, rebuilt from the other side and charged in tempo. It also re-falsifies "a kill **or a cache** re-opens the shutter" at 0 fuel. **The *ever lit* clause is not reopened**; the rejection is recorded in §4 so it is not re-proposed. **The runner-up was doing nothing**, and it loses on attribution: §10 levels the receipt a `report` because *the FUEL readout says it louder*, and that assumes the player can attribute the change — on every other paying turn they stepped onto a `♦` they had seen or killed the thing that dropped it, and on this one the meter shows one net number (+25, −4, HUD moves 21) with no glyph and no body. The sentence does not restate the meter, it **attributes** it. The compound is safe where the descent's was not, on three measurable counts: it is **strictly additive to a glance** (the wake is first and unchanged, so a half-reader loses nothing), which is also why the two player tiers never compound — `You take N.` and `The lantern goes out.` are the lines whose whole value is instant reading, and each states a survival fact nothing else on screen states, where the wake tier can afford a clause because the board carries the `C` too (#94 measured it read first); it **fits inside a conservative 41-character budget**, the longest compound being `Three things wake. You gather 41 ember.` at **39** against the descend compound at **43** — 41 is deliberately *below* the ~47 characters that measurably fit at 390 wide, because the resolved mono font is a stack and its advance width is device-dependent, so the margin is the safety rather than the measurement; and it **invents no sentence** — both halves are strings already ruled, joined by one space, so §4's *no cause-variant string* ruling is untouched and the standing objection to compounds, which bites on *authored* combinatorial pairs, has nothing to bite. **Level `alarm`**, lifted off the winning `woke` cue as always, which keeps the shared invariant (`woke` ∨ player `damaged` ∨ player `died` → `alarm`) exactly true so the corpus test does not change shape; a `report` here would silently demote every wake that coincided with a pickup, which is #94's defect reintroduced by #107's fix. **The `♦` that never renders stays out of scope and is a Watch, not an issue:** a pickup is *always underfoot*, so the spatial question a beat would answer has a constant answer under `@`, and `fuelGained` deliberately carries no `at` — a beat means widening `render/`'s cue vocabulary and lands on #82's mechanism, which is explicitly last. #81 is untouched. New pin: the longest producible line is ≤ 41 characters |
| 2026-08-02 | **§4/§6 implemented, not amended: `nextMind` stops parking a woken Cinder and pursues. No rule moved; the code caught up to the 2026-07-31 ruling** | #83, build-order step 4, and the first step in the wager's build order to change what the simulation *does* rather than what it says. **This row records an implementation because the ruling it implements is one this table already carries** (2026-07-31, same section) — and because §4's own status marker had by then been wrong in both directions, once saying "not built" of built code and once "not implemented" of code about to ship. `nextMind` goes from five cases to three: settle `turnsSinceContact` (0 on contact, else +1), return `DORMANT` at 8, otherwise attack if adjacent and step toward the player if not. **The third case does not consult contact at all**, which is the entire ruling — an awake creature paths at you lit or shuttered, near or far, and the counter is the only thing contact still governs. Subtraction, as the ruling promised: two cases deleted, and with them `Mind.awareness` and the `Awareness` union, which existed solely to hold the last-known tile those cases pathed to. **A dead field is easier to re-add than a forgotten reason**, so the reason it existed moved into `behaviour.ts`'s header as a `SUPERSEDED` block rather than being deleted with it. **One case the ruling did not name, decided here:** a dead player. `hasContact` already answers `false` for one so that creatures do not swing at a corpse, but unconditional pursuit would have them *walk to* it — routing around that guard instead of honouring it — so the declaration is gated on the player being alive and the creature waits out its clock over the body. `turn.ts` halts the actor sweep on the killing blow, so this is nearly unreachable; nearly is not a rule, and the gate is visible in a stored fixture, where the surviving Cinder holds a `wait` that reads `attack` without it. **`RULES_VERSION` 4 → 5**, unambiguous under both clauses of the policy — the rule alters what an existing record replays to, and `GameState`'s shape loses a field. **The combat fixture was re-recorded rather than re-pinned**, and that is the judgement worth keeping: its old log "retreated" by shuffling one tile back and forth, which was a retreat only because breaking contact used to be sufficient. Replayed under pursuit it became a stand-up fight with no re-dormancy, no sleeper, no dormant strike and no death — so re-pinning the digest onto it would have silently deleted three of the six properties the fixture exists for, which is the "update the expected values" failure `replay.ts`'s version policy is written against. The same *intent* was re-recorded against the new rules and every old property is pinned again, with pursuit added. **Nothing was tuned:** the 8 does not move, no fuel number moves (#109 still gates that), and no mechanic, state, glyph, cue or UI was added. **What is still owed is the measurement** — the fraction of woken creatures reaching adjacency before re-dormanting, which is a playtest number and decides which way the watch fires |
