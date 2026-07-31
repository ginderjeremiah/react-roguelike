# Roadmap

Milestones, in order. Each is a vertical slice that leaves the game **playable** — never a
half-built system waiting on the next milestone to mean anything.

Kept in sync with GitHub milestones. Issues live there; this file explains the intent behind them.

**Current milestone: M1 — Playable core.** The simulation, both pure layers above it, and the screen
are all built, and #21 closed the run loop. **Nothing is left to build: what gates the exit is the
second `playtester` run** — both endings, on a phone. The open M1 issues (#12, #47, #60, #69, #70)
are real work that does not stand between the milestone and that playtest. See "Where M1 actually
stands" below before picking up work.

---

## M0 — Foundations — **complete**

*Goal: the machinery of autonomous development works end to end, and the design is settled enough
to build against.*

No game yet. This milestone exists so that every milestone after it can move without stopping to
argue or to hand-verify.

- [x] Process, agents, and documentation scaffolding
- [x] CI pipeline: typecheck, lint, unit tests, web build, E2E smoke
- [x] Test infrastructure: Vitest + Playwright, both proven against a real assertion
- [x] Strip the Expo tutorial boilerplate down to a bare shell
- [x] Seeded RNG with a full property-test suite
- [x] Core types and the `step()` reducer skeleton, with the replay-determinism test in place
- [x] Design review of the *Emberdepth* concept — validate, sharpen, or replace it (`design`)

**Exit criteria:** an agent can take an issue from the queue to a merged, CI-verified PR without
human involvement, and `docs/GDD.md` describes a game we are confident is worth building.

**Both met**, and the GitHub milestone is closed. Every PR since #7 has gone queue → merge without
human involvement, and the GDD has survived a design review plus one measured correction
(2026-08-04).

## M1 — Playable core — *in progress*

*Goal: you can move around a generated level, fight something, and die — or reach the bottom and
win.*

The first milestone that produces a game. Deliberately narrow — one level type, one enemy, no
items — because the point is to get the turn loop and the feel of movement right before anything
is layered on top.

- [x] Level generation (one algorithm, one theme) — #13
- [x] Field of view and light propagation — #14
- [x] The turn scheduler — #15
- [x] One enemy with legible intent (Pillar 2) — the Cinder, #16
- [x] Deterministic combat resolution — #16
- [x] `GameState`, the four-command union, and the real `step()` — #18
- [x] Descent, and the two ways a run ends — #18, GDD §13
- [x] Presentation model in `render/` — #19
- [x] `session/` owns the run, and `Run` hides `GameState` from the type system up — #45,
      [ADR-0010](decisions/0010-session-layer-owns-the-run.md)
- [x] Player movement and touch input — #20. Tap legality is `Scene.taps` in `render/`, so `session/`
      did not change and ADR-0009's `travel(to)` is one more `TapAction` case in M2
- [x] Death, winning, and a run-summary screen — #21. The run tally (kills, fuel burned, seed) went
      into `GameState` so a replay reproduces it; see the journal on why not `session/`. This was the
      last issue gating the exit; **what remains before M1 closes is the second playtest, not more
      building**
- [ ] Determinism rules applied to `game/**/*.test.ts` — #12
- [ ] A tap on a non-adjacent tile is silent — #60. Found by the first playtest; §2 requires feedback
      for a refusal and this is the first interaction a new player will attempt
- [x] The HUD's ember-sense readout lies while the lantern is open — #61. Found by the first
      playtest; it misreported the consequence of the game's central decision at the moment it is
      made. Fixed before the exit playtest for exactly that reason
- [x] `npm run build:web` and `npm run test:e2e` work inside a git worktree — #49. Not gameplay, and
      here anyway: every agent is told to work in a worktree, and CI runs on a clean checkout so it
      stayed green while two of the five pre-push checks silently did not run. Fixed ahead of #20
      because #20's acceptance evidence *is* those two commands. (**"Every agent is told to" is not
      written down anywhere in this repository** — `.claude/skills/work-item/SKILL.md` says `git
      switch -c` in the main checkout. The practice is real, nine worktrees deep; the instruction is
      oral. #62)
- [ ] Where a run's seed comes from — #47. **Does not gate the exit** — M1 ships a constant seed —
      but it is the one M1 issue that needs `platform/` to exist
- [x] Auto-travel's command shape — settled by [ADR-0009](decisions/0009-auto-travel-command-shape.md);
      **the build moved to M2**, and #32 with it
- [x] Rename the two colliding `Perception` types — #36; now `TurnPerception` (`game/fov/`) and
      `LightQuery` (`game/entities/`)

**A run can be won, which this roadmap never said.** GDD §13 settled it in #18: the run ends by
death *or* by taking the stairs on floor 8 (`LAST_FLOOR`). There is no floor 9 and no boss. The
goal and the exit criterion above are amended accordingly — "complete a run" now has two endings
and the summary screen has to render both.

### Where M1 actually stands

*Re-counted at `6e20978` (#20 merged) from the tree, not adjusted from the previous count — the
number this section carried two revisions ago ("`game/` is 44 test files and 797 tests") was the
**whole suite** mislabelled as `game/`, and it survived three PRs because a count with no stated
scope cannot be checked. So: **every number below names what it covers and how it was produced.***

```bash
# source modules and test files, per directory, tracked files only
git ls-files <dir> | grep -E '\.tsx?$' | grep -vE '\.test\.tsx?$' | wc -l
git ls-files <dir> | grep -E '\.test\.tsx?$' | wc -l
# tests: npx vitest run, per-file counts bucketed by top-level directory
npx playwright test --list      # E2E: declarations x 2 projects
```

**Everything M1 set out to build exists except the ending.** There is a game on the screen and you
can play it; you cannot yet finish a run and see what happened.

| Directory | Source modules | Test files | Tests |
| --- | --- | --- | --- |
| `game/` — generation, FOV, light, fuel, scheduler, combat, descent, endings | 45 | 42 | 774 |
| `render/` — the presentation model (#19) + `taps.ts` (#20) | 8 + barrel | 8 | 138 |
| `session/` — the run (#45) | 1 + barrel | 1 | 26 |
| `components/play/` — board, cells, HUD, controls, hit test, theme (#20) | 10 | 0 colocated | — |
| `components/` (rest) + `app/` — two themed views; `_layout` and the game screen | 2 + 2 | 0 | — |
| `tests/unit/` — contract gates, consumer probe, the four `play-*` suites, helpers | 6 helpers | 8 | 109 |
| **Total (Vitest)** | | **59** | **1047** |

`components/play/` has **no colocated tests**: its four pure modules are tested from
`tests/unit/play-*.test.ts` (hit test, cell style, messages, theme) and its React is tested by
Playwright, per ADR-0005's no-component-test-runner rule. E2E is **24 runs — 12 declarations across
2 spec files, each run under both the `phone` and `desktop` projects**, up from 4 before #20.

**`platform/` still does not exist** — that is #47's, and #47 does not gate the exit. M1 ships a
constant seed, so every run is the same run.

**#20's four inherited constraints are all discharged**, recorded here because each was cheap only
while it was still open:

- **A tap on a distant tile is `unbound` and carries its `at`** — every `TapAction` variant does, so
  ADR-0009's `travel(to)` is one more `case` in M2 rather than a restructuring. It is also *silent*,
  which is #60.
- **Tap legality is `Scene.taps` in `render/`**, not a `blocksMovement` call in a `.tsx`. `session/`
  did not change to carry it.
- **The palette is a provisional theme in `components/play/theme.ts`**, checked for completeness
  against `COLOR_TOKENS` and for contrast. M4 still owns the values.
- **The seed is the constant `emberdepth`**, and the playtest brief did say so.

**What is left in M1 is a playtest, not a feature.** #21 merged with the summary screen, both
endings, and an E2E path over a full run — so the exit criterion is now a thing to *check* rather
than a thing to build. #12, #47, #60, #69 and #70 are real work that does not stand between the
milestone and that check; **#60 is the one worth clearing first**, because a silent tap on a distant
tile is the first interaction a new player will try and it reads as a broken touch, which would cost
the playtest a finding about the game rather than about the input.

**The concept checkpoint was spent early, at #20 rather than at #21.** The exit criteria below say
the first `playtester` run is M1's exit; in fact it ran against #20's branch, six runs on the fixed
seed, before the endings existed. That was the right call — it found #59 (fixed in #56), #60 and #61
while the screen was still open on the bench — but it means **the exit playtest is now a second
one**, and the thing it must add is the part the first could not reach: both endings, and a full run
start to finish. The first run's verdicts are recorded on #32 (auto-travel) and #31 (the wager), and
both are folded into M2 below.

**Caveat that travels with everything the first playtest found:** it built from a working tree with
uncommitted in-flight changes, so its build is not reproducible from any commit. That undermines its
*hit-test* observations specifically. It does not touch the turn-by-turn counts, the fuel and HP
figures or the Pillar 1 ratio, all of which depend only on `game/`, which did not change.

### Scope note: M1 absorbed most of M2's simulation work

Flagged rather than corrected, because the absorption was right and the roadmap was wrong. #17
(fuel, the shutter, the light economy) and #16 (dormant-in-darkness behaviour) landed under M1 and
between them deliver three of M2's five *original* bullets outright and most of a fourth (the list
below has grown since, so counting it today gives a different denominator) — the fuel economy is
implemented and calibrated once, but its tuning is still open below. That was not scope creep by
inattention: the light wager *is* the turn loop, and a "playable core" that resolves turns without
fuel or waking would have been a different game with a second implementation to throw away.

The consequence to be honest about: **M2 is now a tuning-and-feel milestone, not a build
milestone**, and it can no longer be the place we discover that the concept does not work — the
simulation is already committed. The cheap discovery M2 was designed to buy has been partly spent.

**So the concept checkpoint moves here, to M1's exit.** It has to land somewhere, and the first
`playtester` run is the first moment any of this is judged by something other than a passing test.
Everything the wager needs is already implemented — fuel, waking, ember-sense, the dark crawl — so
the question "is this actually the reason to play" is answerable the day there is a screen. If the
answer is no, that is the moment to spend §12's fallback, not a milestone later.

**That checkpoint has now been passed, and it did not return a clean yes.** The verdict is on #31,
the re-ruling it forces is #63, and both are summarised under M2 below: the parts work and produce
genuinely distinct play, but the wager does not currently land *as a wager* — dark strictly dominates
on floor 1 (+26 fuel / 0 HP against −27 fuel / −4 HP lit). The playtester classified it **tuning, not
mechanic**, and recommended **not** spending §12's fallback. **Its stated reason for that
recommendation is false** — see M2 — so the "do not spend it" conclusion rests on the classification
alone and needs a `game-designer` to confirm or overturn it. §12's fallback is **not** spent, and
nobody should treat it as spent.

### Scope note 2: M1 also absorbed the architecture above `game/`

Also flagged rather than corrected, and for the same reason. M1's bullet list was written as
*features*; two of the items now on it are *layers*. `render/` (#19) was always planned. `session/`
(#45) was not — it was discovered, mid-milestone, as the answer to "nothing in this repository can
legally call the function #19 just shipped". The determinism rules widened from `game/` to all three
pure layers in the same PR, because shipping a new layer with a known hole in the gates is how a
gate stops being believed.

Accept it: M1 is now "playable core **and** the layer stack it needs", which is bigger than the
stated goal but is not padding — every part of it is on the shortest path to a screen. **What to
watch is the tail it left**: #47, #48, #52 and #53 all say some version of "the seam is not quite
where we said it was", and three of them are parked in M2, which is supposed to be a tuning
milestone. Four is a normal amount of settling after a new layer. **If that set grows to six, or a
sixth layer gets proposed, the seam is still wrong** — and that is a design problem to solve once,
not four more issues to work through.

**The set stands at five after #20, one short of the tripwire.** #57 counts — the layer lint matches
import specifiers by path segment, so `components/game/` is rejected as a component reaching into the
simulation and #20's directory is named `components/play/` by the linter rather than by anyone. That
is the rule that enforces the seam being wrong about where the seam is, which is the same family.
**#58 does not count** and must not be added to it: `nativeEvent.locationX` being typed `number` and
`undefined` on react-native-web is a platform-typing bug, not a statement about our layers. Counting
it would fire a tripwire that is measuring something else.

**Exit criteria:** the `playtester` agent can complete a run start to finish on a phone-sized
viewport — **both endings, death and the eighth descent** — and report that moving and fighting
feel good, and that the flash-and-crawl decision is one it actually made rather than one the rules
merely permit.

**Not met.** The screen exists and the first playtest has run, but a run cannot be finished and
neither ending is drawn. #21 is the whole of what is missing.

**Two instructions the playtest brief must carry, both because auto-travel is deliberately absent
(ADR-0009).** Both were carried by the first brief and both did their job — keeping them here
because the *exit* playtest still needs them, unless auto-travel has landed by then:

- **Crossing known space is done by hand, up to about twenty tiles a floor.** Report the tap count
  as its own line item, and keep it out of the Pillar 1 autopilot count — or at least separate the
  two. Steps across an already-mapped empty room are not evidence that §5's no-corridors rule
  failed; they are the cost of the missing feature. *(The first run did separate them, which is what
  made the auto-travel gate answerable at all — see M2.)*
- **The fuel numbers from this playtest are weak evidence about the economy.**
  `game/systems/economy.test.ts`'s corpus models one-step play by a tireless script, and a
  tap-fatigued player goes back for fewer caches and chases fewer embers — which is precisely the
  behaviour §4's third invariant is calibrated on. Report what happened; do not re-tune from it
  alone. *(The first run reported invariant 3 failing on the generous side, +26 on floor 1 for dark
  play. Nothing has been re-tuned from it.)*

## M2 — The light loop

*Goal: the core wager from `VISION.md` is real and it is the reason to play.*

This was written as the milestone that determines whether the concept works. **It is no longer that
— the checkpoint moved up to M1's exit** (see M1's scope notes), because the simulation was finished
a milestone early and the first playtest is the first honest judgement of it. §12's designated
fallback (strip fuel, keep the positional tactics) is still what "change direction" means; it is
just spent at M1's exit if it is spent at all. What M2 is *now* is where the wager is tuned until it
is tense, having already been judged not-dead.

- [x] Lantern fuel as the run clock — landed early, #17
- [x] Dormant-in-darkness enemy behavior — landed early, #16
- [x] Light-dependent visibility and memory of explored tiles — landed early, #14
- [x] **Re-dormancy — landed early, #16, and this line is new because its absence was believed.**
      `nextMind` in `game/entities/behaviour.ts` returns a creature to dormant after
      `TURNS_TO_REDORMANCY = 8` of its own turns without light and without adjacency; it is unit
      tested in `behaviour.test.ts` and pinned end-to-end by `replay.test.ts`'s fixture. **The first
      playtest reported it unimplemented and built a recommendation on that**, almost certainly after
      reading GDD §4's "**Awake-creature behaviour** (M2, ...)" marker, which was stale. §4 is fixed;
      this line exists so the mistake is not repeated from the roadmap instead
- [ ] Fuel economy and the risk/reward tuning around it — calibrated once in #17; **#31 invalidates
      part of that calibration** and must land before the numbers are trusted. **#63 must be ruled
      first** — it is the re-ruling the correction below forces. See the verdict
- [ ] Sound/haptic feedback for moving blind
- [ ] Does a creature on a marked tile take the hit? — #28, a design ruling §6 is missing
- [ ] Touch perceives ember caches, which §4 says are invisible while shuttered — #41
- [ ] GDD §10's cell-state names vs the ones `render/` shipped — #46. Until this is ruled on, §10
      and the code disagree; §10 carries a pointer so a playtester reading it is not misled
- [ ] `litQuery`'s once-per-turn invariant has no test behind it — #35
- [ ] Auto-travel: implement `travel(to)` per [ADR-0009](decisions/0009-auto-travel-command-shape.md)
      — **#65**, filed because the gate below has been answered and the recommendation is build it.
      #32 was the design ruling and stays closed

### The first playtest's verdict on the wager, and one thing it got wrong

Six runs, fixed seed `emberdepth`, 390×844 with touch emulation, against #20's branch. Full report on
**#31**. Recorded here because the tuning work above is judged against it.

**Dark is not currently a trade against light; it is simply better.** Floor 1, measured: floodlit
23 turns, fuel −27, HP −4, two awake kills at two hits each. Dark 21 turns, fuel **+26**, HP 0, two
dormant kills at **one** hit each. A 53-fuel and 4-HP swing, and the dark line was found on the
second run and was not optimised. The light decision was agonising exactly once in six runs, and only
after the player had already burned down to 17 fuel playing badly. Related: **fuel is not the run
timer it is meant to be** — the player died of HP with 66 fuel banked. §4's invariants 1 and 2 hold;
**invariant 3 fails on the generous side** for dark play.

The three causes it named, in its order: a flash costs 5 fuel and **zero turns** (both toggles are
free actions); the containment guarantee turns ember-sense at 5/5 into a **permission check** rather
than a gamble; and light's only unique product — terrain and items — can be deferred indefinitely,
because touch radius 1 plus the four-neighbour guarantee lets you crawl anywhere forever.

**Classification: tuning, not mechanic.** "The dark stalk is genuinely good play and it is the thing
I would come back for; it just needs to cost something."

**Where it was wrong, and it matters because it was the load-bearing reason:** it recommended not
spending §12's fallback *because* §4's re-dormancy was unimplemented, so light was more punishing
than the design intends and the wager was being judged with one counterweight missing. **Re-dormancy
is implemented** (see the checked bullet above), so that argument does not hold and its proposed
sequence — *re-dormancy first, then re-tune, then re-measure* — collapses to **re-tune, then
re-measure**. The recommendation may still be right on the classification alone. **#63** is the
re-ruling, and until a `game-designer` closes it, **treat "do not spend the fallback" as unconfirmed
rather than settled.**

**Two levers it offered and did not decide**, both real trades: charging a turn for the shutter
toggle (§2 argues against it on Pillar 3 grounds), and cutting ember-sense below 4, which breaks the
containment guarantee's use as a permission check without breaking its use as legibility. Also
observed and unfiled as its own thing: six rapid shutter taps burn 15 fuel with zero turns elapsed
and no warning, so a fumbled double-tap costs 5 fuel.

**Contract and tooling debt, parked here because it had nowhere else to go.** None of it is light-loop
work and it should not be counted as M2 progress; it is here so that `gh issue list --milestone "M2:
The light loop"` — the queue every session actually reads — does not hide it. If M2 starts and this
list has grown, move it to its own milestone rather than carrying it further. **It has grown, from
five to eight — #57, #58 and #62 joined — and M2 has not started** — so the next session that opens M2 should split it out
rather than carry it, which is what the sentence above was written to trigger.

- [ ] Both contract gates are bypassable by naming a source file `*.test.ts` — #48. Same family as
      #12; whoever does #12 is already in both files
- [ ] `render/` and `session/` may import `platform/`, one import from a clock — #52. **Must be
      settled before or with the PR that creates `platform/` (#47)**, not after
- [ ] `render/`'s barrel lets `components/` name `GameState` via `Parameters<>` — #53. Pre-existing
      from #19; no value path, so it falsifies a documented claim rather than breaking anything
- [ ] Journal and ADR dates from 2026-07-31 onward are fabricated — #50
- [ ] No line-width enforcement anywhere in lint or CI — #39
- [ ] The layer lint rejects `components/game/`, which is why #20's directory is `components/play/`
      — #57
- [ ] `nativeEvent.locationX` is typed `number` and is `undefined` on react-native-web — #58. It was
      a **shipped** bug in #20, fixed there; what is open is the mechanism that stops the next one,
      and the more valuable half is the test shape that hid it — an expectation of "nothing happens"
      cannot distinguish a working refusal from a handler that is never called, and GDD §2 is full of
      legitimate refusals
- [ ] The worktree convention is written down nowhere, and its `node_modules` junction eats the main
      checkout under `rm -rf` — #62

### Auto-travel: the gate is answered, and the two arms disagree

Its rules were always settled (ADR-0009); whether it is built was not. It was gated here because the
friction it removes had never been felt. The M1 playtest has now felt it. **Recommendation: build
it** — full ruling on **#32**, build issue **#65**. The evidence is genuinely split and is recorded
split, because flattening it into "the playtest said yes" would destroy the part a future session
needs.

- **The "build it" arm fired, on both of its clauses.** Tedium named in turns rather than vibes: Run
  A turns 24–30 were **seven consecutive** locomotion taps; a forced backtrack on floor 2, (4,13) →
  (6,5), was **16 taps, 16 turns, 16 fuel, zero events and a blank status line for all sixteen**.
  Across one 61-turn measured run, ~45 turns (74%) were a step onto known terrain with no fork and no
  creature in sense range — 29 of 45 (64%) excluding that artificial backtrack.
- **The Pillar 1 count is the number that decides it.** 9 of 37 turns were real decisions — 1 in 4.
  Collapse the locomotion and the same play becomes ~9 decisions in ~17 commands, **53%**. Same
  rules, same play, no other change.
- **The "do not build it" arm also fired, on the disambiguating probe this roadmap wrote.** The probe
  was *did you want to go back and decide not to?* — and the answer was **no, not once, in six
  runs.** The single declined backtrack was declined for fuel and turns, which are costs the design
  wants felt; the tap count never entered it. Read literally, that is the do-not-build arm.
- **The resolution is that the gate was aimed at the wrong behaviour.** It was written around
  *backtracking*. The tedium is in *forward* travel through rooms a single flash has already fully
  revealed — one flash reveals a 5×5 room, then 4–8 taps cross a space you can already see,
  containing nothing. ADR-0009's stop rules cover that case unchanged: travel runs over *remembered*
  passable terrain, which is exactly a flashed room.
- **Kill it permanently** if, once built, it stops on nearly every step — untouched by any of the
  above, and untestable until it exists.

**If it is built, expect the win in forward motion, not in returns.** Evaluated against backtracking
it will look like it did not help. And `game/systems/economy.test.ts`'s corpus must be re-measured
with travel in it: travel changes no arithmetic but it changes how many turns a player will spend, and
§4's third invariant was calibrated against scripted one-step play (ADR-0009's Consequences). That
re-measurement now has two reasons — the same playtest reports invariant 3 already failing.

**Exit criteria:** the playtester reports the light decision recurring naturally and being
genuinely tense — and can point to specific turns where it mattered. Unchanged, and now the only
thing M2 is really for. The contract-and-tooling list above is lodged here, not aimed at this — it
does not count toward the exit.

## M3 — Depth

*Goal: runs vary enough to be worth repeating.*

- Multiple level themes with distinct tactical texture
- 6-10 enemies with real behavioral variety
- Items and abilities that change how you play, not just your numbers
- Progression across floors, and a difficulty curve

**Exit criteria:** two runs on different seeds feel like different runs.

## M4 — Feel and finish

*Goal: it looks and feels like a finished thing.*

- Visual polish — palette, typography, light falloff, animation. **`components/play/theme.ts` is the
  provisional palette #20 shipped**; it is checked for token completeness and contrast, so it cannot
  silently lose a token, but every value in it is M4's to move
- Audio
- Onboarding that teaches by playing, not by text
- Accessibility: colorblind-safe palette, text scaling, reduced motion
- **Non-visual play is undecided** — #64. The board announces that a grid exists and nothing about
  what is in it. That is not one of §11's five requirements, so it is not a regression; the open
  question is whether §11 should have a sixth, and "no" is a legitimate answer that nobody has given
- Save/resume mid-run
- Native (iOS/Android) verification pass — **#34 belongs to this one**: a descent measures 1.7ms of
  ARCHITECTURE's 2ms per-turn budget on a GitHub runner, and ~92% of that is level generation.
  Measure it on a real device before deciding whether it needs fixing.

**Exit criteria:** a stranger can install it, learn it, and finish a run without being told
anything.

## Later — not committed

Deliberately parked. Revisit only after M4, and only if the game is actually good.

- Daily challenge seeds (cheap given determinism — needs a backend, see ADR-0006)
- Replay sharing
- Meta-progression between runs (**skeptical**: risks Pillar 1 — unlocks tend to replace decisions
  with waiting)
- Skia renderer, if glyphs become the limiting factor on feel (ADR-0003)
- App store release

---

## Amending this roadmap

Milestone goals, exit criteria, and the tasks within them are all ours to change as we learn.
Amending a goal or an exit criterion deserves an ADR or at least a journal entry explaining why —
it is a significant act — but it does not need the owner's sign-off. See `docs/WORKFLOW.md`.
