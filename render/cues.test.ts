import { describe, expect, it } from 'vitest';
import { createInitialState, floorNumberOf, runStates, step, type Command, type GameState } from '@/game/core';
import { playerOf } from '@/game/entities';
import { scenarioState } from '@/tests/unit/support/presentation';
import { atTheStairs, diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { CUE_KINDS, cuesFor, type Cue } from './cues';

/**
 * Cues are derived, never emitted: nothing in `game/` reports an event, so every variant below is
 * recovered by comparing the state before a command with the state after it. That is what caps the
 * vocabulary and what makes these tests possible at this tier — no clock, no Reanimated, no DOM.
 *
 * The corpus is two real runs, walked one command at a time, because a cue is a statement about a
 * *transition* and a hand-built pair of states is not one.
 */

const DIVE = diveToTheBottom('cues', 3);
const DEATH = standUntilDead('grave', 3);

/** Every (before, after, cues) triple of a run. */
function transitions(record: { seed: string; commands: readonly Command[] }) {
  const states = runStates(record.seed, record.commands);
  return states.slice(1).map((after, i) => ({
    before: states[i],
    after,
    command: record.commands[i],
    cues: cuesFor(states[i], after),
  }));
}

const DARK = transitions(DIVE);
const LIT = transitions(DEATH);
const ALL = [...DARK, ...LIT];

function kinds(cues: readonly Cue[]): string[] {
  return cues.map((cue) => cue.kind);
}

describe('the vocabulary', () => {
  it('lists every variant, in emission order', () => {
    // A component's switch is checked against this list, so a variant missing from it is a cue no
    // renderer knows exists. Emitted kinds must be a subset, and the order they arrive in must be
    // the order declared here.
    expect(new Set(CUE_KINDS).size).toBe(CUE_KINDS.length);
    for (const { cues } of ALL) {
      for (const cue of cues) expect(CUE_KINDS).toContain(cue.kind);
      const positions = cues.map((cue) => CUE_KINDS.indexOf(cue.kind));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });

  it('is exercised in full by two real runs', () => {
    // Otherwise every property below could be true of a vocabulary half of which never fires.
    const emitted = new Set(ALL.flatMap(({ cues }) => kinds(cues)));
    expect([...emitted].sort()).toEqual([...CUE_KINDS].sort());
  });

  it('carries no timing, no easing and no colour', () => {
    // The rule this module exists to hold: a cue is a fact. `react-native-reanimated` does not run
    // in Vitest, so a `durationMs` here would be a number no test could ever validate — and it would
    // be the simulation's renderer deciding how long a frame lasts, three layers down.
    const forbidden = /duration|delay|ease|easing|ms$|millis|colou?r|opacity|alpha/i;
    for (const { cues } of ALL) {
      for (const cue of cues) {
        for (const key of Object.keys(cue)) expect(key, `${cue.kind}.${key}`).not.toMatch(forbidden);
      }
    }
  });
});

describe('a refusal (GDD §2: a refused tap must still produce feedback)', () => {
  it('is exactly the state coming back by reference, and produces only `refused`', () => {
    // `step`'s contract point 6: a refusal returns the input state *itself*. So the detection needs
    // no heuristic and no field comparison — and a `step` that started allocating on a refusal would
    // turn this into a silent stream of wrong cues, which is why it is asserted here as well as in
    // `step.test.ts`.
    const state = createInitialState('refuse');
    const refused = step(state, { kind: 'setShutter', to: 'open' }); // already open (§2)

    expect(refused).toBe(state);
    expect(cuesFor(state, refused)).toEqual([{ kind: 'refused' }]);
  });

  it('fires for a descent taken off the stairs', () => {
    const state = createInitialState('refuse');
    expect(kinds(cuesFor(state, step(state, { kind: 'descend' })))).toEqual(['refused']);
  });

  it('never accompanies another cue', () => {
    for (const { cues } of ALL) {
      if (!kinds(cues).includes('refused')) continue;
      expect(cues).toHaveLength(1);
    }
  });
});

describe('a descent (GDD §13: you leave the map behind)', () => {
  it('is announced alone, so nothing is animated across two different boards', () => {
    // The player is at the old floor's stairs and then at the new floor's entrance, HP is 2 higher,
    // and ids have been reassigned to entirely different creatures. Every other cue computed across
    // that boundary would be a lie about a board that no longer exists.
    const before = atTheStairs('descend-cue');
    const after = step(before, { kind: 'descend' });

    expect(floorNumberOf(after)).toBe(floorNumberOf(before) + 1);
    expect(cuesFor(before, after)).toEqual([{ kind: 'descended', toFloor: floorNumberOf(after) }]);
    // The player really did move, and the floor below really is a different set of creatures — so
    // there was plenty for a naive diff to report, and none of it would have been true.
    expect(playerOf(after.world).at).not.toEqual(playerOf(before.world).at);
    expect(after.world.actors.map((a) => a.at)).not.toEqual(before.world.actors.map((a) => a.at));
  });

  it('fires once per descent in a full dive and never otherwise', () => {
    const descents = DARK.filter(({ cues }) => kinds(cues).includes('descended'));
    expect(descents.length).toBeGreaterThan(1);
    for (const { before, after, cues } of DARK) {
      expect(kinds(cues).includes('descended')).toBe(floorNumberOf(after) !== floorNumberOf(before));
    }
  });

  it('is not fired by the winning descent, which ends the run where it stands', () => {
    // §13: taking the last floor's stairs ends the run in phase 1 and generates no floor. There is
    // no board to replace, so `descended` would be describing a transition that did not happen.
    const win = diveToTheBottom('win-cue');
    const states = runStates(win.seed, win.commands);
    const final = cuesFor(states[states.length - 2], states[states.length - 1]);

    expect(states[states.length - 1].status.kind).toBe('reachedBottom');
    expect(kinds(final)).not.toContain('descended');
  });
});

describe('the shutter (§9: the command names a setting, not a toggle)', () => {
  it('reports the setting the shutter now holds', () => {
    const state = createInitialState('shutter-cue');
    const shut = step(state, { kind: 'setShutter', to: 'shuttered' });
    expect(cuesFor(state, shut)).toContainEqual({ kind: 'shutterChanged', to: 'shuttered' });

    const open = step(shut, { kind: 'setShutter', to: 'open' });
    expect(cuesFor(shut, open)).toContainEqual({ kind: 'shutterChanged', to: 'open' });
  });

  it('fires when the lantern runs dry, because that shuts the shutter too', () => {
    // §4/`lantern.ts`: "the turn you run dry is the turn the shutter shuts". The player did not press
    // anything, and the lamp still went out — which is precisely the moment that needs a beat, and
    // the one case where a shutter cue is not the echo of a command.
    const { state } = scenarioState(['#####', '#@..#', '#####'], { shutter: 'open', fuel: 4 });
    const after = step(state, { kind: 'wait' });

    expect(after.lantern.fuel).toBe(0);
    expect(after.lantern.vision.shutter).toBe('shuttered');
    expect(cuesFor(state, after)).toContainEqual({ kind: 'shutterChanged', to: 'shuttered' });
  });
});

describe('the player moving', () => {
  it('reports both ends of the step, so a component never has to guess where it came from', () => {
    for (const { before, after, cues } of ALL) {
      const from = playerOf(before.world).at;
      const to = playerOf(after.world).at;
      const moved = cues.find((cue) => cue.kind === 'playerMoved');
      if (from.x === to.x && from.y === to.y) {
        expect(moved).toBeUndefined();
        continue;
      }
      if (kinds(cues).includes('descended')) continue;
      expect(moved).toEqual({ kind: 'playerMoved', from, to });
    }
  });

  it('reports a step of exactly one orthogonal tile', () => {
    // §3: movement is 4-directional. A cue reporting a two-tile jump would mean the renderer was
    // handed two states that are not one command apart.
    for (const { cues } of ALL) {
      for (const cue of cues) {
        if (cue.kind !== 'playerMoved') continue;
        expect(Math.abs(cue.from.x - cue.to.x) + Math.abs(cue.from.y - cue.to.y)).toBe(1);
      }
    }
  });
});

describe('damage and death (§2 phases 4 and 5, §3)', () => {
  it('reports every HP drop, with the amount and who took it', () => {
    for (const { before, after, cues } of ALL) {
      if (kinds(cues).includes('descended') || kinds(cues).includes('refused')) continue;
      const wasHp = new Map(before.world.actors.map((actor) => [actor.id, actor.hp]));
      const expected = after.world.actors
        .filter((actor) => (wasHp.get(actor.id) ?? actor.hp) > actor.hp)
        .map((actor) => actor.hp);
      const reported = cues.filter((cue) => cue.kind === 'damaged');
      expect(reported).toHaveLength(expected.length);
      for (const cue of reported) {
        if (cue.kind !== 'damaged') continue;
        expect(cue.amount).toBeGreaterThan(0);
      }
    }
  });

  it('reports the player’s own death, which never leaves the actor list', () => {
    // Two shapes, because there are two rules: a creature is *removed* in phase 5, and the player
    // never is (`game/entities/world.ts`). A single "hp reached 0" check would miss both.
    const last = LIT[LIT.length - 4] ?? LIT[LIT.length - 1];
    const dying = LIT.find(({ after }) => after.status.kind === 'died')!;
    expect(dying.cues).toContainEqual({
      kind: 'died',
      at: playerOf(dying.after.world).at,
      who: 'player',
    });
    expect(last).toBeDefined();
  });

  it('reports the player’s death exactly once, not on every turn afterwards', () => {
    // §13: once a run has ended every command is refused, so the turns after a death emit `refused`
    // — but a status field that is still `died` must not keep re-announcing it.
    const deaths = LIT.filter(({ cues }) =>
      cues.some((cue) => cue.kind === 'died' && cue.who === 'player'),
    );
    expect(deaths).toHaveLength(1);
  });

  it('reports a creature’s death on the tile it stood on', () => {
    // Neither scripted run kills anything — the dark dive walks around creatures and the lit run
    // stands still until it dies — so the kill is constructed. §3's dormant strike is 3 x 2 = 6
    // against 5 HP, which is a one-hit kill and exactly the move §3 built the shutter around.
    const { state, scenario } = scenarioState(['####', '#@c#', '####'], { shutter: 'shuttered' });
    const at = scenario.at('c');
    const after = step(state, { kind: 'move', dir: 'east' });

    expect(after.world.actors.some((actor) => actor.kind === 'creature')).toBe(false);
    expect(cuesFor(state, after)).toContainEqual({ kind: 'died', at, who: 'creature' });
    // And the body left an ember on the tile it died on (§4), which the player is not standing on.
    expect(after.world.embers.map((drop) => drop.at)).toEqual([at]);
  });
});

describe('fuel', () => {
  it('reports a gain net of the turn’s burn, matching what the HUD moved by', () => {
    // A cue announcing "+25" beside a meter that moved 21 is a cue that contradicts the readout next
    // to it. §4's burn happens on the same turn the cache is collected.
    for (const { before, after, cues } of ALL) {
      const delta = after.lantern.fuel - before.lantern.fuel;
      const gained = cues.find((cue) => cue.kind === 'fuelGained');
      if (delta > 0) expect(gained).toEqual({ kind: 'fuelGained', amount: delta });
      else expect(gained).toBeUndefined();
    }
  });

  it('never reports the ordinary drain as a gain', () => {
    const drains = ALL.filter(({ before, after }) => after.lantern.fuel < before.lantern.fuel);
    expect(drains.length).toBeGreaterThan(10);
    for (const { cues } of drains) expect(kinds(cues)).not.toContain('fuelGained');
  });
});

describe('cuesFor is pure and deterministic', () => {
  it('returns the same list twice for the same pair', () => {
    for (const { before, after, cues } of ALL.slice(0, 60)) {
      expect(cuesFor(before, after)).toEqual(cues);
    }
  });

  it('does not mutate either state', () => {
    const state = createInitialState('cue-purity');
    const after = step(state, { kind: 'wait' });
    const frozen = [state, after].map(deepFreeze) as [GameState, GameState];
    expect(() => cuesFor(frozen[0], frozen[1])).not.toThrow();
  });
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
