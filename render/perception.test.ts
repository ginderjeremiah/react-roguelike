import { describe, expect, it } from 'vitest';
import { runStates, type GameState } from '@/game/core';
import { creatureById, isAlive, playerOf, withActor, withHp } from '@/game/entities';
import { EMBER_SENSE_RADIUS, perceive } from '@/game/fov';
import { comparePositions } from '@/game/map';
import { scenarioState, stateFrom } from '@/tests/unit/support/presentation';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { livingCreaturePositions, perceivedCreatureCount, perceivedCreatures } from './perception';

/**
 * The creature list has two owners' worth of consequences hanging off it, and both are stated in
 * `perception.ts`'s header: it is the consumer `TurnPerception.creatures` never had, and it is the
 * list ADR-0009's auto-travel stop rule must count. So these are not "does the filter work" tests —
 * they pin the two exclusions the ADR names as the drift modes, and they pin the union that keeps
 * §4's "position only" a type rather than a promise.
 */

const DIVE = diveToTheBottom('perceive', 3);
const DARK: readonly GameState[] = runStates(DIVE.seed, DIVE.commands);
const DEATH = standUntilDead('grave', 3);
const LIT: readonly GameState[] = runStates(DEATH.seed, DEATH.commands);

describe('which creatures are in the list', () => {
  it('never includes the player', () => {
    // ADR-0009's first named drift mode. Counting yourself makes the count off by one everywhere and
    // constant, which is worse than wrong: it would still *look* like it worked.
    for (const state of [...DARK, ...LIT]) {
      const player = playerOf(state.world).at;
      for (const at of livingCreaturePositions(state.world)) {
        expect(at.x === player.x && at.y === player.y).toBe(false);
      }
      for (const sense of perceivedCreatures(state)) {
        expect(sense.at.x === player.x && sense.at.y === player.y).toBe(false);
      }
    }
  });

  it('drops a creature the moment its HP reaches 0, before phase 5 removes it', () => {
    // ADR-0009's second named drift mode. GDD §2 puts deaths at phase 5, so a creature killed in
    // phase 1 sits at 0 HP for the rest of the turn — out of the schedule, not occupying its tile.
    const built = scenarioState(['#######', '#@.#.c#', '#######'], {
      shutter: 'shuttered',
      senseRadius: EMBER_SENSE_RADIUS,
    });
    const id = built.scenario.ids[0];
    const corpse = stateFrom(
      withActor(built.state.world, withHp(creatureById(built.state.world, id), 0)),
      { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS },
    );

    expect(livingCreaturePositions(built.state.world)).toHaveLength(1);
    expect(livingCreaturePositions(corpse.world)).toHaveLength(0);
    expect(perceivedCreatureCount(corpse)).toBe(0);
  });

  it('holds every living creature on the floor, in ascending id order', () => {
    for (const state of [...DARK, ...LIT]) {
      const expected = state.world.actors
        .filter((actor) => actor.kind === 'creature' && isAlive(actor))
        .map((actor) => actor.at);
      expect(livingCreaturePositions(state.world)).toEqual(expected);
    }
  });
});

describe('how they are perceived — §4’s vision table, second row', () => {
  it('identifies in light and only feels in the dark', () => {
    // The union is the table. There is no third answer and no way to be half-shuttered.
    for (const state of [...DARK, ...LIT]) {
      const expected = state.lantern.vision.shutter === 'open' ? 'seen' : 'felt';
      for (const sense of perceivedCreatures(state)) expect(sense.kind).toBe(expected);
    }
  });

  it('returns positions row-major, so nothing about spawn order can reach the screen', () => {
    for (const state of [...DARK, ...LIT]) {
      const positions = perceivedCreatures(state).map((sense) => sense.at);
      expect(positions).toEqual([...positions].sort(comparePositions));
    }
  });

  it('is exactly `perceive` with the real list — this layer adds no rule of its own', () => {
    // The point of the file: `render/` supplies the argument `game/systems/light.ts` deliberately
    // leaves empty, and nothing else. A reimplementation here would be a second copy of §4's table
    // that could disagree with the first.
    for (const state of [...DARK, ...LIT]) {
      expect(perceivedCreatures(state)).toEqual(
        perceive(
          state.world.floor.grid,
          state.lantern.vision,
          playerOf(state.world).at,
          livingCreaturePositions(state.world),
        ).creatures,
      );
    }
  });

  it('is bounded by the current sense radius while shuttered, not by the ceiling', () => {
    // §4's ramp is the tensest state in the game because it shortens this. A list that used
    // EMBER_SENSE_RADIUS instead of `vision.senseRadius` would delete the gamble entirely.
    const lines = ['#######', '#@.#.c#', '#######'];
    const atFloor = scenarioState(lines, { shutter: 'shuttered' });
    const adapted = scenarioState(lines, { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS });

    expect(perceivedCreatureCount(atFloor.state)).toBe(0);
    expect(perceivedCreatureCount(adapted.state)).toBe(1);
  });

  it('feels through stone but sees only what light reaches', () => {
    // ADR-0007/§4's asymmetry, the whole answer to "why would I ever go dark", asserted on the one
    // board: the same creature behind the same wall, in the two vision states.
    const lines = ['#######', '#@.#.c#', '#######'];
    const dark = scenarioState(lines, { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS });
    const lit = scenarioState(lines, { shutter: 'open' });

    expect(perceivedCreatureCount(dark.state)).toBe(1);
    expect(perceivedCreatureCount(lit.state)).toBe(0);
  });

  it('counts what it lists', () => {
    for (const state of [...DARK, ...LIT]) {
      expect(perceivedCreatureCount(state)).toBe(perceivedCreatures(state).length);
    }
  });

  it('actually perceives something across the corpus', () => {
    // Every property above holds vacuously over an empty list, and a run that never met a creature
    // would produce nothing but empty lists.
    const total = [...DARK, ...LIT].reduce((sum, state) => sum + perceivedCreatureCount(state), 0);
    expect(total).toBeGreaterThan(20);
    expect(new Set([...DARK, ...LIT].flatMap((s) => perceivedCreatures(s).map((c) => c.kind)))).toEqual(
      new Set(['seen', 'felt']),
    );
  });
});
