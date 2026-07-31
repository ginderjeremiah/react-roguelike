import { describe, expect, it } from 'vitest';
import { createInitialState, floorNumberOf, runStates, step, type Command, type GameState } from '@/game/core';
import { creatureById, playerOf } from '@/game/entities';
import { scenarioState, stateFrom } from '@/tests/unit/support/presentation';
import { atTheStairs, diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { awaken } from '@/tests/unit/support/scenario';
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
  it('reports every HP drop elementwise — the tile, the amount, and who took it', () => {
    // The whole payload, in order, over every transition of both runs. The previous version of this
    // test compared `reported.length` against a list of *final HP values* and then asserted only
    // that `amount > 0`, which left all three fields of a `damaged` cue unasserted: `at: (0,0)`,
    // `who: 'creature'` and `amount: 1` all survived as hard-coded constants. #21 draws a floating
    // number at `cue.at` reading `cue.amount`, so those constants are a damage popup that appears in
    // the map's top-left corner saying "1" for every blow in the game.
    //
    // This is deliberately a *mirror* of the derivation — same two states, recomputed a different
    // way — so it catches drift over hundreds of transitions but cannot tell a wrong-by-design
    // choice of tile from a right one. The two tests below pin literal coordinates and literal
    // damage against GDD §3's numbers, which is the half a mirror cannot do.
    let drops = 0;
    for (const { before, after, cues } of ALL) {
      if (kinds(cues).includes('descended') || kinds(cues).includes('refused')) continue;
      const wasHp = new Map(before.world.actors.map((actor) => [actor.id, actor.hp]));
      const expected = after.world.actors.flatMap((actor) => {
        const previous = wasHp.get(actor.id);
        if (previous === undefined || actor.hp >= previous) return [];
        return [
          {
            kind: 'damaged',
            at: actor.at,
            who: actor.kind === 'player' ? 'player' : 'creature',
            amount: previous - actor.hp,
          },
        ];
      });
      expect(cues.filter((cue) => cue.kind === 'damaged')).toEqual(expected);
      drops += expected.length;
    }
    // Not vacuous: two runs in which nothing was ever hit would satisfy the loop trivially. The
    // real figure is 6, all of them the player being hit — the dark dive walks around creatures and
    // the lit run never swings — so `who: 'creature'` is unreachable from the corpus and needs the
    // constructed test below. The bound is loose on purpose: it exists to catch a corpus that went
    // quiet, not to pin a number a rules change is entitled to move by one.
    expect(drops).toBeGreaterThan(3);
  });

  it('reports a blow the player takes on the player’s own tile, for the §3 amount', () => {
    // The `who: 'player'` direction, with the tile and the number written out. §3 gives the Cinder
    // attack 2 against an awake target, and the player is standing at (1,1) — so a `damaged` cue
    // hard-coded to `(0,0)`, to `'creature'`, or to `1` fails here on the field that is wrong.
    const built = scenarioState(['#####', '#@c.#', '#####'], {
      shutter: 'shuttered',
      perceive: false,
    });
    const state = stateFrom(
      awaken(built.state.world, built.scenario.ids[0], { kind: 'attack', at: { x: 1, y: 1 } }),
      { shutter: 'shuttered' },
    );

    // `awaken` joins the schedule for *next* turn, so the first wait is the Cinder winding up and
    // the second is the one it lands on. Asserting the quiet turn as well keeps the test honest
    // about which transition it is making a claim on.
    const waited = step(state, { kind: 'wait' });
    const struck = step(waited, { kind: 'wait' });

    expect(cuesFor(state, waited).filter((cue) => cue.kind === 'damaged')).toEqual([]);
    expect(playerOf(struck.world).hp).toBe(playerOf(waited.world).hp - 2);
    expect(cuesFor(waited, struck)).toContainEqual({
      kind: 'damaged',
      at: { x: 1, y: 1 },
      who: 'player',
      amount: 2,
    });
  });

  it('reports a blow a creature survives on the creature’s tile, and calls it a creature', () => {
    // The `who: 'creature'` direction, which neither scripted run reaches — so a `who` frozen to
    // `'creature'` would pass every corpus assertion in this file. §3: the player's attack is 3, and
    // the doubling only applies to a *dormant* target, so an awake Cinder takes 3 off its 5 and
    // lives. It has to live: a creature killed by the blow is removed in phase 5 and never appears
    // in `after.world.actors`, which is why the kill scenario below reports a death and no damage.
    const built = scenarioState(['####', '#@c#', '####'], { shutter: 'shuttered', perceive: false });
    const id = built.scenario.ids[0];
    const state = stateFrom(awaken(built.state.world, id, { kind: 'wait' }), {
      shutter: 'shuttered',
    });
    const after = step(state, { kind: 'move', dir: 'east' });

    expect(creatureById(after.world, id).hp).toBe(2);
    expect(cuesFor(state, after)).toContainEqual({
      kind: 'damaged',
      at: { x: 2, y: 1 },
      who: 'creature',
      amount: 3,
    });
    // And the player, who threw the punch, is not reported as having taken one.
    expect(cuesFor(state, after).filter((cue) => cue.kind === 'damaged')).toHaveLength(1);
  });

  it('reports the player’s own death, which never leaves the actor list', () => {
    // Two shapes, because there are two rules: a creature is *removed* in phase 5, and the player
    // never is (`game/entities/world.ts`). A single "hp reached 0" check would miss both.
    const dying = LIT.find(({ after }) => after.status.kind === 'died')!;
    expect(dying.after.world.actors.some((actor) => actor.kind === 'player')).toBe(true);
    expect(dying.cues).toContainEqual({
      kind: 'died',
      at: playerOf(dying.after.world).at,
      who: 'player',
    });
  });

  it('reports the player’s death exactly once, not on every turn afterwards', () => {
    // §13: once a run has ended every command is refused, so the turns after a death emit `refused`
    // — but a status field that is still `died` must not keep re-announcing it.
    const deaths = LIT.filter(({ cues }) =>
      cues.some((cue) => cue.kind === 'died' && cue.who === 'player'),
    );
    expect(deaths).toHaveLength(1);
  });

  it('says only `refused` for a command issued after the run has ended', () => {
    // The premise `cues.ts`'s `isRunning(before)` annotation rests on, pinned rather than assumed.
    // That guard is a genuine equivalent mutant *only because* §13 refuses every command once a run
    // is over and a refusal returns its input by reference — so `cuesFor` short-circuits and
    // `deathCues` never sees a pair whose `before` is already terminal. The day `step` stops
    // short-circuiting, the guard becomes load-bearing (it is what stops a `died` cue firing again
    // on every subsequent turn) and this test is what says the annotation needs re-deriving.
    const dead = LIT[LIT.length - 1].after;
    expect(dead.status.kind).toBe('died');
    for (const command of [
      { kind: 'wait' },
      { kind: 'move', dir: 'east' },
      { kind: 'setShutter', to: 'shuttered' },
      { kind: 'descend' },
    ] as Command[]) {
      const after = step(dead, command);
      expect(after, JSON.stringify(command)).toBe(dead);
      expect(cuesFor(dead, after)).toEqual([{ kind: 'refused' }]);
    }
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

    // A killing blow reports the death and **not** the 6 damage that caused it: `damageCues` walks
    // `after.world.actors`, and phase 5 has already removed the body. Pinned because it is a real,
    // observable choice rather than an accident nobody has to live with — #21 gets a death beat on
    // this tile and no floating "-6" beside it. If that reads wrong when the animation lands, the
    // change belongs in `cues.ts` and this line is the paired edit.
    expect(kinds(cuesFor(state, after))).toEqual(['died']);
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
