# Roadmap

Milestones, in order. Each is a vertical slice that leaves the game **playable** — never a
half-built system waiting on the next milestone to mean anything.

Kept in sync with GitHub milestones. Issues live there; this file explains the intent behind them.

**Current milestone: M1 — Playable core.** The simulation and both pure layers above it — `render/`
and `session/` — are finished. What is left is the screen: **#20 → #21 is what remains before the
exit, and #20 is the only *unblocked* one.** See "Where M1 actually stands" below before picking up
work.

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
- [ ] Death, winning, and a run-summary screen — #21
- [ ] Determinism rules applied to `game/**/*.test.ts` — #12
- [x] `npm run build:web` and `npm run test:e2e` work inside a git worktree — #49. Not gameplay, and
      here anyway: every agent is told to work in a worktree, and CI runs on a clean checkout so it
      stayed green while two of the five pre-push checks silently did not run. Fixed ahead of #20
      because #20's acceptance evidence *is* those two commands
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

*Counted at `2db3f39` (#45 merged), per directory, because the number this section carried before —
"`game/` is 44 test files and 797 tests" — was the **whole suite** at `03d76ec` (#36) mislabelled as
`game/`. `game/` was 42 files then and is 42 files now. It went in as a "stale counts" fix and
survived three PRs after that, which is the lesson: **quote a count only with the directory it
covers, and re-run it** — a number with no stated scope cannot be checked, so nobody checks it.*

**The simulation is done and so are both pure layers above it. What is missing is a screen.**

| Directory | Source modules | Test files | Tests |
| --- | --- | --- | --- |
| `game/` — generation, FOV, light, fuel, scheduler, combat, descent, endings | 45 | 42 | 774 |
| `render/` — the presentation model (#19) | 7 + barrel | 7 | 124 |
| `session/` — the run (#45) | 1 + barrel | 1 | 26 |
| `tests/` — contract gates, the cross-layer consumer probe, shared helpers | — | 3 | 32 |
| **Total** | | **53** | **956** |

`app/` and `components/` are still the bare Expo shell: two files each, no game in them. **`platform/`
does not exist** — that is #47's problem, not #20's.

**#20 → #21, and #20 is unblocked today.** #45 is what unblocked it, and the reason is worth
stating because it was not obvious when #19 was queued: `render/` shipped `presentScene(state)` and
**nothing in the repository could legally call it.** `components/` and `app/` are banned from
importing `game/` by both contract gates, so there was no legal home for `createInitialState()` or
`step()` — #19 finished and #20 still had nowhere to stand. `session/` is that home. #20 now gets
`beginRun(seed)` in a `useState` and the six functions beside it — `move`, `wait`, `setShutter`,
`descend`, `sceneOf`, `cuesOf` — and that is the entire surface it may touch. #21 still follows #20,
because a run summary needs a screen to draw on.

**Two issues stand between M1 and its exit: #20, then #21.** #21 is still `blocked` and still
carries the exit criterion in its own body — the summary screen, both endings, and an E2E path over
a full run. #20 is the only one that can be *started* today. The other three M1 issues — #12, #47
and #49 — are real work that does not gate the playtest.

Four constraints #20 inherits. None blocks it; all four are cheap now and expensive later:

- **A tap on a distant tile stays unbound**, and the tap handler must be able to produce a
  `Position`, not only a `Direction` (ADR-0009 — the auto-travel *build* moved to M2, so this is all
  that is left of #32).
- **There is no token→colour table.** `render/` emits semantic `ColorToken`s and M4 owns the
  palette, so #20 ships a provisional theme and the first honest look at a screenshot will move it.
- **Nothing yet says which of the four neighbours is a *legal* tap target** (GDD §9: "an impassable
  neighbour is not a tap target"). That is a game rule and belongs in `render/` — it must not end up
  as a `blocksMovement` call in a `.tsx`.
- **The seed is a constant** until #47 gives `platform/` a clock, so every run is the same run. That
  is deliberate; the playtest brief has to say so or the first report will be about repetition.

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

**Exit criteria:** the `playtester` agent can complete a run start to finish on a phone-sized
viewport — **both endings, death and the eighth descent** — and report that moving and fighting
feel good, and that the flash-and-crawl decision is one it actually made rather than one the rules
merely permit.

**Two instructions the playtest brief must carry, both because auto-travel is deliberately absent
(ADR-0009).** Without them M1's headline finding is likely to be about tapping rather than about the
light wager:

- **Crossing known space is done by hand, up to about twenty tiles a floor.** Report the tap count
  as its own line item, and keep it out of the Pillar 1 autopilot count — or at least separate the
  two. Steps across an already-mapped empty room are not evidence that §5's no-corridors rule
  failed; they are the cost of the missing feature.
- **The fuel numbers from this playtest are weak evidence about the economy.**
  `game/systems/economy.test.ts`'s corpus models one-step play by a tireless script, and a
  tap-fatigued player goes back for fewer caches and chases fewer embers — which is precisely the
  behaviour §4's third invariant is calibrated on. Report what happened; do not re-tune from it
  alone.

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
- [ ] Fuel economy and the risk/reward tuning around it — calibrated once in #17; **#31 invalidates
      part of that calibration** and must land before the numbers are trusted
- [ ] Sound/haptic feedback for moving blind
- [ ] Does a creature on a marked tile take the hit? — #28, a design ruling §6 is missing
- [ ] Touch perceives ember caches, which §4 says are invisible while shuttered — #41
- [ ] GDD §10's cell-state names vs the ones `render/` shipped — #46. Until this is ruled on, §10
      and the code disagree; §10 carries a pointer so a playtester reading it is not misled
- [ ] `litQuery`'s once-per-turn invariant has no test behind it — #35
- [ ] Auto-travel: implement `travel(to)` per [ADR-0009](decisions/0009-auto-travel-command-shape.md).
      **Gated on the M1 playtest**, not automatic — and **there is no issue for it**: #32 was the
      design ruling and is closed. File the build issue when the gate below opens, not before

**Contract and tooling debt, parked here because it had nowhere else to go.** None of it is light-loop
work and it should not be counted as M2 progress; it is here so that `gh issue list --milestone "M2:
The light loop"` — the queue every session actually reads — does not hide it. If M2 starts and this
list has grown, move it to its own milestone rather than carrying it further.

- [ ] Both contract gates are bypassable by naming a source file `*.test.ts` — #48. Same family as
      #12; whoever does #12 is already in both files
- [ ] `render/` and `session/` may import `platform/`, one import from a clock — #52. **Must be
      settled before or with the PR that creates `platform/` (#47)**, not after
- [ ] `render/`'s barrel lets `components/` name `GameState` via `Parameters<>` — #53. Pre-existing
      from #19; no value path, so it falsifies a documented claim rather than breaking anything
- [ ] Journal and ADR dates from 2026-07-31 onward are fabricated — #50
- [ ] No line-width enforcement anywhere in lint or CI — #39

**Auto-travel is gated, and this is the gate.** Its rules are settled; whether it is built is not.
Moved here from M1 because the friction it removes had never been felt — nothing above `game/`
existed, so tuning a stop rule would have been tuning it against imagination.

- **Build it** if the M1 playtester reports crossing already-mapped space by hand as tedium, naming
  turns rather than vibes, or if the Pillar 1 autopilot count is dominated by known-empty dark steps.
- **Do not build it** if the playtester rarely crosses known space (floors get abandoned for the
  stairs), or crosses it *lit* — in which case travel is a trap that costs 4 a turn and wakes the
  floor, and the fix is elsewhere. **This arm is confounded and must be disambiguated before it is
  believed**, because the tap cost suppresses the very behaviour it is measuring: a player who
  wanted to go back and could not face the taps produces the same observation as a player who never
  wanted to. Ask directly — *did you want to go back and decide not to?* An answer of "yes, often"
  is evidence **for** travel, not against it.
- **Kill it permanently** if, once built, it stops on nearly every step. That is the stop rule being
  wrong at the concept level rather than the tuning level, and a travel that stops every step is
  worse than twenty taps because it also lies about what it does.

If it is built, `game/systems/economy.test.ts`'s corpus must be re-measured with travel in it. Travel
changes no arithmetic, but it changes how many turns a player is willing to spend, and §4's third
invariant was calibrated against scripted one-step-at-a-time play (ADR-0009's Consequences).

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

- Visual polish — palette, typography, light falloff, animation
- Audio
- Onboarding that teaches by playing, not by text
- Accessibility: colorblind-safe palette, text scaling, reduced motion
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
