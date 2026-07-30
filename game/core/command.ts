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
 * 3. **Adding or changing a variant is a `RunRecord.version` bump** if it changes what an existing
 *    stored command sequence does. See `replay.ts`.
 *
 * ## Why these two commands
 *
 * They are scaffolding, and they say so. The design is under review (ADR-0007 / #8), so modelling
 * real actions now would mean inventing rules nobody agreed to. What the machinery genuinely needs
 * in order to be tested honestly is one command that consumes no randomness and one that consumes
 * a fixed amount, so that "the generator advanced by exactly the number of draws the command
 * sequence calls for" is a property with something to say.
 *
 * When the design lands, this union is replaced wholesale. Nothing else in `game/core/` should
 * need to change when that happens — that separation is the point of keeping them in their own
 * file.
 */

/**
 * SCAFFOLDING — replaced when the design lands.
 *
 * - `wait`  — advance a turn, consume no randomness.
 * - `roll`  — advance a turn, consume exactly one draw, record the result.
 */
export type Command =
  | { readonly kind: 'wait' }
  | { readonly kind: 'roll'; readonly sides: number };

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
  roll: true,
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
