import { describe, expect, it } from 'vitest';
import { LAST_FLOOR, STARTING_FUEL } from '@/game/content';
import {
  createInitialState,
  floorNumberOf,
  replay,
  runStates,
  step,
  worldOf,
  type GameState,
} from '@/game/core';
import { playerOf, withActor, withHp } from '@/game/entities';
import { ADAPTATION_FLOOR, EMBER_SENSE_RADIUS, TURNS_TO_FULL_ADAPTATION } from '@/game/fov';
import { burnRate, isOnStairs } from '@/game/systems';
import { scenarioState } from '@/tests/unit/support/presentation';
import { atTheStairs, diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import {
  CRITICAL_FRACTION,
  CRITICAL_TURNS_OF_FUEL,
  LOW_FRACTION,
  LOW_TURNS_OF_FUEL,
  presentHud,
  type OutcomeHud,
} from './hud';

/**
 * §9 gives the HUD a **minimum**, and the interesting failure is not a wrong number — it is a
 * missing one. Four of the five are obvious enough that nobody drops them; the fifth, ember-sense
 * radius, is the one §9 had to justify in a parenthesis, and it is therefore the one that goes.
 */

const DIVE = diveToTheBottom('hud', 3);
const DARK: readonly GameState[] = runStates(DIVE.seed, DIVE.commands);

const DEATH = standUntilDead('grave', 3);
const DYING: readonly GameState[] = runStates(DEATH.seed, DEATH.commands);

describe('§9 requires five readouts, and the fifth is the one that goes missing', () => {
  it('reports HP, fuel, floor, shutter and ember-sense radius', () => {
    const hud = presentHud(createInitialState('hud'));

    expect(hud.health.hp).toBe(12);
    expect(hud.health.maxHp).toBe(12);
    expect(hud.fuel.fuel).toBe(STARTING_FUEL);
    expect(hud.floor.number).toBe(1);
    expect(hud.floor.last).toBe(LAST_FLOOR);
    expect(hud.shutter.state).toBe('open');
    // §4: "a run's sense radius **starts at the floor, 1, not at the ceiling** ... a HUD that reads
    // 5 before the player has ever been dark is a lie the player will act on."
    expect(hud.sense.radius).toBe(ADAPTATION_FLOOR);
    expect(hud.sense.max).toBe(EMBER_SENSE_RADIUS);
  });

  it('tracks every one of them across a real run', () => {
    for (const state of DARK) {
      const hud = presentHud(state);
      expect(hud.health.hp).toBe(playerOf(state.world).hp);
      expect(hud.fuel.fuel).toBe(state.lantern.fuel);
      expect(hud.floor.number).toBe(floorNumberOf(state));
      expect(hud.shutter.state).toBe(state.lantern.vision.shutter);
      expect(hud.sense.radius).toBe(state.lantern.vision.senseRadius);
      expect(hud.turnsElapsed).toBe(state.turnsElapsed);
    }
  });
});

describe('fuel is read in turns, because there is no maximum to be a fraction of', () => {
  it('reports the current burn rate and how many turns it buys', () => {
    // §4: 4/turn lit, 1/turn shuttered — and `refuel` has no ceiling, so a percentage would be a
    // percentage of a number the game does not have (`game/systems/lantern.ts`).
    for (const state of DARK) {
      const hud = presentHud(state);
      const rate = burnRate(state.lantern.vision.shutter);
      expect(hud.fuel.burnRate).toBe(rate);
      expect(hud.fuel.turnsRemaining).toBe(Math.floor(state.lantern.fuel / rate));
    }
  });

  it('halves the turns you can afford the moment the shutter opens', () => {
    // The single number that makes §4's "a flash costs its 4" legible before it is paid.
    const { state: shut } = scenarioState(['###', '#@#', '###'], { shutter: 'shuttered', fuel: 40 });
    const { state: lit } = scenarioState(['###', '#@#', '###'], { shutter: 'open', fuel: 40 });
    expect(presentHud(shut).fuel.turnsRemaining).toBe(40);
    expect(presentHud(lit).fuel.turnsRemaining).toBe(10);
  });

  it('rounds turns of fuel down, so it never promises a turn you cannot pay for', () => {
    // 42 fuel at 4/turn is ten turns and two fuel left over, not eleven. Rounding up puts a number
    // on the HUD that the lantern cannot honour, on the one readout §4 asks the player to plan
    // against — and the turn it lies about is the turn the light goes out.
    const { state } = scenarioState(['#####', '#@..#', '#####'], { shutter: 'open', fuel: 42 });
    expect(presentHud(state).fuel.turnsRemaining).toBe(10);
  });

  it('reports a dry lantern as dry, unopenable, and not an ending', () => {
    // §4: 0 fuel is "a desperate state, not a loss state". The control must show itself dead —
    // `game/systems/lantern.ts`: "a control that silently does nothing is worse than one that is
    // visibly dead."
    const { state } = scenarioState(['###', '#@#', '###'], { shutter: 'shuttered', fuel: 0 });
    const hud = presentHud(state);

    expect(hud.fuel.dry).toBe(true);
    expect(hud.fuel.turnsRemaining).toBe(0);
    expect(hud.fuel.level).toBe('critical');
    expect(hud.shutter.canOpen).toBe(false);
    expect(hud.outcome.kind).toBe('running');
  });

  it('says the shutter can be opened whenever there is anything left to burn', () => {
    const { state } = scenarioState(['###', '#@#', '###'], { shutter: 'shuttered', fuel: 1 });
    expect(presentHud(state).shutter.canOpen).toBe(true);
  });

  it('escalates at the stated thresholds and nowhere else', () => {
    const level = (fuel: number) =>
      presentHud(scenarioState(['###', '#@#', '###'], { shutter: 'shuttered', fuel }).state).fuel
        .level;

    // At the threshold, not one past it: an off-by-one here is a HUD that goes red a turn late,
    // which for a resource measured in turns is the whole point of the warning.
    expect(level(CRITICAL_TURNS_OF_FUEL)).toBe('critical');
    expect(level(CRITICAL_TURNS_OF_FUEL + 1)).toBe('low');
    expect(level(LOW_TURNS_OF_FUEL)).toBe('low');
    expect(level(LOW_TURNS_OF_FUEL + 1)).toBe('ok');
  });
});

describe('HP', () => {
  it('reports a fraction and a level that agree with each other', () => {
    for (const state of DYING) {
      const hud = presentHud(state);
      expect(hud.health.fraction).toBe(hud.health.hp / hud.health.maxHp);
      if (hud.health.fraction <= CRITICAL_FRACTION) expect(hud.health.level).toBe('critical');
      else if (hud.health.fraction <= LOW_FRACTION) expect(hud.health.level).toBe('low');
      else expect(hud.health.level).toBe('ok');
    }
  });

  it('escalates at the stated fractions, at the threshold rather than past it', () => {
    // §3 gives the Cinder 2 attack against 12 HP, so the HUD crosses these lines on exact quarters
    // and halves — which is precisely where an inclusive/exclusive slip is invisible in a corpus
    // test and obvious to a player who dies one turn after the bar was still amber.
    const level = (hp: number) => {
      const built = scenarioState(['#####', '#@..#', '#####'], { shutter: 'shuttered' });
      const player = playerOf(built.state.world);
      return presentHud({
        ...built.state,
        world: withActor(built.state.world, withHp(player, hp)),
      }).health.level;
    };

    expect(level(3)).toBe('critical'); // 3/12 = CRITICAL_FRACTION exactly
    expect(level(4)).toBe('low');
    expect(level(6)).toBe('low'); // 6/12 = LOW_FRACTION exactly
    expect(level(7)).toBe('ok');
    expect(CRITICAL_FRACTION).toBe(0.25);
    expect(LOW_FRACTION).toBe(0.5);
  });

  it('reaches every level over a run that ends in a death', () => {
    // Guards the test above from being three unreachable branches.
    const levels = new Set(DYING.map((state) => presentHud(state).health.level));
    expect([...levels].sort()).toEqual(['critical', 'low', 'ok']);
  });
});

describe('ember-sense (§4: the adaptation ramp is invisible without this)', () => {
  it('flags the four turns after shuttering, and stops flagging at full adaptation', () => {
    // §4: during the ramp "the containment guarantee is suspended: flashing while your sense radius
    // is under 4 can wake something you could not feel. That is the gamble the ramp exists to
    // create, and it stays legible because the HUD shows the number."
    let state = createInitialState('adapt');
    const seen: boolean[] = [];
    for (let turn = 0; turn <= TURNS_TO_FULL_ADAPTATION + 1; turn += 1) {
      state = turn === 0 ? stepShut(state) : stepWait(state);
      seen.push(presentHud(state).sense.adapting);
    }

    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
    expect(presentHud(state).sense.radius).toBe(EMBER_SENSE_RADIUS);
  });

  it('never flags adaptation while the shutter is open', () => {
    // §4: eyes do not dark-adapt with the lantern open, and the number is unobservable there. A HUD
    // that pulsed "adapting" with the light on would be describing a rule that does not exist.
    const open = createInitialState('adapt');
    expect(presentHud(open).shutter.state).toBe('open');
    expect(presentHud(open).sense.radius).toBeLessThan(EMBER_SENSE_RADIUS);
    expect(presentHud(open).sense.adapting).toBe(false);
  });
});

describe('the descend control (§9: present only while you are standing on the stairs)', () => {
  it('agrees with the rule `descend` itself is refused by', () => {
    // Not recomputed from `floor.stairs`: `isOnStairs` asks the *tile*, so it agrees with what the
    // player can see. A control offered on a tile `step()` would refuse is §2's dead tap wearing a
    // button.
    for (const state of DARK) {
      expect(presentHud(state).onStairs).toBe(isOnStairs(worldOf(state)));
    }
  });

  it('appears when the player is actually standing there', () => {
    expect(presentHud(atTheStairs('stairs-hud')).onStairs).toBe(true);
    expect(presentHud(createInitialState('stairs-hud')).onStairs).toBe(false);
  });
});

describe('the two endings (§13)', () => {
  it('tells a death from a win, with words for each', () => {
    const died = replay(DEATH);
    const won = replay(diveToTheBottom('win', LAST_FLOOR));

    expect(died.status.kind).toBe('died');
    expect(won.status.kind).toBe('reachedBottom');

    const deadHud = presentHud(died);
    const wonHud = presentHud(won);
    expect(deadHud.outcome.kind).toBe('died');
    expect(wonHud.outcome.kind).toBe('reachedBottom');

    // A summary screen has to be able to say *which* ending happened, **in words**. Comparing the
    // two `outcome` objects would be satisfied by `kind` alone and would say nothing about the copy;
    // the failure mode of collapsing the union to `over: boolean` is one headline for both endings,
    // so the headlines are what gets compared. Not pinned to their literal text — that is
    // presentation copy §13 lets M4 rewrite — but they must exist and they must differ.
    const deathLine = headlineOf(deadHud.outcome);
    const winLine = headlineOf(wonHud.outcome);
    expect(deathLine.length).toBeGreaterThan(0);
    expect(winLine.length).toBeGreaterThan(0);
    expect(deathLine).not.toBe(winLine);
  });

  it('says running for every state of a run in progress', () => {
    for (const state of DARK.slice(0, -1)) {
      expect(presentHud(state).outcome.kind).toBe('running');
    }
  });
});

/** The words an ending shows, or `''` for a run still in progress. */
function headlineOf(outcome: OutcomeHud): string {
  return outcome.kind === 'running' ? '' : outcome.headline;
}

function stepShut(state: GameState): GameState {
  return step(state, { kind: 'setShutter', to: 'shuttered' });
}

function stepWait(state: GameState): GameState {
  return step(state, { kind: 'wait' });
}
