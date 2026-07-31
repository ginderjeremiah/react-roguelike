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

import { type Cue } from '@/render';

/** §9: the tap landed on an impassable neighbour, which is not a tap target. */
export const BLOCKED_MESSAGE = 'The way is blocked.';

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
 * The one line to show for a whole turn: the **last** cue that has something to say.
 *
 * Last rather than first, because `CUE_KINDS` is in emission order — "the board changes, then the
 * lamp, then the player, then the blows, then the bodies, then the spoils" — so the last sentence is
 * the end of the turn's story, and the end is what the player has not seen yet. A turn that opens the
 * shutter and takes a hit should say the hit.
 *
 * `null` when nothing is worth saying, which clears the line rather than leaving last turn's news up.
 */
export function describeTurn(cues: readonly Cue[]): string | null {
  let latest: string | null = NO_MESSAGE;
  for (const cue of cues) {
    const sentence = describeCue(cue);
    if (sentence !== null) latest = sentence;
  }
  return latest;
}
