import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cuesOf, sceneOf } from '@/session';
import { describeTurn, wakeMessage } from '@/components/play/messages';
import { openRun } from '@/components/play/opening';

/**
 * The opening frame's sentence, and the wiring that nearly lost it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE BUG THESE TESTS EXIST FOR
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * #79 emitted the opening wake as a cue, argued it in `session/run.ts` at length, wrote it into
 * GDD §4 as a rule — and the screen never rendered it. `app/index.tsx` initialised its message to a
 * literal `null` and only ever assigned it from a *press* handler, so `beginRun`'s cues reached
 * `cuesOf()` and stopped. Every layer under `app/` was tested and correct; the seam between the last
 * of them and the screen was not tested at all.
 *
 * It survived because the seed is a constant until #47 and `emberdepth` is one of the ~90% of
 * openings that wake nothing. **That is also why this file is at the unit tier and not in `e2e/`:**
 * with one hard-coded seed there is no press, no control and no route that reaches an opening which
 * wakes, so the DOM tier structurally cannot see the 10% of openings this rule is about. The day
 * #47 lands a real seed, an E2E can take this over and the source assertion at the bottom can go.
 */

/** Resolved the way `tests/unit/infrastructure.test.ts` resolves the repo root, for the same reason. */
const SCREEN = fs.readFileSync(path.resolve(__dirname, '../../app/index.tsx'), 'utf8');

/**
 * The screen with its prose stripped out.
 *
 * That file's comments *discuss* `openRun` and `beginRun` by name — as they should, since the
 * argument for this wiring is written next to it — and counting call sites in the same text as the
 * paragraphs about them would make every assertion below a hostage to editing a sentence.
 */
const CODE = SCREEN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** Seeds whose opening light finds somebody. Found by measurement below, not by guessing. */
const WAKING_SEED = 'open-1';
/** And one whose opening light finds nobody — the common case, and the shipped constant. */
const QUIET_SEED = 'emberdepth';

describe('the line a run already owes on its opening frame (§4, #79)', () => {
  it('says what the opening light woke, rather than starting blank', () => {
    // The blocking defect, at the seam it was lost on. A screen that starts its message at `null`
    // passes every test under it and still never says this.
    const opened = openRun(WAKING_SEED);

    expect(cuesOf(opened.run).map((cue) => cue.kind)).toEqual(['woke']);
    expect(opened.message).toBe(wakeMessage(1));
  });

  it('is silent on an opening that woke nothing, which is most of them', () => {
    // The other half, and the reason the defect was invisible: the shipped seed is one of these, so
    // "always blank" and "blank because nothing woke" look identical on `emberdepth` forever.
    const opened = openRun(QUIET_SEED);

    expect(cuesOf(opened.run)).toEqual([]);
    expect(opened.message).toBeNull();
  });

  it('describes the run it returns, never a second run begun to describe the first', () => {
    // `openRun` hands back the pair from one `beginRun` call. A caller that began a run and then
    // asked a separate helper for "the opening message for this seed" would be describing a
    // different run object — identical today, and a silent lie the moment a run stops being a pure
    // function of its seed alone (a resumed save, #47's platform seed, a daily challenge).
    const opened = openRun(WAKING_SEED);
    expect(opened.message).toBe(describeTurn(cuesOf(opened.run)));
    expect(sceneOf(opened.run).hud.floor.number).toBe(1);
  });

  it('is pure: the same seed opens the same run with the same line, twice', () => {
    for (const seed of [WAKING_SEED, QUIET_SEED, '']) {
      expect(openRun(seed).message, seed).toBe(openRun(seed).message);
    }
  });

  it('speaks on roughly one opening in ten, which is why one fixed seed could hide it', () => {
    // The measurement the review made, pinned. Two claims live here and both matter: the rule fires
    // **often enough to matter** (a launch in ten, and under #83 that is an unannounced hunter), and
    // **rarely enough that a single seed is not evidence** — which is exactly how this shipped.
    //
    // The bounds are deliberately loose. This is a property of the level generator (§5 keeps
    // creatures out of the entrance room, so only light through a doorway can find one), and a
    // generator change is entitled to move it. A change that took it to 0 or to 1 would mean the
    // opening flash had stopped being a wager, and that is worth failing for.
    const seeds = Array.from({ length: 200 }, (_, i) => `open-${i}`);
    const speaking = seeds.filter((seed) => openRun(seed).message !== null);

    expect(speaking.length).toBeGreaterThan(4);
    expect(speaking.length).toBeLessThan(60);
    // And every one of them says a wake sentence — never a move, a blow or a floor change, which
    // would mean the opening had started being diffed against something.
    const sentences = [1, 2, 3, 4, 5, 6].map(wakeMessage);
    for (const seed of speaking) expect(sentences, seed).toContain(openRun(seed).message);
  });
});

describe('the screen uses it — for the first run and for RUN AGAIN alike', () => {
  /**
   * A source assertion, and the reason for it is stated rather than assumed.
   *
   * `app/index.tsx` imports `react-native`, so Vitest cannot load it, and the fixed seed means no
   * E2E can reach an opening that wakes (see this file's header). That leaves reading the file.
   * There is precedent — `tests/unit/infrastructure.test.ts` scans sources for layer violations that
   * no runtime test can observe — and the bar is the same: assert the *shape of the mistake*, not
   * the formatting.
   *
   * These two go red against the version of `app/index.tsx` that shipped this defect, which is the
   * whole point of writing them.
   */
  it('does not start the line at a literal, which is the defect verbatim', () => {
    expect(CODE, 'the opening line must come from the run, not from a literal').not.toMatch(
      /useState<string \| null>\(\s*null\s*\)/,
    );
    expect(CODE, 'a restart must not clear the line it has just been given').not.toMatch(
      /setMessage\(\s*null\s*\)\s*;?\s*\n\s*\}, \[\]\)/,
    );
  });

  it('routes both the first run and the restart through `openRun`', () => {
    // Two call sites, because there are two ways a fresh run appears on this screen and only one of
    // them was ever going to be remembered. `beginRun` must not be reached for either: it returns a
    // `Run` and no sentence, which is precisely the shape that lost the line.
    expect(CODE.match(/openRun\(SEED\)/g) ?? [], 'openRun(SEED), twice').toHaveLength(2);
    expect(CODE, 'the screen no longer begins a run without describing it').not.toMatch(
      /\bbeginRun\s*\(/,
    );
  });
});
