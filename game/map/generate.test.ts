import { describe, expect, it } from 'vitest';
import { createRng, next, type Rng } from '@/game/rng';
import { findFieldDivergence, formatFieldDivergence } from '@/game/core';
import {
  manhattanDistance,
  COLUMN_SEPARATOR_X,
  COLUMN_SPANS,
  creatureCount,
  expectedDrawCount,
  findSoundnessProblems,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  generateFloor,
  LATTICE_EDGES,
  MAX_PILLARS_PER_ROOM,
  MERGEABLE_EDGE_IDS,
  renderFloorAscii,
  ROOM_COUNT,
  ROW_SEPARATOR_Y,
  ROW_SPANS,
  roomRow,
  type Floor,
  type Grid,
  type Position,
  type Room,
} from '@/game/map';

/**
 * The property suite for GDD §5. Every invariant §5 lists explicitly is checked over a corpus of
 * seeds, plus the structural claims the generator makes about itself.
 *
 * Two deliberate choices about how these are written:
 *
 * **The reachability check does not use `game/map`'s flood fill.** The headline invariant — "the
 * stairs are reachable from the entrance" — is verified with a breadth-first search written in this
 * file. Asserting it with the same code the generator uses to filter pillar placements would make
 * the two fail together and pass together, which is how a suite reports success while enforcing
 * nothing. `soundness.test.ts` covers that module against grids whose answers are known by hand.
 *
 * **Several tests assert that something varies.** A generator that ignored the RNG entirely, or
 * that never merged rooms, or that never placed a pillar, would satisfy every "nothing is broken"
 * property trivially. Those are the mutations that survive an all-negative suite, so there are
 * positive tests for each.
 */

function seeds(count: number, prefix = 'floor'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

const SEEDS = seeds(400);

let generated: { seed: string; floor: Floor }[] | null = null;

/**
 * The shared corpus of floors, built once on first use.
 *
 * Lazy rather than a module-level `const` for a reason mutation testing surfaced: a generator that
 * *throws* on some seed would blow up during module evaluation, and Vitest reports that as a
 * collection error reading "no tests" rather than as a named failing test. The suite still goes
 * red — but "no tests" is a much worse thing to read in CI than the name of the invariant that
 * broke. Built inside the first test that asks for it, the throw lands in a test with a name.
 */
function corpus(): { seed: string; floor: Floor }[] {
  generated ??= SEEDS.map((seed) => ({ seed, floor: generateFloor(createRng(seed), 1).value }));
  return generated;
}

/** Fails with the seed and a picture of the level, which is the difference between a bug report and a shrug. */
function context(seed: string, floor: Floor): string {
  return `seed "${seed}"\n${renderFloorAscii(floor)}`;
}

// --- independent implementations, used only by the tests ----------------------------------------

/** Breadth-first search over passable tiles. Written here on purpose — see the header. */
function reachableTiles(grid: Grid, from: Position): Set<string> {
  const passable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return false;
    const kind = grid.tiles[y * grid.width + x].kind;
    return kind !== 'wall' && kind !== 'pillar';
  };

  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Position[] = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!passable(x, y)) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ x, y });
    }
  }
  return seen;
}

function roomOf(floor: Floor, at: Position): Room | null {
  return (
    floor.rooms.find(
      (room) =>
        at.x >= room.x &&
        at.x < room.x + room.width &&
        at.y >= room.y &&
        at.y < room.y + room.height,
    ) ?? null
  );
}

/** Room adjacency rebuilt from the floor's own doorways and merge, independent of the generator. */
function roomAdjacency(floor: Floor, edges: 'all' | 'tree'): number[][] {
  const adjacency: number[][] = Array.from({ length: ROOM_COUNT }, () => []);
  const join = (a: number, b: number): void => {
    if (!adjacency[a].includes(b)) adjacency[a].push(b);
    if (!adjacency[b].includes(a)) adjacency[b].push(a);
  };
  for (const doorway of floor.doorways) {
    if (edges === 'tree' && doorway.origin !== 'tree') continue;
    join(doorway.rooms[0], doorway.rooms[1]);
  }
  if (floor.merge.kind === 'merged') {
    // A merged pair is ONE node, not two rooms joined by an edge (GDD §5, ruled during the
    // lattice correction). Contract them: anything adjacent to one half is adjacent to the other.
    // Written here as a contraction over the finished lists rather than mirroring the
    // implementation's incremental join, so the two are not the same code twice.
    const [a, b] = floor.merge.rooms;
    const union = [...new Set([...adjacency[a], ...adjacency[b], a, b])].sort((x, y) => x - y);
    for (const room of union) {
      if (room === a || room === b) continue;
      join(a, room);
      join(b, room);
    }
    join(a, b);
  }
  return adjacency;
}

function roomDistances(adjacency: readonly number[][], from: number): number[] {
  const distance = new Array<number>(ROOM_COUNT).fill(-1);
  distance[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of adjacency[queue[head]]) {
      if (distance[next] !== -1) continue;
      distance[next] = distance[queue[head]] + 1;
      queue.push(next);
    }
  }
  return distance;
}

/**
 * How many times the generator advanced the RNG, found by stepping a fresh copy until it matches.
 *
 * The only way to observe the draw count from outside, since `Rng` is a value and there is nothing
 * to instrument. Bounded so a runaway generator fails instead of hanging.
 */
function drawsTaken(from: Rng, to: Rng, limit = 500): number {
  let current = from;
  for (let steps = 0; steps <= limit; steps += 1) {
    if (
      current.s0 === to.s0 &&
      current.s1 === to.s1 &&
      current.s2 === to.s2 &&
      current.s3 === to.s3
    ) {
      return steps;
    }
    current = next(current).rng;
  }
  throw new Error(`generator advanced more than ${limit} steps`);
}

function tileKindAt(floor: Floor, at: Position): string {
  return floor.grid.tiles[at.y * FLOOR_WIDTH + at.x].kind;
}

function countTiles(floor: Floor, kind: string): number {
  return floor.grid.tiles.filter((tile) => tile.kind === kind).length;
}

// --- the invariants GDD §5 lists ----------------------------------------------------------------

describe('§5 invariant: the grid is exactly 11 x 15', () => {
  it('holds for every seed and every floor number', () => {
    for (const { seed, floor } of corpus()) {
      expect(floor.grid.width, context(seed, floor)).toBe(11);
      expect(floor.grid.height, context(seed, floor)).toBe(15);
      expect(floor.grid.tiles, context(seed, floor)).toHaveLength(11 * 15);
    }
    for (let number = 1; number <= 8; number += 1) {
      const floor = generateFloor(createRng(`depth-${number}`), number).value;
      expect(floor.grid.tiles).toHaveLength(FLOOR_WIDTH * FLOOR_HEIGHT);
    }
  });

  it('renders as 15 rows of 11 glyphs', () => {
    const lines = renderFloorAscii(corpus()[0].floor).split('\n');
    expect(lines).toHaveLength(15);
    for (const line of lines) expect(line).toHaveLength(11);
  });
});

describe('§5 invariant: every floor is connected, with no corridors', () => {
  it('holds for every seed', () => {
    for (const { seed, floor } of corpus()) {
      expect(findSoundnessProblems(floor.grid).join('\n'), context(seed, floor)).toBe('');
    }
  });

  it('holds for floors 1 through 8', () => {
    for (let number = 1; number <= 8; number += 1) {
      for (const seed of seeds(40, `deep-${number}`)) {
        const floor = generateFloor(createRng(seed), number).value;
        expect(findSoundnessProblems(floor.grid).join('\n'), context(seed, floor)).toBe('');
      }
    }
  });

  it('the check is not vacuous: it rejects a floor with a wall knocked into a corridor', () => {
    // If `findSoundnessProblems` were broken to always return [], the two tests above would pass on
    // any garbage. This proves it still says no.
    const { floor } = corpus()[0];
    const tiles = floor.grid.tiles.slice();
    // Seal every doorway. That strands rooms, which must be reported.
    for (const doorway of floor.doorways) {
      tiles[doorway.at.y * FLOOR_WIDTH + doorway.at.x] = { kind: 'wall' };
    }
    expect(findSoundnessProblems({ ...floor.grid, tiles }).length).toBeGreaterThan(0);
  });
});

describe('§5 invariant: the stairs are reachable from the entrance', () => {
  it('holds for every seed, checked with an independent flood fill', () => {
    for (const { seed, floor } of corpus()) {
      const reached = reachableTiles(floor.grid, floor.entrance);
      expect(reached.has(`${floor.stairs.x},${floor.stairs.y}`), context(seed, floor)).toBe(true);
    }
  });

  it('so is every cache and every creature', () => {
    for (const { seed, floor } of corpus()) {
      const reached = reachableTiles(floor.grid, floor.entrance);
      for (const cache of floor.caches) {
        expect(reached.has(`${cache.x},${cache.y}`), context(seed, floor)).toBe(true);
      }
      for (const creature of floor.creatures) {
        expect(reached.has(`${creature.at.x},${creature.at.y}`), context(seed, floor)).toBe(true);
      }
    }
  });

  it('the independent flood fill can fail: it does not reach a walled-off tile', () => {
    const { floor } = corpus()[0];
    const tiles = floor.grid.tiles.slice();
    for (const doorway of floor.doorways) {
      tiles[doorway.at.y * FLOOR_WIDTH + doorway.at.x] = { kind: 'wall' };
    }
    const sealed: Grid = { ...floor.grid, tiles };
    const reached = reachableTiles(sealed, floor.entrance);
    // With every doorway sealed the entrance can reach at most its own room (or its merged pair).
    expect(reached.size).toBeLessThan(30);
  });
});

describe('§5 invariant: no creature within 2 tiles of the entrance', () => {
  it('holds for every seed, at every floor number', () => {
    for (let number = 1; number <= 8; number += 1) {
      for (const seed of seeds(60, `spawn-${number}`)) {
        const floor = generateFloor(createRng(seed), number).value;
        for (const creature of floor.creatures) {
          expect(
            manhattanDistance(creature.at, floor.entrance),
            `${context(seed, floor)}\ncreature at ${JSON.stringify(creature.at)}`,
          ).toBeGreaterThan(2);
        }
      }
    }
  });

  it('and no creature is in the entrance room, or in the room merged with it', () => {
    for (const { seed, floor } of corpus()) {
      const entranceRoom = roomOf(floor, floor.entrance);
      expect(entranceRoom, context(seed, floor)).not.toBeNull();
      const forbidden = [entranceRoom!.id];
      if (floor.merge.kind === 'merged' && floor.merge.rooms.includes(entranceRoom!.id)) {
        forbidden.push(...floor.merge.rooms.filter((id) => id !== entranceRoom!.id));
      }
      for (const creature of floor.creatures) {
        const room = roomOf(floor, creature.at);
        expect(room, context(seed, floor)).not.toBeNull();
        expect(forbidden, context(seed, floor)).not.toContain(room!.id);
      }
    }
  });
});

describe('§5 invariant: the same seed produces the identical floor', () => {
  it('two independent generations are structurally identical', () => {
    for (const seed of seeds(60, 'determinism')) {
      const left = generateFloor(createRng(seed), 3);
      const right = generateFloor(createRng(seed), 3);
      const divergence = findFieldDivergence(left.value, right.value);
      expect(divergence ? formatFieldDivergence(divergence) : null).toBeNull();
      // The generator position must match too: a floor that looks the same but leaves the RNG
      // somewhere else has already diverged, it just has not surfaced yet.
      expect(left.rng).toEqual(right.rng);
    }
  });

  it('different seeds produce different floors', () => {
    // Without this, a generator that ignored the RNG entirely would pass every other test in this
    // file — including the determinism test above, which would then be comparing two copies of the
    // same constant.
    const rendered = seeds(200, 'variety').map(
      (seed) => `${renderFloorAscii(generateFloor(createRng(seed), 1).value)}`,
    );
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('a different floor number changes the floor', () => {
    const first = generateFloor(createRng('same-seed'), 1).value;
    const second = generateFloor(createRng('same-seed'), 5).value;
    expect(first.creatures.length).not.toBe(second.creatures.length);
    expect(first.floorNumber).toBe(1);
    expect(second.floorNumber).toBe(5);
  });

  it('generating does not mutate the caller’s Rng value', () => {
    const rng = createRng('immutability');
    const snapshot = { ...rng };
    generateFloor(rng, 1);
    expect(rng).toEqual(snapshot);
  });
});

// --- the plain-data contract --------------------------------------------------------------------

describe('a Floor is plain JSON-shaped data', () => {
  it('survives a JSON round trip unchanged', () => {
    // `findFieldDivergence` throws on any Map, Set, Date, or class instance, so this asserts the
    // shape rule as well as the round trip. A Floor is headed for GameState, where a non-plain
    // value would make the replay comparator report a false pass.
    for (const { seed, floor } of corpus().slice(0, 50)) {
      const divergence = findFieldDivergence(floor, JSON.parse(JSON.stringify(floor)) as Floor);
      expect(divergence ? `${seed}: ${formatFieldDivergence(divergence)}` : null).toBeNull();
    }
  });

  it('lists caches and creatures in canonical row-major order, not the order they were drawn', () => {
    // Found by mutation testing: deleting the sort in `generateFloor` broke nothing. Order matters
    // because the entity layer will assign actor ids from this array, and §2 breaks scheduler ties
    // by ascending actor id — so draw order would leak into turn order. Canonical order also keeps
    // two floors that differ only in *when* things were placed from comparing as different states.
    let outOfOrderIfUnsorted = 0;
    for (const { seed, floor } of corpus()) {
      const positions = [...floor.caches, ...floor.creatures.map((c) => c.at)];
      const ordered = (list: readonly Position[]): boolean =>
        list.every(
          (at, index) =>
            index === 0 ||
            list[index - 1].y < at.y ||
            (list[index - 1].y === at.y && list[index - 1].x < at.x),
        );
      expect(ordered(floor.caches), context(seed, floor)).toBe(true);
      expect(ordered(floor.creatures.map((c) => c.at)), context(seed, floor)).toBe(true);
      expect(positions.length).toBeGreaterThan(0);
      if (floor.caches.length > 1 || floor.creatures.length > 1) outOfOrderIfUnsorted += 1;
    }
    // The check above is only meaningful on floors with more than one of something to order.
    expect(outOfOrderIfUnsorted).toBe(corpus().length);
  });

  it('contains no undefined, NaN, or -0 anywhere', () => {
    const walk = (value: unknown, path: string): void => {
      if (value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
        return;
      }
      if (typeof value === 'number') {
        expect(Number.isNaN(value), `${path} is NaN`).toBe(false);
        expect(Object.is(value, -0), `${path} is -0`).toBe(false);
      }
      expect(value, `${path} is undefined`).not.toBeUndefined();
    };
    walk(corpus()[0].floor, 'floor');
  });
});

// --- the draw-count contract --------------------------------------------------------------------

describe('draw count', () => {
  it('is exactly expectedDrawCount(floorNumber), whatever the seed', () => {
    // The whole point of the no-rejection-sampling design in generate.ts. A stray conditional draw
    // added later fails here, at the change that introduced it, instead of silently shifting every
    // subsequent value in the run.
    for (let number = 1; number <= 8; number += 1) {
      for (const seed of seeds(50, `draws-${number}`)) {
        const rng = createRng(seed);
        const result = generateFloor(rng, number);
        expect(drawsTaken(rng, result.rng), `seed ${seed}, floor ${number}`).toBe(
          expectedDrawCount(number),
        );
      }
    }
  });

  it('grows only with the creature count', () => {
    expect(expectedDrawCount(2) - expectedDrawCount(1)).toBe(
      creatureCount(2) - creatureCount(1),
    );
    // Past floor 4 the creature count is capped, so the draw count stops moving entirely.
    expect(expectedDrawCount(5)).toBe(expectedDrawCount(8));
  });

  it('drawsTaken can fail — it does not just return whatever it is asked for', () => {
    const rng = createRng('probe');
    expect(drawsTaken(rng, rng)).toBe(0);
    expect(drawsTaken(rng, next(next(rng).rng).rng)).toBe(2);
    expect(() => drawsTaken(rng, createRng('unrelated'), 20)).toThrow(/advanced more than/);
  });
});

describe('argument validation', () => {
  it('rejects a floor number that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generateFloor(createRng('x'), bad)).toThrow(/positive integer/);
    }
  });

  it('validates before drawing, so a rejected call consumes no entropy', () => {
    // The corollary in rng/draw.ts: no function may consume entropy and then throw, because the
    // caller keeps the pre-call Rng and the partially consumed draw would vanish with the error.
    const rng = createRng('validation');
    expect(() => generateFloor(rng, 0)).toThrow();
    expect(rng).toEqual(createRng('validation'));
  });
});

// --- the generation steps -----------------------------------------------------------------------

describe('§5 step 1: rooms and jitter', () => {
  it('every room sits inside its lattice cell', () => {
    for (const { seed, floor } of corpus()) {
      expect(floor.rooms, context(seed, floor)).toHaveLength(ROOM_COUNT);
      for (const room of floor.rooms) {
        const xs = COLUMN_SPANS[room.column];
        const ys = ROW_SPANS[room.row];
        expect(room.x, context(seed, floor)).toBeGreaterThanOrEqual(xs.min);
        expect(room.x + room.width - 1, context(seed, floor)).toBeLessThanOrEqual(xs.max);
        expect(room.y, context(seed, floor)).toBeGreaterThanOrEqual(ys.min);
        expect(room.y + room.height - 1, context(seed, floor)).toBeLessThanOrEqual(ys.max);
      }
    }
  });

  it('jitter is at most one tile, and only ever away from the screen edge', () => {
    for (const { seed, floor } of corpus()) {
      for (const room of floor.rooms) {
        const xs = COLUMN_SPANS[room.column];
        const ys = ROW_SPANS[room.row];
        expect(xs.max - xs.min + 1 - room.width, context(seed, floor)).toBeLessThanOrEqual(1);
        expect(ys.max - ys.min + 1 - room.height, context(seed, floor)).toBeLessThanOrEqual(1);

        // The side facing the separator column never moves, so a doorway there always lands on
        // floor. This is what makes connectivity structural rather than something to check.
        if (room.column === 0) expect(room.x + room.width - 1, context(seed, floor)).toBe(xs.max);
        else expect(room.x, context(seed, floor)).toBe(xs.min);

        // Same for the separator rows: only a band touching the screen edge may pull back.
        if (room.row !== 0) expect(room.y, context(seed, floor)).toBe(ys.min);
        if (room.row !== 2) {
          expect(room.y + room.height - 1, context(seed, floor)).toBe(ys.max);
        }
      }
    }
  });

  it('middle-band rooms never jitter vertically, because the lattice does not allow it', () => {
    for (const { seed, floor } of corpus()) {
      for (const room of floor.rooms.filter((r) => r.row === 1)) {
        expect(room.y, context(seed, floor)).toBe(ROW_SPANS[1].min);
        expect(room.height, context(seed, floor)).toBe(ROW_SPANS[1].max - ROW_SPANS[1].min + 1);
      }
    }
  });

  it('jitter actually varies — it is not a decorative draw', () => {
    // A mutation that read the jitter draw and ignored it would pass every test above.
    const shapes = new Set(
      corpus().map(({ floor }) => floor.rooms.map((r) => `${r.x}:${r.y}:${r.width}:${r.height}`).join()),
    );
    expect(shapes.size).toBeGreaterThan(8);

    for (const room of [0, 1, 4, 5]) {
      const widths = new Set(corpus().map(({ floor }) => floor.rooms[room].width));
      const heights = new Set(corpus().map(({ floor }) => floor.rooms[room].height));
      expect(widths, `room ${room} width never varies`).toEqual(new Set([4, 5]));
      expect(heights, `room ${room} height never varies`).toEqual(new Set([3, 4]));
    }
  });

  it('every room is big enough that it cannot be a passage', () => {
    for (const { seed, floor } of corpus()) {
      for (const room of floor.rooms) {
        expect(room.width, context(seed, floor)).toBeGreaterThanOrEqual(4);
        expect(room.height, context(seed, floor)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('§5 steps 2 and 3: doorways', () => {
  it('there is at most one doorway per lattice edge', () => {
    for (const { seed, floor } of corpus()) {
      const edges = floor.doorways.map((doorway) => doorway.edge);
      expect(new Set(edges).size, context(seed, floor)).toBe(edges.length);
    }
  });

  it('every doorway sits in the wall of the edge it belongs to, and is a doorway tile', () => {
    for (const { seed, floor } of corpus()) {
      for (const doorway of floor.doorways) {
        const edge = LATTICE_EDGES[doorway.edge];
        expect(doorway.rooms, context(seed, floor)).toEqual(edge.rooms);
        if (edge.wall.kind === 'column') expect(doorway.at.x, context(seed, floor)).toBe(edge.wall.x);
        else expect(doorway.at.y, context(seed, floor)).toBe(edge.wall.y);
        expect(tileKindAt(floor, doorway.at), context(seed, floor)).toBe('doorway');
      }
      expect(countTiles(floor, 'doorway'), context(seed, floor)).toBe(floor.doorways.length);
    }
  });

  it('the tree doorways alone already connect all six rooms', () => {
    // §5 step 2: "Guarantees connectivity". The loops must be optional, not load-bearing.
    for (const { seed, floor } of corpus()) {
      const distance = roomDistances(roomAdjacency(floor, 'tree'), 0);
      expect(distance.filter((d) => d === -1), context(seed, floor)).toEqual([]);
    }
  });

  it('there are 1-2 loop doorways, and both counts occur', () => {
    const counts = new Set<number>();
    for (const { seed, floor } of corpus()) {
      const loops = floor.doorways.filter((doorway) => doorway.origin === 'loop').length;
      expect(loops, context(seed, floor)).toBeGreaterThanOrEqual(1);
      expect(loops, context(seed, floor)).toBeLessThanOrEqual(2);
      counts.add(loops);
    }
    expect(counts).toEqual(new Set([1, 2]));
  });

  it('loops really are loops: the room graph has a cycle', () => {
    // An "extra doorway" that duplicated a tree edge would add nothing. The escape route §5 asks
    // for only exists if the graph has more edges than a tree does.
    for (const { seed, floor } of corpus()) {
      const connections =
        floor.doorways.length + (floor.merge.kind === 'merged' ? 1 : 0);
      expect(connections, context(seed, floor)).toBeGreaterThan(ROOM_COUNT - 1);
    }
  });

  it('no two doorways are adjacent — a threshold is one tile, never a passage', () => {
    for (const { seed, floor } of corpus()) {
      const doors = new Set(floor.doorways.map((d) => `${d.at.x},${d.at.y}`));
      for (const doorway of floor.doorways) {
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ]) {
          expect(doors.has(`${doorway.at.x + dx},${doorway.at.y + dy}`), context(seed, floor)).toBe(
            false,
          );
        }
      }
    }
  });

  it('every doorway has exactly two exits, one into each room', () => {
    for (const { seed, floor } of corpus()) {
      for (const doorway of floor.doorways) {
        const edge = LATTICE_EDGES[doorway.edge];
        const [ax, ay] = edge.wall.kind === 'column' ? [-1, 0] : [0, -1];
        const before = { x: doorway.at.x + ax, y: doorway.at.y + ay };
        const after = { x: doorway.at.x - ax, y: doorway.at.y - ay };
        expect(roomOf(floor, before)?.id, context(seed, floor)).toBe(
          edge.wall.kind === 'column' ? edge.rooms[0] : edge.rooms[0],
        );
        expect(roomOf(floor, after)?.id, context(seed, floor)).toBe(edge.rooms[1]);
      }
    }
  });
});

describe('§5 step 4: room merges', () => {
  it('merges at most one stacked pair, and does so on some seeds but not all', () => {
    const merged = corpus().filter(({ floor }) => floor.merge.kind === 'merged');
    expect(merged.length).toBeGreaterThan(corpus().length * 0.3);
    expect(merged.length).toBeLessThan(corpus().length * 0.7);

    for (const { seed, floor } of merged) {
      if (floor.merge.kind !== 'merged') throw new Error('unreachable');
      expect(MERGEABLE_EDGE_IDS, context(seed, floor)).toContain(floor.merge.edge);
      const [a, b] = floor.merge.rooms;
      expect(Math.abs(roomRow(a) - roomRow(b)), context(seed, floor)).toBe(1);
    }
  });

  it('a merge opens the shared wall into a hall, and never also gets a doorway', () => {
    for (const { seed, floor } of corpus()) {
      if (floor.merge.kind !== 'merged') continue;
      const wall = LATTICE_EDGES[floor.merge.edge].wall;
      if (wall.kind !== 'row') throw new Error('a merged edge must be a stacked pair');

      const [above, below] = floor.merge.rooms.map((id) => floor.rooms[id]);
      const from = Math.max(above.x, below.x);
      const to = Math.min(above.x + above.width - 1, below.x + below.width - 1);
      expect(to - from + 1, context(seed, floor)).toBeGreaterThanOrEqual(4);

      // Opened over exactly the overlap and no further. A wider opening would leave a lip hanging
      // off the side of the hall where one room was jittered narrower than the other: still legal
      // ground, but not the rectangular 5-wide hall §5 describes. The far half of the same
      // separator row belongs to the other column's edge and may hold its doorway.
      const doors = new Set(floor.doorways.map((d) => `${d.at.x},${d.at.y}`));
      for (let x = 0; x < FLOOR_WIDTH; x += 1) {
        if (doors.has(`${x},${wall.y}`)) continue;
        const inside = x >= from && x <= to;
        expect(
          tileKindAt(floor, { x, y: wall.y }) === 'wall',
          `${context(seed, floor)}\nmerged row at (${x}, ${wall.y})`,
        ).toBe(!inside);
      }

      expect(
        floor.doorways.map((doorway) => doorway.edge),
        context(seed, floor),
      ).not.toContain(floor.merge.edge);
    }
  });

  it('an unmerged separator row stays solid except at its doorways', () => {
    for (const { seed, floor } of corpus()) {
      const mergedY =
        floor.merge.kind === 'merged'
          ? (LATTICE_EDGES[floor.merge.edge].wall as { kind: 'row'; y: number }).y
          : -1;
      const doors = new Set(floor.doorways.map((d) => `${d.at.x},${d.at.y}`));
      for (const y of ROW_SEPARATOR_Y) {
        if (y === mergedY) continue;
        for (let x = 0; x < FLOOR_WIDTH; x += 1) {
          if (doors.has(`${x},${y}`)) continue;
          expect(tileKindAt(floor, { x, y }), `${context(seed, floor)}\nat (${x}, ${y})`).toBe(
            'wall',
          );
        }
      }
    }
  });

  it('the separator column is solid except at its doorways — it can never merge', () => {
    for (const { seed, floor } of corpus()) {
      const doors = new Set(floor.doorways.map((d) => `${d.at.x},${d.at.y}`));
      for (let y = 0; y < FLOOR_HEIGHT; y += 1) {
        if (doors.has(`${COLUMN_SEPARATOR_X},${y}`)) continue;
        expect(tileKindAt(floor, { x: COLUMN_SEPARATOR_X, y }), context(seed, floor)).toBe('wall');
      }
    }
  });
});

describe('§5 step 5: pillars', () => {
  it('places at most two per room, all inside room interiors', () => {
    for (const { seed, floor } of corpus()) {
      const perRoom = new Array<number>(ROOM_COUNT).fill(0);
      for (let index = 0; index < floor.grid.tiles.length; index += 1) {
        if (floor.grid.tiles[index].kind !== 'pillar') continue;
        const at = { x: index % FLOOR_WIDTH, y: Math.floor(index / FLOOR_WIDTH) };
        const room = roomOf(floor, at);
        expect(room, `${context(seed, floor)}\npillar outside every room at ${at.x},${at.y}`).not.toBeNull();
        perRoom[room!.id] += 1;
      }
      for (const count of perRoom) {
        expect(count, context(seed, floor)).toBeLessThanOrEqual(MAX_PILLARS_PER_ROOM);
      }
    }
  });

  it('places roughly one per room on average — the safety filter is not silently rejecting everything', () => {
    // A mutation that made every candidate look unsafe would place zero pillars and break no other
    // test in this file; one that ignored the rolled count and always placed two would give 12.
    // A uniform 0-2 per room over six rooms has a mean of exactly 6, and the standard error over
    // this corpus is ~0.1, so the window below is roughly plus or minus five standard errors.
    const total = corpus().reduce((sum, { floor }) => sum + countTiles(floor, 'pillar'), 0);
    const average = total / corpus().length;
    expect(average).toBeGreaterThan(5.5);
    expect(average).toBeLessThan(6.5);
  });

  it('produces floors with 0, 1 and 2 pillars in a single room', () => {
    const seen = new Set<number>();
    for (const { floor } of corpus()) {
      for (const room of floor.rooms) {
        let count = 0;
        for (let y = room.y; y < room.y + room.height; y += 1) {
          for (let x = room.x; x < room.x + room.width; x += 1) {
            if (tileKindAt(floor, { x, y }) === 'pillar') count += 1;
          }
        }
        seen.add(count);
      }
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });
});

describe('§5 step 6: entrance and stairs', () => {
  it('there is exactly one entrance tile and one stairs tile, where the floor says they are', () => {
    for (const { seed, floor } of corpus()) {
      expect(countTiles(floor, 'entrance'), context(seed, floor)).toBe(1);
      expect(countTiles(floor, 'stairs'), context(seed, floor)).toBe(1);
      expect(tileKindAt(floor, floor.entrance), context(seed, floor)).toBe('entrance');
      expect(tileKindAt(floor, floor.stairs), context(seed, floor)).toBe('stairs');
    }
  });

  it('the stairs are in a room at the greatest graph distance from the entrance', () => {
    for (const { seed, floor } of corpus()) {
      const entranceRoom = roomOf(floor, floor.entrance)!;
      const stairsRoom = roomOf(floor, floor.stairs)!;
      const distance = roomDistances(roomAdjacency(floor, 'all'), entranceRoom.id);
      expect(distance[stairsRoom.id], context(seed, floor)).toBe(Math.max(...distance));
      expect(stairsRoom.id, context(seed, floor)).not.toBe(entranceRoom.id);
    }
  });

  it('the entrance is not always in the same room', () => {
    const rooms = new Set(corpus().map(({ floor }) => roomOf(floor, floor.entrance)!.id));
    expect(rooms.size).toBe(ROOM_COUNT);
  });
});

describe('§5 step 7 / §8: creatures', () => {
  it('spawns exactly min(2 + floor, 6)', () => {
    for (let number = 1; number <= 8; number += 1) {
      for (const seed of seeds(20, `count-${number}`)) {
        const floor = generateFloor(createRng(seed), number).value;
        expect(floor.creatures, `${seed} floor ${number}`).toHaveLength(
          Math.min(2 + number, 6),
        );
      }
    }
    expect(creatureCount(1)).toBe(3);
    expect(creatureCount(4)).toBe(6);
    expect(creatureCount(9)).toBe(6);
  });

  it('never stacks two creatures, and never puts one on a doorway or a feature tile', () => {
    for (const { seed, floor } of corpus()) {
      const seen = new Set<string>();
      for (const creature of floor.creatures) {
        const key = `${creature.at.x},${creature.at.y}`;
        expect(seen.has(key), context(seed, floor)).toBe(false);
        seen.add(key);
        // Plain floor only: a creature standing in the single threshold tile would be a blocked
        // passage, and one standing on the stairs or a cache would hide it.
        expect(tileKindAt(floor, creature.at), context(seed, floor)).toBe('floor');
      }
    }
  });

  it('all creatures are dormant Cinders (§6)', () => {
    for (const { floor } of corpus()) {
      for (const creature of floor.creatures) expect(creature.kind).toBe('cinder');
    }
  });
});

describe('§5 step 8: caches', () => {
  it('places 1-2, on cache tiles, never stacked', () => {
    const counts = new Set<number>();
    for (const { seed, floor } of corpus()) {
      expect(floor.caches.length, context(seed, floor)).toBeGreaterThanOrEqual(1);
      expect(floor.caches.length, context(seed, floor)).toBeLessThanOrEqual(2);
      counts.add(floor.caches.length);
      expect(countTiles(floor, 'cache'), context(seed, floor)).toBe(floor.caches.length);
      for (const cache of floor.caches) {
        expect(tileKindAt(floor, cache), context(seed, floor)).toBe('cache');
      }
    }
    expect(counts).toEqual(new Set([1, 2]));
  });

  it('is biased toward leaf rooms of the spanning tree, measurably', () => {
    // §5 step 8 wants caches off the main route. "Biased" is not "always", so this compares the
    // observed leaf share against what an unbiased placement would give on the same floors — a
    // mutation that dropped the weighting would land almost exactly on the unbiased figure.
    let inLeaf = 0;
    let total = 0;
    let unbiasedExpectation = 0;
    for (const { floor } of corpus()) {
      const adjacency = roomAdjacency(floor, 'tree');
      if (floor.merge.kind === 'merged') {
        // The merge is part of the spanning structure, exactly as the generator treats it.
        adjacency[floor.merge.rooms[0]].push(floor.merge.rooms[1]);
        adjacency[floor.merge.rooms[1]].push(floor.merge.rooms[0]);
      }
      const leaves = adjacency.map((list) => list.length === 1);
      for (const cache of floor.caches) {
        total += 1;
        if (leaves[roomOf(floor, cache)!.id]) inLeaf += 1;
        unbiasedExpectation += leaves.filter(Boolean).length / ROOM_COUNT;
      }
    }
    const observed = inLeaf / total;
    const unbiased = unbiasedExpectation / total;
    expect(observed).toBeGreaterThan(unbiased + 0.1);
  });
});

// --- pinned output -------------------------------------------------------------------------------

describe('pinned floors', () => {
  /**
   * Ground truth by definition: generated from this implementation, not derived from the design.
   * They cannot prove the generator is right, only that it has not *changed* — which is the thing a
   * stored replay depends on. A deliberate change to any rule or to the draw order means re-pinning
   * these and bumping `RULES_VERSION`.
   */
  it('seed "emberdepth", floor 1', () => {
    const floor = generateFloor(createRng('emberdepth'), 1).value;
    expect(renderFloorAscii(floor).split('\n')).toEqual([
      '###########',
      '#...o#...o#',
      '#....#....#',
      '#.<o.+....#',
      '#+######+##',
      '#....#>....',
      '#....#....c',
      '#....+..c$o',
      '#....#.....',
      '#....#.....',
      '#....######',
      'o.o..#....#',
      '.....#c...#',
      '.....+..$.#',
      '######....#',
    ]);
    expect(floor.entrance).toEqual({ x: 2, y: 3 });
    expect(floor.stairs).toEqual({ x: 6, y: 5 });
    expect(floor.merge).toEqual({ kind: 'merged', edge: 4, rooms: [2, 4] });
    expect(floor.caches).toEqual([
      { x: 9, y: 7 },
      { x: 8, y: 13 },
    ]);
  });

  it('seed "a", floor 1', () => {
    expect(renderFloorAscii(generateFloor(createRng('a'), 1).value).split('\n')).toEqual([
      '######$....',
      '#....#.....',
      '#.c>c+.....',
      '#....#.....',
      '##+#######+',
      '.....#.....',
      '.....#.....',
      'c....#.....',
      '.....#.....',
      '.....+.....',
      '#+####+####',
      '#....#....#',
      '#..o.+....#',
      '#....#....#',
      '######.<..#',
    ]);
  });
});

describe('§5 step 2-3: the room graph actually varies', () => {
  /**
   * Found in review, and the single most valuable gap in this suite.
   *
   * `chooseLinks` shuffles the candidate edges and runs Kruskal over the shuffled order. Replacing
   * `for (const id of order.value)` with `for (const id of LATTICE_EDGE_IDS)` — keeping the shuffle
   * so the draw count is untouched — passed all 370 tests. Every unmerged floor then gets the
   * identical spanning tree, forever.
   *
   * Nothing structural catches it: connectivity holds, the tree still spans, loops are still 1-2,
   * there are still no corridors, and floors still *look* different because jitter, pillars and
   * the entrance vary. But §5's whole premise is that "the mental map you build in the dark is
   * rooms and which wall the door was in" — a fixed room graph is precisely the failure that rule
   * exists to prevent, and it is the one structure that had no variance test.
   */
  it('produces many different spanning trees', () => {
    const trees = new Set(
      corpus().map(({ floor }) =>
        floor.doorways
          .filter((d) => d.origin === 'tree')
          .map((d) => d.edge)
          .sort((a, b) => a - b)
          .join('-'),
      ),
    );

    // 15 of the 21 five-edge subsets of the 7 lattice edges are spanning trees; the corpus reaches
    // most of them. A fixed-order Kruskal collapses this to 1.
    expect(trees.size).toBeGreaterThan(6);
  });

  it('produces many different room graphs once loops and merges are counted', () => {
    const graphs = new Set(
      corpus().map(({ floor }) => {
        const edges = floor.doorways
          .map((d) => `${d.origin[0]}${d.edge}`)
          .sort()
          .join(',');
        const merge = floor.merge.kind === 'merged' ? `m${floor.merge.edge}` : 'm-';
        return `${edges}|${merge}`;
      }),
    );
    expect(graphs.size).toBeGreaterThan(20);
  });
});

describe('§5 step 6: the stairs tie-break is a draw, not the lowest room id', () => {
  /**
   * Found in review. `placeStairs`'s docstring states the rule explicitly — "ties are broken by a
   * draw among the tied rooms, ascending by id — not by taking the lowest id, which would make
   * some rooms systematically likelier to hold the stairs on symmetric layouts."
   *
   * Replacing `chooseFrom(rng, tied)` with `chooseFrom(rng, tied.slice(0, 1))` — the exact
   * anti-pattern the comment warns against, same draw count — passed all 370 tests. Ties are not
   * rare: roughly a third of floors have more than one room at maximum distance.
   *
   * A stated design rule with no test is the thing that gets "simplified away" in six months.
   */
  it('does not always pick the lowest-id room among those tied at maximum distance', () => {
    let tiedFloors = 0;
    let pickedNonLowest = 0;

    for (const { floor } of corpus()) {
      const entranceRoom = roomOf(floor, floor.entrance)!;
      const stairsRoom = roomOf(floor, floor.stairs)!;
      const distance = roomDistances(roomAdjacency(floor, 'all'), entranceRoom.id);
      const farthest = Math.max(...distance);
      const tied = distance
        .map((d, id) => ({ d, id }))
        .filter(({ d }) => d === farthest)
        .map(({ id }) => id);

      if (tied.length < 2) continue;
      tiedFloors += 1;
      if (stairsRoom.id !== Math.min(...tied)) pickedNonLowest += 1;
    }

    // The corpus must actually exercise the tie, or this test proves nothing.
    expect(tiedFloors, 'no floor in the corpus had a tie — this test is vacuous').toBeGreaterThan(10);
    expect(pickedNonLowest).toBeGreaterThan(0);
  });
});
