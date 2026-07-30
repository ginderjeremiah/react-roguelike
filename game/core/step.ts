/**
 * `step(state, command) -> state`. The whole simulation, eventually.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE STEP CONTRACT — everything in `game/` that resolves a turn must uphold this
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **Pure.** Same `(state, command)` in, same state out, forever. No clock, no ambient
 *    randomness, no I/O, no module-level mutable state. Enforced by lint and by the scanner in
 *    `tests/unit/infrastructure.test.ts`.
 *
 * 2. **Never mutates its input.** The returned state is a new value; the input is untouched, down
 *    to every nested object. `purity.test.ts` deep-freezes every state in a long run and
 *    would throw on the first in-place write. Structural sharing of *immutable* sub-values is
 *    fine and expected — `wait` hands the shared `NO_OUTCOME` object to the next state — because
 *    nothing in `game/` ever writes through a reference.
 *
 * 3. **Randomness is threaded, never ambient.** Every draw takes `state.rng` and the resulting
 *    `rng` goes into the returned state. Dropping it (returning `{ ...state }` after drawing)
 *    replays the same value forever; taking it from anywhere but `state` makes the run depend on
 *    a hidden input.
 *
 * 4. **Draw count depends on the command, not on what was drawn.** This is `draw.ts`'s draw-count
 *    contract extended one level up. Game *rules* may legitimately branch on a drawn value — a
 *    critical hit happens or it does not — but a branch must not change how many draws the turn
 *    consumes unless the branch is itself part of the recorded command sequence. A conditional
 *    draw shifts the whole downstream stream and surfaces later as an unrelated-looking bug.
 *    `replay.test.ts` anchors the final generator position against a draw budget computed from
 *    the command list alone, which is the assertion that catches this.
 *
 * 5. **Exactly one turn per command.** `turn` increases by one on every call, without exception.
 *    That is what makes `turn` usable as a cross-check on a replay's position.
 *
 * 6. **Malformed commands throw; illegal-but-well-formed actions do not.** The distinction matters
 *    and is easy to blur. A command that violates its own type contract (`sides: 0`, an unknown
 *    `kind` arriving from a parsed save file) is a programmer or data error, and failing loudly is
 *    the only honest response — silently substituting a default would make a replay reproduce a
 *    run that never happened. Whether an action the *rules* forbid (walking into a wall) costs a
 *    turn, is ignored, or is rejected is a game-design question; there is no such command yet and
 *    this file does not presume an answer.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { int } from '../rng';
import { assertNever } from './assert';
import type { Command } from './command';
import { NO_OUTCOME, type GameState } from './state';

/**
 * Resolve one command against one state.
 *
 * @returns a new `GameState`. The input is not modified.
 * @throws on a malformed command — see contract point 6.
 */
export function step(state: GameState, command: Command): GameState {
  switch (command.kind) {
    case 'wait':
      // No draw, so `rng` carries over byte-identically. A stray draw here would be invisible in
      // the visible state and would shift every subsequent value in the run; `step.test.ts`
      // asserts the generator is untouched for exactly that reason.
      //
      // The outcome is cleared rather than passed through: `lastOutcome` is the result of the
      // command just resolved, and waiting has no result. See the note in `state.ts` — carrying it
      // forward instead made the whole command log reorderable without changing anything.
      return { ...state, turn: state.turn + 1, lastOutcome: NO_OUTCOME };

    case 'roll': {
      // Validated *before* the draw, mirroring the corollary in draw.ts: nothing may consume
      // entropy and then throw, because the caller's `Rng` would be the pre-call state and the
      // partially-consumed draw would vanish with the exception.
      if (!Number.isSafeInteger(command.sides) || command.sides < 1) {
        throw new Error(
          `step: roll requires an integer sides >= 1, got ${JSON.stringify(command.sides)}`,
        );
      }

      const drawn = int(state.rng, 1, command.sides);
      return {
        turn: state.turn + 1,
        rng: drawn.rng,
        lastOutcome: { kind: 'rolled', value: drawn.value },
      };
    }

    default:
      return assertNever(command, 'step');
  }
}
