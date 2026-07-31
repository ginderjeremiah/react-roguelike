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
 */

import { type Cue, type FloorHud } from '@/render';

/** §9: the tap landed on an impassable neighbour, which is not a tap target. */
export const BLOCKED_MESSAGE = 'The way is blocked.';

/**
 * §13: the run has ended, so the board accepts nothing — and §2 still wants the tap acknowledged.
 *
 * **This is the only refusal in the game with nothing else to speak for it.** A blocked neighbour at
 * least produces `BLOCKED_MESSAGE`; every refusal that reaches `step` produces a `refused` cue. A tap
 * on a finished board produces neither: `render/taps.ts` empties the tap list at the ending, so
 * `tapAt` answers `unbound` and no command is ever built. Without this line the press is genuinely
 * indistinguishable from a press that was never received — which is §2's "a UI failure wearing the
 * costume of a rule", and which is also why the E2E could not tell a working refusal from a dead
 * handler until this existed.
 */
export const RUN_OVER_MESSAGE = 'The run is over.';

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
export const TOO_FAR_MESSAGE = 'Too far to step.';

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
 * One cue as a sentence, or `null` if the board already says it.
 *
 * The switch is exhaustive over `Cue['kind']` by construction — a new cue kind is a type error here
 * rather than a turn that silently narrates nothing. `tests/unit/messages.test.ts` checks the same
 * thing at runtime against `CUE_KINDS`, because a `default` branch added later would make the
 * compiler stop caring.
 */
export function describeCue(cue: Cue): string | null {
  switch (cue.kind) {
    case 'refused':
      // §2. The player is told the tap arrived and did nothing — never *why*, because the reason is
      // a rule and a component that branched on it would be holding a copy of one.
      return 'Nothing happens.';
    case 'descended':
      return `You climb down to floor ${cue.toFloor}.`;
    case 'shutterChanged':
      return cue.to === 'open' ? 'The shutter opens. Light spills out.' : 'The shutter closes.';
    case 'playerMoved':
      return NO_MESSAGE;
    case 'damaged':
      return cue.who === 'player' ? `You take ${cue.amount}.` : `You strike for ${cue.amount}.`;
    case 'died':
      return cue.who === 'player' ? 'The lantern goes out.' : 'It burns out.';
    case 'fuelGained':
      return `You gather ${cue.amount} ember.`;
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
 * `null` when nothing is worth saying, which clears the line rather than leaving last turn's news up.
 */
export function describeTurn(cues: readonly Cue[]): string | null {
  let playerDied: Cue | null = null;
  let playerHurt: Cue | null = null;
  let latest: string | null = NO_MESSAGE;

  for (const cue of cues) {
    if (cue.kind === 'died' && cue.who === 'player') playerDied = cue;
    else if (cue.kind === 'damaged' && cue.who === 'player') playerHurt = cue;

    const sentence = describeCue(cue);
    if (sentence !== null) latest = sentence;
  }

  if (playerDied !== null) return describeCue(playerDied);
  if (playerHurt !== null) return describeCue(playerHurt);
  return latest;
}
