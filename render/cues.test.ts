import { describe, expect, it } from 'vitest';
import { createInitialState, floorNumberOf, runStates, step, type Command, type GameState } from '@/game/core';
import { creatureById, playerOf } from '@/game/entities';
import { scenarioState, stateFrom } from '@/tests/unit/support/presentation';
import {
  atTheStairs,
  diveToTheBottom,
  standUntilDead,
  walkInTheDarkThenFlash,
} from '@/tests/unit/support/run-script';
import { awaken } from '@/tests/unit/support/scenario';
import { CUE_KINDS, cuesFor, wakesOnArrival, type Cue } from './cues';

/**
 * Cues are derived, never emitted: nothing in `game/` reports an event, so every variant below is
 * recovered by comparing the state before a command with the state after it. That is what caps the
 * vocabulary and what makes these tests possible at this tier — no clock, no Reanimated, no DOM.
 *
 * The corpus is three real runs, walked one command at a time, because a cue is a statement about a
 * *transition* and a hand-built pair of states is not one.
 *
 * The third run was added with `woke` (#79) and is not a formality. `diveToTheBottom` shutters on
 * command 1 and never opens; `standUntilDead` stands in its own light from turn 0 and never moves.
 * Between them they contain **no dormant → awake transition at all** — the dive wakes nothing, and
 * the lit run's creatures were woken by the opening state's phase 3, before the first command. So
 * the completeness test below went red the moment `woke` was declared, which is exactly what it is
 * for, and the answer was to add the missing play pattern rather than to weaken the assertion.
 */

const DIVE = diveToTheBottom('cues', 3);
const DEATH = standUntilDead('grave', 3);
const FLASH = walkInTheDarkThenFlash('flash');

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
const APPROACH = transitions(FLASH);
const ALL = [...DARK, ...LIT, ...APPROACH];

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

  it('is exercised in full by three real runs', () => {
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
  it('carries no diffed cue across the boundary, on any descent in a whole dive', () => {
    // The sharper form of what this test has always been protecting. It used to assert the cue list
    // was *exactly* `[descended]`, which was a proxy: what matters is that no cue **derived from
    // two states** crosses the stairs. The player is at the old floor's stairs and then at the new
    // floor's entrance, HP is 2 higher, and ids have been reassigned to entirely different
    // creatures, so a naive diff would emit a `playerMoved` animating across a board that no longer
    // exists and `damaged`/`died` cues pairing unrelated actors that share an id.
    //
    // `woke` is deliberately not in that list: on a descent it is a **census of the new floor**, not
    // a diff, which is the whole argument in `cues.ts`'s header for why it is admissible where the
    // other four are not. Asserting `[descended]` exactly would have made adding it look like a
    // regression in a rule that never said that.
    const DIFFED = ['playerMoved', 'damaged', 'died', 'fuelGained'];

    const before = atTheStairs('descend-cue');
    const after = step(before, { kind: 'descend' });

    expect(floorNumberOf(after)).toBe(floorNumberOf(before) + 1);
    expect(kinds(cuesFor(before, after))[0]).toBe('descended');
    for (const kind of kinds(cuesFor(before, after))) expect(DIFFED).not.toContain(kind);
    // The player really did move, and the floor below really is a different set of creatures — so
    // there was plenty for a naive diff to report, and none of it would have been true.
    expect(playerOf(after.world).at).not.toEqual(playerOf(before.world).at);
    expect(after.world.actors.map((a) => a.at)).not.toEqual(before.world.actors.map((a) => a.at));

    // And over every descent the dark dive takes, so a single lucky floor cannot carry this.
    const descents = ALL.filter(({ cues }) => kinds(cues).includes('descended'));
    expect(descents.length).toBeGreaterThan(1);
    for (const { cues } of descents) {
      expect(kinds(cues)[0]).toBe('descended');
      for (const kind of kinds(cues)) expect(DIFFED).not.toContain(kind);
    }
  });

  it('reports what the arrival woke, when the stairs are taken with the shutter open', () => {
    // §4/#79's third emission site, and the one the bug was worst at: `descendTurn` runs the whole
    // phase pipeline **on the new floor**, so arriving lit genuinely runs phase 3 and genuinely
    // wakes — and the player has a new board, sense radius 1 and no reason to suspect anything.
    // Before this, `cuesFor` early-returned `[descended]` and the arrival was silent.
    //
    // The dive used by the test above shutters on command 1, which is why that one still passes and
    // why this one has to open the lantern deliberately. `descend-cue` is not reused: this needs a
    // seed whose floor 2 puts a creature in the arrival's light, and most do not.
    const dark = atTheStairs('z');
    const lit = step(dark, { kind: 'setShutter', to: 'open' });
    const arrived = step(lit, { kind: 'descend' });
    const cues = cuesFor(lit, arrived);

    expect(kinds(cues)[0]).toBe('descended');
    const woke = cues.filter((cue) => cue.kind === 'woke');
    expect(woke.length).toBeGreaterThan(0);
    // The census, recomputed the other way round: every awake creature on the arrival floor, and
    // nothing else. A `descended` that swallowed the wakes would leave this empty; a census that
    // reported dormant creatures too would leave it longer.
    expect(woke).toEqual(
      arrived.world.actors
        .filter((actor) => actor.kind === 'creature' && actor.mind.kind === 'awake')
        .map((actor) => ({ kind: 'woke', at: actor.at })),
    );
  });

  it('reports nothing woken when the stairs are taken in the dark', () => {
    // The other half, and the one that stops the census from being "announce every creature".
    // Nothing wakes in the dark (§4), so a shuttered arrival has no news beyond the new floor.
    const before = atTheStairs('z');
    expect(before.lantern.vision.shutter).toBe('shuttered');
    const after = step(before, { kind: 'descend' });

    expect(after.world.actors.filter((actor) => actor.kind === 'creature').length).toBeGreaterThan(0);
    expect(kinds(cuesFor(before, after))).toEqual(['descended']);
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

describe('waking (§2 phase 3, §4: the whole cost of light)', () => {
  /** A corridor with two sleepers at unequal distances, both inside `LIT_RADIUS` (4). */
  const CORRIDOR = ['#########', '#c...@.c#', '#########'];

  it('emits one cue per woken creature, on its own tile, in ascending actor id', () => {
    // Three separate ways to be wrong, and the map is built so each fails differently. One cue for
    // the pair (`fuelGained`'s aggregate shape) fails the length. A hard-coded or player-relative
    // `at` fails the tiles. And the two sleepers sit at distance **4 and 2** from the player while
    // their ids run left to right, so an implementation that walked a `Map`, a `filter` by distance
    // or the lit-tile list would emit (7,1) before (1,1) and fail the order — which is ADR-0004's
    // rule at this tier: a cue list that reordered itself would make a Playwright assertion flake.
    const { state, scenario } = scenarioState(CORRIDOR, { shutter: 'shuttered', perceive: false });
    const flash = step(state, { kind: 'setShutter', to: 'open' });

    expect(cuesFor(state, flash).filter((cue) => cue.kind === 'woke')).toEqual([
      { kind: 'woke', at: { x: 1, y: 1 } },
      { kind: 'woke', at: { x: 7, y: 1 } },
    ]);
    expect(scenario.ids).toHaveLength(2);
  });

  it('emits a cue per creature rather than one for the turn, so the count is the list length', () => {
    // The shape ruling, pinned as a property rather than as a literal: #79 chose `damaged`/`died`'s
    // one-per-actor shape over an aggregate count so that a renderer can pulse the tile that woke.
    // `components/play/messages.ts` derives its plural sentence from this length, so an aggregate
    // cue carrying `amount: 2` would render "Something wakes." on a turn that woke two.
    const { state } = scenarioState(CORRIDOR, { shutter: 'shuttered', perceive: false });
    const woke = cuesFor(state, step(state, { kind: 'setShutter', to: 'open' })).filter(
      (cue) => cue.kind === 'woke',
    );

    expect(woke).toHaveLength(2);
    for (const cue of woke) expect(Object.keys(cue).sort()).toEqual(['at', 'kind']);
  });

  it('is silent for a creature that was already awake, however long the light stays on', () => {
    // §4 is explicit that re-lighting says nothing: a line that fired every turn a `C` stood in the
    // light would speak on every turn of every fight, which is how a player learns to stop reading
    // the line. A census of `after` — the shape the *arrival* case legitimately uses — would fail
    // here, which is why the ordinary path is a diff and the two are separate functions.
    const { state, scenario } = scenarioState(CORRIDOR, { shutter: 'shuttered', perceive: false });
    let current = step(state, { kind: 'setShutter', to: 'open' });

    for (let turn = 0; turn < 3; turn += 1) {
      const before = current;
      current = step(before, { kind: 'wait' });
      expect(kinds(cuesFor(before, current)), `turn ${turn}`).not.toContain('woke');
    }
    // Not vacuous: something really is still awake and still standing in the light, so the silence
    // is a decision rather than an empty board.
    expect(creatureById(current.world, scenario.ids[0]).mind.kind).toBe('awake');
    expect(current.lantern.vision.shutter).toBe('open');
  });

  it('speaks again for a creature that went re-dormant and was woken a second time', () => {
    // §4's other clause, and the reason the diff is on the *transition* rather than on a
    // "has it ever been announced" flag: after eight turns of no contact the creature is a sleeper
    // again, the player has been treating it as one, and it is a new hunter when it wakes.
    //
    // Played out for real: flash, shutter, retreat to the end of the corridor, and wait while
    // §6's `TURNS_TO_REDORMANCY` runs out. The creature walks to the tile it last saw the light on
    // and parks there, three tiles short of the player — never adjacent, so contact never resumes.
    const { state, scenario } = scenarioState(
      ['#############', '#...@...c...#', '#############'],
      { shutter: 'shuttered', perceive: false },
    );
    const id = scenario.ids[0];

    const first = step(state, { kind: 'setShutter', to: 'open' });
    expect(cuesFor(state, first)).toContainEqual({ kind: 'woke', at: { x: 8, y: 1 } });

    let current = step(first, { kind: 'setShutter', to: 'shuttered' });
    for (const dir of ['west', 'west', 'west'] as const) {
      const before = current;
      current = step(before, { kind: 'move', dir });
      expect(kinds(cuesFor(before, current))).not.toContain('woke');
    }
    for (let turn = 0; turn < 12 && creatureById(current.world, id).mind.kind === 'awake'; turn += 1) {
      const before = current;
      current = step(before, { kind: 'wait' });
      expect(kinds(cuesFor(before, current)), `turn ${turn}`).not.toContain('woke');
    }

    // The premise: it really did fall asleep, in the dark, without ever reaching the player.
    expect(creatureById(current.world, id).mind.kind).toBe('dormant');
    expect(playerOf(current.world).hp).toBe(playerOf(state.world).hp);

    const again = step(current, { kind: 'setShutter', to: 'open' });
    expect(cuesFor(current, again)).toContainEqual({
      kind: 'woke',
      at: creatureById(again.world, id).at,
    });
  });

  it('never reports a creature the light did not reach', () => {
    // The containment claim §4 makes about the flash, read back off the cue list. A sleeper outside
    // `LIT_RADIUS` is not woken and is therefore not announced — so the count the player reads is a
    // count of *this* flash, not of the floor.
    const { state } = scenarioState(['############', '#@.c......c#', '############'], {
      shutter: 'shuttered',
      perceive: false,
    });
    const flash = step(state, { kind: 'setShutter', to: 'open' });

    expect(cuesFor(state, flash).filter((cue) => cue.kind === 'woke')).toEqual([
      { kind: 'woke', at: { x: 3, y: 1 } },
    ]);
  });

  it('fires on a real approach-and-flash run, at the moment the shutter opens', () => {
    // The corpus half. The scripted run walks in the dark and then opens up two tiles from a
    // sleeper, which is the play pattern the light wager exists for — and the turn it flashes is
    // the only turn in three whole runs that carries both a `shutterChanged` and a `woke`.
    const flashes = APPROACH.filter(({ cues }) => kinds(cues).includes('woke'));
    expect(flashes).toHaveLength(1);
    expect(kinds(flashes[0].cues)).toContain('shutterChanged');
    expect(flashes[0].command).toEqual({ kind: 'setShutter', to: 'open' });
    // More than one woke, so the plural copy path is reached by a real run and not only by a
    // hand-built pair of states.
    expect(flashes[0].cues.filter((cue) => cue.kind === 'woke').length).toBeGreaterThan(1);
  });

  it('agrees with the ordinary diff wherever both are defined', () => {
    // `wakesOnArrival` is a census and `wakeCues` is a diff, and the argument that the census is
    // legal is that on a board that came into existence this turn the two coincide. That claim is
    // only checkable where a board is genuinely new — so it is checked on the opening state of
    // several seeds, which is the other place the census is used (`session/run.ts`).
    for (const seed of ['open-1', 'open-17', 'open-20', 'session', 'cues']) {
      const state = createInitialState(seed);
      const awake = state.world.actors.filter(
        (actor) => actor.kind === 'creature' && actor.mind.kind === 'awake',
      );
      expect(wakesOnArrival(state), seed).toEqual(awake.map((actor) => ({ kind: 'woke', at: actor.at })));
    }
    // Not vacuous in the interesting direction: at least one of those openings really did wake
    // something, so this is not five empty lists agreeing with each other.
    expect(wakesOnArrival(createInitialState('open-1')).length).toBeGreaterThan(0);
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
