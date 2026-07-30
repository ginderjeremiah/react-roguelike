/**
 * The creatures the player is aware of — **the list, and the only list**.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THIS RESOLVES `TurnPerception.creatures`, WHICH HAD NO CONSUMER UNTIL NOW
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `game/fov/perceive.ts` computes two halves — the terrain and the creatures — and until this file
 * existed, **only the terrain half was ever read.** `game/systems/light.ts`'s phase 3 calls
 * `perceive(grid, vision, origin, [])` with an empty creature list *on purpose*, and says why: the
 * result was discarded, mutation testing proved the line unkillable, and "an unkillable line is a
 * line that should not exist."
 *
 * The consequence was demonstrated rather than asserted during the #36/#38 review: planting a real
 * behaviour change in `seenIn` left all 26 tests in `game/core/replay.test.ts` green, both pinned
 * whole-run fixtures included, because a digest of `GameState` cannot see a value that is never in a
 * `GameState`. Issue #19 was named as the PR that decides which way that goes.
 *
 * **It goes this way: `render/` is the caller that passes the real list.** The creature half is not
 * dead weight; it is §4's vision table's second row, and the layer that draws the board is its
 * natural consumer. From here on, the tests in this directory are what cover it — the replay
 * fixtures still will not, and that is fine, because nothing about the creature half enters the
 * simulation's state.
 *
 * `perceive` is called rather than reimplemented, and that is the whole point. `CreatureSense` is a
 * union so that a `felt` creature is *a position and nothing else* — no species, no HP, no intent.
 * Reaching around this function to `world.actors` for the creature standing on a felt tile would
 * defeat §4's promise at exactly the moment it matters, and it would compile. `scene.ts` looks up an
 * actor only for a `seen` sense; `scene.test.ts` proves a `felt` one cannot reach identity by
 * building two states that differ only in the felt creature and asserting the boards are identical.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ADR-0009: THIS IS THE LIST A FUTURE `travel(to)` MUST COUNT
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0009 settles auto-travel's stop rule as: **travel stops after a step in which you perceive
 * more creatures than you did**, keyed to the *count* and never to identity, because "more marks
 * than there were" is checkable by the player looking at the screen. The ADR then names the risk
 * this file inherits, verbatim:
 *
 * > **The counted list must be the rendered list, and nothing enforces that across two issues.** The
 * > count is only "checkable by looking" while the creatures the simulation counts are exactly the
 * > marks `render/` draws. ... If they ever diverge — the player counted as a creature, a 0-HP
 * > creature not yet resolved, a creature filtered by liveness in one place and not the other — the
 * > count stops matching the screen and the ruling's whole premise quietly becomes false, with
 * > nothing failing.
 *
 * So the list is defined **once**, here, with its two exclusions stated as rules rather than left to
 * a `filter` that happens to read the same way in two files:
 *
 *   1. **The player is not a creature.** A `*` never marks your own tile, and counting yourself
 *      would make the count off by one everywhere and constant, which is worse than wrong.
 *   2. **A dead creature is not perceived.** GDD §2 puts deaths at phase 5, so a creature killed in
 *      phase 1 sits at 0 HP for the rest of the turn (`game/entities/actor.ts`). It is out of the
 *      schedule, it does not occupy its tile (`occupantAt` skips it), and drawing a mark for it
 *      would show the player a contact that is not there. `isAlive` is the same predicate the
 *      entity layer uses, not a re-derivation.
 *
 * **Where drift would come from, and what to do about it.** The obvious fix — put this function in
 * `game/entities/` so travel and `render/` literally share it — is wrong *today* and right the day
 * travel lands. Today there is no `game/`-side consumer, so it would be an export nothing calls,
 * which is the exact thing `light.ts` deleted and the exact thing this file's first half exists to
 * resolve. **Whoever implements `travel` (M2, issue #32) must move `livingCreaturePositions` down
 * into `game/entities/world.ts` and have this file import it** — at that point travel is the
 * `game/`-side consumer and the shared definition is killable by a mutation. Failing that, they must
 * assert the two lists agree over a corpus. The ADR says "assert, do not assume"; this note says
 * where.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import type { GameState } from '../game/core';
import { isAlive, playerOf, type ActorWorld } from '../game/entities';
import { perceive, type CreatureSense } from '../game/fov';
import type { Position } from '../game/map';

/**
 * Every living creature on the floor, as positions, in ascending actor id order.
 *
 * Order is irrelevant to the result — `perceive` sorts its answer row-major, so spawn order cannot
 * leak into what the player perceives — but `world.actors` is held in ascending id order by every
 * function in `game/entities/`, so this iterates a defined sequence rather than relying on that
 * being irrelevant. Sorting nothing and depending on nothing is the ADR-0004 shape.
 *
 * The player is excluded structurally, by `kind`, rather than by id: `PLAYER_ID` being 0 is a
 * scheduling fact and not a promise about who is a creature.
 */
export function livingCreaturePositions(world: ActorWorld): readonly Position[] {
  const out: Position[] = [];
  for (const actor of world.actors) {
    if (actor.kind === 'creature' && isAlive(actor)) out.push(actor.at);
  }
  return out;
}

/**
 * §4's vision table, second row: who the player is aware of and how.
 *
 * Shutter open, this is every living creature standing on a lit tile, **identified**. Shuttered, it
 * is every living creature within the current ember-sense radius, through walls, **as positions**.
 * The union's variant is the difference and there is no third answer.
 *
 * This is `perceive`'s creature half with the real list. See the header for both reasons that
 * sentence is worth a header.
 */
export function perceivedCreatures(state: GameState): readonly CreatureSense[] {
  const world = state.world;
  return perceive(
    world.floor.grid,
    state.lantern.vision,
    playerOf(world).at,
    livingCreaturePositions(world),
  ).creatures;
}

/**
 * How many creatures the player is perceiving — **ADR-0009 clause 1's quantity**, and the number of
 * marks on the board.
 *
 * It is one `.length` and it is exported anyway, so that the rule the ADR states in English exists
 * somewhere as a name. When travel is built, this is the function whose value it compares across a
 * step; if it ever stops equalling the marks drawn by `presentScene`, the ruling's premise has
 * broken and `scene.test.ts`'s cross-check is what says so.
 */
export function perceivedCreatureCount(state: GameState): number {
  return perceivedCreatures(state).length;
}
