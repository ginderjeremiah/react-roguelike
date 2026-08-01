/**
 * A turn, in one sentence. `render/`'s cues are facts; this is the copy for them.
 *
 * ## Why there is a line of text on a glyph grid at all
 *
 * GDD §2 requires that **a refused tap still produce feedback** — "a tap that does nothing at all
 * reads on a phone as 'the touch did not register', which is a UI failure wearing the costume of a
 * rule" — and §9 adds a second, larger case: an impassable neighbour is not a tap target, so the
 * commonest dead tap in the game never reaches the simulation and therefore never produces a cue.
 * One line that says what just happened answers both, and it costs no motion, which is the cheapest
 * possible way to honour §11's reduced-motion requirement.
 *
 * It is also the first thing a playtester reads when they cannot tell why the board changed.
 *
 * ## What belongs here and what does not
 *
 * Copy. Nothing else. Every sentence below is a rendering of a `Cue`, and a `Cue` is a fact the
 * simulation already established (`render/cues.ts`: "facts, never durations"). Deciding *whether* a
 * creature died is `game/`'s; deciding that it reads as "it burns out" is this file's.
 *
 * `describeCue` returns `null` for things the board says better than a sentence can — a move is
 * visible as the `@` being somewhere else, and narrating it would push the useful line off screen.
 *
 * ## And how loudly it is said (§10, #94)
 *
 * A sentence is not enough on its own. The playtest of #79 measured the line at 13px/400 in the same
 * grey as the two captions beside it, which made `The shutter opens. Light spills out.` and `Two
 * things wake.` — *you got away with it* and *you have company* — typographically identical. So
 * every line carries a **`LineLevel`** with it, and `status-style.ts` turns that into weight, size
 * and colour.
 *
 * **The level is a property of the cue that won the line, never of the string.** A component that
 * decided emphasis by matching on text would be holding a second copy of the copy, and it would rot
 * silently the first time a sentence is reworded. That is why the level is chosen here, in the same
 * `switch` that chooses the words, and why the three cueless refusals below are `TurnLine`s rather
 * than bare strings.
 */

import { type Cue, type FloorHud } from '@/render';

/**
 * How loudly a line is drawn. GDD §10 (#94).
 *
 * **`alarm`: something is now against you that was not before** — a wake, damage taken, the player's
 * death. **`report`: here is what your press did** — every receipt, and every refusal.
 *
 * Named for the criterion rather than for the volume, so an assignment can be argued rather than
 * bikeshedded. Two levels and not three: a tier *below* `report` for refusals has nowhere to go, and
 * a tier splitting *hunted* from *hit* was rejected because §4's precedence means those two never
 * appear side by side — a distinction the player can never contrast is a costume, not a tier.
 *
 * The set falls out of `describeTurn`'s precedence for free: `player death > player damage > woke`
 * **is** the `alarm` set, and every message recency can reach is a `report`. That invariant is
 * pinned over real runs in `tests/unit/play-messages.test.ts` rather than merely hoped for.
 */
export type LineLevel = 'alarm' | 'report';

/**
 * One turn, in one sentence, at one volume.
 *
 * The pair travels together — `app/index.tsx` holds a `TurnLine | null` in state and hands the whole
 * thing to `StatusLine` — precisely so that the text and the level cannot be chosen in two places
 * and drift apart.
 */
export type TurnLine = {
  readonly text: string;
  readonly level: LineLevel;
};

/** §9: the tap landed on an impassable neighbour, which is not a tap target. */
export const BLOCKED_MESSAGE: TurnLine = { text: 'The way is blocked.', level: 'report' };

/**
 * §13: the run has ended, so the board accepts nothing — and §2 still wants the tap acknowledged.
 *
 * **Three refusals never reach `step`, so none of them has a cue to speak for it** — a blocked
 * neighbour, a tap further away than a neighbour, and this one. Each has exactly one string standing
 * between it and silence, and two of the three shipped without theirs. A tap on a finished board is
 * the starkest case: `render/taps.ts` empties the tap list at the ending, so
 * `tapAt` answers `unbound` and no command is ever built. Without this line the press is genuinely
 * indistinguishable from a press that was never received — which is §2's "a UI failure wearing the
 * costume of a rule", and which is also why the E2E could not tell a working refusal from a dead
 * handler until this existed.
 *
 * A `report` (§10): a refusal is a receipt for a thumb, never a fact that is against the player.
 * **#98 asks a different question** — whether this line is reachable at all, given that
 * `status-line.tsx` and this file disagree about whether the line survives a finished run — and it
 * is deliberately left open here. The level does not settle it either way.
 */
export const RUN_OVER_MESSAGE: TurnLine = { text: 'The run is over.', level: 'report' };

/**
 * §9: a tap acts on your own tile or one of the four beside it. This one was further away.
 *
 * **The wording may not promise auto-travel**, and that is the whole constraint on it. ADR-0009
 * settles `travel(to)`'s rules and defers the build to M2 (#65), so anything reading as "you cannot
 * path *there*" or "not from here" advertises a feature that does not exist — and a player who
 * hears "not *yet*" taps distant tiles again, which is worse than silence. So this states the rule
 * (adjacency) and the verb a tap actually performs (a step), and promises nothing.
 *
 * Found by the first playtest, which called a silent distant tap "the first thing a new mobile
 * player will do" — every touch roguelike is tap-to-path, so the tap arrives before the player has
 * learned the game does not do that, and total silence reads as a missed touch rather than a rule
 * (§2, #60).
 *
 * **This line disappears when travel lands.** `unbound` stops being a refusal and becomes a command
 * — which is exactly why #20 kept `blocked` and `unbound` as distinct `TapAction` kinds instead of
 * collapsing them, and why every variant carries `at`. Do not "simplify" the two together.
 */
export const TOO_FAR_MESSAGE: TurnLine = { text: 'Too far to step.', level: 'report' };

/**
 * What the descend control promises. **There is no floor 9.**
 *
 * §13, twice over: "There is no floor 9 and there is no boss ... The eighth descent *is* the
 * ending", and the run's second ending is "**Reached the bottom** — the player takes the stairs on
 * the last floor". So `to floor ${number + 1}` is right seven times and wrong at the climax, where
 * it offers a floor the game does not have on the one press that finishes the run.
 *
 * `>=` rather than `===` so that a floor past the last — which nothing can produce — still does not
 * promise a floor below it. The failure of a wrong comparison here is a lie at the ending; the cost
 * of the looser one is nothing.
 *
 * The summary screen is #21's (§13 says so explicitly). This is only the label on the control.
 */
export function descendHint(floor: FloorHud): string {
  return floor.number >= floor.last
    ? 'the last stairs — this is the bottom'
    : `to floor ${floor.number + 1}`;
}

/** The turn resolved and there was nothing worth saying about it. */
export const NO_MESSAGE = null;

/**
 * The words for two through six — the whole range above one that the game can reach.
 *
 * §8 caps a floor at `min(2 + floor, 6)` creatures, so six is the most a single turn can wake and
 * this table is provably total over everything the simulation can produce. One is not in the table
 * because it is not a count in the copy at all ("Something"), and `wakeMessage` still answers past
 * the end — see there.
 */
const COUNT_WORDS: readonly string[] = ['Two', 'Three', 'Four', 'Five', 'Six'];

/**
 * §4 (#79): the turn woke `n` creatures, said with the number.
 *
 * ## Every word here was ruled, and three of them were close calls
 *
 * **"wakes", not "stirs".** *Stirs* is the better mood and the wrong fact — it describes the
 * beginning of waking, and under #83 the creature is awake, has declared, and is coming. More
 * importantly *wake* is **the rule's own word**: §2 phase 3, §4's table and §6's dormancy row all
 * say it. In a game with no tutorial the copy is the only place the vocabulary can be taught, and a
 * player who reads `Something wakes.` on the turn the room lit up has been handed *light wakes
 * things* for free. `Nothing happens.` and `The way is blocked.` set the register: plain, literal.
 *
 * **"things", not "Cinders".** In light you can see what it is, so naming it would leak nothing —
 * it is a scaling problem. M3 adds creatures and the line would have to enumerate mixed groups
 * (*A Cinder and two Ashwalkers wake.*), which is combinatorial copy for a one-line status bar.
 * `died` already chose anonymity for the same reason (`It burns out.`), and "something" also covers
 * the one case where identity genuinely is unknown: a dormant strike landed while shuttered.
 *
 * **The count is spoken, and spoken as a word.** Spoken at all because the failure without it is
 * concrete: you flash, wake three, read `Something wakes.`, budget for one hunter and have three.
 * The count is also the part that cannot be read off the board — the woken creatures *are* on
 * screen, but a flash reveals a whole room at once and one new glyph among twenty is not a signal.
 * As a **word** rather than a numeral because every existing numeral in this line (`You take 3.`,
 * `You gather 25 ember.`) is a quantity of a metered resource the HUD also shows, so a digit there
 * reads as *check the meter*. This is a count of bodies with no meter behind it, and `2 things
 * wake.` reads like a debug string.
 *
 * **No cause-variant string.** Welding the flash in (`Light spills out. Something wakes.`) is
 * tempting and wrong, because a wake is not always a flash: walking with the shutter open slides the
 * lit radius over a sleeper, and there is no `shutterChanged` cue on that turn at all. One string
 * that reads correctly in all three contexts — flash, walk-while-lit, dormant strike — beats two
 * that need a branch to choose between. The causal link is carried by *when* the line appears.
 *
 * The numeral fallback above six **cannot fire today** and is kept so the function is total without
 * a throw. It is not a live branch; §8's cap is what makes it dead, and if that cap moves this is
 * already correct rather than a crash at the worst possible moment.
 */
export function wakeMessage(count: number): string {
  if (count === 1) return 'Something wakes.';
  const word: string | undefined = COUNT_WORDS[count - 2];
  return `${word ?? count} things wake.`;
}

/**
 * One cue as a sentence at a volume, or `null` if the board already says it.
 *
 * The switch is exhaustive over `Cue['kind']` by construction — a new cue kind is a type error here
 * rather than a turn that silently narrates nothing. `tests/unit/play-messages.test.ts` checks the
 * same thing at runtime against `CUE_KINDS`, because a `default` branch added later would make the
 * compiler stop caring; it now checks the **level** the same way, so a ninth cue kind cannot arrive
 * as a silent `report`.
 *
 * ## Why the level is chosen here and not in a `levelOf(cue)` beside it
 *
 * Two of these cases pick their level from the **same field** they pick their words from: `damaged`
 * and `died` are an `alarm` when `who` is the player and a `report` when it is not. A second switch
 * over the same union would have to repeat that discrimination, and the failure mode of the two
 * drifting is `You take 3.` drawn as quietly as `You strike for 3.` — which is exactly the defect
 * #94 was filed about, reintroduced by a refactor nobody would flag. One switch, one decision.
 */
export function describeCue(cue: Cue): TurnLine | null {
  switch (cue.kind) {
    case 'refused':
      // §2. The player is told the tap arrived and did nothing — never *why*, because the reason is
      // a rule and a component that branched on it would be holding a copy of one.
      return { text: 'Nothing happens.', level: 'report' };
    case 'descended':
      // §10: a `report`, even though the press is a wager. The floor number is on the HUD in the
      // largest type on screen, and on the arrivals that matter the wake outranks this line anyway.
      return { text: `You climb down to floor ${cue.toFloor}.`, level: 'report' };
    case 'shutterChanged':
      return {
        text: cue.to === 'open' ? 'The shutter opens. Light spills out.' : 'The shutter closes.',
        level: 'report',
      };
    case 'playerMoved':
      return NO_MESSAGE;
    case 'woke':
      // One cue is one creature (`render/cues.ts`), so a single `woke` is exactly `n = 1` and this
      // is accurate rather than a default. The turn's *count* is `describeTurn`'s job, because only
      // it sees the whole list — this function is per-cue by construction.
      return { text: wakeMessage(1), level: 'alarm' };
    case 'damaged':
      // The `who` decides both halves: a blow you took is an `alarm` (three of them is the run, at
      // 12 HP), a blow you landed is a `report` — you chose it, you aimed it, and the target is lit.
      return cue.who === 'player'
        ? { text: `You take ${cue.amount}.`, level: 'alarm' }
        : { text: `You strike for ${cue.amount}.`, level: 'report' };
    case 'died':
      return cue.who === 'player'
        ? { text: 'The lantern goes out.', level: 'alarm' }
        : { text: 'It burns out.', level: 'report' };
    case 'fuelGained':
      return { text: `You gather ${cue.amount} ember.`, level: 'report' };
  }
}

/**
 * The one line to show for a whole turn: **what happened to the player**, else the last cue that has
 * something to say.
 *
 * ## Precedence, not recency — and the reason is a bug this rule already had
 *
 * The first version of this function took the last speaking cue, justified on the grounds that
 * `CUE_KINDS` is in emission order — board, lamp, player, blows, bodies, spoils — so the last
 * sentence is the newest news. **That holds *between* cue kinds and not *within* one.**
 * `render/cues.ts` emits `damaged` by iterating `world.actors`, which is in ascending id order, and
 * the player is id `0`. So the player's own `damaged` cue is always *first* among a turn's blows, and
 * last-wins always discarded it: every turn in which blows were traded said `You strike for 4.` and
 * never `You take 3.` At 12 max HP and 3-4 damage a hit, that is three silent turns from death, and
 * with nothing on screen animating, the only remaining signal was auditing a HUD number.
 *
 * Found independently by the `playtester` (six runs, "the only thing that compromised Pillar 2") and
 * by review of #20 — and the test that covered this rule could not fail, because its sample held a
 * single `damaged` cue where the bug needs two. See `play-messages.test.ts`.
 *
 * The same argument applies to death: `fuelGained` is emitted *after* `died`, so last-wins could
 * report `You gather 25 ember.` on the turn the run ended. Death outranks damage, damage outranks
 * everything else, and only then does recency decide.
 *
 * Ordering by *who it happened to* rather than by actor id is what makes this stable: it does not
 * care what order the simulation iterates, which is exactly the assumption that broke.
 *
 * ## The third tier: a wake beats the shutter (§4, #79)
 *
 *     player death  >  player damage  >  woke  >  last speaking cue by emission order
 *
 * **`woke` is above recency specifically so that it beats `shutterChanged`.** The two fire on the
 * same turn by construction — you open the shutter, the light wakes what it touches — and only one
 * line fits. `The shutter opens. Light spills out.` restates the single most visible change the game
 * can make, the entire board's tint, on the one turn the player pressed the control themselves: the
 * least informative sentence available at the most consequential moment. Demoting it makes the turn
 * line report the flash's **outcome** instead of its input, and leaves the shutter line meaning
 * something real — *you got away with it*.
 *
 * **Player damage keeps the tier it won above.** A turn can wake a sleeper *and* take a hit from
 * something already awake (phase 3 wakes, phase 4 swings); at 12 HP and 2-4 a blow the hit is still
 * the more urgent fact, and the woken creature announces itself next turn by moving.
 *
 * §3's dormant strike falls out of this order with **no special branch**: `You strike for 6.` is a
 * `damaged` cue in recency, `woke` is a tier above it, so a survivor's wake takes the line. That is
 * the right answer on the merits — the strike was chosen and is visible, the waking is the surprise
 * — and a compound sentence is deliberately not built, because §4's change log records that branch
 * as unreachable at M1's numbers and a special case for a branch that cannot fire is the same defect
 * as #80's undrawable glyph. If a creature that survives a strike ever ships, the compound is the
 * prepared answer and it is a copy change, not a precedence change.
 *
 * The count is **aggregated here** rather than read off any one cue, because a cue is one creature
 * and only this function sees the turn.
 *
 * ## The volume comes from the winner, and is never re-decided (§10, #94)
 *
 * Every `return` below hands back the `TurnLine` **`describeCue` built for the cue that won**, so
 * the level is the winning cue's own and there is no second table to keep in step. The aggregate
 * wake is the one line whose *words* this function has to compose, and even there the level is
 * lifted off a real `woke` cue rather than written as a literal: `{ ...one, text: wakeMessage(n) }`.
 * If `woke` were ever re-levelled in `describeCue`, a turn that woke three would follow it.
 *
 * That the three tiers above recency are exactly the `alarm` set is not a coincidence to be
 * maintained by hand — it is §4's precedence and §10's levels agreeing, and it is asserted over real
 * runs in `tests/unit/play-messages.test.ts`.
 *
 * `null` when nothing is worth saying, which clears the line rather than leaving last turn's news up.
 */
export function describeTurn(cues: readonly Cue[]): TurnLine | null {
  let playerDied: Cue | null = null;
  let playerHurt: Cue | null = null;
  let anyWoke: Cue | null = null;
  let woken = 0;
  let latest: TurnLine | null = NO_MESSAGE;

  for (const cue of cues) {
    if (cue.kind === 'died' && cue.who === 'player') playerDied = cue;
    else if (cue.kind === 'damaged' && cue.who === 'player') playerHurt = cue;
    else if (cue.kind === 'woke') {
      woken += 1;
      anyWoke ??= cue;
    }

    const line = describeCue(cue);
    if (line !== null) latest = line;
  }

  if (playerDied !== null) return describeCue(playerDied);
  if (playerHurt !== null) return describeCue(playerHurt);
  if (anyWoke !== null) {
    // `woke` always speaks, so this is never `null` — but it is written as a fall-through rather
    // than a `!` so that a future `describeCue` which stopped narrating a wake would go quiet
    // instead of throwing on the most consequential turn in the game.
    const one = describeCue(anyWoke);
    if (one !== null) return { ...one, text: wakeMessage(woken) };
  }
  return latest;
}
