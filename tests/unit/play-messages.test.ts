import { describe, expect, it } from 'vitest';
import { CUE_KINDS, type Cue } from '@/render';
import { beginRun, cuesOf, setShutter } from '@/session';
import { BLOCKED_MESSAGE, describeCue, describeTurn } from '@/components/play/messages';

/**
 * The line under the board, which is GDD §2's feedback surface: "a refused tap must still produce
 * feedback — a tap that does nothing at all reads on a phone as 'the touch did not register'".
 *
 * One `Cue` of each kind, built by hand. `render/cues.test.ts` proves the simulation emits them; what
 * is proved here is that none of them renders as `undefined`.
 */

const SAMPLES: Readonly<Record<Cue['kind'], Cue>> = {
  refused: { kind: 'refused' },
  descended: { kind: 'descended', toFloor: 3 },
  shutterChanged: { kind: 'shutterChanged', to: 'open' },
  playerMoved: { kind: 'playerMoved', from: { x: 1, y: 1 }, to: { x: 1, y: 2 } },
  damaged: { kind: 'damaged', at: { x: 2, y: 2 }, who: 'player', amount: 2 },
  died: { kind: 'died', at: { x: 2, y: 2 }, who: 'creature' },
  fuelGained: { kind: 'fuelGained', amount: 25 },
};

describe('every cue has copy', () => {
  it('covers `CUE_KINDS` exhaustively, at runtime as well as at compile time', () => {
    // The switch in `describeCue` is exhaustive by type today, but a `default` branch added later
    // would silence the compiler while leaving a new cue kind narrating nothing. `CUE_KINDS` is
    // exported for exactly this check.
    expect(Object.keys(SAMPLES).sort()).toEqual([...CUE_KINDS].sort());
    for (const kind of CUE_KINDS) {
      const sentence = describeCue(SAMPLES[kind]);
      expect(sentence === null || typeof sentence === 'string', kind).toBe(true);
      expect(String(sentence), kind).not.toContain('undefined');
    }
  });

  it('says something for a refusal, because §2 requires the tap be acknowledged', () => {
    // The one cue that MUST have copy. A `null` here is a dead tap, which on a phone reads as a
    // missed touch — "a UI failure wearing the costume of a rule".
    expect(describeCue({ kind: 'refused' })).toBeTruthy();
    expect(BLOCKED_MESSAGE).toBeTruthy();
  });

  it('stays silent about a move, which the board says better', () => {
    // Narrating every step would push the useful sentence off the line on the commonest action in
    // the game.
    expect(describeCue(SAMPLES.playerMoved)).toBeNull();
  });

  it('puts the numbers a player needs into the sentence', () => {
    expect(describeCue(SAMPLES.damaged)).toContain('2');
    expect(describeCue(SAMPLES.fuelGained)).toContain('25');
    expect(describeCue(SAMPLES.descended)).toContain('3');
    expect(describeCue({ ...SAMPLES.damaged, who: 'creature' } as Cue)).not.toBe(
      describeCue(SAMPLES.damaged),
    );
  });
});

describe('a whole turn is one sentence', () => {
  it('reports the end of the turn’s story, not its beginning', () => {
    // `CUE_KINDS` is in emission order — board, lamp, player, blows, bodies, spoils — so the last
    // sentence is the newest news. A turn that opens the shutter and then takes a hit must say the
    // hit; a first-match implementation says "the shutter opens" and swallows the damage.
    const turn: readonly Cue[] = [SAMPLES.shutterChanged, SAMPLES.playerMoved, SAMPLES.damaged];
    expect(describeTurn(turn)).toBe(describeCue(SAMPLES.damaged));
  });

  it('clears the line when a turn has nothing to say', () => {
    // Otherwise last turn's "You take 2." sits under the board while the player walks away from the
    // thing that hit them.
    expect(describeTurn([])).toBeNull();
    expect(describeTurn([SAMPLES.playerMoved])).toBeNull();
  });

  it('renders a real refusal off a real run', () => {
    // End to end through `session/`, with no hand-built cue: the opening lantern is already open, so
    // re-asserting `open` is refused (§2) and the run comes back with the refusal cue on it.
    const run = beginRun('messages');
    expect(describeTurn(cuesOf(setShutter(run, 'open')))).toBe(describeCue({ kind: 'refused' }));
  });
});
