/**
 * `Command` — the only way anything outside `game/` can influence the simulation.
 *
 * A command is the *player's intent*, not the outcome of it. `components/` emits commands upward;
 * it never computes what they do. This is what makes a run storable as `(seed, commands)`: the
 * outcome is recomputed by `step`, so a stored run is a few dozen bytes and replaying it is free.
 *
 * ## Rules for anything added here
 *
 * 1. **A command is plain JSON data.** It gets written to a save file and read back. No functions,
 *    no class instances, no `undefined` fields, no references to `GameState`.
 * 2. **A command carries intent, not resolution.** `{ kind: 'move', dir: 'north' }`, never
 *    `{ kind: 'move', to: { x: 4, y: 7 }, cost: 1 }`. The moment the caller computes part of the
 *    answer, part of the rules live outside `step` and the replay stops being authoritative.
 * 3. **Adding or changing a variant is a `RULES_VERSION` bump** if it changes what an existing
 *    stored command sequence does. See `replay.ts`.
 *
 * ## Why exactly these four
 *
 * GDD §9 gives the player's whole vocabulary and §3 settles its shape. Two of the four are worth
 * defending because the obvious fifth and sixth were both considered and rejected:
 *
 * **There is no `attack`.** §3: "One directional command, not two. There is no separate `attack`.
 * What a tap on an adjacent tile does is decided by what is standing there at the moment of the tap
 * — never by a mode, never by a modifier." A separate attack command reintroduces the mode §3
 * removed, and the only thing it could buy is striking a tile a creature is *about to* enter, which
 * is worth nothing because player attacks resolve immediately against what is there **now**.
 * `move` resolves through `bump`, which decides.
 *
 * **`setShutter(to)`, not `toggleShutter`.** A toggle's meaning depends on prior state, so a stored
 * log with one command dropped or duplicated silently inverts the shutter for the rest of the run
 * instead of failing — and at 0 fuel the toggle is the *identity* (§4), so a refused open is
 * invisible in the log. An absolute setting replays to the same shutter whatever happened before it.
 * §9's control is still a toggle; what it *emits* is the setting it is toggling to.
 *
 * `descend` is its own command rather than a special case of `move` or of the self-tap, because §9
 * makes it its own control: "present only while you are standing on the stairs ... Not the self-tap
 * — that is `wait`, and **waiting on the stairs is a real move**."
 */

import type { ShutterState } from '../fov';
import type { Position } from '../map';

/**
 * One of the four moves §3 allows. **A bare string union, deliberately.**
 *
 * The alternative — a `{ dx, dy }` offset — is the representation that looks more general and is
 * worse here on every axis that matters. It has infinitely many inhabitants of which four are
 * legal, so `{ dx: 3, dy: 0 }` becomes a *malformed command* the validator has to reject and a
 * teleport it has to reject it *before*; it makes a diagonal expressible, which §3 rules out; and
 * it renders in a bug report as arithmetic rather than as a word. A string union has exactly four
 * inhabitants, round-trips through JSON as something a human can read, and makes "is this command
 * well-formed" a membership test against a list that cannot drift from the type (`DIRECTIONS`).
 *
 * Screen-space names rather than up/down/left/right, because `down` and `descend` in one vocabulary
 * is an ambiguity a player-facing bug report does not need.
 */
export type Direction = 'north' | 'east' | 'south' | 'west';

/**
 * A key for every direction. `Record` over a union requires all of its keys and permits no others,
 * so a fifth direction breaks this line until it is listed. Same trick as `KIND_KEYS` below, and
 * for the same reason: the runtime list is derived from the type rather than written twice.
 */
const DIRECTION_KEYS: Record<Direction, true> = {
  // Deliberately NOT in sorted order — see the note in `KIND_KEYS`.
  north: true,
  east: true,
  south: true,
  west: true,
};

/** Every direction, as a value, in sorted order. The validator's membership list. */
export const DIRECTIONS: readonly Direction[] = Object.keys(DIRECTION_KEYS).sort() as Direction[];

/**
 * What each direction means as a step on the grid. `y` grows downward (`map/grid.ts`: the origin is
 * the top-left), so north is `-1`.
 *
 * Lives with the `Direction` type rather than in `game/map/`, because it is the *definition of the
 * vocabulary* rather than a rule: it says what the word means, not what happens when you use it.
 * What happens is `bump`'s, in `game/systems/`.
 */
const DIRECTION_STEPS: Record<Direction, Position> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

/** The tile one step from `at` in `dir`. May be off the grid; the caller checks (§2 refuses it). */
export function neighbourOf(at: Position, dir: Direction): Position {
  const step = DIRECTION_STEPS[dir];
  return { x: at.x + step.x, y: at.y + step.y };
}

/**
 * The player's whole vocabulary (GDD §3, §9, §13).
 *
 * - `move`       — step there, or attack whatever is standing there. Costs a turn.
 * - `wait`       — spend the turn. Costs a turn, and on the stairs it is a real decision (§9).
 * - `setShutter` — put the shutter where you want it. **Free** (§2), and still burns its fuel.
 * - `descend`    — take the stairs. Costs a turn, paid on the floor below (§13).
 */
export type Command =
  | { readonly kind: 'move'; readonly dir: Direction }
  | { readonly kind: 'wait' }
  | { readonly kind: 'setShutter'; readonly to: ShutterState }
  | { readonly kind: 'descend' };

/**
 * A key for every command kind. `Record` over a union requires all of its keys and permits no
 * others, so adding a variant to `Command` breaks this line until it is listed — which is the
 * whole reason the runtime list below is derived rather than written out.
 */
const KIND_KEYS: Record<Command['kind'], true> = {
  // Deliberately NOT in sorted order. `Object.keys` returns these in insertion order, so writing
  // them sorted here would make the `.sort()` below untestable — it would be a line that could be
  // deleted with every test still green, which is the same as not having it.
  wait: true,
  move: true,
  descend: true,
  setShutter: true,
};

/**
 * Every command kind, as a value, in sorted order.
 *
 * Exists because "step handles every command kind" is otherwise only checkable at compile time,
 * and only inside the file that switches. The table test in `step.test.ts` iterates this.
 *
 * `Object.keys` order is insertion order for string keys, which is a property of how this file
 * happens to be written rather than part of the simulation's definition — so it is sorted. That
 * is the rule from ARCHITECTURE.md applied to a case where it currently costs nothing, because
 * the case where it costs something looks exactly like this one.
 */
export const COMMAND_KINDS: readonly Command['kind'][] = Object.keys(KIND_KEYS).sort() as Command['kind'][];

/** Every shutter setting, sorted. The `setShutter` payload's membership list. */
export const SHUTTER_STATES: readonly ShutterState[] = (
  Object.keys({ open: true, shuttered: true } satisfies Record<ShutterState, true>) as ShutterState[]
).sort();
