import { describe, expect, it } from 'vitest';
import {
  exitCount,
  findCorridors,
  findDeadEnds,
  findSoundnessProblems,
  isPinch,
  isReachable,
  isSound,
  passableIndices,
  reachableFrom,
  DOORWAY,
  FLOOR,
  PILLAR,
  WALL,
  type Grid,
  type Tile,
} from '@/game/map';

/**
 * These tests exist so the property suite in `generate.test.ts` cannot pass vacuously.
 *
 * The generator uses `isSound` to decide where a pillar may go, and the property tests use the same
 * module to assert the finished floor is legal. If `isSound` were broken to always return `true`,
 * both would sail through. So every function here is checked against grids built by hand, whose
 * answers are known by inspection and were **not** produced by the generator — including grids that
 * are deliberately unsound, because a checker that cannot say "no" is not a checker.
 */

const PARSE: Record<string, Tile> = {
  '#': WALL,
  '.': FLOOR,
  o: PILLAR,
  '+': DOORWAY,
};

/** Build a grid from an ASCII picture. Rows must be equal length. */
function gridOf(rows: readonly string[]): Grid {
  const width = rows[0].length;
  const tiles: Tile[] = [];
  for (const row of rows) {
    if (row.length !== width) throw new Error(`ragged test grid: "${row}"`);
    for (const char of row) {
      const tile = PARSE[char];
      if (!tile) throw new Error(`unknown test glyph "${char}"`);
      tiles.push(tile);
    }
  }
  return { width, height: rows.length, tiles };
}

// A 5x4 room, walled. The shape the generator actually produces, and the baseline for "sound".
const ROOM = ['#######', '#.....#', '#.....#', '#.....#', '#######'];

// Two rooms sharing a one-tile doorway. GDD §5 calls this a threshold and allows it explicitly.
const TWO_ROOMS_ONE_DOORWAY = [
  '#########',
  '#...#...#',
  '#...+...#',
  '#...#...#',
  '#########',
];

// The same two rooms joined by a two-tile passage. That is a corridor and is forbidden.
const TWO_ROOMS_CORRIDOR = [
  '##########',
  '#...##...#',
  '#...++...#',
  '#...##...#',
  '##########',
];

// A room with a one-tile nub. (3,2) can only be left the way it was entered.
const ROOM_WITH_NUB = ['#####', '#..##', '#...#', '#..##', '#####'];

describe('grid parsing (the test helper itself)', () => {
  it('rejects ragged and unknown input, so a malformed fixture fails loudly', () => {
    expect(() => gridOf(['##', '#'])).toThrow(/ragged/);
    expect(() => gridOf(['#?'])).toThrow(/unknown test glyph/);
  });

  it('places tiles row-major', () => {
    const grid = gridOf(['#.', 'o+']);
    expect(grid.tiles.map((t) => t.kind)).toEqual(['wall', 'floor', 'pillar', 'doorway']);
  });
});

describe('passableIndices', () => {
  it('lists floor and doorway but not wall or pillar, in ascending order', () => {
    const grid = gridOf(['#.o+']);
    expect(passableIndices(grid)).toEqual([1, 3]);
  });
});

describe('exitCount', () => {
  it('counts only the four orthogonal neighbours', () => {
    // The centre of a 3x3 block of floor has four exits; the diagonals are irrelevant to a
    // 4-directional game (§9) and counting them would make every corner look open.
    const grid = gridOf(['...', '...', '...']);
    expect(exitCount(grid, 1, 1)).toBe(4);
    expect(exitCount(grid, 0, 0)).toBe(2);
  });

  it('treats out of bounds as no exit', () => {
    const grid = gridOf(['..']);
    expect(exitCount(grid, 0, 0)).toBe(1);
  });

  it('treats a pillar as no exit', () => {
    const grid = gridOf(['.o.', 'o.o', '.o.']);
    expect(exitCount(grid, 1, 1)).toBe(0);
  });
});

describe('isPinch', () => {
  it('is true for a through-passage', () => {
    const grid = gridOf(['#.#', '#.#', '#.#']);
    expect(isPinch(grid, 1, 1)).toBe(true);
  });

  it('is FALSE for a corner, where the two exits meet at a right angle', () => {
    // The distinction the whole corridor rule rests on. Every tile of a 2x2 room has exactly two
    // exits; if "two exits" alone counted as a passage, a 2x2 room would read as a corridor.
    const grid = gridOf(['..', '..']);
    expect(isPinch(grid, 0, 0)).toBe(false);
    expect(isPinch(grid, 1, 1)).toBe(false);
  });

  it('is false for an open tile and for a wall', () => {
    const grid = gridOf(['...', '...', '...']);
    expect(isPinch(grid, 1, 1)).toBe(false);
    expect(isPinch(gridOf(['#']), 0, 0)).toBe(false);
  });
});

describe('reachableFrom', () => {
  it('reaches everything in a connected room and nothing beyond a wall', () => {
    const grid = gridOf(['..#..']);
    const reached = reachableFrom(grid, { x: 0, y: 0 });
    expect(reached).toEqual([true, true, false, false, false]);
  });

  it('flows through a doorway', () => {
    const grid = gridOf(TWO_ROOMS_ONE_DOORWAY);
    const reached = reachableFrom(grid, { x: 1, y: 1 });
    expect(reached.filter(Boolean)).toHaveLength(passableIndices(grid).length);
  });

  it('throws when asked to fill from a wall, rather than reporting nothing reachable', () => {
    expect(() => reachableFrom(gridOf(['#.']), { x: 0, y: 0 })).toThrow(/impassable/);
  });
});

describe('isReachable', () => {
  it('is true across a doorway and false across a wall', () => {
    const joined = gridOf(TWO_ROOMS_ONE_DOORWAY);
    expect(isReachable(joined, { x: 1, y: 1 }, { x: 7, y: 3 })).toBe(true);

    const split = gridOf(['#########', '#...#...#', '#...#...#', '#########']);
    expect(isReachable(split, { x: 1, y: 1 }, { x: 7, y: 2 })).toBe(false);
  });

  it('is false when the destination is a pillar', () => {
    expect(isReachable(gridOf(['.o.']), { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});

describe('findDeadEnds', () => {
  it('finds a one-tile nub off a room', () => {
    const grid = gridOf(ROOM_WITH_NUB);
    // (3,2) has one exit, west — the definition of a turn with one legal move.
    expect(findDeadEnds(grid)).toEqual([{ x: 3, y: 2 }]);
  });

  it('finds an isolated tile, which has no exits at all', () => {
    expect(findDeadEnds(gridOf(['###', '#.#', '###']))).toEqual([{ x: 1, y: 1 }]);
  });

  it('finds nothing in a plain room', () => {
    expect(findDeadEnds(gridOf(ROOM))).toEqual([]);
  });
});

describe('findCorridors', () => {
  it('reports two adjacent through-passages once, not twice', () => {
    const grid = gridOf(TWO_ROOMS_CORRIDOR);
    expect(findCorridors(grid)).toEqual([[{ x: 4, y: 2 }, { x: 5, y: 2 }]]);
  });

  it('does not report a single doorway — a threshold is allowed', () => {
    expect(findCorridors(gridOf(TWO_ROOMS_ONE_DOORWAY))).toEqual([]);
  });

  it('does not report a 2x2 room, whose tiles all have exactly two exits', () => {
    expect(findCorridors(gridOf(['####', '#..#', '#..#', '####']))).toEqual([]);
  });

  it('reports a vertical corridor as well as a horizontal one', () => {
    const grid = gridOf(['###', '...', '#.#', '#.#', '...', '###']);
    expect(findCorridors(grid)).toEqual([[{ x: 1, y: 2 }, { x: 1, y: 3 }]]);
  });
});

describe('findSoundnessProblems', () => {
  it('reports nothing for a plain room, or for two rooms joined by a threshold', () => {
    expect(findSoundnessProblems(gridOf(ROOM))).toEqual([]);
    expect(findSoundnessProblems(gridOf(TWO_ROOMS_ONE_DOORWAY))).toEqual([]);
  });

  it('names the disconnection, including how much is stranded', () => {
    const grid = gridOf(['#########', '#...#...#', '#...#...#', '#########']);
    const problems = findSoundnessProblems(grid);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not connected: 6 of 12 passable tiles/);
  });

  it('names the corridor and both of its tiles', () => {
    expect(findSoundnessProblems(gridOf(TWO_ROOMS_CORRIDOR))).toEqual([
      'corridor: through-passages at (4, 2) and (5, 2) are adjacent',
    ]);
  });

  it('names a dead end and its position', () => {
    expect(findSoundnessProblems(gridOf(ROOM_WITH_NUB))).toEqual([
      'dead end at (3, 2): fewer than two exits',
    ]);
  });

  it('reports a grid with no passable tiles at all rather than crashing', () => {
    expect(findSoundnessProblems(gridOf(['##', '##']))).toEqual(['no passable tiles at all']);
  });
});

/**
 * `isSound` is a hand-optimized re-implementation of `findSoundnessProblems(g).length === 0` — see
 * its docstring for why. These are the tests that stop the two from drifting apart, which matters
 * because the generator trusts the fast one and the property suite asserts the slow one.
 */
describe('isSound agrees with findSoundnessProblems', () => {
  const CASES: [string, string[]][] = [
    ['plain room', ROOM],
    ['threshold', TWO_ROOMS_ONE_DOORWAY],
    ['corridor', TWO_ROOMS_CORRIDOR],
    ['disconnected', ['#########', '#...#...#', '#...#...#', '#########']],
    ['dead end', ROOM_WITH_NUB],
    ['solid rock', ['##', '##']],
    ['2x2 room', ['####', '#..#', '#..#', '####']],
    ['vertical corridor', ['###', '...', '#.#', '#.#', '...', '###']],
    ['isolated tile', ['###', '#.#', '###']],
  ];

  for (const [name, rows] of CASES) {
    it(`agrees on: ${name}`, () => {
      const grid = gridOf(rows);
      expect(isSound(grid)).toBe(findSoundnessProblems(grid).length === 0);
    });
  }

  it('agrees on every single-tile perturbation of a room grid', () => {
    // The generator's actual question is "what if I put a pillar here?", asked of every floor tile
    // in turn. This asks it exhaustively, which is the strongest available guard against the fast
    // path disagreeing on a shape nobody thought to write down.
    const base = gridOf([
      '###########',
      '#....#....#',
      '#....+....#',
      '#....#....#',
      '#.#######.#',
      '#.........#',
      '###########',
    ]);
    let differed = 0;
    let unsound = 0;
    for (let index = 0; index < base.tiles.length; index += 1) {
      const tiles = base.tiles.slice();
      tiles[index] = PILLAR;
      const probe: Grid = { ...base, tiles };
      const fast = isSound(probe);
      const slow = findSoundnessProblems(probe).length === 0;
      if (fast !== slow) differed += 1;
      if (!fast) unsound += 1;
    }
    expect(differed).toBe(0);
    // Some perturbations must be unsound, or the loop above proved nothing about disagreement on
    // the "no" answer.
    expect(unsound).toBeGreaterThan(10);
  });
});

describe('isSound', () => {
  it('says no to an empty grid rather than vacuously yes', () => {
    expect(isSound(gridOf(['##']))).toBe(false);
  });

  it('says yes to a plain room and no to each way a floor can be illegal', () => {
    expect(isSound(gridOf(ROOM))).toBe(true);
    expect(isSound(gridOf(TWO_ROOMS_CORRIDOR))).toBe(false);
    expect(isSound(gridOf(ROOM_WITH_NUB))).toBe(false);
    expect(isSound(gridOf(['#########', '#...#...#', '#...#...#', '#########']))).toBe(false);
  });
});
