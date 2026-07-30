# Journal

Append-only development log, newest at the top. **This is the primary memory of the project across
sessions.** Session state, agent context, and reasoning all evaporate; this file does not.

## Why this exists

A future session starts with no memory of this one. It will read the code and see *what* was
built, and read git history and see *when*. Neither tells it *why* — why an obvious-looking
approach was rejected, what was tried and abandoned, what is currently half-finished, what is
about to break. That is what goes here.

## Format

One entry per meaningful work session or merged PR. Newest first.

```markdown
## YYYY-MM-DD — Short title

**Did:** what changed, in a sentence or two. Link the PR/issue.
**Why:** the reasoning, especially any non-obvious choice or rejected alternative.
**Learned:** anything surprising. Wrong assumptions, gotchas, things that cost time.
**Next:** the immediate next step, specific enough to act on cold.
**Review addendum:** the reviewer found the fourth check-that-enforces-nothing in four PRs, and
this one was in the phase order itself. `resolveTurn` correctly folds `RESOLUTION_PHASES`, but
*nothing pinned that* — swapping the fold to `Object.keys(phases)` passed all 233 tests, because
every phases object in the suite was constructed in GDD order (two of them by iterating
`RESOLUTION_PHASES` itself, which is self-referential). The new test builds its literal in
**alphabetical** order — what a tidy-up pass produces — and asserts the trace spelled out
literally rather than against the constant.

Two other tests were added for mutants that survived: `createSchedule`'s entries were only checked
via `dueActors`, so scheduling everyone at tick 0 instead of at `now` passed; and `addActor`'s id
guard was unexercised, where a `NaN` id makes `hasActor` false forever and `removeActor` throw —
an actor that can never be removed, i.e. a corpse that acts every turn for the rest of the run.

The reviewer also caught that its *own* first harness run was lying: `--reporter=basic` no longer
exists in Vitest 4, so vitest exited 0 without running anything and reported every mutation
"killed". Worth remembering — a mutation harness needs a baseline assertion or it measures nothing.

**Review addendum (post-review):** the suite pinned the *generator* but nothing pinned the
*mapping from raw word to helper output* — the surface all game code actually calls. Four
semantics-preserving mutations passed all 76 tests: modulo instead of multiply-high, reversed
`weighted` iteration, reversed `shuffle` result, and `pick` indexed from the far end. Each changes
what a given seed produces while preserving bounds, uniformity, permutation, and exact draw
counts. That mattered because #3 records replay fixtures in terms of `int`/`pick`/`shuffle`, not
raw words, so any of them would have invalidated every stored replay with CI green.

Added a pinned-helper-output block and confirmed each mutation is now killed by its intended test.
Those pins are ground truth by definition, generated from this implementation — they cannot prove
the mapping is correct, only that it has not changed. A deliberate change means re-pinning and
bumping `RunRecord.version`.

Also corrected a comment claiming the distribution and draw-count tests defended against `%` —
they do not, since `%` preserves both. And a collision test whose threshold rested on a
factor-of-1000 birthday-bound error: it tolerated 99 collisions where the expectation is 0.047,
and would have passed for a 22-bit hash.

**Review addendum:** the reviewer found a false green in the comparator itself — the worst place
for one. `walk` compared any two objects by their own enumerable keys, and `Map`, `Set`, and
`Date` have none, so `new Set([1])` vs `new Set([2, 3])` reported *no divergence at all*.

Three defenses failed together: the replay properties are all phrased as "divergence is null"; the
JSON round-trip property passes too, because `JSON.stringify` renders a Map as `{}` and `{}`
equals `{}`; and `purity.test.ts` claimed the structural snapshot covered what freezing could not
(`Map`/`Set` contents) when the snapshot is compared with the same blind comparator.

Not hypothetical: ARCHITECTURE.md's module map has `fov/` and `entities/` next, which is exactly
where `readonly seen: Set<TileIndex>` would enter `GameState`. The fix throws on any non-plain
object, naming the field — which turns a silent pass into a loud error and makes `state.ts`'s
"plain JSON-shaped data" rule enforced rather than aspirational.

Also fixed: `snapshot()` had no instrument test (replacing it with `return value` left all 173
tests green, making the purity suite unfalsifiable); the reported `turn` was not pinned to the left
sequence; and the `commandIndex === 0` boundary was untested, where an off-by-one misreports the
first command's divergence as a seed mismatch. All four verified by mutation.

Filed #12: the determinism lint rules are disabled inside `game/**/*.test.ts`, so this PR's
property corpus is protected by discipline rather than enforcement.

**Design rulings applied (post-review):** the `game-designer` pass on GDD §5 changed two things
about what every seed produces, both applied here before merge.

**The entrance exclusion is Manhattan, not Chebyshev.** I had chosen Chebyshev as the conservative
reading. That was wrong, and the designer's argument is better than "it is stricter": movement and
attacks are 4-directional, so the player's unit of distance is the step. A creature at (+2,+2) is
four steps away; excluding it makes the rule uncheckable by counting, which is what Pillar 2 asks
of a rule. Chebyshev has no referent anywhere else in the rules. The side effect of the strict
reading was a systematic thinning of spawns in rooms next to the entrance — the early floor was
quietly emptier than §8's curve says. `chebyshevDistance` stays in `grid.ts` for measurement but no
rule uses it.

**A merged pair is ONE node for graph distance, not two joined by an edge.** The decisive point is
that the implementation was self-contradictory: `forbiddenRooms` already treated the merged partner
as the entrance room for spawns, while `roomAdjacency` treated the merge as an ordinary hop for
stairs. Now contracted in both. Corollary worth knowing: if the entrance is in a merged hall,
neither half can hold the stairs.

Both pinned floors were **deliberately re-pinned**, which is the process ARCHITECTURE.md describes —
a rules change invalidates fixtures and they get re-recorded on purpose, never silently
regenerated. No `RULES_VERSION` bump: nothing has shipped and `Floor` is not in `GameState` yet.

**Review addendum:** the reviewer found the fifth check-that-enforces-nothing in five PRs, and it
was in the highest-value place — the room graph. `chooseLinks` shuffles the candidate edges and
runs Kruskal over the shuffled order, but *nothing tested that*. Replacing `order.value` with
`LATTICE_EDGE_IDS` (keeping the shuffle so the draw count is untouched) passed all 370 tests, while
collapsing unmerged floors from 15 distinct spanning trees to exactly **one** — the same room
graph, every floor, forever. Connectivity held, the tree still spanned, loops were still 1-2, no
corridors, and floors still looked different because jitter and pillars vary. §5's premise is that
the mental map is "rooms and which wall the door was in"; a fixed room graph is exactly the failure
that rule exists to prevent, and it was the one structure with no variance test.

Second: `placeStairs`'s docstring states that ties are broken by a draw rather than by lowest id,
precisely to avoid bias on symmetric layouts — and `chooseFrom(rng, tied.slice(0, 1))` passed
everything. Ties are not rare; roughly a third of floors have one. A stated design rule with no
test is what gets simplified away later.

The lesson generalizing across both: **an all-negative suite cannot catch a generator that stopped
generating.** Every invariant here is of the form "nothing is wrong with this floor", and a
degenerate generator satisfies all of them. Variance needs its own positive assertions, and the
structures most worth varying are the ones least likely to have them.

**Review addendum:** the reviewer found that the branching-experiment test killed the reactive bug
only in its *unconditional* form. The form a real author would write is guarded — retarget only if
the player is still orthogonally adjacent — and that survived all 488 tests.

The reason is geometric and worth remembering: stepping one orthogonal tile off a marked tile
always lands at Manhattan distance 2 from the creature, because the marked tile's other three
neighbours are diagonal to it. So in a **one-move window the guard is never true** and the mutant
is provably identical to correct code. Every existing test was a one-move window.

The window is two moves wide only on the **free-action path**, because a free command does not
charge the player, so the player acts again at the same instant before the creature resolves. The
new test drives exactly that trace and the guarded mutant now dies. Note this also means a creature
woken during a free action sees two player commands before resolving — more conservative than §2
requires, legible in play, but undocumented until now.

Second finding: `bump` enforced its stated adjacency precondition on the move branch only.
`resolveAttack` validates liveness and self-targeting but not adjacency, so a bump onto a distant
or diagonal *occupied* tile resolved as a ranged, 8-directional strike and returned cleanly — while
the same bump onto an *empty* tile threw. The loud failure was on the harmless branch and the
silent one on the dangerous branch, and `bump` is what #18's tap handler will call with a raw tap
target.

**Watch:** known risks, deferred cleanup, things that will bite later. Omit if none.
```

Write for a reader with zero context. "Fixed the FOV bug" is useless; "shadowcasting was
symmetric-visible but asymmetric-lit, so enemies could see the player through walls the player
couldn't see through — fixed by computing lighting from the light source rather than the viewer"
is worth the file.

**Be honest about failure.** A record of what did not work is worth more than a record of what
did — it is the only thing stopping a future session from repeating it.

---

## 2026-08-01 — `game/fov/`: symmetric shadowcasting, touch, ember-sense, dark adaptation (#14)

**Did:** Built `game/fov/` — the whole of GDD §4's vision table. Eight modules, 152 new tests
(512 total). Not wired into `GameState`; that is #18, and it is an outcome-changing change that
needs a `RULES_VERSION` bump. Also fixed the two comments in `map/grid.ts` that #25 invalidated.

The surface: `perceive(grid, vision, at, creaturePositions)` returns the terrain field and the
creature list for one turn, dispatching on the shutter; `Vision` holds the three things that
survive a turn (shutter, current sense radius, remembered terrain) and its transitions are
`closeShutter` / `openShutter` / `adaptVision` / `remember`.

**The shadowcasting variant matters and it is not the usual one.** This is Albert Ford's
**symmetric** recursive shadowcasting, not the classic Björn Bergström variant most roguelikes
ship. They differ in one line — whether a floor tile is revealed because the scan reached it, or
only when its *centre* lies inside the wedge — and that line is the difference between an FOV that
is symmetric and one that is not. The classic variant is asymmetric around wall corners, which is
exactly the bug this repo's own journal format warns about: a creature seeing the player through a
wall the player cannot see through. Symmetry is now a property test over every passable pair on
twelve generated floors, and it passed first time, which is the evidence that picking the variant
was the right move rather than patching afterwards.

Cost of symmetry: a few tiles behind a corner that a "generous" FOV would light stay dark. Correct
trade — §4's promise is that the player can state the rule.

**Chebyshev falls out; there is no radius check anywhere.** A wedge scan's `depth` *is* the major
axis and every tile in a row has `|column| <= depth`, so `depth <= radius` **is**
`max(|dx|,|dy|) <= radius`. The #25 ruling predicted this and it held exactly. Anyone adding a
`chebyshevDistance(...) <= radius` to `shadowcast.ts` is either writing dead code or quietly
turning the square into a disc.

**Slopes are exact fractions, not floats.** IEEE-754 doubles would have been deterministic (so
replays would still reproduce), but every comparison in shadowcasting sits *on* a wedge boundary —
all slopes have the form `(2c-1)/2d` — so rounding decides visibility at exactly the tiles that
matter. Comparing `num/den` pairs by cross-multiplication keeps it exact with integers under a
thousand. The lit shape is the one the geometry says it is, not the one the rounding picked.

**Ember-sense is separated structurally, not by comment.** Two defences, because "keep them
separate" is the rule most likely to be lost to a future tidy-up: `senseCreatures(origin, radius,
creatures)` **takes no grid**, so it physically cannot consult a wall — the wall-piercing rule is a
property of the signature; and a test reads `embersense.ts` and fails if it ever imports
`shadowcast`, `light`, or mentions `blocksLight`.

**Containment is property-tested in both directions, which is the point.** "When `senseRadius >= 4`,
every lit tile is inside the sensed region" holds from every standable tile of ten generated
floors (>1000 origins), *and* is genuinely violated at radius 1, 2 and 3 for more than half of
them. Testing only the first half would have passed just as well if the adaptation ramp had been
deleted. There is also a version stated the way the player feels it: every creature a flash could
wake was already in the felt list.

**Learned — mutation testing, 51 breaks, 49 killed, and the two survivors are both provably
equivalent.** Four survived the first pass and three were real gaps:

- *Walls are revealed even when the wedge only clips them* was asserted nowhere. The room pictures
  all had wall centres inside the wedge, so the mutation stayed green. Without that rule the
  boundary of a lit region is a ragged edge of half-drawn walls and a room stops reading as a room.
  Now pinned on a tile reached through a doorway aperture whose centre is outside the cone.
- *Seen creatures were not sorted.* The order-independence test only exercised the shuttered path.
  Not a determinism bug in itself — both runs agree — but the entity layer will hand this list over
  in actor id order, and §2 breaks scheduler ties by actor id, so it is the same shape of leak the
  map generator had with `caches`/`creatures`.
- *`hasTile` without its bounds check* survived by luck: the test set's members happened not to be
  where a row-wrap lands. `(3, 0)` on a 3-wide grid is `(0, 1)`, a real tile — a lit tile appearing
  on the far side of the map. Now tested with members placed exactly where the wrap goes.

The two remaining survivors are equivalent mutants and are documented as such in the source, so a
future run does not re-investigate them:

- *Off-grid is opaque* → transparent. Argued to be unobservable, then **checked**: flipping the
  predicate and comparing 26,400 fields (20 floors x every tile x eight radii) gave a byte-identical
  dump. Opaque is kept only because it stops the scan sooner.
- *Dropping the `blocksEmberSense` call.* The predicate is constant `false`, so nothing it could
  change is reachable and no test can kill it. The call stays because that predicate is where the
  rule lives; the assertion that would actually catch a change is a table test pinning
  `blocksEmberSense` across every tile kind, which is now there.

**Benchmark: 0.0036ms per lit field, ~0.2% of the 2ms turn budget.** No performance problem to
report — unlike the level generator, which was 9x over on the day its benchmark was written. The
budget is set at **0.05ms**, not 0.2ms, deliberately: a threshold satisfied by a fifty-fold
regression is a benchmark that enforces nothing. Dark perception is 0.0006ms; a floor-wide radius-20
cast is 0.0039ms, so nothing is quadratic in the radius.

**Two design readings I had to make, both flagged for a designer rather than assumed:**

1. **Ember-sense does not operate while the shutter is open.** §4's table assigns creature
   perception per vision state — lit shows creatures in the lit region, shuttered gives ember-sense
   — so opening the shutter trades the wall-piercing sense for an identifying one. This is what
   makes containment mean something ("you feel what is there *before* you flash"). If the intent
   was that ember-sense keeps running underneath the light, it is a two-line change in
   `perceive.ts`.
2. **§4 never says which way the shutter starts a run.** `createVision(grid, shutter)` therefore
   requires the caller to say, and starts fully dark-adapted either way, because the ramp is
   triggered by the *act* of shuttering and none has happened. #18 will have to answer this.

Smaller calls, all documented at their definition: shuttering an already-shut shutter does **not**
restart the ramp (a stray no-op command must not blind the player for four turns); adaptation only
advances while shuttered (unobservable either way, since shuttering resets to the floor — so the
version that matches the fiction wins); and memory is union-only and returns the same `Vision`
object when nothing new was perceived.

**Watch:**
- `Vision` is not in `GameState` yet. `state-shape.test.ts` asserts it survives
  `findFieldDivergence` and a JSON round trip, which is the thing the divergence comparator's own
  journal entry predicted `game/fov/` would get wrong with a `Set<TileIndex>`. It did not.
- The lit-shape assertions are ASCII pictures. They are ground truth *by definition* — generated
  from this implementation — so they prove the shape has not changed, not that it is right. The
  claims they encode are also stated separately as coordinates so a deliberate re-pin does not
  silently discard them.
- The FOV benchmark is timing, so it can fail for reasons that are not about the code. Say so here
  rather than raising the number.
- `tests/unit/support/ascii-grid.ts` is new test-support infrastructure (parse a scene, print a
  field). It is outside `game/` on purpose and has its own instrument tests — a printer that
  ignored its flags would make every picture assertion vacuous.

**Next:** #18 wires `Floor` + `Vision` into `GameState` and the movement/shutter commands, which is
where the two design readings above have to be settled and where `RULES_VERSION` gets bumped. #16
(entities) supplies the creature positions `perceive` already takes.

## 2026-08-01 — `game/entities/`: actors, deterministic combat, and the Cinder (#16)

**Did:** Built `game/entities/` (actor model, Cinder behaviour, pathing, the lighting seam),
`game/systems/combat.ts` and `game/systems/actors.ts` (deterministic damage, bump-to-attack, the
dormant strike, deaths, and the rules half of GDD §2 phases 3 and 4), and `game/content/` (the
creature table and the player's numbers). 114 new tests, 488 total. Not wired into `GameState` —
that is #18, and `Floor` is not in `GameState` yet.

**The scheduling invariant is the spine of the whole thing:**

> an actor is in the schedule ⟺ it is alive AND (it is the player OR it is awake)

Both directions were arrived at by working backwards from GDD §2 and both turned out to answer a
question the issue asked separately.

*Dormant creatures are not in the queue.* That is what makes "a creature woken by light declares
this turn and acts next turn" (§2 phase 3, and `turn.ts`'s header) true rather than aspirational:
waking joins the schedule at `now + ACTION_COST`, so a creature woken in phase 3 is not due when
phase 4 runs three lines later. The alternative — scheduling sleepers and no-oping their turn —
would have made that ordering depend on wake order, and phase 4 would have needed to know what
dormancy is.

*Dead actors leave the queue at kill time, in phase 1.* This is the first of the two things PR #22's
review handed over. Deaths still **resolve** at phase 5 (embers drop, the body leaves), and that
order is right; what cannot wait is the queue entry, because a creature killed in phase 1 is still
due at `now` and would take its turn in phase 4 and attack from the grave. `resolveAttack`
unschedules on the killing blow, and `resolveDeaths` throws if it ever finds a corpse still holding
a place — the two halves check each other.

The second handover, *a free action must skip the actor phase entirely*, is expressed as a required
argument: `actorPhase(cost: TurnCost, perception)` where `TurnCost` is `'costsATurn' | 'free'` and
has no default. #17 cannot wire the shutter toggle without saying which it is, and `'free'` returns
`identity` rather than "run the phase but skip the charge", which is the mistake `turn.test.ts`
documents.

**Commit one turn ahead is a data decision before it is a code decision.** The declared action is a
field on the creature (`Mind` is a union, so an awake creature *always* has one and a dormant one
cannot), written on turn N and read on turn N+1. A behaviour function that looked at the world and
returned an action would be reactive by construction and no care at the call site would fix it.
Two corollaries fell out and both are load-bearing: **an attack marks a tile, not an actor** (so
stepping aside works — §2's whole reason movement is a combat action), and **a declared move can be
blocked** (so baiting costs the creature its turn). `commit.test.ts` is written as branching
experiments — same world, two different player commands, assert the creature resolved the same
committed action — because a test asserting "it moved to (4,1)" passes just as happily for a
creature that recomputed and happened to agree. `floorplay.test.ts` carries the corpus form: **the
player can only ever be hit on a tile that was already marked when the turn began.**

**The lighting seam is one boolean.** `Perception = { isPlayerLightVisibleFrom(at): boolean }`,
injected, exactly as `resolveTurn` takes its phases. `game/entities/` contains no radius, no shutter
state, no line of sight, and exports no default query — so there is nothing to delete when #17 and
#14 land. What "visible" means is deliberately not this layer's decision: §4 says "while the shutter
is open", §6 says "where it last saw your light", and #25 has not settled the metric. All three
readings plug into that signature unchanged. The *other* half of contact, adjacency, is **not**
injected, because §3 settles it: 4-directional, one orthogonal step, one meaning.

**Two design gaps, flagged rather than invented:**

1. **"Then searches" (§6) has no definition.** Implemented as the smallest honest reading: the
   creature walks to the last tile it saw light and then holds position until re-dormancy. Wandering
   needs a wander model nobody has designed and, worse, needs a random draw on a path taken a
   variable number of times per turn. If the playtester reports that a searching Cinder is a statue,
   `nextMind` case 5 is the only thing that changes.
2. **Creatures cannot hurt each other.** A declared attack marks a tile, so a creature *can* end up
   standing on a tile another creature marked. Making that hit would add a real tactic (bait them
   into each other) that §6 does not describe, so the conservative reading — nothing happens — is
   what shipped. `game-designer`'s call.

**Nothing in `game/entities/` touches the RNG, at all.** Pathing is a breadth-first distance field
from the goal plus one step down the gradient, with ties broken by the fixed `ORTHOGONAL_STEPS`
order. A drawn tie-break was the obvious alternative and was rejected on determinism grounds rather
than taste: it would put entropy consumption on a path taken a variable number of times per turn,
which shifts the whole run's generator stream and surfaces days later somewhere unrelated.

**Learned:** the issue's warning — *an all-negative combat suite cannot catch an enemy that stopped
thinking* — is exactly right, and writing the sweep made it concrete. "HP never negative", "nobody
in a wall", "the schedule is consistent", "damage is deterministic" are all satisfied by a Cinder
that never moves. So `floorplay.test.ts` tallies evidence as it plays 24 floors × 90 turns and then
asserts the behaviour *happened*: 70 wakings, 170 moves, 139 of them closing distance, 68 landed
hits, 73 attacks dodged, 116 kills, 5 returns to dormancy. Thresholds sit at about half of each, and
the tally is printed so the margin is visible instead of guessed at.

**Mutation testing: 36 mutants, 34 killed, 2 survivors, both argued equivalent and documented at the
site.** The killed set includes every rule that matters — dormant strike removed, kill left in the
queue, attack retargeted to the player's current tile (the reactive bug, unconditional form), declare-before-resolve,
free action running the actor phase, proximity waking a sleeper, waking scheduled for this turn,
re-dormancy off by one, creature ids assigned in reverse spawn order, pathing that sidesteps or
wanders. Three survived the first pass and one was a real hole: **removing the dead-player check in
`hasContact` left every test green**, which would have left creatures permanently awake swinging at
a corpse in a state the re-dormancy clock can never leave. That now has a test. The two remaining
survivors are `wakeInLight` iterating in reverse id order and `occupantAt` returning the last match
instead of the first; both are unobservable *today* — the schedule re-canonicalises, and two living
actors never share a tile — and both are the shape of ADR-0004's iteration-order bug before it
bites. They are written in id order deliberately, with a comment saying so and saying that no test
can currently kill them. Writing a test that passes for both would have been worse than none.

**Next:** #18 wires this into `GameState` and `step()` — the sketch it should follow is in
`game/systems/index.ts`'s header, and three of the six phases (`lightingAndWaking` minus the
lighting, `actors`, `deaths`) exist today. #17 (shutter, fuel) supplies the real `Perception` and
must decide whether a free action still burns fuel; #14 (FOV) supplies what "visible" means, after
#25 settles the metric.

**Watch:** `restoreOnDescent` exists and is tested but has no caller until floor transitions land,
so "descending restores 2 HP" is a rule nothing exercises end to end yet. Ember *drops* are
implemented, ember *collection* is not — `world.embers` accumulates and nothing consumes it until
fuel exists (#17). And the pathing distance field is recomputed per creature per declaration: 0.095ms
for a full six-creature turn against a 2ms budget, benchmarked in `actors.bench.test.ts`, but that
is the number that moves if pathing ever accounts for other actors.


## 2026-07-31 — The vision metric is Chebyshev; ember-sense drops 6 → 5 (#25)

**Did:** Settled GDD §4's last open question — what measures a "radius". **Chebyshev (a square) for
every vision radius**: lit 4, dark touch 1, ember-sense, and every value the dark-adaptation ramp
passes through. Two numbers moved as a consequence and both are flagged loudly in the change log:
**ember-sense 6 → 5** and the **adaptation floor 2 → 1** (ramp 1→2→3→4→5). Also replaced §4's
"light reveals ~20 tiles per turn" claim, which was the wrong number in the wrong unit. No ADR: the
metric was marked *Open*, not settled, and VISION.md commits to no radius.

**Why:** §4 had already committed to Chebyshev without noticing — "radius 1, the 8 tiles you can
touch" is only true under Chebyshev; Manhattan and Euclidean radius 1 are both 4 tiles. That is
evidence of intent, and lit and dark terrain vision are the same sense at two reaches, so they
cannot differ.

The argument that actually decided it against Euclidean was Pillar 1, not looks. In a 5×4 room a
Euclidean radius-4 disc leaves 4-5 tiles dark unless you stand near the middle, and Manhattan
lights the room only from the exact centre tile. Both make "walk to the middle of the room, then
flash" the always-correct move — an obvious optimal turn, which is precisely the turn Pillar 1 says
should not exist. Chebyshev 4 is exactly the corner-to-corner span of the largest room, so a flash
lights one room from *anywhere* in it and the decision is purely *when* to flash, never *where*.

Light and ember-sense share the metric, and that turned out to be load-bearing rather than tidiness.
With sense 5 ⊇ lit 4 under one metric, the lit region is always a subset of the sensed region, so
**everything a flash can wake, you can already feel**. A different metric for ember-sense would
break containment at the corners and manufacture the one unfair death this system can produce — a
creature woken inside your own light that you had no way to sense.

**Learned:** Choosing the metric *invalidated a number*, which I did not expect going in. Chebyshev
radius 6 on an 11×15 grid is a 13×13 box — from the middle band it covers ~87% of the floor and
stops varying with position. That is not "too strong", it is a radius that has stopped being a
radius: it falsifies §5's "ember-sense tells you there are two things in the room north of me", and
the top two steps of the adaptation ramp become provable no-ops. #14 would have implemented a ramp
whose last two turns do nothing. Worth remembering as a general shape: an unstated metric can hide
the fact that a stated number is degenerate, and settling the metric is what surfaces it.

The floor drop 2 → 1 is the smaller of the two and the nicer one — it restores the four-turn ramp
§4 always claimed, and it *subtracts a constant*, because it is the same 1 as the dark touch radius.
"Shuttered, you know only what you can touch, and your sense of the living grows a tile a turn back
to five" is one sentence carrying three rules, which is what a game with no tutorial text needs.

**Next:** #14 (FOV) is unblocked and should start. Three things fall out of this ruling for it:
Chebyshev is the *natural* output of recursive shadowcasting (octant depth is the major axis, so
`depth ≤ 4` gives the square with no separate radius predicate); ember-sense stays a plain box scan
with no visibility pass at all; and the containment property is the strongest test in the section —
**when `senseRadius ≥ 4`, every lit tile is inside the sensed region** — with the guard `≥ 4`
mattering, since the ramp deliberately suspends the guarantee.

**Watch:** `game/map/grid.ts` now has two stale comments — `manhattanDistance`'s note that §4 "has
not yet settled" the vision metric, and `chebyshevDistance`'s "not used by any rule", which is now
false three times over. #14 touches that file and should fix both. Also: ADR-0007 records
ember-sense radius 6; it is a historical record and was not edited, but the GDD change log says
explicitly that §4 supersedes it, so a future session reading the ADR alone will get the old number.


## 2026-07-31 — `game/map/`: tiles, the room lattice, and the chambered-ruin generator (#13)

**Did:** Built `game/map/` — the `Tile` union, the 2x3 room lattice, and `generateFloor(rng,
floorNumber)`, which produces an 11x15 chambered ruin satisfying every invariant in GDD §5. Six
modules, 145 new tests (374 total). Not wired into `GameState` yet: that changes what a replay
produces and belongs with the command work, per one-issue-one-PR.

**The GDD has an arithmetic error in §5 and it needs a one-line correction.** §5 states
`height = 4 + 1 + 4 + 1 + 4 = 15`. That sum is 14. The grid size and the decomposition contradict
each other, and the grid size wins: 11x15 is bolded twice, derived from a 390px phone at ~35px tap
targets, called an ADR-level decision in #13, and is one of the property-tested invariants — while
the decomposition is arithmetic in a prose block. The extra row went to the **middle** band
(`4 + 1 + 5 + 1 + 4 = 15`), the only assignment that keeps the lattice vertically symmetric so no
floor has a systematically roomier corner. Rooms are 5x4 / 5x5 / 5x4 before jitter, still "six
rooms of ~20 tiles". A consequence: a merged hall is 5x10, not the 5x9 §5 predicts. This is
recorded in `lattice.ts`'s header and guarded by a test that says what to do if someone "fixes" the
bands back to 4/4/4. **A `game-designer` pass should ratify or overrule the choice and correct §5.**

**Draw-count decision: fixed, `54 + creatureCount(floor)` draws, independent of the seed.** The
alternative — rejection sampling ("pick a tile, retry if occupied") — was rejected. Two techniques
buy it. Every placement first builds a *candidate list*, deterministically filtered from the grid
as it stands and scanned row-major, then spends exactly one draw indexing into it; and optional
things still draw, so "0-2 pillars per room" rolls the count and then runs both slots, consuming a
discarded draw for the unused one. It costs a handful of wasted draws and buys a test that asserts
"floor 1 advances the generator by exactly 57 steps" — so a stray conditional draw added later
fails at the change that introduced it instead of silently shifting the run and surfacing a
fortnight later. That test killed a mutation nothing else caught.

**Connectivity and "no corridors" are structural, not checked-afterwards.** Jitter may only pull a
room *away from the screen edge*, never off a wall it shares with a neighbour — so both sides of a
shared wall always touch it and a doorway anywhere in the overlap connects by construction. A
random spanning tree (randomized Kruskal over a shuffled edge list — a fixed 6 draws, where "keep
adding until spanning" would not be) makes the room graph connected. The only thing that could
manufacture a passage afterwards is a pillar, so a pillar is only placed on a tile that leaves the
whole floor *sound*: connected, no tile with fewer than two exits, and no two adjacent
through-passages. That last clause is the mechanical form of §5's "a corridor is a sequence of
turns with one legal move" — one through-passage is a threshold, which §5 allows; two in a row is a
corridor. Notably the "don't put a pillar next to a doorway" rule one reaches for is unnecessary: a
doorway has exactly two exits, so a pillar on either creates a dead end and is already rejected.

**Learned — the benchmark paid for itself the day it was written.** ARCHITECTURE.md says to add one
when touching level generation. The first working generator ran at **2.7ms per floor on a desktop**,
against a 2ms budget for a whole turn on a mid-range phone. The cause was `isSound` defined as
`findSoundnessProblems(grid).length === 0`, which allocates a position object and several arrays
per call — and the generator asks it once per candidate tile per pillar, ~240 times per floor.
Rewriting it as a short-circuiting, allocation-free pass took it to **0.30ms**, a 9x win. Nothing
else was optimized because nothing else showed up. The cost is two implementations of one
predicate, which is a genuine drift hazard, so `soundness.test.ts` pins them together — including
on *every single-tile perturbation* of a room grid, which is exactly the question the generator asks.

**Learned — mutation testing found two false greens, both in tests that looked fine.** 27 deliberate
breaks, each checked for whether the *intended* test failed, not merely that something did.
25 were killed first time. Two were not:

- Deleting the row-major sort of `caches` and `creatures` broke **nothing** — the pinned floors
  happened to have been drawn in row-major order already. It is not a determinism bug (both runs
  agree), but the entity layer will assign actor ids from that array and §2 breaks scheduler ties by
  ascending actor id, so draw order would have leaked into turn order. Now covered by an explicit
  ordering test.
- Flooring the merged wall over the *union* of the two room widths instead of the overlap was
  caught only incidentally by a pinned floor, not by any structural claim. The merge test now
  asserts the separator row is open over exactly the overlap and wall outside it.

A third finding was about the suite's shape rather than its coverage: the seed corpus was a
module-level `const`, so a generator that *throws* produced a Vitest collection error reading
"no tests" instead of a named failure. Still red, but "no tests" is a terrible thing to read in CI.
The corpus is built lazily now; the same mutation reports 47 named failures.

**Watch:**
- `Floor` is not in `GameState` yet. Putting it there is an outcome-changing change and needs a
  `RULES_VERSION` bump plus re-pinning the map fixtures.
- The pinned floors are ground truth *by definition* — generated from this implementation. They
  prove the generator has not changed, not that it is right. Any deliberate rules change or reorder
  of `LATTICE_EDGES` means re-pinning them and bumping the version.
- The benchmark is the one test in the repo that can fail for reasons that are not about the code.
  It warms up and takes a median of five batches to limit that. If it starts failing intermittently
  near the threshold, say so here rather than quietly raising the number.
- Merges are restricted to vertically stacked pairs, because §5 describes the result as "a 5x9
  hall" and a side-by-side merge would give an 11-wide band spanning the whole floor — a different
  idea that the GDD did not ask for. Worth a designer's opinion if floors feel samey.

**Next:** FOV and light propagation (`game/fov/`), which is the other place ARCHITECTURE.md says
performance blows up — add a benchmark there too. It consumes `blocksLight` and `blocksEmberSense`,
which are deliberately separate predicates in `grid.ts`: the pillar blocks light but not
ember-sense, and that asymmetry is the whole reason darkness carries information (§4).

---

## 2026-07-30 — Turn scheduler: one clock, a sorted array, and the tie-break (#15)

**Did:** Built `game/systems/` — `schedule.ts` (the integer clock and the priority queue on
`(nextActAt, actorId)`) and `turn.ts` (the GDD §2 resolution order and the actor phase inside it).
61 new tests, 233 total. Nothing is wired into `step()` yet; see *Next*.

**Why a sorted plain array and not a heap.** A floor holds ~7 actors, so an O(n) insert is not the
thing worth optimizing, and the alternative costs more than it saves: `GameState` must be plain
JSON-shaped data, and `game/core/divergence.ts` now *throws* on a class instance, `Map`, or `Set`
rather than reporting two different ones as identical. A binary heap is the obvious place to reach
for a class, and a `Map<ActorId, number>` is the obvious place to reach for insertion order. A
sorted array is comparable field-by-field, serializable, and readable in a bug report.

**The tie-break is the whole file.** `compareScheduleEntries` never returns 0 for two distinct
entries, so `(nextActAt, actorId)` is a strict total order and sort stability is irrelevant *by
construction*. That matters because the failure mode is silent: a comparator that returns 0 on a
tie hands the decision to `Array.prototype.sort`, which is stable, which means the answer becomes
"whoever was inserted first" — spawn order, i.e. level-generation order, i.e. a hidden input. In
M1 ties are not an edge case but the normal case, since every action costs the same and the whole
floor shares a cadence.

A pleasant consequence: the player is an actor holding the lowest id, so "the player moves first"
falls out of the ordering instead of being special-cased anywhere in turn resolution.

**The seam for #14/#16/#17.** `RESOLUTION_PHASES` is the GDD §2 order as data, and `resolveTurn`
folds over it, so there is no second copy of the order to drift. The phases are *injected* as a
`Record` over the phase union — a caller that forgets one does not compile. The phases that do not
exist yet are deliberately **not stubbed here**: an empty `burnFuel` returning its state unchanged
is a lie that passes tests, and the next session finds it and assumes fuel is done. `turn.test.ts`
supplies them as identity at the call site, which is exactly how `step()` will supply the real ones.

**One design decision inside the actor phase:** the actor is charged *before* it acts. That makes
a death mid-action stick (charging afterwards would put the corpse back in the queue with a fresh
act time) and guarantees progress even if a creature's behaviour forgets the schedule entirely. The
queue is re-read after every action rather than snapshotted, so a creature killed earlier in the
same phase never gets its turn.

**Variable cost: mechanism built, not designed with.** `nextActAt` is an arbitrary integer and
`reschedule` accepts any time — that is the entire mechanism, and it is why this was built now
rather than retrofitted. Every action goes through `chargeActor`, which charges `ACTION_COST` and
nothing else, so observable behaviour is strict alternation. There are no speed values, no
per-action costs, and no `cost` parameter on the `act` callback. Adding one is a design change and
needs a GDD row, not a refactor.

**Learned (mutation testing).** Twelve deliberate breaks, all killed, each by the test written for
it — including the three the ordering rests on: descending tie-break, tie-break removed, and a
queue that keeps insertion order with a `peek` that scans for the first minimum. Two findings worth
recording:

- The insertion-order property is only meaningful because the test sorts with its **own**
  comparator written out in the test file. Had it used `compareScheduleEntries` as its yardstick,
  flipping the tie-break would have moved implementation and expectation together and every
  assertion would still have passed. Same class of false green as the `snapshot()` instrument
  found in #3.
- "The clock advances by ACTION_COST" survived every alternation test, because in the M1 steady
  state every gap *is* one action. Only a drain with random start times, and a phase with a lone
  actor scheduled at tick 350, distinguish it from "advance to the head of the queue". An
  invariant that is accidentally true in the common case needs a test built around the uncommon one.

**Next:** #13 (map) is in flight in parallel. The scheduler is standalone until #16 gives
`GameState` actors to schedule — that PR should add `schedule: Schedule` to `GameState`, rewrite
`step()` as the `resolveTurn` call sketched in `turn.ts`'s header, and bump `RULES_VERSION` (a new
`GameState` field is an outcome-changing change by the policy in `replay.ts`). Nothing in this PR
touches `game/core/`, so no bump was owed here.

**#16 must also do two things this PR cannot do for it**, both found in review:

1. **Remove a killed actor from the schedule at kill time, in phase 1** — not in phase 5. GDD §2
   puts deaths at phase 5, and that order is right (phase 5 is about embers dropping and the corpse
   leaving the world). But a creature the player kills in phase 1 will still take its turn in phase
   4 unless it leaves the queue immediately. `runActorPhase` already supports this — the test
   `does not give a turn to an actor killed earlier in the same phase` proves it — but #16's author
   will read GDD §2 as literally as this PR did and land in the same place.
2. **Wire a free action to skip the actor phase entirely, not merely skip its own charge.** GDD §2
   says the shutter toggle is free. `runActorPhase` charges every actor due at `now`, and the
   player is due at `now` when the turn begins — so a command phase that just declines to charge
   still gets charged by phase 4, *and* hands every creature on the floor a free turn. The
   corrected wiring is in `turn.ts`'s header sketch, and `a free action` in `turn.test.ts` pins both
   the right behaviour and the wrong one.

**Watch:** `chargeActor` is the only cost in the game and `runActorPhase` is the only loop that
pays it. If a second charging path appears, alternation stops being enforced by construction.
Also: `MAX_ACTS_PER_TURN` (1024) is a livelock tripwire, not a rule — if a design ever wants an
actor to act many times per instant, it is the wrong guard and should be replaced deliberately
rather than raised.


## 2026-07-30 — Core types, `step()`, and the replay-determinism tripwire (#3)

**Did:** Built `game/core/` — `GameState`, `Command`, `step(state, command)`, `RunRecord` +
`replay()`, and the replay-determinism property test the whole testing strategy rests on. Six
modules, 90 new tests (173 total).

**Scope, deliberately narrow.** The design is under owner review (ADR-0007 / #8 proposes reworking
the concept), so `game/core/` models **no game rules at all**: no map, no actors, no light, no
fuel. Two scaffolding commands exist — `wait` (no draw) and `roll` (exactly one draw) — because the
machinery cannot be tested honestly without one command that consumes randomness and one that does
not. They are labelled as scaffolding in three places and live in their own file so replacing them
is a delete, not a rewrite. Everything else — purity, generator threading, the replay contract,
divergence reporting, the version policy — is meant to survive whatever design lands.

**`RunRecord.version`.** The canonical value is `RULES_VERSION` in `game/core/replay.ts`; the
policy (what counts as an outcome-changing change, and the bump procedure) is in that file's
header, with `ARCHITECTURE.md` pointing at it rather than restating it. `replay()` *throws* on a
version mismatch — replaying an old record under new rules produces a plausible state that is not
the run that was recorded, which is worse than an error because it is believable. `runCommands()`
is the deliberate escape hatch. Each bump requires a `RULES_VERSION_LOG` line, and a test enforces
that, because an unexplained bump is how a diverging fixture gets "fixed" by updating its expected
values.

**Divergence reporting, since a bare "states differ" was called out as the thing to avoid.**
`findRunDivergence` steps two runs and reports the first command index, the command, the turn, and
the field path (`rng.s2`) with both values rendered. Object keys are **sorted** before the walk:
which divergence is reported "first" would otherwise depend on property insertion order, so the
same failure could name a different field after an unrelated refactor moved a line — a diagnostic
that changes its story is worse than none, because it gets trusted. Comparison uses `Object.is`,
so `NaN` equals itself (otherwise every state containing one reports a phantom divergence) and `0`
does not equal `-0` (a genuine difference: `-0` does not survive JSON, so such a state cannot be
pinned as a fixture).

**Learned — mutation testing changed the design twice, not just the tests.** 43 deliberate breaks,
checking each time that the *intended* test failed rather than merely that something did.

1. **A mutation exposed that command order was completely unobservable.** `wait` originally passed
   the previous roll result through, and with that, sorting or reversing an entire command log
   changed *nothing*: a `roll` consumes the same draw wherever it sits in the log, and `turn`
   counts commands regardless of order. Replay machinery that cannot notice its command log being
   shuffled is not testing much. Fixed in the model, not the test: `lastOutcome` is now the result
   of the command *just resolved*, so `wait` clears it. Reordering is now observable at every
   position, and `runCommands` sorting its input is caught by four tests.
2. **One mutation survived the entire suite: dropping `rng` from the per-command comparison** —
   precisely the case the issue warned about, where a run has already diverged but the difference
   has not surfaced in the visible state yet. It survived because it was *untestable through the
   record API*: no pair of `wait`/`roll` logs can differ in the generator alone, since anything
   that changes the draw count also changes `lastOutcome`. The fix was structural — the comparator
   now takes two **state sequences** (`findStateSequenceDivergence`), with `findRunDivergence` a
   thin wrapper, so a test can hand it two trajectories that are identical in `turn` and
   `lastOutcome` and differ only in generator position. Four variants of the projection bug are now
   killed. **The lesson: when a mutation survives, ask whether the code shape makes the bug
   unreachable by any test, not just whether you forgot to write one.**

Also caught by mutation testing: a test asserting "a rejected command consumes no entropy" that
*cannot fail* — with a threaded immutable `Rng`, a half-consumed draw is discarded with the
exception no matter where the throw happens. Replaced with the assertion that is real: the error
comes from `step`'s own validation naming the command, not from inside `int()` talking about spans
and safe integers. And the corpus itself is now measured (both command kinds present, seeds vary,
empty logs and non-ASCII seeds appear), because a generator that quietly degenerated to "always
`wait`" would leave all seven properties green and testing nothing, with no other signal.

**On the not-mutating-input test: both a deep freeze and a structural snapshot,** because they fail
differently. The freeze throws *at the offending line* (ES modules are strict mode), so the stack
trace names the mutation; a snapshot only tells you afterwards that something changed, which in a
simulation with a map and forty actors is a bisect. The snapshot is the backstop for what freezing
cannot do — `Object.freeze` does not protect `Map`/`Set` contents — and proves the freeze is not
vacuous. Every state in a 200-command run is frozen, not just the first, because the mistake that
actually bites is turn 40 writing through a reference inherited from turn 12, which retroactively
rewrites history.

**Type decisions:** `RunRecord.commands` is `readonly Command[]`, not the `Command[]` written in
ARCHITECTURE.md — same runtime shape, but a mutable array on a record that gets replayed twice and
compared invites the first replay editing what the second reads. `COMMAND_KINDS` is derived from a
`Record<Command['kind'], true>` and sorted, so adding a variant without listing it is a compile
error; the keys are deliberately written out of order so the `.sort()` is doing observable work
that a test can catch being deleted. `step` throws on a malformed command (a `sides: 0`, an unknown
`kind` from a parsed save) — but whether an *illegal-but-well-formed* action like walking into a
wall costs a turn is a design question, and nothing here presumes an answer.

**Next:** #4/#8 — the owner's ruling on ADR-0007 unblocks M1. When the design lands, replacing the
`Command` union and `lastOutcome` is the intended change, and it is a `RULES_VERSION` bump to 2
with the pinned run in `replay.test.ts` re-recorded. Nothing else in `game/core/` should need to
move.

**Watch:** Four things.

- The **pinned run** in `replay.test.ts` fails if the rules or the generator change. That is
  deliberate. If a session sees it red, the question is "did I mean to change the rules", not "how
  do I update the constants".
- **The replay-identity property is nearly tautological while `step` stays pure** — it is the alarm
  for the day someone reaches for a clock or a `Set` iteration, not a proof of anything today. The
  properties doing real work are the **draw budget** anchor (catches a conditional draw, which is
  perfectly deterministic and still poisons every seed) and the seed/command sensitivity pair
  (catches the degenerate implementations that would make everything else pass vacuously).
- **`drawCost` in the test is a second, independent statement of the draw-count contract.** It must
  be updated by hand when a command is added — the exhaustive switch makes that a compile error, on
  purpose. Do not "DRY" it against `step`; a specification that reads its answer from the
  implementation asserts nothing.
- `step()` currently costs **~0.13µs**, four orders of magnitude under the 2ms budget, which means
  precisely nothing yet — it does almost nothing. No benchmark committed; per ARCHITECTURE.md the
  ones that matter are FOV and level generation, and neither exists.

## 2026-07-30 — Accepted ADR-0007; fixed the escalation rule that misrouted it

**Did:** Accepted ADR-0007, amended the `VISION.md` concept to describe the game as designed
rather than as originally proposed, and narrowed the "when to ask the owner" rule in
`docs/WORKFLOW.md` and the `game-designer` agent.

**Why:** The owner asked why #8 was waiting on him, and he was right to. I had routed the concept
change to him on the strength of a `WORKFLOW.md` rule saying "ask when a design pillar or the core
concept needs to change" — a rule **an agent wrote during project setup, not the owner**.

It contradicted his stated boundary twice. His brief said he would be needed only for
"resources/architecture available to the project." And when offered "you approve design docs only"
as one of three autonomy models, he explicitly chose PR-plus-green-CI self-merge instead. The rule
asserted a gate he had already declined.

It was also self-defeating in this specific case: the concept being revised was invented by an
agent in the groundwork PR and explicitly labelled a proposal to attack. There was nothing of the
owner's being overridden. The escalation cost a round trip and bought nothing.

**Learned:** A process document written by the same agent that follows it can quietly encode
preferences the owner never expressed, and those read as authoritative to every later session
precisely *because* they are written down. The failure is invisible from inside — the rule looked
prudent, and following it felt like diligence.

The heuristic that would have caught it: **the owner's own words outrank a rule an agent wrote,
and `needs-owner` means "only he can supply this" (credentials, money, infrastructure), not "this
feels important."** Both `WORKFLOW.md` and the `game-designer` agent now say that, and
`WORKFLOW.md` keeps a note explaining the mistake rather than silently correcting it — a rule with
its own postmortem attached is harder to re-break.

**Next:** #3 (core types + replay-determinism test) is in flight and unaffected — it was
deliberately scoped to machinery with no game-specific state. With the concept settled, M1 can now
be specified from GDD §1-§6 rather than waiting.

**Watch:** ADR-0007's own weak point is unchanged and worth restating: *"dark is not dominant"
rests on arithmetic, not evidence.* Light reveals ~20 tiles for 4 fuel; ember-sense reveals 8 for
~20 turns. If that reasoning is wrong the lantern is still a failure button and the sharpening
failed. The M2 playtest is the test, and GDD §12's positional-tactics fallback is the response —
subtract fuel, do not add a mechanic.


## 2026-07-29 — Seeded RNG: xoshiro128**, fixed draw counts, 76 tests (#2)

**Did:** Built `game/rng/` — the project's only source of randomness. Three modules: `seed.ts`
(string → state), `xoshiro128.ts` (the generator), `draw.ts` (`int`/`float`/`pick`/`shuffle`/
`weighted`), plus a barrel. 76 tests across two suites.

**Why xoshiro128\*\* over PCG32:** both were sanctioned by the issue and both are statistically
fine. The deciding factor was JavaScript arithmetic. PCG32's state advance is a 64-bit LCG, and JS
has no 64-bit integer multiply — a faithful port needs either BigInt (allocating, and a
comparatively lightly-exercised path in Hermes) or a hand-rolled 64×64 multiply from 32-bit halves
that must be exactly right on every engine forever, or web and native replays diverge.
xoshiro128** needs only xor, shift, rotate, and multiply-by-constant, all of which `Math.imul` and
`>>>` perform exactly under ECMA-262 with zero implementation latitude. Cross-platform identity by
construction rather than by hope. Its state is also four plain uint32s, so it drops into
`GameState` as JSON-clean immutable data.

**Ergonomics — the decision the whole simulation now lives with:** every operation takes an `Rng`
and returns `{ value, rng }`. The caller threads the new state forward. The rejected alternative
was a mutable cursor (`cursor.int(1, 6)`, hand the state back at the end of the turn), which reads
much better in draw-heavy code like level generation — that is a real cost we are paying, and #3
onwards will feel it. It was rejected because offering both makes the pure form optional, and the
boundary between "code that threads" and "code that mutates" is exactly where a state-reuse bug
hides: a cursor captured in a closure produces *plausible* randomness that quietly repeats. If
level generation turns into a ladder of `rng1, rng2, rng3`, the fix is a scoped combinator that
still returns a `Draw`, not a cursor. Objects rather than `[value, rng]` tuples because
destructuring into pre-declared bindings is genuinely awkward in TypeScript.

**The variable-draw decision, written down so nobody has to reverse-engineer it:** `int()` uses
multiply-high (Lemire) *without* the rejection step — `min + floor(u32 * n / 2^32)` — so it always
consumes exactly one draw, including when `min === max`. Textbook rejection sampling is unbiased
but consumes a variable number of draws, which puts a data-dependent branch on the randomness path
and makes stream position unpredictable. The cost is a bias below `n / 2^32`: about 1.4e-9 for a
d6, 9.4e-7 for a tile on an 80×50 map. Detecting that needs ~10^18 samples; a full run draws maybe
10^6 times. It is unobservable in principle, whereas variable draw counts are the thing the issue
correctly identified as surfacing days later as an unrelated bug. This is what makes `shuffle`
exactly `n - 1` draws. If a genuinely unbiased draw is ever needed, add a separate `intUnbiased`
and document the contract break at its call site — do not change `int`.

**Learned — the tests I wrote first were weaker than they looked.** I wrote the suite, it went
green, and then I mutation-tested it: 18 deliberate breaks of the implementation, checking not just
that the suite failed but that the *intended* test was the one that failed. Three mutations
survived outright:

1. **Rejection sampling in `int()` survived** — the exact bug this issue is about. My "consumes
   exactly one draw" test used a d6, where the rejection zone is 4 words out of 2^32, so a
   rejection implementation would never have triggered it. The fix is to test at spans just above
   2^31, where `floor(2^32 / span)` is 1 and roughly *half* of all draws get rejected; 200 samples
   there gives a rejection implementation a ~1e-31 chance of surviving. Worth internalizing: to
   test that something never resamples, you must pick the input where resampling is likely, not a
   representative one.
2. **Replacing `mulhi32` with naive `Math.floor(a * b / 2**32)` survived** 20,000 random operand
   pairs. The naive form is only wrong when the true 64-bit product lands within ~2048 of a
   multiple of 2^32, i.e. about one pair in a million — so a random sweep finds it never, and a
   real run finds it as a rare out-of-bounds map coordinate. Fixed by searching for adversarial
   pairs (products just below a multiple of 2^32, via modular inverse) and pinning eight of them.
3. **`float()` dividing by 2^32 - 1 survived**, because I had asserted a *range* rather than the
   divisor. Dividing by 2^32 - 1 lets `float()` return exactly 1.0 on the maximum draw and breaks
   every `Math.floor(f * n)` caller. Now asserted exactly: `float(rng).value === next(rng).value /
   2^32`.

Two more were caught only by the pinned-vector tripwire rather than by a test that understood what
was wrong. Dropping the fmix32 finalizer from `hashString` passed my avalanche test because I
measured the *average* number of flipped bits over all 32 positions, which is ~16 either way.
Per-position rates tell the real story: with fmix32 they span 0.484–0.513, without it 0.081–0.953,
because FNV-1a's multiply only propagates entropy leftward so the low bits stay tied to the input's
low bits. Averaging hid precisely the structure that matters. Similarly, `rngFromWords` normalizing
to signed int32 slipped past a test that compared two calls of the same function — self-referential
assertions pass for any *consistent* wrong answer, so it now asserts absolute values.

All 18 mutations are now caught by the intended test. The general lesson is that a green suite says
nothing until you have watched it go red for the right reason, and the tests that fail this
standard are the ones covering rare-but-catastrophic paths — which is most of what matters here.

**Also learned:** the comment-stripping fix from the previous session earned its keep immediately.
`game/rng/index.ts` legitimately documents that "`Math.random()` is a lint error inside `game/`",
which the old infrastructure scanner would have flagged. Predicted last session, confirmed this
one. I also re-verified both gates actually see `game/rng/` by planting five violations
(`Math.random`, `Date.now`, a `react` import, an upward `render/` import, an `async` function) and
watching lint reject all five; the scanner catches four, correctly not the `async` one, which is
the documented ESLint-is-the-authority split.

**Next:** #3 — core types and the `step()` reducer skeleton, with the replay-determinism test.
`Rng` is designed to drop straight into `GameState` as a field; nothing about it needs to change.
The RNG's own mini-replay test (a scripted mix of all five helpers reproducing byte-identically
across 250 turns) is a rehearsal for the real one, not a substitute.

**Watch:** Three things.

- The **pinned stream test** in `xoshiro128.test.ts` fails if the generator or seed derivation ever
  changes. That is deliberate — such a change invalidates every stored replay fixture and must be a
  considered `RunRecord.version` bump. If a future session sees it red, the question is "did I mean
  to change the algorithm", not "how do I update the constants".
- **`weighted` requires integer weights.** If a designer wants 1.5, the answer is to scale the
  table, not to relax the check. Float weights would reintroduce a rounding question this module
  otherwise does not have.
- **Ergonomics are unproven.** `{ value, rng }` threading has never been used by real draw-heavy
  code. M1 level generation is the first honest test of it, and if it is bad, it will be bad in a
  way that shows up as noisy call sites rather than as bugs. Revisit then, deliberately.

## 2026-07-29 — Stripped the Expo tutorial boilerplate (#1)

**Did:** Reduced the app to a single route. Deleted the three tutorial tabs, the modal, six unused
components, the React logo assets, and `scripts/reset-project.js`. Removed five dependencies that
existed only for deleted code: `@react-navigation/bottom-tabs`, `expo-image`, `expo-symbols`,
`expo-web-browser`, `@expo/vector-icons`. Web export went from 9 routes / 25.7 kB to 3 routes /
18.4 kB.

**Why:** Every tutorial file left in place is something a future session has to read and rule out,
and something a search surfaces as a false positive. Cheap to clear now, expensive once real code
sits beside it.

Collapsed the tab bar rather than keeping the renamed `character`/`settings` tabs: a tab bar
permanently occupies thumb space at the bottom of the screen, which is exactly where a
touch-native roguelike wants its controls (Pillar 3). If navigation is needed later it should be a
modal over the game.

**Kept deliberately:** `themed-text`/`themed-view`, the color-scheme hooks, `constants/theme.ts`,
and `expo-haptics`.

A correction on the reasoning, because the first version of this entry cited a requirement that
does not exist. I justified keeping the themed components with "dark mode is an M4 accessibility
requirement" — it is not. ROADMAP M4 and GDD §11 list colorblind-safe palette, text scaling, and
reduced motion; no document mentions color schemes at all. The actual mechanism is `app.json`'s
`userInterfaceStyle: "automatic"`. The honest reason is narrower: they are ~40 generic lines that
give the placeholder something to render and are cheap to delete later. Recording this because a
cited-but-nonexistent requirement becomes folklore the next session defends.

`expo-haptics` is the opposite case and the reasoning does hold — ROADMAP M2 really does say
"sound/haptic feedback for moving blind."

**Learned:** `eslint .` linted the agent worktrees under `.claude/worktrees/`. A design agent was
running in one, so `npm run verify` failed with 19 errors from a *different agent's copy of the
repo* — code not in my branch and not even in my working tree. Confusing failure, and it would
have hit anyone running an agent with worktree isolation. Fixed permanently: `.claude/worktrees/`
is now in `.gitignore`, the ESLint ignore list, and `tsconfig.json`'s `exclude`.

This is a direct consequence of making the lint gate real. `expo lint` only globbed `app/` and
`components/`, so it never saw worktrees; `eslint .` sees everything, which is the point, and
means the ignore list now matters.

**Next:** #2 (seeded RNG). #3 is blocked behind it. The design review (#4) is running in parallel.

**Watch:** The five removed dependencies were judged unused by grep after deletion, and the web
build and E2E pass — but **no native build has ever been run** on this project, so if any of them
was doing something implicit on iOS/Android it will not surface until the M4 native verification
pass. `expo-image` in particular is sometimes pulled in indirectly.


## 2026-07-29 — M0 design review: Emberdepth survives, but not as written

**Did:** Attacked the *Emberdepth* concept (issue #4), kept its skeleton, and replaced its central
claim. Rewrote `docs/GDD.md` — §1-§6, §9, §10 and a new §12 are now specified well enough to
implement M1 without inventing design mid-code. Wrote ADR-0007 (since **Accepted** — see the 07-30 entry) because
the change contradicts the concept seed in `VISION.md`, and annotated that seed so nobody builds
from the stale bullets.

**Why:** The seed's structure was "light costs fuel and gives information; dark is free and gives
none." Each option is one-dimensional, and a choice between two scalars is a threshold rule, not a
decision — "shutter the lantern unless you are lost." Dark also dominated on *both* fuel and safety
(things stay dormant), so the lantern was a failure button. And the turns spent crawling blind with
nothing to read are precisely the autopilot turns Pillar 1 forbids.

The four "open questions" in GDD §1 turned out to be four symptoms of that one flaw, which is why
none of them had an answer inside the seed. Three changes fix all four:

1. **Ember-sense.** Shuttered, you see the *position* of every living thing within radius 6,
   **through walls** — no identity, no health, no intent. Lit, you see terrain, items, creatures
   and intent within radius 4, blocked by walls. Light shows you stone; dark shows you souls.
   Neither state is blind, and the asymmetry (sense passes walls, light does not) means darkness
   tells you something light physically cannot.
2. **Fuel is earned by killing.** Creatures are made of ember. This is what makes the player *want*
   to wake something; without it light is strictly defensive.
3. **The dormant strike** — double damage on a sleeping creature. Darkness gets a capability rather
   than a discount, and the only free kills in the game exist only unlit.

The second axis the wager needed was **HP**, which already existed — fighting converts HP into fuel,
light converts fuel into HP preservation. Adding a heat/sanity/noise bar was the obvious move and
the wrong one.

**Learned:** The instinct to answer "dark needs an upside" with a *new* upside is what produces
bloat. The upside that worked was already implied by the fiction (things that glow in a lightless
ruin) and cost one integer of state. Similarly, "the wager needs a second axis" was true and needed
no new resource. Both times, subtracting or re-reading what existed beat adding.

Also: several candidate mechanics died on Pillar 3 rather than on fun. "Dark costs double action
time" was the first fix for the flatness and is genuinely richer than "dark hides intent" — it lost
because *telegraphing* it ("this enemy acts twice before you do") needs UI on a 6-inch screen that a
missing intent marker does not. Brightness-encoded health in ember-sense died on §11 (colour cannot
be the sole carrier of meaning). Worth remembering that the accessibility requirements are cutting
real mechanics, which is what they are for.

Replacement was seriously considered. The runner-up was pure positional tactics with no resource at
all (Hoplite-shaped); it lost on Pillar 4 — geometry puzzles produce "I played well", not "the
lantern died on floor six" — and it is recorded in GDD §12 as the **designated fallback**, so that
if M2 reports the wager is hollow the response is to strip fuel rather than bolt on another system.

**Next:** M0 #1/#2/#3 are unaffected and remain the implementation entry points. M1 can now be
planned against a real spec: 11×15 chambered-ruin generation (§5), the commit-one-turn-ahead
scheduler (§2), 4-directional bump combat with the dormant strike (§3), and the Cinder (§6). The
owner needs to accept or reject ADR-0007 before `VISION.md` is amended — the GDD is authoritative
in the meantime.

**Watch:** Three named risks with cut signals in the GDD. *Re-dormancy* (creatures return to sleep
after 8 turns of no contact) is the most likely to degenerate into "retreat and press wait"; the fix
is a distance requirement, not a fuel tax. *Dark adaptation* (ember-sense shrinks to 2 on shuttering
and recovers +1/turn) is the most likely to read as a bug rather than a mechanic — if the playtester
cannot explain why the distant dots vanished, it is presentation-broken, not design-broken. And the
whole "dark is not dominant" argument rests on arithmetic — light reveals ~20 tiles for 4 fuel,
touch reveals 8 for ~20 turns — which is reasoning, not evidence. Every fuel number in the GDD is
marked **(tuning)** for that reason; the three economy invariants in §4 are the part that is design.


## 2026-07-29 — Review caught the determinism contract was never enforced

**Did:** Fixed three blocking bugs the `code-reviewer` agent found in the PR #5 scaffolding, all in
the machinery meant to enforce the project's core invariants.

1. **`npm run lint` never looked at `game/`.** `expo lint` with no arguments lints a hardcoded
   `['src', 'app', 'components']`. `src/` doesn't exist, so it linted `app/` and `components/`
   only — every determinism and layer rule scoped to `game/` and `render/` was dead code. CI
   would have reported green with `Math.random()` in the simulation core. Fixed by switching to
   `eslint .`, which now covers 27 files across every directory instead of 15.
2. **Layer-import rules only matched depth 1.** `../components/*` matches `game/foo.ts` importing
   `../components/x`, but not `game/systems/foo.ts` importing `../../components/x` — and per
   ARCHITECTURE.md every real game file lives at depth 2. The guard protected only the depth where
   no code will ever live. Same hole in the `components/` → `game/` rule, where `components/ui/`
   already exists. Fixed with a `layer()` helper generating `**/dir`, `**/dir/*`, `**/dir/**`,
   which covers any depth plus the `@/` alias in one entry.
3. **Both contract tests passed vacuously**, since `game/` is empty at M0, and the import regex had
   no branch for relative paths anyway. Rewrote the scanner to extract module specifiers first
   (catching `from`, dynamic `import()`, `require()`, and side-effect imports) and match those,
   and — the actual fix — added fixture files of known violations plus tests asserting the scanner
   flags them. The scanner is now proven to work even while the directories it guards are empty.
   `render/` had no backstop at all and now has one.

Also from the non-blocking findings: added `async`/`Promise` lint selectors (ARCHITECTURE.md
claimed promises were lint-enforced; only `await` was), enabled
`strict_required_status_checks_policy`, and put a warning block at the top of `ci.yml` about the
job names being pinned by the ruleset.

**Why:** All three bugs share a shape — the enforcement *looked* correct and reported success, so
nothing would have surfaced them until a determinism bug appeared in gameplay weeks later and the
replay tests couldn't explain it. This is precisely the failure mode ADR-0001 says the review gate
exists to catch, and it was caught on the second PR.

**Learned:** The reviewer verified by *running* things — probe files at real nesting depths,
`gh api` against the live ruleset — rather than reading configs and reasoning. Reading the ESLint
config would not have revealed finding 1; you have to check what `expo lint` actually globs. I
adopted the same approach for the fixes: every one was confirmed by planting a violation, watching
the check fail, removing it, and watching it pass. Assume enforcement is broken until you have
seen it reject something.

Two specific traps now documented rather than latent: a **skipped** CI job reports as *passing* to
required status checks, so adding a `paths:` filter to a required job silently opens the merge
gate. And because required contexts match job display names with no bypass actors, renaming a job
in `ci.yml` makes every PR permanently unmergeable — including the PR that would fix it.

A **second** review pass on the fixes then found two more, both the same shape as the originals —
enforcement scoped to a set that real code can fall outside of:

4. **`.tsx`/`.js` files under `game/` escaped every gate.** Rules were scoped to `*.ts`, and the
   test scanner filtered on `.ts`. A `game/ui/hud.tsx` doing `Math.random()`, `fetch()`, and
   importing `react-native` produced zero signal from lint, tsc, and the test suite. Fixed by
   widening both gates to all source extensions, *plus* a positive assertion that `game/` and
   `render/` contain only `.ts` — a `.tsx` in a pure layer is itself the violation.
5. **The scanner matched comments and string literals.** A legitimate `game/rng/pcg32.ts` whose
   docstring said "replaces `Math.random()`, which cannot be seeded" would have failed CI. That
   would have hit on issue #2, the very next code PR, and the natural response to a spurious
   failure is to reword the doc or loosen the scanner — both worse than the false positive. Now
   strips comments and string literals before scanning, with tests both ways: documented prose
   passes, and real code next to prose still fails.

Also closed from the non-blocking list: `no-restricted-imports` does not inspect `import()` or
`require()` at all, so `await import('@/game/step')` in a component bypassed the layer gate —
added `no-restricted-syntax` selectors covering both across `game/`, `render/`, `components/`, and
`app/`. Added `react-native-*` and `@react-navigation/*` to the banned groups (`react-native` alone
missed `react-native-reanimated`). Added `Promise.*`, `fetch`, `setTimeout`, `XMLHttpRequest`, and
friends, which makes ARCHITECTURE.md's "no promises, no I/O" claim true rather than aspirational.
Added `--max-warnings 0`, since warnings never failed CI and lint is now a real gate.

**Learned (second pass):** esquery, which powers `no-restricted-syntax` selectors, delimits regex
attribute values with `/` and cannot handle an escaped `\/` — it crashes ESLint with a
config-level `SyntaxError` instead of reporting a lint error. Use the `\x2f` hex escape. This cost
a debugging cycle and is noted in `eslint.config.js` at the call site.

**Next:** Unchanged — M0 #1 (strip boilerplate) is the entry point, #3 stays `blocked` behind #2.
The difference is that the contract enforcement those issues rely on is now real.

**Watch:** `required_approving_review_count: 0`, so "the `code-reviewer` agent must approve" is
still convention — an agent is not a GitHub reviewer, and requiring an approval would deadlock a
single-owner repo. This is a known, accepted gap, not a covered one. PR #5 already demonstrated
how it fails.

## 2026-07-29 — Branch protection and agent authorization

**Did:** Added a branch ruleset on `main` (PRs required, all three CI checks required, squash-only,
no force-push, no deletion, **no bypass actors**) and recorded the owner's standing authorization
to spawn any agent in `.claude/agents/` without asking.

**Why:** The "no direct commits to `main`" rule was documentation, which means it was a rule that
held exactly as long as nobody made a mistake. Now the remote rejects the push. Deliberately no
bypass actors: agents operate with the owner's token, so an admin bypass would be an agent bypass,
and the rule would protect nothing.

The agent authorization matters more than it sounds. During setup I merged PR #5 without a
`code-reviewer` pass because I had a standing instruction not to spawn agents unasked — so the
first PR in a process built around adversarial review shipped without any. The owner made the
permission explicit so that cannot recur. It is now written in two places (`CLAUDE.md` and
`WORKFLOW.md` step 9) with the reasoning attached, because a bare permission gets read as optional.

**Learned:** Verified the ruleset by actually attempting a direct push to `main` and confirming
rejection, rather than trusting the API's success response. Worth the thirty seconds — a
protection rule you have not seen reject something is a rule you are only assuming works.

Note for future sessions: `gh` on this machine defaults to an account with read-only access to
this repo. `gh auth switch --user ginderjeremiah` is required before any GitHub write, and the
failure mode is confusing because `gh auth status` shows both accounts as authenticated.

**Next:** M0 issues are unblocked and #1 (strip boilerplate) is the entry point. #3 stays labeled
`blocked` until #2 (seeded RNG) lands.

**Watch:** The ruleset has no bypass, so if CI ever breaks in a way that blocks all merges, fixing
it requires editing the ruleset in repo settings. That is the correct trade — but it is a
single point of failure worth remembering when CI is red and the fix is itself a PR.

## 2026-07-29 — Project groundwork

**Did:** Set up the entire development system before any game code. Documentation spine
(`VISION`, `GDD`, `ARCHITECTURE`, `ROADMAP`, `WORKFLOW`, ADRs, this journal), seven specialized
agents in `.claude/agents/`, GitHub CI running typecheck/lint/unit/build/E2E, issue and PR
templates, Vitest + Playwright wired up and proven with real tests, and the M0/M1 issue queue.

**Why:** The owner intends minimal involvement, so the project needs to be self-verifying. Every
choice here follows from that: determinism so tests can be exhaustive rather than sampled, a web
build so a browser can be automated, a hard sim/render seam so logic is testable without a
renderer, and an adversarial review agent because there is no human reading each diff.

Four things were decided up front with the owner: web-first (mobile-compatible), self-merge on
green CI + agent review, glyph rendering, and no backend. The first three came from him; the
rendering and backend calls were delegated to me with the instruction to prioritize quality over
speed.

**Learned:** Chose a glyph grid over Skia *specifically* because glyphs render to a real DOM tree,
which Playwright can assert against — a canvas would be opaque pixels and would have forced a
human into every verification loop. Quality-over-speed here meant picking the option that keeps
the feedback loop closed, not the option with the higher visual ceiling. The `render/` seam is the
hedge: if glyphs become the limit on feel, swapping renderers touches one layer (ADR-0003).

Also settled: no Jest. The pure-TS core makes Vitest sufficient, and the UI is better verified by
driving the real app in a browser than by shallow-rendering components (ADR-0005).

**Next:** Strip the Expo tutorial boilerplate (#1), then seeded RNG (#2) — the RNG blocks
essentially everything else, since determinism depends on it, and #3 (core types + the
replay-determinism test) depends on it directly. In parallel, the M0 design review (#4) should
attack the *Emberdepth* concept before M1 commits to it.

**Watch:** The concept is unvalidated — `VISION.md` states it as a proposal deliberately, and M0
exists partly to kill it if it does not hold up. The replay-determinism test does not exist yet;
until it does, nothing is actually enforcing the project's central invariant. And no native build
has ever been run: web-first means iOS/Android drift is possible and will not surface until the
M4 verification pass, so keep native-hostile APIs out of the codebase in the meantime.
