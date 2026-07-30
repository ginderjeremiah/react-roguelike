/**
 * Animation cues — **what happened**, never how to draw it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * NOTHING ANIMATION-SHAPED MAY EXIST BELOW `components/`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * A `Cue` carries no duration, no easing, no delay, no colour, no distance in pixels, and no idea
 * that time exists. It is a sentence about the turn that just resolved — *the player moved from here
 * to here*, *this took 2 damage*, *the command was refused* — and `components/` decides what, if
 * anything, that looks like.
 *
 * Three reasons, and only the first is architectural:
 *
 *   1. **Reanimated does not run in Vitest** (CLAUDE.md). A cue with a `durationMs` would be a
 *      number this suite could assert and no test could ever validate. A cue with a *fact* is
 *      testable here and the timing is testable in Playwright, which is the tier that has a clock.
 *   2. **Animation is cosmetic and never blocking.** The simulation does not wait for it; a player
 *      tapping fast must not be throttled by a fade. Because cues are a pure function of two states,
 *      dropping every cue in a frame changes nothing but the look — which is also exactly what
 *      honouring §11's reduced-motion setting is: `components/` ignores the list.
 *   3. **The vocabulary stays small because it is derived, not emitted.** Nothing in `game/`
 *      *reports* an event; there is no event bus and adding one would be a channel by which the
 *      simulation could start caring about the renderer. Every cue below is recovered by comparing
 *      the state before a command with the state after it, which caps the vocabulary at "things two
 *      states can disagree about" and keeps it honest.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ## The refusal cue is the one that earns its place
 *
 * GDD §2: "**a refused tap must still produce feedback** — a tap that does nothing at all reads on a
 * phone as 'the touch did not register', which is a UI failure wearing the costume of a rule."
 *
 * And a refusal is trivially detectable, because `step`'s contract makes it so: *a refusal returns
 * the input state itself, by reference.* So `before === after` **is** the refusal, exactly, with no
 * heuristic and no field comparison. `components/` gets a shake or a thud; the rule stays in `game/`.
 *
 * ## What a descent does to the other cues
 *
 * Everything is different below the stairs: a new grid, new creatures, ids reused for entirely
 * different actors. Comparing positions or HP across that boundary would produce a `playerMoved`
 * from the old entrance to the new one — a movement animation across a board that no longer exists —
 * and `damaged` cues for pairs of unrelated creatures that share an id. So a descent emits
 * `descended` and stops. `components/` gets one cue meaning *the board is replaced*, which is the
 * only honest thing to say about it.
 */

import { floorNumberOf, isRunning, type GameState } from '../game/core';
import { playerOf, type Actor } from '../game/entities';
import type { ShutterState } from '../game/fov';
import type { Position } from '../game/map';
import type { ActorId } from '../game/systems';

/**
 * One thing that happened. Seven variants, and the bar for an eighth is that it is recoverable from
 * two `GameState`s and that a renderer would draw it differently from all seven.
 */
export type Cue =
  /** §2: the command ran no phases and changed nothing. The tap must still be acknowledged. */
  | { readonly kind: 'refused' }
  /** §13: the board is replaced. Emitted alone; see the header. */
  | { readonly kind: 'descended'; readonly toFloor: number }
  /** §9's free action. `to` is the setting the shutter now holds, not a toggle. */
  | { readonly kind: 'shutterChanged'; readonly to: ShutterState }
  | { readonly kind: 'playerMoved'; readonly from: Position; readonly to: Position }
  /** §3: deterministic damage. `at` is where the actor stands **after** the turn resolved. */
  | {
      readonly kind: 'damaged';
      readonly at: Position;
      readonly who: 'player' | 'creature';
      readonly amount: number;
    }
  /** §2 phase 5, or §13's ending. `at` is where the actor stood when it died. */
  | { readonly kind: 'died'; readonly at: Position; readonly who: 'player' | 'creature' }
  /** §4's two income sources, netted against the turn's burn. See `fuelGained` below. */
  | { readonly kind: 'fuelGained'; readonly amount: number };

/**
 * Every cue kind, in **emission order** — which is also the order the turn's story reads in: the
 * board changes, then the lamp, then the player, then the blows, then the bodies, then the spoils.
 *
 * Exported so a component's switch can be checked for completeness by a test, and so the ordering is
 * a stated contract rather than the order the `if`s happen to appear in below.
 */
export const CUE_KINDS: readonly Cue['kind'][] = [
  'refused',
  'descended',
  'shutterChanged',
  'playerMoved',
  'damaged',
  'died',
  'fuelGained',
];

/**
 * What happened between two consecutive states.
 *
 * `after` must be the result of exactly one `step(before, command)`. Handing this two states from
 * across several commands is not an error — it produces a plausible, wrong list — so it is stated
 * rather than checked: there is no field on a `GameState` that says how many commands it is past
 * another one, and inventing one to validate a renderer helper would be a field in the simulation
 * that exists for the renderer's benefit.
 *
 * Pure, total, and deterministic: creature cues are emitted in ascending actor id, never in the
 * order a `Map` or a `filter` happened to produce (ADR-0004 applies here as much as in `game/`,
 * because a cue list that reordered itself would make a Playwright assertion flake).
 */
export function cuesFor(before: GameState, after: GameState): readonly Cue[] {
  // Contract point 6: a refusal returns the input state *by reference*. This is the whole test.
  if (after === before) return [{ kind: 'refused' }];

  const toFloor = floorNumberOf(after);
  if (toFloor !== floorNumberOf(before)) return [{ kind: 'descended', toFloor }];

  const cues: Cue[] = [];

  const shutter = after.lantern.vision.shutter;
  if (shutter !== before.lantern.vision.shutter) cues.push({ kind: 'shutterChanged', to: shutter });

  const wasAt = playerOf(before.world).at;
  const nowAt = playerOf(after.world).at;
  if (wasAt.x !== nowAt.x || wasAt.y !== nowAt.y) {
    cues.push({ kind: 'playerMoved', from: wasAt, to: nowAt });
  }

  cues.push(...damageCues(before, after));
  cues.push(...deathCues(before, after));

  // §4's income, **net of the turn's burn**, and that is deliberate: a cache taken with the shutter
  // open is +25 against a -4, and 21 is the number that changed on the HUD. A cue announcing 25
  // while the meter moved 21 is a cue that contradicts the readout beside it.
  const gained = after.lantern.fuel - before.lantern.fuel;
  if (gained > 0) cues.push({ kind: 'fuelGained', amount: gained });

  return cues;
}

/** Actors present in both states, keyed by id. Ascending, because `world.actors` already is. */
function damageCues(before: GameState, after: GameState): Cue[] {
  const wasHp = new Map<ActorId, number>();
  for (const actor of before.world.actors) wasHp.set(actor.id, actor.hp);

  const cues: Cue[] = [];
  for (const actor of after.world.actors) {
    const previous = wasHp.get(actor.id);
    if (previous === undefined || actor.hp >= previous) continue;
    cues.push({
      kind: 'damaged',
      at: actor.at,
      who: whoIs(actor),
      amount: previous - actor.hp,
    });
  }
  return cues;
}

/**
 * Deaths, from the two shapes they take.
 *
 * A creature **leaves the world** in phase 5, so it is an id that was in `before` and is not in
 * `after`. The player **never leaves** — `playerOf` throws if it does, and `game/entities/world.ts`
 * says "the player is never removed from `actors`, even at 0 HP" — so the player's death is the run
 * ending, which is the state field that records it. Two rules, because there are two rules; a single
 * "hp reached 0" check would miss the creature (removed before it could be observed at 0) and would
 * fire for the player on a turn `died` was already set.
 *
 * **`isRunning(before)` is a provably equivalent mutant today** and a mutation run will not kill it:
 * §13 refuses every command once a run has ended, a refusal returns its input by reference, and
 * `cuesFor` answers `refused` and returns before reaching here. So `before` is always `running` in
 * any pair one `step` apart. It is written anyway because the sentence is "the turn the run ended",
 * not "the run is over", and the two stop being the same the first time something resolves after a
 * terminal state. Noted here so a later run does not spend time re-deriving that it survives.
 */
function deathCues(before: GameState, after: GameState): Cue[] {
  const cues: Cue[] = [];

  const survivors = new Set<ActorId>(after.world.actors.map((actor) => actor.id));
  for (const actor of before.world.actors) {
    if (actor.kind !== 'creature') continue;
    if (survivors.has(actor.id)) continue;
    cues.push({ kind: 'died', at: actor.at, who: 'creature' });
  }

  if (isRunning(before) && after.status.kind === 'died') {
    cues.push({ kind: 'died', at: playerOf(after.world).at, who: 'player' });
  }
  return cues;
}

function whoIs(actor: Actor): 'player' | 'creature' {
  return actor.kind === 'player' ? 'player' : 'creature';
}
