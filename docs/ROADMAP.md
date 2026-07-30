# Roadmap

Milestones, in order. Each is a vertical slice that leaves the game **playable** — never a
half-built system waiting on the next milestone to mean anything.

Kept in sync with GitHub milestones. Issues live there; this file explains the intent behind them.

**Current milestone: M0 — Foundations**

---

## M0 — Foundations

*Goal: the machinery of autonomous development works end to end, and the design is settled enough
to build against.*

No game yet. This milestone exists so that every milestone after it can move without stopping to
argue or to hand-verify.

- [x] Process, agents, and documentation scaffolding
- [x] CI pipeline: typecheck, lint, unit tests, web build, E2E smoke
- [x] Test infrastructure: Vitest + Playwright, both proven against a real assertion
- [x] Strip the Expo tutorial boilerplate down to a bare shell
- [x] Seeded RNG with a full property-test suite
- [ ] Core types and the `step()` reducer skeleton, with the replay-determinism test in place
- [ ] Design review of the *Emberdepth* concept — validate, sharpen, or replace it (`design`)

**Exit criteria:** an agent can take an issue from the queue to a merged, CI-verified PR without
human involvement, and `docs/GDD.md` describes a game we are confident is worth building.

## M1 — Playable core

*Goal: you can move around a generated level, fight something, and die.*

The first milestone that produces a game. Deliberately narrow — one level type, one enemy, no
items — because the point is to get the turn loop and the feel of movement right before anything
is layered on top.

- Level generation (one algorithm, one theme)
- Field of view and light propagation
- The turn scheduler
- Player movement and touch input
- One enemy with legible intent (Pillar 2)
- Deterministic combat resolution
- Death, and a run-summary screen

**Exit criteria:** the `playtester` agent can complete a run start to finish on a phone-sized
viewport and report that moving and fighting feel good.

## M2 — The light loop

*Goal: the core wager from `VISION.md` is real and it is the reason to play.*

This is the milestone that determines whether the concept works. If light-vs-dark is not
compelling here, we find out now and change direction, while it is still cheap.

- Lantern fuel as the run clock
- Dormant-in-darkness enemy behavior
- Light-dependent visibility and memory of explored tiles
- Fuel economy and the risk/reward tuning around it
- Sound/haptic feedback for moving blind

**Exit criteria:** the playtester reports the light decision recurring naturally and being
genuinely tense — and can point to specific turns where it mattered.

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
- Native (iOS/Android) verification pass

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

Milestone *goals* and exit criteria are owner-visible: changing one gets a `needs-owner` issue.
The tasks within a milestone are ours to add, cut, and reorder freely as we learn — that is
expected, and the journal is where we record why.
