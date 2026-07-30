import { describe, expect, it } from 'vitest';
import {
  COLUMN_SEPARATOR_X,
  COLUMN_SPANS,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  LATTICE_EDGES,
  LATTICE_EDGE_IDS,
  MERGEABLE_EDGE_IDS,
  ROOM_COLUMNS,
  ROOM_COUNT,
  ROOM_ROWS,
  ROW_SEPARATOR_Y,
  ROW_SPANS,
  roomColumn,
  roomIdAt,
  roomRow,
} from '@/game/map';

/**
 * The lattice is a table of constants, so these are table tests: they recompute what the constants
 * claim from first principles and compare. A typo in a span or an edge would otherwise produce a
 * generator that still runs and still passes "is it connected", just with a wall in the wrong place
 * on every floor forever.
 */

describe('grid dimensions', () => {
  it('is exactly 11 x 15 (GDD §5, derived from the screen)', () => {
    // Not an arbitrary number: 11 columns is what gives ~35px tap targets on a 390px phone with no
    // panning (Pillar 3). Changing it needs an ADR, per issue #13.
    expect(FLOOR_WIDTH).toBe(11);
    expect(FLOOR_HEIGHT).toBe(15);
  });

  it('is a 2 x 3 room lattice', () => {
    expect(ROOM_COLUMNS).toBe(2);
    expect(ROOM_ROWS).toBe(3);
    expect(ROOM_COUNT).toBe(6);
    expect(COLUMN_SPANS).toHaveLength(ROOM_COLUMNS);
    expect(ROW_SPANS).toHaveLength(ROOM_ROWS);
  });
});

describe('spans tile the grid', () => {
  it('every column is either exactly one room column or the separator', () => {
    const owner: string[] = new Array<string>(FLOOR_WIDTH).fill('');
    COLUMN_SPANS.forEach((span, index) => {
      for (let x = span.min; x <= span.max; x += 1) {
        expect(owner[x]).toBe(''); // no overlap
        owner[x] = `room column ${index}`;
      }
    });
    expect(owner[COLUMN_SEPARATOR_X]).toBe('');
    owner[COLUMN_SEPARATOR_X] = 'separator';

    expect(owner.filter((entry) => entry === '')).toEqual([]); // no gaps
  });

  it('every row is either exactly one room row or a separator', () => {
    const owner: string[] = new Array<string>(FLOOR_HEIGHT).fill('');
    ROW_SPANS.forEach((span, index) => {
      for (let y = span.min; y <= span.max; y += 1) {
        expect(owner[y]).toBe('');
        owner[y] = `room row ${index}`;
      }
    });
    for (const y of ROW_SEPARATOR_Y) {
      expect(owner[y]).toBe('');
      owner[y] = 'separator';
    }

    expect(owner.filter((entry) => entry === '')).toEqual([]);
  });

  it('room columns are 5 wide and room rows are 4, 5, 4 tall', () => {
    // The middle band carries the row that GDD §5's `4 + 1 + 4 + 1 + 4` arithmetic is missing —
    // that sum is 14, and the bolded grid size is 15. See the header of lattice.ts. If this test
    // is failing because someone "fixed" the bands back to 4/4/4, FLOOR_HEIGHT must change too,
    // and that is an ADR-level decision.
    expect(COLUMN_SPANS.map((s) => s.max - s.min + 1)).toEqual([5, 5]);
    expect(ROW_SPANS.map((s) => s.max - s.min + 1)).toEqual([4, 5, 4]);
  });

  it('there is exactly one separator column and two separator rows', () => {
    expect(ROW_SEPARATOR_Y).toHaveLength(ROOM_ROWS - 1);
    expect(ROW_SEPARATOR_Y).toEqual([4, 10]);
    expect(COLUMN_SEPARATOR_X).toBe(5);
  });

  it('rooms are flush with the screen edge — there is no perimeter wall', () => {
    expect(COLUMN_SPANS[0].min).toBe(0);
    expect(COLUMN_SPANS[ROOM_COLUMNS - 1].max).toBe(FLOOR_WIDTH - 1);
    expect(ROW_SPANS[0].min).toBe(0);
    expect(ROW_SPANS[ROOM_ROWS - 1].max).toBe(FLOOR_HEIGHT - 1);
  });
});

describe('room ids', () => {
  it('are row-major and round-trip', () => {
    const seen: number[] = [];
    for (let row = 0; row < ROOM_ROWS; row += 1) {
      for (let column = 0; column < ROOM_COLUMNS; column += 1) {
        const id = roomIdAt(column, row);
        expect(roomColumn(id)).toBe(column);
        expect(roomRow(id)).toBe(row);
        seen.push(id);
      }
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('lattice edges', () => {
  /** Every orthogonally adjacent pair of lattice cells, derived independently of LATTICE_EDGES. */
  function expectedAdjacencies(): string[] {
    const pairs: string[] = [];
    for (let row = 0; row < ROOM_ROWS; row += 1) {
      for (let column = 0; column < ROOM_COLUMNS; column += 1) {
        const id = roomIdAt(column, row);
        if (column + 1 < ROOM_COLUMNS) pairs.push(`${id}-${roomIdAt(column + 1, row)}`);
        if (row + 1 < ROOM_ROWS) pairs.push(`${id}-${roomIdAt(column, row + 1)}`);
      }
    }
    return pairs.sort();
  }

  it('covers every adjacent room pair exactly once, and nothing else', () => {
    expect(LATTICE_EDGES.map((edge) => `${edge.rooms[0]}-${edge.rooms[1]}`).sort()).toEqual(
      expectedAdjacencies(),
    );
    expect(LATTICE_EDGES).toHaveLength(7);
  });

  it('has ids equal to its own indices, since the generator indexes by id', () => {
    LATTICE_EDGES.forEach((edge, index) => expect(edge.id).toBe(index));
    expect(LATTICE_EDGE_IDS).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('lists room pairs in ascending order', () => {
    for (const edge of LATTICE_EDGES) expect(edge.rooms[0]).toBeLessThan(edge.rooms[1]);
  });

  it('names the wall that actually separates the two rooms', () => {
    for (const edge of LATTICE_EDGES) {
      const [a, b] = edge.rooms;
      if (roomRow(a) === roomRow(b)) {
        // Side by side: they share the separator column.
        expect(edge.wall).toEqual({ kind: 'column', x: COLUMN_SEPARATOR_X });
        expect(Math.abs(roomColumn(a) - roomColumn(b))).toBe(1);
      } else {
        // Stacked: they share the separator row between their two bands.
        expect(edge.wall.kind).toBe('row');
        expect(roomColumn(a)).toBe(roomColumn(b));
        const upper = Math.min(roomRow(a), roomRow(b));
        expect(edge.wall).toEqual({ kind: 'row', y: ROW_SEPARATOR_Y[upper] });
      }
    }
  });

  it('a spanning tree of the room graph needs 5 of the 7 edges, leaving exactly 2 spare', () => {
    // The generator's fixed draw count depends on this: "1-2 loop doorways" is only a fixed-shape
    // choice because there are always exactly two leftover edges.
    expect(LATTICE_EDGES.length - (ROOM_COUNT - 1)).toBe(2);
  });

  it('only stacked pairs may merge, and every stacked pair may', () => {
    // §5 describes a merge as producing "a 5x9 hall", which only a stacked pair can produce.
    const stacked = LATTICE_EDGES.filter((edge) => edge.wall.kind === 'row').map((edge) => edge.id);
    expect([...MERGEABLE_EDGE_IDS].sort()).toEqual(stacked.sort());
    expect(MERGEABLE_EDGE_IDS).toHaveLength(4);
  });
});
