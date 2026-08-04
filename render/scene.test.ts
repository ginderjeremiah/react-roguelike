import { describe, expect, it } from 'vitest';
import { runStates, step, type GameState } from '@/game/core';
import { creatureById, playerOf, withActor, withHp } from '@/game/entities';
import { EMBER_SENSE_RADIUS, hasBeenLit, hasTile } from '@/game/fov';
import { chebyshevDistance, FLOOR_HEIGHT, FLOOR_WIDTH } from '@/game/map';
import { awaken } from '@/tests/unit/support/scenario';
import { scenarioState, stateFrom } from '@/tests/unit/support/presentation';
import { diveToTheBottom, standUntilDead } from '@/tests/unit/support/run-script';
import { ATTACK_TELEGRAPH, CELL_OPACITY, MOVE_TELEGRAPH, lampTint, sameCell, type Cell } from './cell';
import { GLYPHS } from './glyphs';
import { perceivedCreatureCount } from './perception';
import { presentSummary } from './summary';
import { cellAt, presentScene, type Scene } from './scene';

/**
 * ## What is asserted against what
 *
 * Two corpora, for two different jobs, and mixing them up is how a suite ends up with a hundred
 * tests that all exercise the same eight cells.
 *
 *   - **Real runs** (`darkDive`, `litDeath`) drive the actual `step()` over generated floors and
 *     produce hundreds of states across several floors, in both vision states, with kills, deaths,
 *     caches and drops walked over in the dark, and descents in them. Everything phrased as
 *     *this must be true of every
 *     cell of every state* is asserted here, because a property that holds only on a hand-built
 *     3×7 room is a property about that room.
 *
 *     **`darkDive` stops at three floors and no longer runs the lantern dry**, and the change is
 *     §4's rather than this file's: since *The dark can take nothing* (#149) a never-flash line that
 *     reaches 0 fuel is a **dead** line, so "a dry lantern in them" is now a property of the *last*
 *     state of a longer dive rather than of a stretch of play. `litDeath` is what supplies the
 *     terminal frames here.
 *   - **Scenarios** construct the exact situation a rule is about — a creature at distance three
 *     with the shutter shut, a declared attack on a specific tile. Used where the point is a
 *     particular arrangement, per `tests/unit/support/scenario.ts`'s own reasoning.
 */

/** A shuttered dive: ember-sense, touch terrain, no telegraphs, and the lantern running dry. */
function darkDive(seed: string, floors = 3): readonly GameState[] {
  const record = diveToTheBottom(seed, floors);
  return runStates(record.seed, record.commands);
}

/** A lit run that stands in its own light until the Cinders kill it: seen creatures, telegraphs. */
function litDeath(seed = 'grave'): readonly GameState[] {
  const record = standUntilDead(seed, 3);
  return runStates(record.seed, record.commands);
}

const CORPUS: readonly GameState[] = [...darkDive('render-dark'), ...litDeath()];

function everyCell(states: readonly GameState[]): { state: GameState; cell: Cell }[] {
  return states.flatMap((state) =>
    presentScene(state).grid.cells.map((cell) => ({ state, cell })),
  );
}

describe('the board mirrors the floor', () => {
  it('is one cell per tile, row-major, at the grid dimensions', () => {
    const state = CORPUS[0];
    const grid = presentScene(state).grid;
    const floor = state.world.floor.grid;

    expect(grid.width).toBe(floor.width);
    expect(grid.height).toBe(floor.height);
    expect(grid.cells).toHaveLength(floor.tiles.length);

    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        // The cell at index i must be the cell at (x, y) — a transposed board renders as a
        // plausible-looking level that is not the one the player is walking around.
        expect(cellAt(grid, x, y)).toBe(grid.cells[y * grid.width + x]);
        expect(cellAt(grid, x, y).x).toBe(x);
        expect(cellAt(grid, x, y).y).toBe(y);
      }
    }
  });

  it('refuses an out-of-bounds lookup rather than returning undefined', () => {
    const grid = presentScene(CORPUS[0]).grid;
    for (const [x, y] of [
      [-1, 0],
      [0, -1],
      [grid.width, 0],
      [0, grid.height],
    ]) {
      expect(() => cellAt(grid, x, y)).toThrow(/outside/);
    }
  });
});

describe('the scene carries §13’s summary, and only once the run is over', () => {
  it('is the summary built from the HUD outcome it also carries', () => {
    // The whole screen's layout branches on this one field (`app/index.tsx`), so a `presentScene`
    // that computed a perfect summary and forgot to attach it would be a run that never ends on
    // screen — and `summary.ts`'s own suite would stay green throughout, because it calls
    // `presentSummary` directly. Asserted against the scene's own `hud.outcome` rather than against
    // `state.status`, because those two agreeing is the property that makes the copy single-sourced.
    for (const state of [...litDeath(), ...darkDive('scene-summary', 2)]) {
      const scene = presentScene(state);
      expect(scene.summary).toEqual(presentSummary(state, scene.hud.outcome));
      expect(scene.summary === null).toBe(scene.hud.outcome.kind === 'running');
    }
  });

  it('reaches a state where it is not null, so the check above is not vacuous', () => {
    const ended = litDeath().filter((state) => presentScene(state).summary !== null);
    expect(ended.length).toBeGreaterThan(0);
    expect(presentScene(ended[0]).summary?.outcome).toBe('died');
  });
});

describe('the four states, over every state of two real runs', () => {
  it('carries the state on opacity, always', () => {
    // The §10/§11 channel, asserted where it actually has to hold. `cell.test.ts` proves the four
    // constants are distinct; this proves every cell on the board actually uses them, which is the
    // half a `CELL_OPACITY[state]` typo would break.
    for (const { cell } of everyCell(CORPUS)) {
      expect(cell.opacity, `${cell.x},${cell.y} ${cell.state}`).toBe(CELL_OPACITY[cell.state]);
    }
  });

  it('draws nothing at all on an unknown cell', () => {
    // "Every unknown cell is blank whatever the state." A shade, a dot, or a dimmed wall glyph on an
    // unknown tile is free map information — the same defect ADR-0009 rejected in a pathfinding
    // costume.
    let unknowns = 0;
    for (const { cell } of everyCell(CORPUS)) {
      if (cell.state !== 'unknown') continue;
      unknowns += 1;
      expect(cell.glyph).toBe(GLYPHS.blank);
      expect(cell.opacity).toBe(0);
      expect(cell.tint).toBe(0);
      expect(cell.telegraph).toBeNull();
      expect(cell.bgAlpha).toBe(0);
      expect(cell.fg).toBe('void');
      expect(cell.bg).toBe('void');
    }
    // Not vacuous: a run that had already mapped every floor would satisfy the loop trivially.
    expect(unknowns).toBeGreaterThan(1000);
  });

  it('draws something on every cell that is not unknown', () => {
    for (const { cell } of everyCell(CORPUS)) {
      if (cell.state === 'unknown') continue;
      expect(cell.glyph, `${cell.x},${cell.y} ${cell.state}`).not.toBe(GLYPHS.blank);
    }
  });

  it('reaches all four states across the two runs', () => {
    // The guard on every property above: three of these are easy to reach and `sensed` is not, so a
    // corpus that never went dark within ember-sense range would make the interesting assertions
    // silently vacuous.
    const seen = new Set(everyCell(CORPUS).map(({ cell }) => cell.state));
    expect([...seen].sort()).toEqual(['remembered', 'sensed', 'unknown', 'visible']);
  });
});

describe('light falloff', () => {
  it('is lamplight and nothing else: tinted exactly when the shutter is open and the tile is lit', () => {
    for (const { state, cell } of everyCell(CORPUS)) {
      const open = state.lantern.vision.shutter === 'open';
      if (!open || cell.state !== 'visible') {
        expect(cell.tint, `${cell.x},${cell.y}`).toBe(0);
        continue;
      }
      const at = state.world.actors.find((actor) => actor.kind === 'player');
      expect(cell.tint).toBe(lampTint(chebyshevDistance(at!.at, { x: cell.x, y: cell.y })));
    }
  });

  it('is flat across a shuttered board — touch is not light', () => {
    const shuttered = CORPUS.filter((state) => state.lantern.vision.shutter === 'shuttered');
    expect(shuttered.length).toBeGreaterThan(20);
    for (const { cell } of everyCell(shuttered)) expect(cell.tint).toBe(0);
  });

  it('never distinguishes two cells that the simulation treats identically', () => {
    // The other half of "falloff must not imply information the simulation does not have": tint is a
    // function of (state, Chebyshev distance) and of nothing else, so two lit cells the same
    // distance away are the same brightness however they differ underneath.
    for (const state of CORPUS) {
      if (state.lantern.vision.shutter !== 'open') continue;
      const player = state.world.actors.find((actor) => actor.kind === 'player')!.at;
      const byDistance = new Map<number, number>();
      for (const cell of presentScene(state).grid.cells) {
        if (cell.state !== 'visible') continue;
        const distance = chebyshevDistance(player, { x: cell.x, y: cell.y });
        const already = byDistance.get(distance);
        if (already === undefined) byDistance.set(distance, cell.tint);
        else expect(cell.tint).toBe(already);
      }
    }
  });
});

describe('the player', () => {
  it('is always drawn, on a cell it can always see', () => {
    for (const state of CORPUS) {
      const player = state.world.actors.find((actor) => actor.kind === 'player')!;
      const cell = cellAt(presentScene(state).grid, player.at.x, player.at.y);
      expect(cell.glyph).toBe(GLYPHS.player);
      expect(cell.fg).toBe('player');
      // §4: "you always know your own four neighbours" — and, trivially, your own tile. If this ever
      // fails, the touch field or the lit field has stopped including the origin.
      expect(cell.state).toBe('visible');
    }
  });

  it('is drawn exactly once', () => {
    for (const state of CORPUS) {
      const players = presentScene(state).grid.cells.filter((cell) => cell.glyph === GLYPHS.player);
      expect(players).toHaveLength(1);
    }
  });
});

describe('ember-sense contacts (GDD §4: position only)', () => {
  it('draws a felt creature as `*` and never as a species glyph', () => {
    const { state, scenario } = scenarioState(
      ['########', '#@..#.c#', '########'],
      { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS },
    );
    const cell = cellAt(presentScene(state).grid, scenario.at('c').x, scenario.at('c').y);

    expect(cell.glyph).toBe(GLYPHS.contact);
    expect(cell.fg).toBe('contact');
    // Through a wall, on a tile whose terrain has never been perceived. That is §10's
    // sensed-but-unseen, and it is the state that makes darkness worth choosing.
    expect(cell.state).toBe('sensed');
    expect(cell.opacity).toBe(CELL_OPACITY.sensed);
  });

  it('still says the tile is visible when you can touch what you are feeling', () => {
    // The edge `cell.ts`'s header argues both ways round. A creature adjacent to you in the dark is
    // felt *and* standing on a tile the touch radius reaches, so the terrain is not a mystery — the
    // creature's identity is. The cell is therefore `visible` (opacity 1, because you know that
    // tile) carrying the `*` (because §4 gives you position and nothing else). Classifying it as
    // `sensed` would dim a tile the player is standing next to; drawing `c` would invent identity.
    const { state, scenario } = scenarioState(['#####', '#@c.#', '#####'], {
      shutter: 'shuttered',
    });
    const cell = cellAt(presentScene(state).grid, scenario.at('c').x, scenario.at('c').y);

    expect(cell.state).toBe('visible');
    expect(cell.opacity).toBe(CELL_OPACITY.visible);
    expect(cell.glyph).toBe(GLYPHS.contact);
  });

  it('exposes nothing about the creature it marks', () => {
    // THE §4 PROMISE, AS A TEST. Two boards that differ only in the felt creature — its HP, whether
    // it is awake, and what it has declared — must be byte-identical. This is what would fail if
    // anything in `scene.ts` reached around `perceive` to `world.actors` for a felt contact.
    const lines = ['########', '#@..#.c#', '########'];
    const dormant = scenarioState(lines, {
      shutter: 'shuttered',
      senseRadius: EMBER_SENSE_RADIUS,
    });
    const id = dormant.scenario.ids[0];

    const wounded = withActor(dormant.state.world, withHp(creatureById(dormant.state.world, id), 1));
    const awake = awaken(wounded, id, { kind: 'attack', at: { x: 5, y: 1 } });
    const other = stateFrom(awake, { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS });

    // Sanity: the two worlds really do differ, or this test asserts that a copy equals itself.
    expect(creatureById(other.world, id).hp).not.toBe(creatureById(dormant.state.world, id).hp);
    expect(creatureById(other.world, id).mind.kind).toBe('awake');

    expect(presentScene(other).grid.cells).toEqual(presentScene(dormant.state).grid.cells);
  });

  it('outranks the map: a `*` on a tile you remember is still a `*`', () => {
    // The other edge `cell.ts`'s header argues. Walking out and back leaves the far end of the
    // corridor *remembered*, and the creature standing there is felt but not perceived. Classifying
    // that cell as `remembered` would draw the stone at memory opacity and hide the living thing on
    // it — the one thing the dark is for. Driven with real `move` commands, so the remembered set is
    // the one the game built and the sense radius is where §4's ramp actually put it.
    const { state } = scenarioState(['########', '#@....c#', '########'], { shutter: 'shuttered' });
    let walked = state;
    for (const dir of ['east', 'east', 'east', 'east', 'west', 'west', 'west', 'west'] as const) {
      walked = step(walked, { kind: 'move', dir });
    }

    const cell = cellAt(presentScene(walked).grid, 6, 1);
    expect(walked.lantern.vision.senseRadius).toBe(EMBER_SENSE_RADIUS);
    expect(hasTile(walked.lantern.vision.remembered, 6, 1)).toBe(true);
    expect(cell.state).toBe('sensed');
    expect(cell.glyph).toBe(GLYPHS.contact);
  });

  it('does not reach a creature outside the current ember-sense radius', () => {
    // The adaptation ramp is the tensest state in the game precisely because it shortens this. A
    // renderer that drew every creature on the floor would delete that.
    const near = scenarioState(['###########', '#@.......c#', '###########'], {
      shutter: 'shuttered',
      senseRadius: EMBER_SENSE_RADIUS,
    });
    const marks = (state: GameState) =>
      presentScene(state).grid.cells.filter((cell) => cell.glyph === GLYPHS.contact).length;

    // Chebyshev 8 away: beyond radius 5, so nothing is felt even at full adaptation.
    expect(marks(near.state)).toBe(0);
    expect(perceivedCreatureCount(near.state)).toBe(0);
  });

  it('marks a creature it can feel through stone, at the ramp floor and at the ceiling', () => {
    const lines = ['#######', '#@.#.c#', '#######'];
    const atFloor = scenarioState(lines, { shutter: 'shuttered' }); // radius 1
    const adapted = scenarioState(lines, { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS });
    const marks = (state: GameState) =>
      presentScene(state).grid.cells.filter((cell) => cell.glyph === GLYPHS.contact).length;

    expect(marks(atFloor.state)).toBe(0);
    expect(marks(adapted.state)).toBe(1);
  });
});

describe('creatures seen in light (GDD §4: identified)', () => {
  it('draws the species glyph, and the case says whether it is awake', () => {
    const lines = ['#######', '#@.c..#', '#######'];
    const dormant = scenarioState(lines, { shutter: 'open' });
    const id = dormant.scenario.ids[0];
    const at = dormant.scenario.at('c');

    // §2 phase 3 wakes anything in the light, so the scenario's dormant Cinder is already awake by
    // the time `stateFrom` has run phase 3. Both halves of the case pair are reachable by taking
    // the pre-perception state for the dormant one.
    const unlit = scenarioState(lines, { shutter: 'open', perceive: false });
    expect(cellAt(presentScene(unlit.state).grid, at.x, at.y).glyph).toBe('c');
    expect(cellAt(presentScene(dormant.state).grid, at.x, at.y).glyph).toBe('C');
    expect(creatureById(dormant.state.world, id).mind.kind).toBe('awake');
    expect(cellAt(presentScene(dormant.state).grid, at.x, at.y).fg).toBe('creature');
  });

  it('does not draw a creature standing in the dark beside you', () => {
    // §4's lit column is "visible in the lit radius" — not "everywhere". A creature behind a pillar
    // in your own room is not lit and is not seen, which `game/fov/perceive.ts` states as the rule
    // the player reads off the screen.
    const { state, scenario } = scenarioState(
      ['#######', '#@#...#', '#o#.c.#', '#######'],
      { shutter: 'open' },
    );
    const at = scenario.at('c');
    const cell = cellAt(presentScene(state).grid, at.x, at.y);
    expect(cell.glyph).not.toBe('c');
    expect(cell.glyph).not.toBe('C');
    expect(cell.glyph).not.toBe(GLYPHS.contact);
  });
});

describe('ember on the ground (#81, ruled with §4’s *The dark can take nothing*)', () => {
  const withEmber = (shutter: 'open' | 'shuttered') => {
    const built = scenarioState(['#####', '#@..#', '#####'], { shutter, perceive: false });
    return stateFrom(
      { ...built.state.world, embers: [{ at: { x: 2, y: 1 }, amount: 20 }] },
      { shutter },
    );
  };

  it('draws a drop the lantern reveals', () => {
    const cell = cellAt(presentScene(withEmber('open')).grid, 2, 1);
    expect(cell.glyph).toBe(GLYPHS.ember);
    expect(cell.fg).toBe('ember');
  });

  it('hides a drop the light does not reach', () => {
    // §4: items are "visible **in the lit radius**", not wherever they happen to be. A drop drawn on
    // an unknown tile is a beacon saying *something died over there* on terrain the player has never
    // seen — free map information, and free information about a fight they were not present for.
    const built = scenarioState(['##########', '#@.......#', '##########'], {
      shutter: 'open',
      perceive: false,
    });
    const far = stateFrom(
      { ...built.state.world, embers: [{ at: { x: 8, y: 1 }, amount: 20 }] },
      { shutter: 'open' },
    );
    const cell = cellAt(presentScene(far).grid, 8, 1);

    expect(cell.state).toBe('unknown'); // Chebyshev 7, well past the lit radius of 4
    expect(cell.glyph).toBe(GLYPHS.blank);
  });

  it('draws a drop you are standing next to in the dark', () => {
    // ═══ #81, CLOSED AS A RULE (§4's *The dark can take nothing*, #144, built by #149) ═══
    //
    // This test asserted the opposite, on §4's table row *"Items / ember caches | Visible in the lit
    // radius | **Invisible**"*. That row is about a **cache** — terrain the lantern has to have shown
    // you — and it is untouched; the block below still pins it. A *drop* is not a cache: **its
    // position is information the player created**, and under the ruling the player cannot pick it up
    // in the dark either, so hiding it as well would leave them standing on fuel they made, cannot
    // take, and cannot see. That is the *chore rather than a decision* the ruling's own Watch names.
    const cell = cellAt(presentScene(withEmber('shuttered')).grid, 2, 1);
    expect(cell.state).toBe('visible');
    expect(cell.glyph).toBe(GLYPHS.ember);
    expect(cell.fg).toBe('ember');
  });

  it('goes on drawing a drop on a tile the player only remembers', () => {
    // The other half of "you go on seeing it": the drop is a **destination**, and the fuel left in
    // the lantern is how many turns you have to reach one (§4). Drawn on `remembered` as well as
    // `visible`, so walking away from your own kill does not erase it — and `unknown` is still blank,
    // because a tile the player has never been to cannot hold something they made.
    const built = scenarioState(['########', '#@.....#', '########'], { shutter: 'shuttered' });
    const start = stateFrom(
      { ...built.state.world, embers: [{ at: { x: 4, y: 1 }, amount: 20 }] },
      { shutter: 'shuttered' },
    );

    // Five steps east: over the drop on step 3 — which takes nothing, because nothing here has ever
    // been lit — and two tiles past it, so (4,1) is outside the Chebyshev-1 touch radius and is
    // memory rather than perception.
    let state = start;
    for (let i = 0; i < 5; i += 1) state = step(state, { kind: 'move', dir: 'east' });
    expect(playerOf(state.world).at).toEqual({ x: 6, y: 1 });
    expect(state.world.embers).toHaveLength(1); // walked over and left where it fell

    const cell = cellAt(presentScene(state).grid, 4, 1);
    expect(cell.state).toBe('remembered');
    expect(cell.glyph).toBe(GLYPHS.ember);
  });
});

describe('an ember cache is terrain the lantern has to have shown you (GDD §4, #31/#41)', () => {
  /**
   * A cache one step east of the player and a plain floor tile one step west, so both are inside
   * the touch radius and the two cells can be compared. The corridor is small enough that one flash
   * lights all of it.
   */
  const SCENE = ['#####', '#.@♦#', '#####'];
  const AT = { x: 3, y: 1 };
  /** The control cell: ordinary floor, equally close, equally perceived. */
  const PLAIN = { x: 1, y: 1 };

  /** Crawled past in the dark: the tile is perceived, and the lantern has never lit it. */
  const crawled = () => scenarioState(SCENE, { shutter: 'shuttered' }).state;
  /** Flashed: §2 phase 3 has folded the lit field into `vision.revealed`. */
  const flashed = () => scenarioState(SCENE, { shutter: 'open' }).state;

  it('draws the floor glyph on a cache the dark has only felt', () => {
    // #41, and the reason this is a `render/` test as well as a `game/` one: the divergence used to
    // be *known* here and deliberately not fixed here. Now the layer indexes nothing — it asks
    // `perceivedTileAt` — so the `♦` is absent because the simulation says the tile is floor.
    const cell = cellAt(presentScene(crawled()).grid, AT.x, AT.y);
    expect(cell.glyph).toBe(GLYPHS.floor);
    expect(cell.fg).toBe('floor');
    expect(cell.glyph).not.toBe(GLYPHS.ember);
  });

  it('does not leave a hole where the cache is', () => {
    // The clause the ruling spends most of its words on. A blank cell in the middle of ground the
    // player has crawled is a **perfect** cache detector, because nothing else on the board is ever
    // skipped — so the leak would run the other way and be worse. The comparison is against the
    // neighbouring plain floor tile: the two must be indistinguishable in every channel this layer
    // has, or the disguise is not a disguise.
    const board = presentScene(crawled()).grid;
    const disguised = cellAt(board, AT.x, AT.y);
    const plain = cellAt(board, PLAIN.x, PLAIN.y);

    expect(disguised.state).toBe('visible');
    expect(disguised.state).toBe(plain.state);
    expect(disguised.glyph).toBe(plain.glyph);
    expect(disguised.fg).toBe(plain.fg);
    expect(disguised.opacity).toBe(plain.opacity);
    expect(disguised.bg).toBe(plain.bg);
  });

  it('draws the ♦ once the lantern has lit it', () => {
    // The positive control for both tests above: without it they pass on a board that never draws a
    // cache at all, which is precisely what a `glyphForTile` returning floor for `cache` would do.
    const cell = cellAt(presentScene(flashed()).grid, AT.x, AT.y);
    expect(cell.glyph).toBe(GLYPHS.ember);
    expect(cell.fg).toBe('ember');
  });

  it('keeps the ♦ on the board after the shutter closes again', () => {
    // §4's *ever lit* reading, on screen. Driven through the real `setShutter` command rather than
    // by editing a lantern, because the claim is about what the player sees one press later: the
    // room goes dark, the tile drops to `remembered`, and the cache is still marked. A renderer
    // keyed on `lamplit` — which is how the ember *drop* works, one block up — would blink it out.
    const shut = step(flashed(), { kind: 'setShutter', to: 'shuttered' });
    const cell = cellAt(presentScene(shut).grid, AT.x, AT.y);

    expect(shut.lantern.vision.shutter).toBe('shuttered');
    expect(cell.state).toBe('visible'); // touch reaches it — it is one step away
    expect(cell.glyph).toBe(GLYPHS.ember);
    expect(cell.fg).toBe('ember');
  });

  it('never draws a ♦ on a tile the lantern has not lit, over two whole runs', () => {
    // The property over the corpus, which is what stops the four scenarios above being four facts
    // about a 5×3 corridor. `darkDive` crosses three floors shuttered and walks over caches; every
    // one of those tiles is remembered, and not one of them may carry the glyph.
    let disguised = 0;
    for (const state of CORPUS) {
      const grid = state.world.floor.grid;
      const board = presentScene(state).grid;
      for (let index = 0; index < grid.tiles.length; index += 1) {
        if (grid.tiles[index].kind !== 'cache') continue;
        const at = { x: index % grid.width, y: Math.floor(index / grid.width) };
        const lit = hasBeenLit(state.lantern.vision, at.x, at.y);
        const cell = cellAt(board, at.x, at.y);
        if (lit) continue;
        expect(cell.glyph, `cache at (${at.x}, ${at.y}) drawn unlit`).not.toBe(GLYPHS.ember);
        expect(cell.fg).not.toBe('ember');
        // Non-vacuity, counted rather than assumed: this loop must actually have met a cache the
        // player had felt but never lit, or it is asserting about tiles nobody has been near.
        if (hasTile(state.lantern.vision.remembered, at.x, at.y)) disguised += 1;
      }
    }
    expect(disguised, 'no run in the corpus ever felt an unlit cache').toBeGreaterThan(0);
  });
});

describe('the marks on the board are the creatures the simulation counts (ADR-0009)', () => {
  it('agrees exactly, over every state of two real runs', () => {
    // ADR-0009 keys auto-travel's stop rule to the *count* of perceived creatures, on the grounds
    // that "more marks than there were" is checkable by looking at the screen. That is only true
    // while the counted list and the drawn list are the same list. The ADR names the drift modes —
    // the player counted as a creature, a 0-HP creature not yet resolved, liveness filtered in one
    // place and not the other — and says to assert rather than assume. This is the assertion.
    let withMarks = 0;
    for (const state of CORPUS) {
      const marks = presentScene(state).grid.cells.filter(
        (cell) => cell.fg === 'contact' || cell.fg === 'creature',
      ).length;
      expect(marks).toBe(perceivedCreatureCount(state));
      if (marks > 0) withMarks += 1;
    }
    expect(withMarks).toBeGreaterThan(10);
  });

  it('never marks the player as a creature', () => {
    for (const state of CORPUS) {
      const player = state.world.actors.find((actor) => actor.kind === 'player')!.at;
      const cell = cellAt(presentScene(state).grid, player.x, player.y);
      expect(cell.fg).toBe('player');
    }
  });

  it('stops marking a creature the moment it is dead, before phase 5 removes it', () => {
    // GDD §2 puts deaths at phase 5, so a creature killed in phase 1 sits at 0 HP for the rest of
    // the turn. It is out of the schedule and does not occupy its tile; drawing a mark for it would
    // show a contact that is not there, and would make the ADR-0009 count disagree with the board.
    const lines = ['#######', '#@.#.c#', '#######'];
    const alive = scenarioState(lines, { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS });
    const id = alive.scenario.ids[0];
    const corpse = stateFrom(
      withActor(alive.state.world, withHp(creatureById(alive.state.world, id), 0)),
      { shutter: 'shuttered', senseRadius: EMBER_SENSE_RADIUS },
    );

    expect(perceivedCreatureCount(alive.state)).toBe(1);
    expect(perceivedCreatureCount(corpse)).toBe(0);
    const at = alive.scenario.at('c');
    expect(cellAt(presentScene(corpse).grid, at.x, at.y).glyph).not.toBe(GLYPHS.contact);
  });
});

describe('telegraphs (GDD §2, §4)', () => {
  const lines = ['#########', '#@.C....#', '#########'];

  function declaring(intent: Parameters<typeof awaken>[2], shutter: 'open' | 'shuttered') {
    const built = scenarioState(lines, { shutter, perceive: false });
    const id = built.scenario.ids[0];
    return stateFrom(awaken(built.state.world, id, intent), { shutter });
  }

  it('marks a declared attack with brackets and a fill', () => {
    const state = declaring({ kind: 'attack', at: { x: 2, y: 1 } }, 'open');
    const cell = cellAt(presentScene(state).grid, 2, 1);

    expect(cell.telegraph).toEqual(ATTACK_TELEGRAPH);
    expect(cell.bg).toBe('telegraphAttack');
    expect(cell.bgAlpha).toBe(ATTACK_TELEGRAPH.fill);
  });

  it('marks a declared move differently on both non-colour channels', () => {
    const state = declaring({ kind: 'move', to: { x: 2, y: 1 } }, 'open');
    const cell = cellAt(presentScene(state).grid, 2, 1);

    expect(cell.telegraph).toEqual(MOVE_TELEGRAPH);
    expect(cell.bg).toBe('telegraphMove');
    expect(cell.telegraph!.frame).not.toBe(ATTACK_TELEGRAPH.frame);
    expect(cell.bgAlpha).not.toBe(ATTACK_TELEGRAPH.fill);
  });

  it('marks nothing for a declared wait', () => {
    const state = declaring({ kind: 'wait' }, 'open');
    expect(presentScene(state).grid.cells.every((cell) => cell.telegraph === null)).toBe(true);
  });

  it('hides the intent of a creature too far away to be felt at all', () => {
    // The weak half of the shuttered rule, and it is worth being explicit that it is the weak half:
    // this creature is at Chebyshev 2 with the shuttered sense radius of 1, so nothing perceives it
    // and no map downstream of `perceive` ever has an entry for it. It is aimed at a
    // `gatherTelegraphs` that read `world.actors` instead of the perceived set — every creature on
    // the floor telegraphing through the dark — but **the adjacent test below kills that mutant
    // too**, measured rather than assumed: planting it turns both tests red. So this one is
    // redundant rather than load-bearing, and is kept only because it is cheap and states the far
    // case explicitly. Do not treat it as a unique guard. The *adjacent* case, where the creature
    // really is perceived, is the one §4's table turns on.
    const state = declaring({ kind: 'attack', at: { x: 2, y: 1 } }, 'shuttered');
    expect(perceivedCreatureCount(state)).toBe(0);
    expect(presentScene(state).grid.cells.every((cell) => cell.telegraph === null)).toBe(true);
  });

  it('hides the intent of a creature standing right beside you in the dark', () => {
    // §4's table: "Enemy intent | Visible | **Hidden**". §2: "Fighting dark means fighting an
    // opponent whose plan is fixed and unknown" — which is the reason light is worth 4 fuel a turn.
    //
    // THE ARRANGEMENT IS THE POINT. Adjacent, so the creature *is* felt and every map downstream of
    // `perceive` has an entry for its tile; and the tile it has marked is the player's own, which
    // the touch radius certainly perceives. So `gatherTelegraphs`'s two conditions — a creature in
    // `identified`, a marked tile in the perceived set — are both satisfiable, and the single thing
    // standing between the player and their attacker's plan is `identified` being built from
    // `contacts.get(index) === 'seen'` rather than from `contacts.has(index)`. Relax that one token
    // and the player is shown an attack telegraph on the tile they are standing on, in the dark.
    const built = scenarioState(['#####', '#@c.#', '#####'], {
      shutter: 'shuttered',
      perceive: false,
    });
    const state = stateFrom(
      awaken(built.state.world, built.scenario.ids[0], { kind: 'attack', at: { x: 1, y: 1 } }),
      { shutter: 'shuttered' },
    );
    const scene = presentScene(state);

    // Live in every way but the one under test: the creature is felt and drawn, it is awake with a
    // declared attack, and the tile it marked is perceived. Without these the test would pass for
    // the same irrelevant reason the one above does.
    expect(cellAt(scene.grid, 2, 1).glyph).toBe(GLYPHS.contact);
    expect(creatureById(state.world, built.scenario.ids[0]).mind.kind).toBe('awake');
    expect(cellAt(scene.grid, 1, 1).state).toBe('visible');

    expect(cellAt(scene.grid, 1, 1).telegraph).toBeNull();
    expect(scene.grid.cells.every((cell) => cell.telegraph === null)).toBe(true);
    expect(scene.grid.cells.every((cell) => cell.bgAlpha === 0)).toBe(true);
  });

  it('does not mark a tile the player is not perceiving', () => {
    // The intent below is deliberately one the behaviour rules would never declare — an attack eight
    // tiles away. `awaken` exists so a test can state an intent without the behaviour that chose it
    // (see `tests/unit/support/scenario.ts`), and the rule under test is the renderer's: a mark on
    // an unperceived tile draws a box in the dark and hands out a tile of free map knowledge.
    const state = declaring({ kind: 'attack', at: { x: 7, y: 1 } }, 'open');
    expect(cellAt(presentScene(state).grid, 7, 1).state).not.toBe('visible');
    expect(cellAt(presentScene(state).grid, 7, 1).telegraph).toBeNull();
  });

  it('never marks a cell in a shuttered run, and does mark one in a lit fight', () => {
    for (const { state, cell } of everyCell(CORPUS)) {
      if (cell.telegraph === null) continue;
      expect(state.lantern.vision.shutter).toBe('open');
      expect(cell.state).toBe('visible');
    }
    expect(everyCell(litDeath()).some(({ cell }) => cell.telegraph !== null)).toBe(true);
  });
});

describe('presentScene is a pure function of the state it was given', () => {
  it('returns the same board twice for the same state', () => {
    for (const state of CORPUS.slice(0, 40)) {
      expect(presentScene(state)).toEqual(presentScene(state));
    }
  });

  it('does not mutate the state', () => {
    // Deep-frozen, so an in-place write throws at the line that did it rather than surfacing as a
    // replay divergence a fortnight later — the same instrument `game/core/purity.test.ts` uses.
    const state = deepFreeze(CORPUS[CORPUS.length - 1]);
    expect(() => presentScene(state)).not.toThrow();
  });

  it('ignores `previous` entirely when deciding what the board looks like', () => {
    // `previous` is an optimisation. Handing it a scene from a completely different floor must
    // change object identity and nothing else — a reuse predicate that got this wrong would leave
    // the player looking at a stale board with nothing failing anywhere.
    const hostile = presentScene(CORPUS[0]);
    for (const state of CORPUS.slice(-20)) {
      expect(presentScene(state, hostile)).toEqual(presentScene(state));
    }
  });

  it('hands out no simulation objects', () => {
    // The seam, checked structurally: a cell holds primitives and one flat telegraph. A component
    // that could reach a `Tile` or an `Actor` could ask it a question, and the answer would be a
    // game rule living in `components/` (ADR-0003).
    for (const { cell } of everyCell(CORPUS.slice(0, 5))) {
      for (const [key, value] of Object.entries(cell)) {
        if (key === 'telegraph') continue;
        expect(['string', 'number'], `${key}`).toContain(typeof value);
      }
      if (cell.telegraph !== null) {
        expect(Object.keys(cell.telegraph).sort()).toEqual(['fill', 'frame', 'kind']);
      }
    }
  });
});

describe('cell identity is stable across turns (#20: an unchanged cell must not re-render)', () => {
  it('reuses the previous object for every cell whose picture is unchanged', () => {
    // The exact property, rather than a percentage that would flake with the seed: if two
    // consecutive cells are `sameCell`, they must be the *same* cell. That is what makes
    // `React.memo` with the default comparator sufficient in `components/`.
    const states = darkDive('memo', 2);
    let scene: Scene | null = null;
    let reused = 0;
    let replaced = 0;

    for (const state of states) {
      const next: Scene = presentScene(state, scene);
      if (scene !== null && scene.grid.width === next.grid.width) {
        for (let i = 0; i < next.grid.cells.length; i += 1) {
          const before = scene.grid.cells[i];
          const after = next.grid.cells[i];
          if (sameCell(before, after)) {
            expect(after, `cell ${i}`).toBe(before);
            reused += 1;
          } else {
            expect(after).not.toBe(before);
            replaced += 1;
          }
        }
      }
      scene = next;
    }

    expect(reused).toBeGreaterThan(0);
    // And the board really does change, or "everything was reused" would be a green vacuous test.
    expect(replaced).toBeGreaterThan(0);
  });

  it('hands back the very same grid when nothing on the board moved', () => {
    // A turn that changes only the HUD — fuel ticking down while nothing else happens — should cost
    // the grid nothing at all, not 165 identity comparisons that all fail.
    const state = CORPUS[10];
    const first = presentScene(state);
    const second = presentScene(state, first);
    expect(second.grid).toBe(first.grid);
    expect(second.grid.cells).toBe(first.grid.cells);
  });

  it('reuses nothing across a change of board size', () => {
    // Not reachable in M1 — every floor is 11×15 — but a previous grid of a different shape is a
    // different board, and indexing into it would pair up unrelated cells.
    const { state } = scenarioState(['###', '#@#', '###'], { shutter: 'shuttered' });
    const small = presentScene(state);
    const big = presentScene(CORPUS[0], small);
    // Each board is its own size — the 3x3 scenario stays nine cells, the generated floor stays
    // FLOOR_WIDTH x FLOOR_HEIGHT — and each `cells` array matches the dimensions it is published
    // with. That last one is the contract `cellAt` indexes on: a grid reporting one shape while
    // carrying another's cells hands back the wrong cell for every lookup instead of throwing.
    for (const grid of [small.grid, big.grid]) {
      expect(grid.cells).toHaveLength(grid.width * grid.height);
    }
    expect(small.grid.cells).toHaveLength(3 * 3);
    expect(big.grid.cells).toHaveLength(FLOOR_WIDTH * FLOOR_HEIGHT);
    expect(big.grid.width).not.toBe(small.grid.width);
    for (const cell of big.grid.cells) expect(small.grid.cells).not.toContain(cell);
  });
});

/** Freeze a value and everything reachable from it. Mirrors `game/core/purity.test.ts`. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
