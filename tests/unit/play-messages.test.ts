import { describe, expect, it } from 'vitest';
import { CUE_KINDS, type Cue } from '@/render';
import { beginRun, cuesOf, sceneOf, setShutter } from '@/session';
import {
  BLOCKED_MESSAGE,
  describeCue,
  describeTurn,
  descendHint,
  RUN_OVER_MESSAGE,
  TOO_FAR_MESSAGE,
  wakeMessage,
} from '@/components/play/messages';

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
  woke: { kind: 'woke', at: { x: 3, y: 4 } },
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
    // §13's refusal has no cue at all — `render/taps.ts` empties the tap list at the ending, so the
    // press never reaches `step`. This string is therefore the *only* acknowledgement it has, and an
    // empty one would take the run-loop E2E's refusal assertion vacuous along with it: it would
    // match both "nothing has been refused yet" and "the refusal was acknowledged".
    expect(RUN_OVER_MESSAGE).toBeTruthy();
    expect(RUN_OVER_MESSAGE).not.toBe(BLOCKED_MESSAGE);
    // §9's third cueless refusal: a tap further away than a neighbour. Same argument as the
    // run-over case, and found the same way — by someone doing it, not by the suite (#60).
    expect(TOO_FAR_MESSAGE).toBeTruthy();
  });

  it('gives each cueless refusal its own words', () => {
    // Three refusals never reach `step`, so none produces a cue and each has exactly one string
    // standing between it and silence. **They must differ from each other**, not merely be
    // non-empty: a player who taps a wall and then a distant tile and reads the same sentence
    // twice learns that the game says something when a tap fails, and nothing about which rule
    // they hit.
    //
    // It is also what keeps the E2E assertions sharp. The blocked spec matches /blocked/i and the
    // distant spec matches TOO_FAR_MESSAGE exactly; on shared copy one of those would start
    // passing for the wrong path, so the specs would stop distinguishing them exactly when the
    // code did.
    const refusals = [BLOCKED_MESSAGE, RUN_OVER_MESSAGE, TOO_FAR_MESSAGE];
    expect(new Set(refusals).size, 'every cueless refusal needs its own sentence').toBe(
      refusals.length,
    );
  });

  it('promises nothing about auto-travel', () => {
    // The one hard constraint on `TOO_FAR_MESSAGE`. ADR-0009 settles `travel(to)` and defers the
    // build to M2 (#65), so copy implying pathing advertises a feature that does not exist — and a
    // player who reads "not *yet*" taps distant tiles again, which is worse than the silence this
    // replaced.
    //
    // Word-level rather than a vibe check, so it can actually fail: it rejects both phrasings #60
    // itself proposed as bad, and the time-promises that carry the same implication without the
    // word "yet" (`Coming soon.`, `Try again later.`, `Not for now.`).
    expect(TOO_FAR_MESSAGE).not.toMatch(
      /travel|path|route|walk|way there|get there|yet|soon|later|for now/i,
    );
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

describe('a wake is announced with a number (§4, #79)', () => {
  it('spells one through six as words and never as digits', () => {
    // §4 ruled the count spoken, and spoken as a *word*: every existing numeral in this line
    // (`You take 3.`, `You gather 25 ember.`) is a quantity of a metered resource the HUD also
    // shows, so a digit reads as "check the meter". This is a count of bodies with no meter behind
    // it, and `2 things wake.` reads like a debug string.
    expect(wakeMessage(1)).toBe('Something wakes.');
    expect(wakeMessage(2)).toBe('Two things wake.');
    expect(wakeMessage(3)).toBe('Three things wake.');
    expect(wakeMessage(4)).toBe('Four things wake.');
    expect(wakeMessage(5)).toBe('Five things wake.');
    expect(wakeMessage(6)).toBe('Six things wake.');
    for (let n = 1; n <= 6; n += 1) expect(wakeMessage(n), `n=${n}`).not.toMatch(/\d/);
  });

  it('stays total above six, which §8 makes unreachable', () => {
    // §8 caps a floor at `min(2 + floor, 6)` creatures, so this cannot fire today. It exists so the
    // function is total without a throw — a crash here would land on the single most consequential
    // turn in the game — and it is deliberately **not** a live branch anybody should design for.
    expect(wakeMessage(7)).toBe('7 things wake.');
    expect(wakeMessage(12)).toBe('12 things wake.');
  });

  it('uses the rule’s own word, and names nothing', () => {
    // "wakes", not "stirs": *stirs* describes the beginning of waking, and under #83 the creature is
    // awake, has declared and is coming. It is also the vocabulary §2 phase 3, §4 and §6 all use,
    // and in a game with no tutorial the copy is the only place a rule can be taught.
    //
    // "things", not "Cinders": naming leaks nothing (a woken creature is lit or adjacent) but does
    // not scale — M3's mixed groups would need "A Cinder and two Ashwalkers wake." from a one-line
    // status bar. `died` already chose anonymity for the same reason.
    for (let n = 1; n <= 6; n += 1) {
      expect(wakeMessage(n), `n=${n}`).toMatch(/wakes?\./);
      expect(wakeMessage(n), `n=${n}`).not.toMatch(/stir|cinder|creature|enemy/i);
    }
  });

  it('fits the line at its longest, against copy that already ships', () => {
    // The status line holds `The shutter opens. Light spills out.` at 36 characters. The longest
    // wake sentence must not be the thing that starts truncating it.
    const longest = Math.max(...[1, 2, 3, 4, 5, 6].map((n) => wakeMessage(n).length));
    expect(longest).toBeLessThanOrEqual(
      describeCue({ kind: 'shutterChanged', to: 'open' })!.length,
    );
  });

  it('reads a single cue as one creature, because one cue is one creature', () => {
    // `render/cues.ts` emits one `woke` per creature, so `describeCue` on a lone cue is n = 1 by
    // construction rather than by default. A cue shape that aggregated a count would make this
    // sentence wrong on every turn that woke more than one.
    expect(describeCue(SAMPLES.woke)).toBe(wakeMessage(1));
  });

  it('counts the whole turn, so two woken creatures are two', () => {
    // The aggregation lives in `describeTurn` because only it sees the list. Without it a turn that
    // woke three would read "Something wakes.", the player would budget for one hunter and have
    // three — which is the failure §4 spells out.
    const two: readonly Cue[] = [SAMPLES.woke, { kind: 'woke', at: { x: 9, y: 9 } }];
    expect(describeTurn(two)).toBe('Two things wake.');
    expect(describeTurn([...two, { kind: 'woke', at: { x: 1, y: 9 } }])).toBe('Three things wake.');
  });

  it('outranks the shutter line, so a flash turn reports its outcome and not its input', () => {
    // The substantive precedence ruling. `shutterChanged` and `woke` fire on the same turn by
    // construction — you open the lantern, the light wakes what it touches — and only one line
    // fits. Under plain recency the shutter cue is emitted first and would still lose, so this test
    // is written with the shutter cue in the position recency would favour as well: it is the
    // *tier* that decides, not the order.
    const flash: readonly Cue[] = [SAMPLES.woke, SAMPLES.shutterChanged];
    expect(describeTurn(flash)).toBe(wakeMessage(1));
    expect(describeTurn(flash)).not.toBe(describeCue(SAMPLES.shutterChanged));

    // And in emission order, which is what a real turn produces.
    expect(describeTurn([SAMPLES.shutterChanged, SAMPLES.woke])).toBe(wakeMessage(1));
  });

  it('outranks the ember, the body and the stairs too', () => {
    // Everything below the wake's tier is either visible on the board or already on the HUD.
    expect(describeTurn([SAMPLES.woke, SAMPLES.fuelGained])).toBe(wakeMessage(1));
    expect(describeTurn([SAMPLES.woke, SAMPLES.died])).toBe(wakeMessage(1));
    expect(describeTurn([SAMPLES.descended, SAMPLES.woke])).toBe(wakeMessage(1));
  });

  it('loses to a blow the player took, and to the run ending', () => {
    // A turn can wake a sleeper *and* take a hit from something already awake (phase 3 wakes, phase
    // 4 swings). At 12 HP and 2-4 a blow the hit is the more urgent fact, and the woken creature
    // announces itself next turn by moving. Death outranks both.
    expect(describeTurn([SAMPLES.woke, SAMPLES.damaged])).toBe(describeCue(SAMPLES.damaged));

    const died: Cue = { kind: 'died', at: { x: 2, y: 2 }, who: 'player' };
    expect(describeTurn([SAMPLES.woke, SAMPLES.damaged, died])).toBe(describeCue(died));
  });

  it('takes the line from `You strike for 6.` on §3’s dormant strike, with no special branch', () => {
    // §3's surviving dormant strike, which falls out of the tier order rather than being written:
    // the strike is a `damaged` cue on a creature, which lives in recency, and `woke` is a tier
    // above it. The strike was chosen and is visible; the waking is the surprise. §4's change log
    // records this branch as unreachable at M1's numbers (6 damage against 5 HP), so a compound
    // sentence is deliberately not built — that would repeat #80's dead-branch defect.
    const struck: Cue = { kind: 'damaged', at: { x: 3, y: 4 }, who: 'creature', amount: 6 };
    expect(describeTurn([struck, SAMPLES.woke])).toBe(wakeMessage(1));
  });
});

describe('the descend control promises a floor that exists', () => {
  it('names the floor below, on every floor that has one', () => {
    expect(descendHint({ number: 1, last: 8 })).toBe('to floor 2');
    expect(descendHint({ number: 7, last: 8 })).toBe('to floor 8');
  });

  it('does not offer a floor 9 on the last floor', () => {
    // §13: "There is no floor 9 and there is no boss. The eighth descent *is* the ending." The
    // obvious `to floor ${n + 1}` is correct seven times and wrong on the one press that wins the
    // run — which is the worst possible place for the interface to describe the game incorrectly.
    const hint = descendHint({ number: 8, last: 8 });
    expect(hint).not.toContain('9');
    expect(hint).toMatch(/bottom/);
  });

  it('reads the last floor off the HUD rather than a literal 8', () => {
    // §5 calls the run length tuning, and `LAST_FLOOR` is where it lives. A hint that hard-coded 8
    // would start lying the day the number moves, on the same press as above.
    const floor = sceneOf(beginRun('descend')).hud.floor;
    expect(descendHint({ number: floor.last, last: floor.last })).toMatch(/bottom/);
    expect(descendHint({ number: 3, last: 4 })).toBe('to floor 4');
    expect(descendHint({ number: 4, last: 4 })).toMatch(/bottom/);
  });
});

describe('a whole turn is one sentence', () => {
  it('reports the end of the turn’s story, not its beginning', () => {
    // `CUE_KINDS` is in emission order — board, lamp, player, blows, bodies, spoils — so a
    // first-match implementation says "the shutter opens" and swallows everything after it.
    const turn: readonly Cue[] = [SAMPLES.shutterChanged, SAMPLES.playerMoved, SAMPLES.damaged];
    expect(describeTurn(turn)).toBe(describeCue(SAMPLES.damaged));
  });

  it('says you were hit on a turn you also dealt a blow', () => {
    // The bug this rule shipped with, and the reason the test above is not enough on its own: it
    // holds ONE `damaged` cue, and this needs two. `render/cues.ts` emits `damaged` by iterating
    // `world.actors` in ascending id order and the player is id 0, so the player's own cue is
    // always FIRST among a turn's blows — and last-wins always threw it away. Every turn in which
    // blows were traded said "You strike" and never "You take", which at 12 max HP is three silent
    // turns from death.
    const hitBack: Cue = { ...SAMPLES.damaged, who: 'creature', amount: 4 } as Cue;
    const turn: readonly Cue[] = [SAMPLES.damaged, hitBack];

    expect(describeTurn(turn)).toBe(describeCue(SAMPLES.damaged));
    expect(describeTurn(turn)).not.toBe(describeCue(hitBack));
  });

  it('says you were hit even when the turn ends in spoils', () => {
    // `fuelGained` is emitted after the blows, so recency alone reports the ember and not the wound.
    const turn: readonly Cue[] = [SAMPLES.damaged, SAMPLES.fuelGained];
    expect(describeTurn(turn)).toBe(describeCue(SAMPLES.damaged));
  });

  it('lets the run ending outrank being hit on the way out', () => {
    // Death is emitted before spoils, so last-wins could report "You gather 25 ember." on the turn
    // the run ended. Death outranks damage; damage outranks everything else; recency decides last.
    const died: Cue = { kind: 'died', who: 'player' } as Cue;
    const turn: readonly Cue[] = [SAMPLES.damaged, died, SAMPLES.fuelGained];
    expect(describeTurn(turn)).toBe(describeCue(died));
  });

  it('still reports the blow you struck when nothing hit you', () => {
    // The precedence must not turn into "always narrate the player" — a turn where you land a hit
    // and take none is the commonest combat turn there is.
    const struck: Cue = { ...SAMPLES.damaged, who: 'creature', amount: 4 } as Cue;
    expect(describeTurn([SAMPLES.playerMoved, struck])).toBe(describeCue(struck));
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
