# ADR-0004: Deterministic pure-TypeScript simulation core

**Status:** Accepted
**Date:** 2026-07-29

## Context

Games are historically hard to test: state is tangled with the framework, randomness makes results
irreproducible, and "is it correct" often means "does it look right when a human plays it."

For an agent-driven project that is fatal. If verification requires a human playing, the human is
in every loop and the project does not move.

## Decision

The entire simulation is a pure, deterministic function:

```ts
step(state: GameState, command: Command): GameState
```

Living in `game/`, with hard constraints enforced by lint:

- No `Math.random()` — randomness comes from a seeded PRNG threaded through state.
- No clock access — the simulation has turns, not time.
- No imports from React, React Native, Expo, or any layer above.
- No async, no I/O.
- No iteration-order dependence (not lint-enforceable; enforced by review).

A run is therefore fully described by `{ seed, commands[] }`, and replaying that reproduces the
run exactly. A property test asserting this is the project's central tripwire.

## Alternatives considered

**Conventional game architecture** — mutable world object, systems reaching into it, randomness
wherever convenient. Faster to write initially. Rejected because testing it requires either
elaborate mocking or accepting that most rules are untested. In a project with no human reviewing
diffs, untested rules mean unverified rules.

**Pure core but allow ambient randomness.** Much of the benefit for less discipline. Rejected
because determinism is all-or-nothing: a single stray `Math.random()` makes replays diverge and
silently destroys the entire testing strategy. There is no partial credit, which is why it is a
lint error rather than a guideline.

**ECS (entity-component-system).** Well-trodden for games and compatible with purity. Rejected as
premature — ECS pays off at a scale of entities and systems we will not reach, and it adds
indirection that makes the rules harder to read. Reconsider if entity variety explodes in M3.

## Consequences

The bulk of the game becomes ordinary TypeScript that can be property-tested exhaustively, with no
DOM, no mocks, and millisecond test runs. Agents can verify game rules with high confidence and no
human involvement — this is the decision that makes ADR-0001 viable.

Falls out nearly free: bug reproduction from a seed, replay sharing, daily challenge seeds, save
files that are kilobytes, and regression detection where a stored replay diverging tells you a
rules change happened whether or not you intended it.

The costs are real. Immutable state updates mean more allocation, so `step()` has a stated
performance budget (2ms/turn) and is benchmarked. The discipline never relaxes — every contributor
and every agent must respect the purity rules permanently, which is why they are lint errors. And
the rules change log (`RunRecord.version`) needs deliberate bumping when balance changes invalidate
stored replays.

**Revisit if:** never, realistically. This is the foundation the rest of the process rests on. If
it becomes untenable, the testing strategy and ADR-0001 need rethinking together.
