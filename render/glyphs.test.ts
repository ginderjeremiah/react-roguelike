import { describe, expect, it } from 'vitest';
import { CINDER, EMBER_SENSE_GLYPH } from '@/game/content';
import { TILE_KINDS, type Tile } from '@/game/map';
import { GLYPHS, glyphForCreature, glyphForTile } from './glyphs';
import type { CreatureActor } from '@/game/entities';

/**
 * The glyph table is content, and content is what a player learns. These tests exist to make a
 * silent change to it impossible: a glyph is the primary carrier of meaning on a colourblind-safe
 * board (§11), so "the wall became a `.`" is a gameplay regression, not a cosmetic one.
 */

/** Every tile kind, as a `Tile`. `TILE_KINDS` is the fixed order; this is the values. */
const TILES: readonly Tile[] = TILE_KINDS.map((kind) => ({ kind }) as Tile);

function creature(mind: CreatureActor['mind']): CreatureActor {
  return {
    kind: 'creature',
    id: 1,
    species: 'cinder',
    at: { x: 0, y: 0 },
    hp: 5,
    maxHp: 5,
    attack: 2,
    mind,
  };
}

describe('the glyph set (GDD §10)', () => {
  it('is exactly the codepoints §10 names', () => {
    // Escapes rather than literals: `game/map/debug.ts` avoids `·` and `♦` entirely so a pinned
    // expectation cannot break on a platform's text encoding. Here the glyphs *are* the product, so
    // they are written out — and pinned by codepoint, which is encoding-proof and still enforcing.
    expect(GLYPHS.player).toBe('@'); // @
    expect(GLYPHS.wall).toBe('#'); // #
    expect(GLYPHS.floor).toBe('·'); // · MIDDLE DOT
    expect(GLYPHS.pillar).toBe('o'); // o
    expect(GLYPHS.stairs).toBe('>'); // >
    expect(GLYPHS.ember).toBe('♦'); // ♦ BLACK DIAMOND SUIT
    expect(GLYPHS.contact).toBe('*'); // *
    // §10 names no glyph for these two; `game/map/debug.ts` already uses the conventions.
    expect(GLYPHS.doorway).toBe('+'); // +
    expect(GLYPHS.entrance).toBe('<'); // <
    expect(GLYPHS.blank).toBe(' ');
  });

  it('draws every glyph in exactly one character, so the grid stays a grid', () => {
    // A two-character glyph is not a rendering bug that shows up in a unit test; it is a cell that
    // is wider than its neighbours in a monospaced grid, which is the one thing this whole
    // presentation approach depends on not happening.
    for (const [name, glyph] of Object.entries(GLYPHS)) {
      expect([...glyph], name).toHaveLength(1);
    }
    expect([...glyphForCreature(creature({ kind: 'dormant' }))]).toHaveLength(1);
    expect([...glyphForCreature(creature({ kind: 'awake', intent: { kind: 'wait' }, awareness: { kind: 'none' }, turnsSinceContact: 0 }))]).toHaveLength(1);
  });

  it('gives every tile kind its own glyph, and no two the same', () => {
    // Two tile kinds sharing a glyph would make a pillar and a wall the same object to the player —
    // and they are not: §5 gives the pillar three distinct properties.
    const glyphs = TILES.map(glyphForTile);
    expect(glyphs).toHaveLength(TILE_KINDS.length);
    expect(new Set(glyphs).size).toBe(TILE_KINDS.length);
  });

  it('never draws a terrain tile as the ember-sense contact', () => {
    // `*` means "a living thing is there and you cannot see what it is" (§4). If it were also a tile,
    // the one signal the dark gives would be ambiguous with stone.
    expect(TILES.map(glyphForTile)).not.toContain(GLYPHS.contact);
    expect(GLYPHS.contact).toBe(EMBER_SENSE_GLYPH);
  });

  it('never draws a terrain tile as the player', () => {
    expect(TILES.map(glyphForTile)).not.toContain(GLYPHS.player);
  });
});

describe('creature glyphs (GDD §6, §11)', () => {
  it('come from the creature table, so dormancy is carried by case rather than by colour', () => {
    const dormant = glyphForCreature(creature({ kind: 'dormant' }));
    const awake = glyphForCreature(
      creature({ kind: 'awake', intent: { kind: 'wait' }, awareness: { kind: 'none' }, turnsSinceContact: 0 }),
    );

    expect(dormant).toBe(CINDER.glyphDormant);
    expect(awake).toBe(CINDER.glyphAwake);
    // The §11 property, not the two letters: dormant and awake must not render identically. A
    // dormant creature is a free double-damage strike (§3) and an awake one is a threat; a player
    // who cannot tell them apart cannot make the decision the game is built on.
    expect(dormant).not.toBe(awake);
  });

  it('does not invent a glyph for a species — it reads the table', () => {
    // The test that keeps `render/` from being a place a second creature has to be registered.
    // If this file ever needs editing to add a creature, `game/content/`'s claim is false.
    expect(glyphForCreature(creature({ kind: 'dormant' }))).toBe(CINDER.glyphDormant);
  });
});
