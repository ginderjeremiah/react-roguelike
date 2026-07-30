import { describe, expect, it } from 'vitest';
import {
  CINDER,
  CREATURES,
  creatureDefinition,
  DESCENT_HEAL,
  EMBER_SENSE_GLYPH,
  PLAYER_ATTACK,
  PLAYER_MAX_HP,
} from './index';
import { DORMANT_STRIKE_MULTIPLIER } from '../systems/combat';

/**
 * Table tests over the content. The job is to make a malformed definition fail *here*, at the point
 * it is written, rather than as `NaN` HP inside a fight three systems away.
 *
 * Two kinds of assertion, and they fail for different reasons:
 *
 *   - **Shape** — every row is well formed, whatever the numbers are. These keep working when
 *     someone retunes the Cinder, which is explicitly allowed (§3: numbers marked *(tuning)* change
 *     freely from playtest evidence).
 *   - **The GDD's numbers, spelled out literally.** These *do* fail on a retune, on purpose: they
 *     are the paired edit that stops the code and the design document drifting apart silently. A
 *     failure here means updating the GDD table in the same change, not deleting the test.
 */

describe('the creature table', () => {
  it.each(CREATURES.map((definition) => [definition.name, definition] as const))(
    '%s is a well-formed definition',
    (_name, definition) => {
      expect(Number.isSafeInteger(definition.maxHp)).toBe(true);
      expect(definition.maxHp).toBeGreaterThan(0);
      expect(Number.isSafeInteger(definition.attack)).toBe(true);
      // A creature with 0 attack cannot threaten anything, which makes fuel free (§4's first tuning
      // invariant: "avoiding all combat must be unsustainable").
      expect(definition.attack).toBeGreaterThan(0);
      expect(Number.isSafeInteger(definition.emberDrop)).toBe(true);
      // §4: fuel comes from kills. A creature that drops nothing is a fight with no income.
      expect(definition.emberDrop).toBeGreaterThan(0);
      expect(definition.name.length).toBeGreaterThan(0);
    },
  );

  it.each(CREATURES.map((definition) => [definition.name, definition] as const))(
    '%s carries dormancy in case and shape, not colour (§11)',
    (_name, definition) => {
      expect(definition.glyphDormant).toHaveLength(1);
      expect(definition.glyphAwake).toHaveLength(1);
      // The rule that matters: the two states must be distinguishable with the colour turned off.
      expect(definition.glyphAwake).not.toBe(definition.glyphDormant);
      expect(definition.glyphAwake).toBe(definition.glyphDormant.toUpperCase());
      expect(definition.glyphDormant).toBe(definition.glyphDormant.toLowerCase());
      // §4: ember-sense reports position only. A species-specific sense glyph would leak identity
      // through walls, which is the information the design deliberately cut.
      expect(definition.glyphDormant).not.toBe(EMBER_SENSE_GLYPH);
      expect(definition.glyphAwake).not.toBe(EMBER_SENSE_GLYPH);
    },
  );

  it('has no duplicate kind and no duplicate glyph', () => {
    // Two rows sharing a kind would make `creatureDefinition` silently authoritative about which
    // one wins; two sharing a glyph would make them indistinguishable on the grid.
    const kinds = CREATURES.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(CREATURES.length);
    const glyphs = CREATURES.flatMap((d) => [d.glyphDormant, d.glyphAwake]);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('resolves every kind in the table to that exact row', () => {
    for (const definition of CREATURES) {
      expect(creatureDefinition(definition.kind)).toBe(definition);
    }
  });

  it('matches GDD §6 for the Cinder', () => {
    // Pinned literally. If a playtest retunes the Cinder, this test and the GDD table change
    // together — that pairing is the whole point of writing the numbers out twice.
    expect(CINDER.maxHp).toBe(5);
    expect(CINDER.attack).toBe(2);
    expect(CINDER.emberDrop).toBe(30);
    expect(CINDER.glyphDormant).toBe('c');
    expect(CINDER.glyphAwake).toBe('C');
    expect(EMBER_SENSE_GLYPH).toBe('*');
  });
});

describe("the player's numbers", () => {
  it('match GDD §3', () => {
    expect(PLAYER_MAX_HP).toBe(12);
    expect(PLAYER_ATTACK).toBe(3);
    expect(DESCENT_HEAL).toBe(2);
  });

  it('make a dormant Cinder a one-strike kill and an awake one a two-strike fight', () => {
    // §3 states both consequences in prose, and they are what the whole light/dark wager is priced
    // against: "a dormant Cinder dies to one strike and costs 0 HP. An awake Cinder takes two
    // strikes and costs 2-4 HP." A retune that quietly made the dormant strike a two-hit kill would
    // delete the payoff for playing dark without touching a rule.
    expect(PLAYER_ATTACK * DORMANT_STRIKE_MULTIPLIER).toBeGreaterThanOrEqual(CINDER.maxHp);
    expect(PLAYER_ATTACK).toBeLessThan(CINDER.maxHp);
    expect(PLAYER_ATTACK * 2).toBeGreaterThanOrEqual(CINDER.maxHp);
  });

  it('lets the player survive at least three hits from a Cinder', () => {
    // Not a GDD sentence — a floor on the sanity of any future retune. At 12 HP against 2 attack a
    // botched fight costs a fraction of the bar; a table where one Cinder could kill from full
    // would be a different game and should not arrive by accident.
    expect(PLAYER_MAX_HP).toBeGreaterThan(CINDER.attack * 3);
  });
});
