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

**Watch:** known risks, deferred cleanup, things that will bite later. Omit if none.
```

Write for a reader with zero context. "Fixed the FOV bug" is useless; "shadowcasting was
symmetric-visible but asymmetric-lit, so enemies could see the player through walls the player
couldn't see through — fixed by computing lighting from the light source rather than the viewer"
is worth the file.

**Be honest about failure.** A record of what did not work is worth more than a record of what
did — it is the only thing stopping a future session from repeating it.

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
