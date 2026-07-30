# Roadmap

Milestones, in order. Each is a vertical slice that leaves the game **playable** — never a
half-built system waiting on the next milestone to mean anything.

Kept in sync with GitHub milestones. Issues live there; this file explains the intent behind them.

**Current milestone: M1 — Playable core.** The simulation is finished; everything left is the UI
layers above it. See "Where M1 actually stands" below before picking up work.

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
- [ ] Presentation model in `render/` — #19
- [ ] Player movement and touch input — #20
- [ ] Death, winning, and a run-summary screen — #21
- [ ] Determinism rules applied to `game/**/*.test.ts` — #12
- [x] Auto-travel's command shape — settled by [ADR-0009](decisions/0009-auto-travel-command-shape.md);
      **the build moved to M2**, and #32 with it
- [x] Rename the two colliding `Perception` types — #36; now `TurnPerception` (`game/fov/`) and
      `LightQuery` (`game/entities/`)

**A run can be won, which this roadmap never said.** GDD §13 settled it in #18: the run ends by
death *or* by taking the stairs on floor 8 (`LAST_FLOOR`). There is no floor 9 and no boss. The
goal and the exit criterion above are amended accordingly — "complete a run" now has two endings
and the summary screen has to render both.

### Where M1 actually stands

**The whole simulation is done.** `game/` is 44 test files and 797 tests: generation, FOV, light,
fuel, the scheduler, combat, descent, and the endings. Nothing above `game/` exists yet — there is
no `render/` directory and no `platform/` directory, only the Expo shell in `app/` and
`components/`. So the three open build issues are strictly sequential:

**#19 → #20 → #21.** Only #19 is unblocked today. #20 needs the presentation model to consume and
#21 needs a screen to draw the summary on. **#20 is no longer blocked by #32** — ADR-0009 settled
auto-travel's shape and moved the build to M2, so all #20 inherits is one constraint: *a tap on a
distant tile stays unbound, and the tap handler must be able to produce a `Position`, not only a
`Direction`.*

### Scope note: M1 absorbed most of M2's simulation work

Flagged rather than corrected, because the absorption was right and the roadmap was wrong. #17
(fuel, the shutter, the light economy) and #16 (dormant-in-darkness behaviour) landed under M1 and
between them deliver three of M2's five bullets outright and most of a fourth — the fuel economy is
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

**Exit criteria:** the `playtester` agent can complete a run start to finish on a phone-sized
viewport — **both endings, death and the eighth descent** — and report that moving and fighting
feel good, and that the flash-and-crawl decision is one it actually made rather than one the rules
merely permit.

## M2 — The light loop

*Goal: the core wager from `VISION.md` is real and it is the reason to play.*

This is the milestone that determines whether the concept works. If light-vs-dark is not
compelling here, we find out now and change direction, while it is still cheap. §12's designated
fallback (strip fuel, keep the positional tactics) is what "change direction" means.

- [x] Lantern fuel as the run clock — landed early, #17
- [x] Dormant-in-darkness enemy behavior — landed early, #16
- [x] Light-dependent visibility and memory of explored tiles — landed early, #14
- [ ] Fuel economy and the risk/reward tuning around it — calibrated once in #17; **#31 invalidates
      part of that calibration** and must land before the numbers are trusted
- [ ] Sound/haptic feedback for moving blind
- [ ] Does a creature on a marked tile take the hit? — #28, a design ruling §6 is missing
- [ ] `litQuery`'s once-per-turn invariant has no test behind it — #35
- [ ] Auto-travel: implement `travel(to)` per [ADR-0009](decisions/0009-auto-travel-command-shape.md)
      — #32, **gated on the M1 playtest**, not automatic

**Auto-travel is gated, and this is the gate.** Its rules are settled; whether it is built is not.
Moved here from M1 because the friction it removes had never been felt — nothing above `game/`
existed, so tuning a stop rule would have been tuning it against imagination.

- **Build it** if the M1 playtester reports crossing already-mapped space by hand as tedium, naming
  turns rather than vibes, or if the Pillar 1 autopilot count is dominated by known-empty dark steps.
- **Do not build it** if the playtester rarely crosses known space (floors get abandoned for the
  stairs), or crosses it *lit* — in which case travel is a trap that costs 4 a turn and wakes the
  floor, and the fix is elsewhere.
- **Kill it permanently** if, once built, it stops on nearly every step. That is the stop rule being
  wrong at the concept level rather than the tuning level, and a travel that stops every step is
  worse than twenty taps because it also lies about what it does.

If it is built, `game/systems/economy.test.ts`'s corpus must be re-measured with travel in it. Travel
changes no arithmetic, but it changes how many turns a player is willing to spend, and §4's third
invariant was calibrated against scripted one-step-at-a-time play (ADR-0009's Consequences).

**Exit criteria:** the playtester reports the light decision recurring naturally and being
genuinely tense — and can point to specific turns where it mattered. Unchanged, and now the only
thing M2 is really for.

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
