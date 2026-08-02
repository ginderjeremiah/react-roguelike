import { describe, expect, it } from 'vitest';
import { CUE_KINDS, type Cue } from '@/render';
import { beginRun, cuesOf, descend, move, sceneOf, setShutter, wait, type Run } from '@/session';
import {
  diveToTheBottom,
  standUntilDead,
  walkInTheDarkThenFlash,
} from '@/tests/unit/support/run-script';
import {
  BLOCKED_MESSAGE,
  describeCue,
  describeTurn,
  descendHint,
  RUN_OVER_MESSAGE,
  TOO_FAR_MESSAGE,
  wakeMessage,
  type LineLevel,
  type TurnLine,
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

/**
 * The **words** of a cue, or of a whole turn, without the level beside them.
 *
 * Every assertion in this file predates #94 and is about copy; routing them through these two keeps
 * them reading as `toBe('You take 2.')` rather than as object comparisons, and keeps a copy failure
 * legible in the diff. The **levels** are asserted separately at the bottom of the file, over the
 * GDD's table and over real runs — deliberately not smuggled into these.
 */
function words(cue: Cue): string | null {
  return describeCue(cue)?.text ?? null;
}

function turnWords(cues: readonly Cue[]): string | null {
  return describeTurn(cues)?.text ?? null;
}

/**
 * Both levels, derived from a `Record` over the union rather than written as a list.
 *
 * A third level added to `LineLevel` is a type error here — which matters because every assertion
 * below that says "and everything else is a `report`" would otherwise quietly keep passing while a
 * whole tier went unchecked.
 */
const LEVEL_MEMBERS: Record<LineLevel, true> = { alarm: true, report: true };
const LEVELS = Object.keys(LEVEL_MEMBERS) as readonly LineLevel[];

/**
 * Every count a turn can wake. §8 caps a floor at `min(2 + floor, 6)` creatures, so six is the whole
 * reachable range above one and every loop below is total rather than a sample.
 */
const COUNTS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** `n` woken creatures, on distinct tiles, as `render/cues.ts` emits them: one cue per creature. */
function wokeCues(n: number): readonly Cue[] {
  return Array.from({ length: n }, (_, i) => ({ kind: 'woke', at: { x: i, y: 0 } }) as Cue);
}

describe('every cue has copy', () => {
  it('covers `CUE_KINDS` exhaustively, at runtime as well as at compile time', () => {
    // The switch in `describeCue` is exhaustive by type today, but a `default` branch added later
    // would silence the compiler while leaving a new cue kind narrating nothing. `CUE_KINDS` is
    // exported for exactly this check.
    //
    // It covers the **level** on the same pass (#94), and for the sharper version of the same
    // reason: a `default` branch would not merely mute a ninth cue kind, it would hand it the
    // quieter of the two volumes silently. A cue kind that ought to be an `alarm` arriving as a
    // `report` is the exact defect this issue was filed about, and it would look like nothing.
    expect(Object.keys(SAMPLES).sort()).toEqual([...CUE_KINDS].sort());
    for (const kind of CUE_KINDS) {
      const line = describeCue(SAMPLES[kind]);
      if (line === null) continue;
      expect(typeof line.text, kind).toBe('string');
      expect(line.text, kind).not.toContain('undefined');
      expect(LEVELS, `${kind} has no level`).toContain(line.level);
    }
  });

  it('says something for a refusal, because §2 requires the tap be acknowledged', () => {
    // The one cue that MUST have copy. A `null` here is a dead tap, which on a phone reads as a
    // missed touch — "a UI failure wearing the costume of a rule".
    expect(words({ kind: 'refused' })).toBeTruthy();
    // `.text`, not the object: a `TurnLine` is truthy even when its sentence is the empty string,
    // which is the one value that would make this assertion — and the E2E refusal assertions that
    // lean on it — pass while saying nothing at all.
    expect(BLOCKED_MESSAGE.text).toBeTruthy();
    // §13's refusal has no cue at all — `render/taps.ts` empties the tap list at the ending, so the
    // press never reaches `step`. This string is therefore the *only* acknowledgement it has, and an
    // empty one would take the run-loop E2E's refusal assertion vacuous along with it: it would
    // match both "nothing has been refused yet" and "the refusal was acknowledged".
    expect(RUN_OVER_MESSAGE.text).toBeTruthy();
    expect(RUN_OVER_MESSAGE.text).not.toBe(BLOCKED_MESSAGE.text);
    // §9's third cueless refusal: a tap further away than a neighbour. Same argument as the
    // run-over case, and found the same way — by someone doing it, not by the suite (#60).
    expect(TOO_FAR_MESSAGE.text).toBeTruthy();
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
    // The **sentences**, not the objects. Three distinct object literals are three distinct
    // members of a `Set` no matter what they say, so a `Set` of the constants themselves would
    // have made this test unable to fail the moment they stopped being strings (#94).
    const refusals = [BLOCKED_MESSAGE.text, RUN_OVER_MESSAGE.text, TOO_FAR_MESSAGE.text];
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
    expect(TOO_FAR_MESSAGE.text).not.toMatch(
      /travel|path|route|walk|way there|get there|yet|soon|later|for now/i,
    );
  });

  it('stays silent about a move, which the board says better', () => {
    // Narrating every step would push the useful sentence off the line on the commonest action in
    // the game.
    expect(words(SAMPLES.playerMoved)).toBeNull();
  });

  it('puts the numbers a player needs into the sentence', () => {
    expect(words(SAMPLES.damaged)).toContain('2');
    expect(words(SAMPLES.fuelGained)).toContain('25');
    expect(words(SAMPLES.descended)).toContain('3');
    expect(words({ ...SAMPLES.damaged, who: 'creature' } as Cue)).not.toBe(
      words(SAMPLES.damaged),
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

  it('reads a single cue as one creature, because one cue is one creature', () => {
    // `render/cues.ts` emits one `woke` per creature, so `describeCue` on a lone cue is n = 1 by
    // construction rather than by default. A cue shape that aggregated a count would make this
    // sentence wrong on every turn that woke more than one.
    expect(words(SAMPLES.woke)).toBe(wakeMessage(1));
  });

  it('counts the whole turn, so two woken creatures are two', () => {
    // The aggregation lives in `describeTurn` because only it sees the list. Without it a turn that
    // woke three would read "Something wakes.", the player would budget for one hunter and have
    // three — which is the failure §4 spells out.
    const two: readonly Cue[] = [SAMPLES.woke, { kind: 'woke', at: { x: 9, y: 9 } }];
    expect(turnWords(two)).toBe('Two things wake.');
    expect(turnWords([...two, { kind: 'woke', at: { x: 1, y: 9 } }])).toBe('Three things wake.');
  });

  it('outranks the shutter line, so a flash turn reports its outcome and not its input', () => {
    // The substantive precedence ruling. `shutterChanged` and `woke` fire on the same turn by
    // construction — you open the lantern, the light wakes what it touches — and only one line
    // fits. Under plain recency the shutter cue is emitted first and would still lose, so this test
    // is written with the shutter cue in the position recency would favour as well: it is the
    // *tier* that decides, not the order.
    const flash: readonly Cue[] = [SAMPLES.woke, SAMPLES.shutterChanged];
    expect(turnWords(flash)).toBe(wakeMessage(1));
    expect(turnWords(flash)).not.toBe(words(SAMPLES.shutterChanged));

    // And in emission order, which is what a real turn produces.
    expect(turnWords([SAMPLES.shutterChanged, SAMPLES.woke])).toBe(wakeMessage(1));
  });

  it('outranks the body and the stairs — but now shares the line with the ember (#107)', () => {
    // Everything below the wake's tier is either visible on the board or already on the HUD, with
    // **one exception**, and this test is where the exception was carved out. The `fuelGained`
    // assertion here used to read `toBe(wakeMessage(1))` — it pinned the bug #107 was filed about,
    // which is what a test written from the implementation gets you. The body and the stairs are
    // unchanged and are the control: they prove the compound is one pair rather than a mechanism.
    expect(turnWords([SAMPLES.woke, SAMPLES.fuelGained])).toBe(
      `${wakeMessage(1)} ${words(SAMPLES.fuelGained)}`,
    );
    expect(turnWords([SAMPLES.woke, SAMPLES.died])).toBe(wakeMessage(1));
    expect(turnWords([SAMPLES.descended, SAMPLES.woke])).toBe(wakeMessage(1));
  });

  it('loses to a blow the player took, and to the run ending', () => {
    // A turn can wake a sleeper *and* take a hit from something already awake (phase 3 wakes, phase
    // 4 swings). At 12 HP and 2-4 a blow the hit is the more urgent fact, and the woken creature
    // announces itself next turn by moving. Death outranks both.
    expect(turnWords([SAMPLES.woke, SAMPLES.damaged])).toBe(words(SAMPLES.damaged));

    const died: Cue = { kind: 'died', at: { x: 2, y: 2 }, who: 'player' };
    expect(turnWords([SAMPLES.woke, SAMPLES.damaged, died])).toBe(words(died));
  });

  it('takes the line from `You strike for 6.` on §3’s dormant strike, with no special branch', () => {
    // §3's surviving dormant strike, which falls out of the tier order rather than being written:
    // the strike is a `damaged` cue on a creature, which lives in recency, and `woke` is a tier
    // above it. The strike was chosen and is visible; the waking is the surprise. §4's change log
    // records this branch as unreachable at M1's numbers (6 damage against 5 HP), so a compound
    // sentence is deliberately not built — that would repeat #80's dead-branch defect.
    const struck: Cue = { kind: 'damaged', at: { x: 3, y: 4 }, who: 'creature', amount: 6 };
    expect(turnWords([struck, SAMPLES.woke])).toBe(wakeMessage(1));
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §10's ONE COMPOUND (#107) — a turn that both wakes and pays says both, in that order
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §4's cache rule (#31/#41) made the pickup condition *ever lit* while the shutter stayed a free
 * action, so opening the shutter on an unlit cache underfoot lights the tile and pays it on the same
 * press — and that press wakes what the light touches, because the flash is what lit the tile. The
 * wake tier outranks recency, so the turn read `Two things wake.` and the pickup was announced by
 * **nothing at all**: `FUEL 66 → 87`, no `♦` drawn for a frame, the only evidence a number that
 * moved.
 *
 * The ruling is a second clause, not a fourth tier: `Two things wake. You gather 21 ember.`, wake
 * first, both halves verbatim, at the wake's own level. The two player tiers never compound.
 */

/** A position for the cues that carry one. Nothing below reads it; it is shape, not data. */
const SOMEWHERE = { x: 0, y: 0 };

/**
 * Every amount the receipt can carry, enumerated rather than sampled.
 *
 * The ruling's measurement is `Three things wake. You gather 41 ember.`, and 41 is not arbitrary: it
 * is §4's `CACHE_FUEL` (25) plus a Cinder's drop (20) less a lit turn's burn (4), which is the
 * biggest ordinary net delta the simulation produces. Two digits at every reachable value, so this
 * range covers the whole of it with room to spare — and it is a **range** and not the number 41,
 * because a test that enumerated only the value the ruling happened to measure would stop being a
 * budget and become a transcript of one screenshot.
 */
const AMOUNTS: readonly number[] = Array.from({ length: 99 }, (_, i) => i + 1);

/**
 * §10's measured character budget for the row: `status-line.tsx` fits **41** mono characters at 14px
 * in 362pt of row at 390 wide.
 *
 * **This replaces the old "fits the line at its longest" assertion**, which was baselined against
 * `The shutter opens. Light spills out.` at 36 — a comparison the compound overturns, and which
 * would therefore have failed for the right reason at the wrong threshold. 41 is a *budget*, not a
 * fact about today's font: if the type ramp moves, this number is what gets re-derived, and §10 says
 * that when it is exceeded **the second clause is what gets cut**, never the wake.
 */
const LINE_BUDGET = 41;

/**
 * Every sentence the turn line can be made to show, over both of its variable dimensions.
 *
 * Enumerated through the real code paths rather than written out, so the longest line is **derived**
 * from the copy that ships. A budget test holding a literal `'Three things wake. You gather 41
 * ember.'` would go on passing at 39 characters after the copy grew to 45, which is the one failure
 * mode a character budget exists to prevent.
 */
function everyLineTheGameCanShow(): readonly string[] {
  const lines: string[] = [BLOCKED_MESSAGE.text, RUN_OVER_MESSAGE.text, TOO_FAR_MESSAGE.text];
  const say = (cue: Cue): void => {
    const line = describeCue(cue);
    if (line !== null) lines.push(line.text);
  };

  say({ kind: 'refused' });
  say({ kind: 'shutterChanged', to: 'open' });
  say({ kind: 'shutterChanged', to: 'shuttered' });
  say({ kind: 'died', at: SOMEWHERE, who: 'player' });
  say({ kind: 'died', at: SOMEWHERE, who: 'creature' });

  // §5's run length, read off the HUD rather than as a literal 8 — the same reason `descendHint`'s
  // test does: the day `LAST_FLOOR` moves, the longest descent sentence moves with it.
  const last = sceneOf(beginRun('budget')).hud.floor.last;
  for (let floor = 1; floor <= last; floor += 1) say({ kind: 'descended', toFloor: floor });

  for (const amount of AMOUNTS) {
    say({ kind: 'damaged', at: SOMEWHERE, who: 'player', amount });
    say({ kind: 'damaged', at: SOMEWHERE, who: 'creature', amount });
    say({ kind: 'fuelGained', amount });
  }

  // The two lines only a whole turn can produce: the aggregate wake, and #107's compound.
  for (const n of COUNTS) {
    lines.push(describeTurn(wokeCues(n))!.text);
    for (const amount of AMOUNTS) {
      lines.push(describeTurn([...wokeCues(n), { kind: 'fuelGained', amount }])!.text);
    }
  }
  return lines;
}

describe('a wake that also paid says both, on one line (§10, #107)', () => {
  it('appends the receipt to the wake at every count the game can reach', () => {
    // THE RULING, over n = 1..6 — §8 caps a floor at six creatures, so this is the full reachable
    // range and not a sample. Before #107 every one of these returned the wake alone and the pickup
    // was announced by nothing.
    //
    // Both halves are **derived from the code that owns them** rather than retyped: the wake from
    // `wakeMessage`, the receipt from `describeCue`. So this asserts the *joining*, which is the only
    // thing #107 added, and a reworded receipt fails in the one place that owns the wording.
    for (const n of COUNTS) {
      const turn: readonly Cue[] = [...wokeCues(n), SAMPLES.fuelGained];
      expect(describeTurn(turn), `n=${n}`).toEqual({
        text: `${wakeMessage(n)} ${words(SAMPLES.fuelGained)}`,
        level: 'alarm',
      });
    }
  });

  it('says #107’s own sentence, verbatim, with the wake first', () => {
    // The exact string off the issue's repro — `FUEL 66 -> 87` on seed `emberdepth`, two Cinders
    // woken by the flash that paid the cache. Written out once, deliberately: everything else here
    // derives its expectation from the code, and a suite that derives *everything* can agree with a
    // rewrite of the copy that nobody ruled.
    expect(turnWords([...wokeCues(2), { kind: 'fuelGained', amount: 21 }])).toBe(
      'Two things wake. You gather 21 ember.',
    );
  });

  it('takes the level off the winning `woke` cue and never off the receipt', () => {
    // #94's constraint, which #107 must not spend: the level is a property of the cue that won the
    // line. A `report` here — the receipt's own level, and the tempting one, since the receipt is
    // the clause being added — would silently demote **every wake that coincided with a pickup**,
    // which is #94's defect reintroduced by #107's fix.
    //
    // Compared against `describeCue`'s answer rather than against the literal `'alarm'`, so the day
    // a wake is re-levelled the compound follows it instead of going stale.
    for (const n of COUNTS) {
      const compound = describeTurn([...wokeCues(n), SAMPLES.fuelGained]);
      expect(compound!.level, `n=${n}`).toBe(describeCue(SAMPLES.woke)!.level);
    }
  });

  it('never compounds with a blow the player took', () => {
    // The first exclusion, and it is a ruling rather than an omission: `You take N.` is one of the
    // two lines whose entire value is being read instantly. A tier that fell through to the wake
    // branch and appended a receipt would put the fuel news on the line that is three of from death.
    const turn: readonly Cue[] = [SAMPLES.damaged, ...wokeCues(2), SAMPLES.fuelGained];
    expect(describeTurn(turn)).toEqual(describeCue(SAMPLES.damaged));
    expect(turnWords(turn), 'the damage line stands alone').not.toMatch(/wake|gather/);
  });

  it('never compounds with the run ending', () => {
    // The second exclusion. `The lantern goes out.` is §13's ending, and the summary panel prints
    // the headline two lines below it — a receipt appended here would be the loudest sentence in the
    // game reporting the spoils of the turn that killed you.
    const died: Cue = { kind: 'died', at: SOMEWHERE, who: 'player' };
    const turn: readonly Cue[] = [SAMPLES.damaged, died, ...wokeCues(3), SAMPLES.fuelGained];
    expect(describeTurn(turn)).toEqual(describeCue(died));
    expect(turnWords(turn), 'the death line stands alone').not.toMatch(/wake|gather/);
  });

  it('is the only pair that shares the line', () => {
    // #107 rules **one** compound, not a compounding mechanism. Everything else the wake outranks is
    // still swallowed whole — the shutter, the stairs, a body, and §3's dormant strike — so a
    // general "join the winner to the last report" implementation fails here rather than shipping as
    // a table of joinable pairs with one member.
    const struck: Cue = { kind: 'damaged', at: SOMEWHERE, who: 'creature', amount: 6 };
    for (const other of [SAMPLES.shutterChanged, SAMPLES.descended, SAMPLES.died, struck]) {
      expect(turnWords([...wokeCues(2), other]), other.kind).toBe(wakeMessage(2));
    }
  });

  it('leaves a paying turn that woke nothing exactly as it was', () => {
    // #107's own **control**: kill the two Cinders in the dark first and the same flash on the same
    // cache tile reads `You gather 21 ember.` at `report`. That contrast is what makes the compound
    // attributable to the wake rather than to the press — and it is what fails if a future
    // implementation builds the compound unconditionally and starts prefixing an empty wake.
    expect(describeTurn([SAMPLES.shutterChanged, SAMPLES.fuelGained])).toEqual(
      describeCue(SAMPLES.fuelGained),
    );
  });

  it('reproduces #107 off a real run, through `session/`, with the numbers it was filed with', () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // THE ISSUE'S REPRO, EXACTLY — and the reason it is here and not only in Playwright
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    //
    // Every assertion above is over cues somebody typed, and this file's own header records what
    // that misses twice over (#20's single `damaged` sample, #79's hand-built pair). This is the
    // turn shape #107 is about, produced by the simulation: shutter, thirteen steps in the dark onto
    // an unlit cache — which pays nothing, correctly, per #31/#41 — then open, which lights the tile,
    // pays the cache and wakes the two Cinders the light reaches, all on one free action.
    //
    // The seed is passed explicitly, so unlike the E2E's route this survives #47 replacing the
    // screen's constant. What it does not survive is a change to floor generation, and that is the
    // point: it would fail loudly, on a named tile, rather than by quietly walking somewhere else.
    const route = [
      'north', 'east', 'east', 'south', 'east', 'east', 'east', 'east',
      'south', 'south', 'south', 'east', 'south',
    ] as const;

    let run = setShutter(beginRun('emberdepth'), 'shuttered');
    for (const dir of route) run = move(run, dir);

    // Standing on the cache, in the dark, thirteen turns in, having been paid nothing for it.
    expect(sceneOf(run).hud.fuel.fuel, 'the walk went somewhere else').toBe(66);
    expect(sceneOf(run).hud.turnsElapsed).toBe(13);

    run = setShutter(run, 'open');
    const cues = cuesOf(run);
    expect(cues.filter((cue) => cue.kind === 'woke')).toHaveLength(2);
    expect(cues.filter((cue) => cue.kind === 'fuelGained')).toHaveLength(1);
    // +25 for the cache, less the 4 the flash cost: the meter moves 21 and the words say 21.
    expect(sceneOf(run).hud.fuel.fuel).toBe(87);
    expect(describeTurn(cues)).toEqual({
      text: 'Two things wake. You gather 21 ember.',
      level: 'alarm',
    });
  });

  it('fits the row at its longest, over every count and every amount (41 characters)', () => {
    // §10's budget, and the concrete difference between this compound and the descend compound #94
    // rejected: `Three things wake. You gather 41 ember.` is 39 and fits, and
    // `You climb down to floor 8. Something wakes.` is 43 — long enough to be at risk on a narrow
    // phone, which is one of three reasons #94 refused it and not the load-bearing one.
    //
    // **41 is deliberately conservative and is not the measured capacity.** Measured in the shipped
    // build at 390 wide, mono resolves to ~7.7pt/char against ~362pt of row, so ~47 characters
    // actually fit — and more on a wider device. The budget is set below that on purpose: the
    // resolved font is a *stack* (`SFMono-Regular, Menlo, …, monospace`), so the advance width is
    // device-dependent and a number derived from one browser is not a rule. Do not "correct" this
    // upward to the measured figure; the headroom is the point.
    //
    // The longest line is **derived from the code**, over both dimensions that vary, so this tracks
    // the copy instead of a screenshot: reword the wake or the receipt and this number moves with it.
    // A wrap is not cosmetic — `status-line.tsx` sets `minHeight: 34` with `numberOfLines={2}`, so a
    // second line does not clip, it **grows the row**, and the board a press is being aimed at moves
    // under the thumb (`board.tsx` resolves a press by measuring where the board is). Growing rather
    // than clipping is the right failure of the two, which is why the row is written that way — but
    // it is still a failure, and it is why this budget exists rather than a wrap being tolerated.
    const longest = everyLineTheGameCanShow().reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length, `the longest line is ${JSON.stringify(longest)}`).toBeLessThanOrEqual(
      LINE_BUDGET,
    );

    // Not vacuous: the enumeration really does contain the compound, which is the thing being
    // budgeted. Without this the assertion above passes just as well on a list of refusals.
    expect(everyLineTheGameCanShow(), 'the enumeration missed the compound entirely').toContain(
      'Three things wake. You gather 41 ember.',
    );
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
    expect(turnWords(turn)).toBe(words(SAMPLES.damaged));
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

    expect(turnWords(turn)).toBe(words(SAMPLES.damaged));
    expect(turnWords(turn)).not.toBe(words(hitBack));
  });

  it('says you were hit even when the turn ends in spoils', () => {
    // `fuelGained` is emitted after the blows, so recency alone reports the ember and not the wound.
    const turn: readonly Cue[] = [SAMPLES.damaged, SAMPLES.fuelGained];
    expect(turnWords(turn)).toBe(words(SAMPLES.damaged));
  });

  it('lets the run ending outrank being hit on the way out', () => {
    // Death is emitted before spoils, so last-wins could report "You gather 25 ember." on the turn
    // the run ended. Death outranks damage; damage outranks everything else; recency decides last.
    const died: Cue = { kind: 'died', who: 'player' } as Cue;
    const turn: readonly Cue[] = [SAMPLES.damaged, died, SAMPLES.fuelGained];
    expect(turnWords(turn)).toBe(words(died));
  });

  it('still reports the blow you struck when nothing hit you', () => {
    // The precedence must not turn into "always narrate the player" — a turn where you land a hit
    // and take none is the commonest combat turn there is.
    const struck: Cue = { ...SAMPLES.damaged, who: 'creature', amount: 4 } as Cue;
    expect(turnWords([SAMPLES.playerMoved, struck])).toBe(words(struck));
  });

  it('clears the line when a turn has nothing to say', () => {
    // Otherwise last turn's "You take 2." sits under the board while the player walks away from the
    // thing that hit them.
    expect(turnWords([])).toBeNull();
    expect(turnWords([SAMPLES.playerMoved])).toBeNull();
  });

  it('renders a real refusal off a real run', () => {
    // End to end through `session/`, with no hand-built cue: the opening lantern is already open, so
    // re-asserting `open` is refused (§2) and the run comes back with the refusal cue on it.
    const run = beginRun('messages');
    expect(turnWords(cuesOf(setShutter(run, 'open')))).toBe(words({ kind: 'refused' }));
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * §10's TABLE, ENUMERATED — every message the game can show, and the level it must land in
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * The GDD names every row (#94). This is that table, transcribed once, with each row bound to the
 * **real code path** that produces it rather than to a literal — so a row is evidence that the
 * message exists as well as that it is levelled correctly.
 *
 * `shape` is what ties a row to the GDD's name for it. It is a pattern rather than the exact
 * sentence on purpose: the copy is #79's and is pinned above, and re-pinning it here would make a
 * ruled wording change fail in two places for one reason. What it *does* catch is a row wired to
 * the wrong cue — the failure that would make this whole table agree with itself and with nothing
 * else.
 */
type LevelRow = {
  /** The message, as GDD §10's table names it. */
  readonly gdd: string;
  /** Which cue kind produces it — or `cueless` for the three refusals that never reach `step`. */
  readonly from: Cue['kind'] | 'cueless';
  /** The line the shipping code actually produces for that case. */
  readonly line: TurnLine | null;
  /** What §10 says it must be drawn as. */
  readonly level: LineLevel;
  readonly shape: RegExp;
};

const TABLE: readonly LevelRow[] = [
  // ── alarm: something is now against you that was not before ─────────────────────────────────
  {
    gdd: 'Something wakes.',
    from: 'woke',
    line: describeTurn([SAMPLES.woke]),
    level: 'alarm',
    shape: /^Something wakes\.$/,
  },
  {
    gdd: 'N things wake.',
    from: 'woke',
    line: describeTurn([SAMPLES.woke, { kind: 'woke', at: { x: 9, y: 9 } }]),
    level: 'alarm',
    shape: /things wake\.$/,
  },
  {
    // §10's one compound (#107). Its row sits in the `alarm` block because the level is the winning
    // cue's and the wake won it — a hunter is still what is against you, and the receipt riding
    // along does not make the turn quieter. `from: 'woke'` for the same reason: `fuelGained` has its
    // own row below, as the sentence it is on the turns that do not wake.
    gdd: 'N things wake. You gather N ember.',
    from: 'woke',
    line: describeTurn([...wokeCues(2), SAMPLES.fuelGained]),
    level: 'alarm',
    shape: /^\w+ things wake\. You gather \d+ ember\.$/,
  },
  {
    gdd: 'You take N.',
    from: 'damaged',
    line: describeCue(SAMPLES.damaged),
    level: 'alarm',
    shape: /^You take \d+\.$/,
  },
  {
    gdd: 'The lantern goes out.',
    from: 'died',
    line: describeCue({ kind: 'died', at: { x: 2, y: 2 }, who: 'player' }),
    level: 'alarm',
    shape: /^The lantern goes out\.$/,
  },

  // ── report: here is what your press did ──────────────────────────────────────────────────────
  {
    gdd: 'You strike for N.',
    from: 'damaged',
    line: describeCue({ ...SAMPLES.damaged, who: 'creature' } as Cue),
    level: 'report',
    shape: /^You strike for \d+\.$/,
  },
  {
    gdd: 'It burns out.',
    from: 'died',
    line: describeCue(SAMPLES.died),
    level: 'report',
    shape: /^It burns out\.$/,
  },
  {
    gdd: 'You gather N ember.',
    from: 'fuelGained',
    line: describeCue(SAMPLES.fuelGained),
    level: 'report',
    shape: /^You gather \d+ ember\.$/,
  },
  {
    gdd: 'The shutter opens. Light spills out.',
    from: 'shutterChanged',
    line: describeCue({ kind: 'shutterChanged', to: 'open' }),
    level: 'report',
    shape: /^The shutter opens\./,
  },
  {
    gdd: 'The shutter closes.',
    from: 'shutterChanged',
    line: describeCue({ kind: 'shutterChanged', to: 'shuttered' }),
    level: 'report',
    shape: /^The shutter closes\.$/,
  },
  {
    gdd: 'You climb down to floor N.',
    from: 'descended',
    line: describeCue(SAMPLES.descended),
    level: 'report',
    shape: /^You climb down to floor \d+\.$/,
  },
  {
    gdd: 'Nothing happens.',
    from: 'refused',
    line: describeCue(SAMPLES.refused),
    level: 'report',
    shape: /^Nothing happens\.$/,
  },
  {
    gdd: 'The way is blocked.',
    from: 'cueless',
    line: BLOCKED_MESSAGE,
    level: 'report',
    shape: /blocked/,
  },
  { gdd: 'Too far to step.', from: 'cueless', line: TOO_FAR_MESSAGE, level: 'report', shape: /^Too far/ },
  { gdd: 'The run is over.', from: 'cueless', line: RUN_OVER_MESSAGE, level: 'report', shape: /over\.$/ },
];

describe('every message is drawn at the level §10 names (#94)', () => {
  it('puts each row of the GDD table in its level, and produces the message the row names', () => {
    // The whole table, row by row. A level flipped in `describeCue` fails on exactly the row it was
    // flipped on and names it — which is the difference between this and a spot check on the wake.
    for (const row of TABLE) {
      expect(row.line, `${row.gdd} produces no line at all`).not.toBeNull();
      expect(row.line!.text, row.gdd).toMatch(row.shape);
      expect(row.line!.level, row.gdd).toBe(row.level);
    }
  });

  it('covers every cue that speaks and every refusal that cannot', () => {
    // ENUMERATED, NOT SAMPLED. The table above is hand-written, so on its own it says nothing about
    // the messages nobody remembered to add to it — and "a new cue kind arrives as a silent
    // `report`" is the failure #94's implementation shape was chosen to prevent. This is what makes
    // the table total: every `CUE_KINDS` member that has copy has a row, driven off `CUE_KINDS`.
    const speaking = CUE_KINDS.filter((kind) => describeCue(SAMPLES[kind]) !== null);
    const covered = new Set(TABLE.map((row) => row.from));
    for (const kind of speaking) expect([...covered], `${kind} has no row in the table`).toContain(kind);
    // And the silent one is genuinely silent rather than merely absent from the table.
    expect(CUE_KINDS.filter((kind) => describeCue(SAMPLES[kind]) === null)).toEqual(['playerMoved']);
    // All three cueless refusals, which no `CUE_KINDS` walk can reach.
    expect(TABLE.filter((row) => row.from === 'cueless')).toHaveLength(3);
  });

  it('keeps `alarm` scarce: exactly the wake, the wound and the death', () => {
    // §10's Watch is that an `alarm` firing too often stops reading as one, and the mechanical half
    // of that is which *messages* are allowed to be loud at all. Five rows out of fifteen, named —
    // and the fifth (#107's compound) is not a new loud *event*, it is the wake row wearing its
    // receipt. Nothing became an alarm that was not one before, which is the property that keeps
    // this list a scarcity claim rather than a census.
    const loud = TABLE.filter((row) => row.line?.level === 'alarm').map((row) => row.gdd);
    expect(loud.sort()).toEqual(
      [
        'N things wake.',
        'N things wake. You gather N ember.',
        'Something wakes.',
        'The lantern goes out.',
        'You take N.',
      ].sort(),
    );
  });

  it('says the same thing about a wake of two through six as about a wake of one', () => {
    // The aggregate wake composes its own words (`describeTurn`), so it is the one line whose level
    // is not lifted straight off `describeCue`'s return. A literal `'alarm'` written there would
    // pass today and stop following the cue the moment anything moved.
    for (let n = 1; n <= 6; n += 1) {
      const cues: Cue[] = Array.from({ length: n }, (_, i) => ({
        kind: 'woke',
        at: { x: i, y: 0 },
      }));
      expect(describeTurn(cues), `n=${n}`).toEqual({ text: wakeMessage(n), level: 'alarm' });
    }
  });

  it('never invents a level outside the two', () => {
    for (const row of TABLE) expect(LEVELS, row.gdd).toContain(row.line!.level);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE PRECEDENCE INVARIANT, OVER REAL RUNS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §4's precedence and §10's levels agree exactly: `player death > player damage > woke` **is** the
 * `alarm` set, and everything recency can reach is a `report`. So the rule below is checkable
 * without knowing which cue won:
 *
 *     a turn whose cues contain a `woke`, a player `damaged` or a player `died`  ->  alarm
 *     every other turn                                                          ->  report or silence
 *
 * **Asserted over real runs and never over hand-built cue arrays.** That is not fastidiousness: it
 * is the specific lesson of the two bugs this file already carries. #20's single-`damaged` sample
 * could not see that the player's own cue is emitted *first* among a turn's blows, and #79's
 * hand-built pair could not see an aggregate count. A cue list somebody typed contains the case
 * they were thinking of; a cue list a run produced contains the case they were not.
 *
 * The corpus is `render/cues.test.ts`'s, seed for seed — a dark dive, a run that stands in its own
 * light until it dies, and a walk in the dark that ends in a flash. Between them they are the only
 * three scripts in the repo that reach all eight cue kinds, and the third exists *because* the first
 * two contain no `dormant -> awake` transition at all.
 *
 * It is replayed through `session/` rather than through `step()` — the same four intents
 * `app/index.tsx` calls, and `cuesOf` is the same list the screen hands to `describeTurn`. So what
 * this measures is the path that actually ships.
 */

/** One `RunRecord`'s worth of commands, typed off the scripts so `@/game/core` stays unnamed here. */
type Scripted = ReturnType<typeof diveToTheBottom>;

function advance(run: Run, command: Scripted['commands'][number]): Run {
  switch (command.kind) {
    case 'move':
      return move(run, command.dir);
    case 'setShutter':
      return setShutter(run, command.to);
    case 'descend':
      return descend(run);
    case 'wait':
      return wait(run);
  }
}

/** Every turn of a scripted run, as the screen would see it: the cues, and the line drawn from them. */
function replay(record: Scripted): readonly { cues: readonly Cue[]; line: TurnLine | null }[] {
  let run = beginRun(record.seed);
  // The opening frame is a turn that already happened (§4 opens the lantern; `opening.ts`), so it
  // belongs in the corpus — on a seed whose opening light finds somebody it is an `alarm` before a
  // finger has touched the screen.
  const turns = [{ cues: cuesOf(run), line: describeTurn(cuesOf(run)) }];
  for (const command of record.commands) {
    run = advance(run, command);
    turns.push({ cues: cuesOf(run), line: describeTurn(cuesOf(run)) });
  }
  return turns;
}

/** The three cues §10 calls an `alarm`. Written from the ruling, not from `describeCue`. */
function isAlarming(cue: Cue): boolean {
  return (
    cue.kind === 'woke' ||
    (cue.kind === 'damaged' && cue.who === 'player') ||
    (cue.kind === 'died' && cue.who === 'player')
  );
}

const CORPUS = [
  ['a dark dive', replay(diveToTheBottom('cues', 3))],
  ['standing in the light until it kills you', replay(standUntilDead('grave', 3))],
  ['a walk in the dark that ends in a flash', replay(walkInTheDarkThenFlash('flash'))],
] as const;

const ALL_TURNS = CORPUS.flatMap(([, turns]) => turns);

describe('the level agrees with §4’s precedence, over three real runs', () => {
  it('draws an alarm on every turn that woke, wounded or killed the player — and only those', () => {
    // THE INVARIANT. Both directions in one loop, because either half alone is passable by a
    // constant: "always alarm" satisfies the first and "always report" satisfies the second.
    for (const [name, turns] of CORPUS) {
      turns.forEach((turn, at) => {
        const where = `${name} turn ${at}: ${turn.cues.map((c) => c.kind).join(',')}`;
        if (turn.cues.some(isAlarming)) {
          expect(turn.line, where).not.toBeNull();
          expect(turn.line!.level, where).toBe('alarm');
        } else {
          expect(turn.line?.level ?? 'report', where).toBe('report');
        }
      });
    }
  });

  it('is not vacuous: the corpus contains all three alarms and plenty of reports', () => {
    // Without this the loop above passes on a corpus that never wakes anything, which is exactly
    // how `render/cues.test.ts` could have shipped a `woke` property over runs containing no wake.
    const cues = ALL_TURNS.flatMap((turn) => turn.cues);
    expect(cues.filter((cue) => cue.kind === 'woke').length, 'no wake in the corpus')
      .toBeGreaterThan(0);
    expect(
      cues.filter((cue) => cue.kind === 'damaged' && cue.who === 'player').length,
      'nothing ever hit the player',
    ).toBeGreaterThan(0);
    expect(
      cues.filter((cue) => cue.kind === 'died' && cue.who === 'player').length,
      'nobody ever died',
    ).toBe(1);

    const spoken = ALL_TURNS.filter((turn) => turn.line !== null);
    const alarms = spoken.filter((turn) => turn.line!.level === 'alarm');
    expect(alarms.length, 'no alarm was ever drawn').toBeGreaterThan(0);
    expect(spoken.length - alarms.length, 'no report was ever drawn').toBeGreaterThan(0);
  });

  it('never draws an alarm on a turn whose only news is the shutter, the stairs or a refusal', () => {
    // The other half of #94's finding, stated as its own assertion: the shutter line survived #79's
    // demotion because *you got away with it* is a real sentence, and it only reads that way while
    // the line that would have replaced it is visibly louder. A `shutterChanged` turn that drew as
    // an alarm would delete the contrast this issue exists to create.
    const quiet = ALL_TURNS.filter(
      (turn) =>
        turn.line !== null &&
        !turn.cues.some(isAlarming) &&
        turn.cues.some(
          (cue) =>
            cue.kind === 'shutterChanged' || cue.kind === 'descended' || cue.kind === 'refused',
        ),
    );
    expect(quiet.length, 'the corpus never pressed a control quietly').toBeGreaterThan(2);
    for (const turn of quiet) expect(turn.line!.level).toBe('report');
  });
});
