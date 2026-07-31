/**
 * The presentation model: `GameState` in, a flat description of the screen out.
 *
 * ```ts
 * import { cuesFor, presentScene, type Scene } from '@/render';
 *
 * // in `session/`, which holds the previous state and the previous scene:
 * const scene = presentScene(next, previousScene);   // board + HUD, cells reused where unchanged
 * const cues = cuesFor(previous, next);              // what happened, as data
 * ```
 *
 * ## The seam
 *
 * `components/` consumes **this** and never `GameState`. That is ADR-0003's whole point — a Skia
 * canvas or a sprite renderer later means rewriting one layer, not the game — and it is enforced
 * three ways: an ESLint rule on `components/` and `app/`, a scanner in
 * `tests/unit/infrastructure.test.ts` that also catches `await import('@/game/...')`, and the fact
 * that nothing in here hands out a `Tile`, an `Actor`, or an id you could ask a question of.
 *
 * `render/` is pure TypeScript. No React, no React Native, no Expo, no `.tsx`, no animation library.
 * The same rules apply upward that `game/`'s apply downward, and the same two gates enforce them.
 *
 * ## Who calls this, and who does not
 *
 * **`session/` does** (ADR-0010). Both functions below take a `GameState`, so the caller has to be
 * able to hold one — and nothing above `session/` can, which was the hole #45 was filed about. The
 * previous state and the previous scene are held *there*, in an opaque `Run`, and `components/`
 * receives `sceneOf(run)` and `cuesOf(run)` having never seen either.
 *
 * That division is not tidiness. This module's public API necessarily **names** `GameState`, so it
 * cannot also be the place `GameState` stops being nameable; one module cannot both expose and hide
 * the same type. Keep it that way — an opaque run handle exported from here would hand `components/`
 * the key and the lock in a single import.
 *
 * ## The two functions, and why they are two
 *
 * A `Scene` is a function of **one** state; a `Cue` is a function of **two**. Fusing them would mean
 * a single call that cannot answer either question on its own — you could not present the opening
 * board, which has no predecessor, without inventing a null state to diff against. So they are
 * separate, `session/` holds the one extra reference, and each is testable at its own arity.
 *
 * ## What is decided here, so that nothing above has to decide it
 *
 * | Question | Answer, and where |
 * | --- | --- |
 * | Which of §10's four states is this cell in? | `cell.ts` — and it is carried by **two non-colour channels**, because §11 |
 * | How much lamplight falls here? | `cell.ts`'s `lampTint` — cosmetic, and provably carries no information |
 * | Which creatures does the player perceive, and how? | `perception.ts` — via `perceive`, with the real list. §4's promise stays a type |
 * | What does a declared action look like? | `cell.ts`'s `Telegraph` — two non-colour channels again, because §2 says two |
 * | Is the descend control visible? Is the shutter pressable? | `hud.ts`, from `game/systems/` predicates |
 * | What just happened? | `cues.ts` — facts, never durations |
 *
 * If a component finds itself asking any of those, the answer is missing from this layer and belongs
 * here, not there.
 */

export { COLOR_TOKENS, type ColorToken, type MeterLevel } from './colors';

export {
  ATTACK_TELEGRAPH,
  CELL_OPACITY,
  CELL_STATES,
  lampTint,
  LAMP_TINT_EDGE,
  MOVE_TELEGRAPH,
  NO_TINT,
  sameCell,
  type Cell,
  type CellState,
  type Telegraph,
} from './cell';

export { CUE_KINDS, cuesFor, type Cue } from './cues';

export { GLYPHS, glyphForCreature, glyphForTile } from './glyphs';

export {
  CRITICAL_FRACTION,
  CRITICAL_TURNS_OF_FUEL,
  LOW_FRACTION,
  LOW_TURNS_OF_FUEL,
  presentHud,
  type FloorHud,
  type FuelHud,
  type HealthHud,
  type Hud,
  type OutcomeHud,
  type SenseHud,
  type ShutterHud,
} from './hud';

export {
  livingCreaturePositions,
  perceivedCreatureCount,
  perceivedCreatures,
} from './perception';

export { cellAt, presentScene, type Scene, type SceneGrid } from './scene';
