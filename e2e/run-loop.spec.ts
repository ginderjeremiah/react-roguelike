import { expect, test, type Page } from '@playwright/test';
import { DEATH_MARKER, DEATH_VERDICT, VICTORY_MARKER, VICTORY_VERDICT } from '@/render';
import { RUN_OVER_MESSAGE } from '@/components/play/messages';
import { boot, playerCell, press, pressCell, turn, wander } from './support/drive';

/**
 * GDD §13's run loop, end to end: a run that ends, a summary that says how, and another run.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHICH TIER COVERS WHICH ENDING, AND WHY BOTH ARE HERE
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * §13 has exactly two endings and **one of them is a win**, so a suite that only ever kills the
 * player has never seen half of what this issue built. Both are driven here, at different cost:
 *
 *   - **Death** is cheap — about twenty presses — and carries the full loop: the summary, the board
 *     going quiet, and RUN AGAIN putting a fresh run on screen with no reload.
 *   - **Reaching the bottom** costs eight floors of walking and carries the things only a win can
 *     show: `8/8`, the victory verdict, and the fact that the eighth descent ends the run instead of
 *     generating a floor 9.
 *
 * `render/summary.test.ts` covers both endings at the unit tier as well, against real scripted runs.
 * What that tier structurally cannot see is whether any of it reached a screen, which is this file.
 *
 * ── ON REACHING THE STAIRS WITHOUT A ROUTE ─────────────────────────────────────────────────────
 * #20 left `onDescend` uncovered because a recorded move sequence dies silently when #47 replaces
 * the fixed seed, and a pathfinder in a spec puts routing above `session/`. `wander` in
 * `support/drive.ts` is neither — it presses the least-pressed tap target and knows nothing about
 * where anything is. The assertion the reviewer asked for, and the one that pins the wiring, is that
 * **`hud-floor` increments**: descend is the only thing in the game that can move it.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

/**
 * Press budgets. A wander that exceeds one throws rather than passing quietly.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THESE ARE MEASURED HEADROOM OVER `emberdepth`, AND THEY STOP BEING MEASUREMENTS AT #47
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Observed on the fixed seed: **21 presses to a death, 52 to floor 1's stairs, 830 to the bottom.**
 * Each budget is roughly 3x its observation, which is headroom for a `wander` that takes a different
 * turn — not a guess.
 *
 * **Two things will invalidate them, and both deserve to be seen coming.**
 *
 * *Tuning.* `wander` with `onContact: 'strike'` fights whatever it meets, so it can die on the way
 * down. Any change to the Cinder's numbers, to the fuel economy, or to level generation can turn the
 * eight-floor wander into a death — and the failure would be `REACHED THE BOTTOM` versus `DIED` at an
 * assertion that says nothing about the run loop. If that is what you are looking at, the run loop is
 * probably fine and the balance moved.
 *
 * *#47.* The moment the seed comes from a clock, none of the three numbers above is an observation
 * any more; they become bets on an unseeded distribution, and the wander's route stops being the same
 * route twice. That is when this file starts to flake, and the fix is to measure the distribution
 * rather than to raise the budgets until it goes quiet.
 */
const DEATH_PRESSES = 250;
const STAIRS_PRESSES = 300;
const BOTTOM_PRESSES = 2500;

async function summaryShown(page: Page): Promise<boolean> {
  return (await page.getByTestId('run-summary').count()) > 0;
}

async function onTheStairs(page: Page): Promise<boolean> {
  return (await page.getByTestId('control-descend').count()) > 0;
}

/**
 * An orthogonal neighbour of the player that is not a wall — the tile a step would land on.
 *
 * Read off the **glyphs**, because a finished run has no tap markers to read (`render/taps.ts`
 * returns an empty list once the run is over) and this has to work identically on both sides of the
 * ending. That identity is the whole point: it is what makes the refusal and its positive control
 * the same measurement rather than two different ones.
 */
async function stepTarget(page: Page): Promise<{ x: number; y: number }> {
  const at = await playerCell(page);
  const found = await page.evaluate((player) => {
    const steps = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    for (const step of steps) {
      const x = player.x + step.x;
      const y = player.y + step.y;
      const node = document.querySelector(`[data-testid="cell-${x}-${y}"]`);
      const glyph = (node?.textContent ?? '').trim();
      // `·` is §10's floor. Not a wall, not a pillar, not a creature, not the void.
      if (glyph === '·') return { x, y };
    }
    return null;
  }, at);
  expect(found, 'the player has no open floor tile beside them').not.toBeNull();
  return found!;
}

test('a run that ends in death: the summary reads, the board goes quiet, and you can run again', async ({
  page,
}) => {
  test.slow();
  await boot(page);

  // ── CONTROL: THE PRESS HELPER ITSELF WORKS ───────────────────────────────────────────────────
  // Narrow, and stated narrowly. This proves that `pressCell` — a press at the centre of a cell's
  // measured box — reaches the board's handler and spends a turn **in the running layout**. It does
  // not, on its own, say anything about the ended layout; that is what the acknowledgement below is
  // for, and the two used to be conflated here.
  const opening = await stepTarget(page);
  await pressCell(page, opening.x, opening.y);
  expect(await turn(page), 'the running board must accept a cell-centre press').toBe(1);
  expect(await playerCell(page)).toEqual(opening);

  // §13's first ending: stand still beside something awake and let it finish the job. `endure` is
  // the one line that makes this a death rather than a cleared floor — striking back wins the fight.
  await wander(page, {
    stop: summaryShown,
    onContact: 'endure',
    descend: false,
    relight: true,
    limit: DEATH_PRESSES,
  });

  // ── THE SUMMARY ──────────────────────────────────────────────────────────────────────────────
  await expect(page.getByTestId('run-summary')).toBeVisible();
  await expect(page.getByTestId('summary-verdict')).toHaveText(DEATH_VERDICT);
  await expect(page.getByTestId('summary-marker')).toHaveText(DEATH_MARKER);
  await expect(page.getByTestId('summary-headline')).not.toHaveText('');

  // §13's four numbers. The build note under the board is a running-run thing and has gone with the
  // controls, so the summary's own count is now the only turn counter on screen — which is the point
  // of asserting against it below rather than against the footer it replaced.
  await expect(page.getByTestId('seed-note')).toHaveCount(0);
  const spent = Number(await page.getByTestId('summary-turns').textContent());
  expect(spent, 'a run that ended must have taken turns').toBeGreaterThan(0);
  await expect(page.getByTestId('summary-floors')).toHaveText(/^[1-8]\/8$/);
  await expect(page.getByTestId('summary-kills')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('summary-fuel')).toHaveText(/^\d+$/);
  // Pillar 4: the run is a shareable artifact, and this is the half of it a player can read.
  await expect(page.getByTestId('summary-seed')).toContainText('emberdepth');

  // §13: the final frame is the killing blow, so the board is still there and the player is still on
  // it. A summary that erased the board would delete the one thing the simulation preserved.
  const grave = await playerCell(page);
  await expect(page.getByTestId(`cell-${grave.x}-${grave.y}`)).toHaveText('@');
  // §11's non-colour carrier for a critical meter, on the reading that ended the run.
  await expect(page.getByTestId('hud-hp')).toHaveText('! 0/12');

  // The controls the summary replaced are gone rather than dead: §13 refuses every command, and a
  // control that cannot do anything must not be offered.
  await expect(page.getByTestId('control-shutter')).toHaveCount(0);
  await expect(page.getByTestId('control-descend')).toHaveCount(0);
  await expect(page.getByTestId('status-line')).toHaveCount(0);
  // And the board stops inviting taps at all — `render/taps.ts` empties the list for a finished run,
  // so there is not one ring left on screen.
  await expect(page.locator('[data-testid^="tap-"]')).toHaveCount(0);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE BOARD REFUSES — AND THE REFUSAL IS OBSERVABLE, WHICH IS THE ONLY REASON THIS CAN FAIL
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // "Nothing happened" is exactly what a dead handler looks like, and a run-over board is nothing
  // but legitimate refusals — so for as long as this press produced no output at all, no assertion
  // here could tell the two apart. A review mutant proved it: making `onTapTile` a no-op **only
  // while the summary is mounted** (#20's shipped bug, transposed onto the new band) left all four
  // of these specs green.
  //
  // So the refusal was given the thing §2 says it always owed the player: a line acknowledging the
  // tap (`RUN_OVER_MESSAGE`). It is the one refusal in the game with no cue behind it — the tap list
  // is empty at the ending, so nothing ever reaches `step` — and it is now the observable that
  // separates *reached and refused* from *never reached*.
  await expect(page.getByTestId('summary-note'), 'nothing has been refused yet').toHaveText('');
  const target = await stepTarget(page);
  const boardBefore = await page.getByTestId('board').boundingBox();

  // Where a press at that point actually lands. The plausible way for a press to miss is the ~200pt
  // panel overlapping the board, and this converts that from "the geometry spec covers it elsewhere"
  // into a fact asserted at the exact coordinate this test is about to press.
  //
  // It resolves to the **board**, not to a cell: the grid is `pointerEvents="none"` (`board.tsx` —
  // one press handler for the whole board, deliberately), so hit testing passes straight through the
  // glyphs to the one surface underneath them. That is the element a press has to reach.
  const hit = await page.evaluate((at) => {
    const cell = document.querySelector(`[data-testid="cell-${at.x}-${at.y}"]`);
    const box = cell!.getBoundingClientRect();
    const node = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      onBoard: node !== null && node.closest('[data-testid="board"]') !== null,
      underSummary: node !== null && node.closest('[data-testid="run-summary"]') !== null,
    };
  }, target);
  expect(hit, 'the press must land on the board, not on the summary over it').toEqual({
    onBoard: true,
    underSummary: false,
  });

  await pressCell(page, target.x, target.y);

  // The press was received and refused: the run did not advance, nobody moved, and the screen said
  // so. Remove any one of those three and the assertion stops meaning what it says.
  // The constant, not a copy of it — `tests/unit/play-messages.test.ts` is what stops it being
  // empty, which is the one value that would make the assertion above and this one agree vacuously.
  await expect(page.getByTestId('summary-note'), 'the refusal must be acknowledged').toHaveText(
    RUN_OVER_MESSAGE,
  );
  await expect(page.getByTestId('summary-turns'), 'a finished run spends no turns').toHaveText(
    String(spent),
  );
  expect(await playerCell(page), 'a finished run moves nobody').toEqual(grave);
  await expect(page.getByTestId('run-summary')).toBeVisible();

  // And the acknowledgement did not move the thing that was pressed. The note shares the seed's row
  // and that row reserves its height (`run-summary.tsx`) precisely so this holds — a panel that grew
  // by a line on every press would slide the board under the thumb, which is #20's stale-origin bug
  // arriving from the other direction. A one-pixel tolerance for sub-pixel layout, and no more.
  const settled = await page.getByTestId('board').boundingBox();
  expect(Math.abs(settled!.y - boardBefore!.y), 'the board must not move when a tap is refused')
    .toBeLessThanOrEqual(1);
  expect(Math.abs(settled!.height - boardBefore!.height)).toBeLessThanOrEqual(1);

  // ── AND THE REST OF THE SCREEN IS NOT FROZEN EITHER ──────────────────────────────────────────
  await press(page, page.getByTestId('control-restart'));

  // §13's loop, closed. A fresh run, in place, no reload: floor 1, full HP, the opening reserve, and
  // a turn counter back at zero.
  await expect(page.getByTestId('run-summary')).toHaveCount(0);
  await expect(page.getByTestId('hud-floor')).toHaveText('1/8');
  await expect(page.getByTestId('hud-hp')).toHaveText('12/12');
  await expect(page.getByTestId('hud-fuel')).toHaveText('80');
  await expect(page.getByTestId('control-shutter')).toHaveCount(1);
  // Empty **because this seed's opening light finds nobody**, not because a fresh run is silent by
  // rule. §4 opens the lantern and `beginRun` runs phase 3, so a restart carries whatever that woke
  // (§4/#79) — about one seed in ten, measured in `tests/unit/play-opening.test.ts`. What this line
  // pins here is the thing the restart *must* clear: the last run's death. `The lantern goes out.`
  // was on this line one press ago, and RUN AGAIN must not leave it under a board with 12 HP on it.
  await expect(page.getByTestId('status-line')).toHaveText('');
  // The build note is back with the run it belongs to, and it is counting from zero again.
  await expect(page.getByTestId('seed-note')).toHaveCount(1);
  expect(await turn(page)).toBe(0);

  // ── CONTROL: THE HELPER STILL WORKS AFTERWARDS ───────────────────────────────────────────────
  // The same helper, the same geometry, the same browser, on the other side of a restart. This and
  // the control at the top of the test bracket the *press helper* — they say the mechanism is live
  // before and after, which is worth having and is **not** what proves the refusal was reached. The
  // acknowledgement above is what proves that, and it is the only thing that does.
  const again = await stepTarget(page);
  await pressCell(page, again.x, again.y);
  expect(await turn(page), 'the restarted board must accept the very same press').toBe(1);
  expect(await playerCell(page)).toEqual(again);
});

test('taking the stairs advances the floor', async ({ page }) => {
  test.slow();
  await boot(page);

  // In the dark, because §4 wakes nothing while the shutter is shut — so this measures the descent
  // wiring and cannot end in a death partway there and quietly test something else.
  await press(page, page.getByTestId('control-shutter'));
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');

  await wander(page, {
    stop: onTheStairs,
    onContact: 'strike',
    descend: false,
    relight: false,
    limit: STAIRS_PRESSES,
  });

  // §9: the control's presence *is* the confirmation that you are standing on the stairs, and its
  // copy is not floor 9's — there is no floor 9 (§13).
  await expect(page.getByTestId('control-descend')).toBeVisible();
  await expect(page.getByTestId('control-descend')).toContainText('to floor 2');
  await expect(page.getByTestId('hud-floor')).toHaveText('1/8');

  await press(page, page.getByTestId('control-descend'));

  // THE ASSERTION THIS TEST EXISTS FOR. `onDescend` was the one line in `app/index.tsx` with no
  // coverage at any tier, and the floor number is the only thing in the game a descent can move —
  // wiring the control to `wait` or to `setShutter` fails right here.
  await expect(page.getByTestId('hud-floor')).toHaveText('2/8');
  await expect(page.getByTestId('status-line')).toHaveText(/floor 2/);
  // §13: the map does not cross the stairs. A fresh floor, and the run is still going.
  await expect(page.getByTestId('run-summary')).toHaveCount(0);
});

/**
 * The win, on the phone project only.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ONE PROJECT, BECAUSE THE SECOND COPY IS 30 SECONDS OF THE SAME 830 PRESSES
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Measured: this spec is **34.1s on phone and 32.2s on desktop**, against ~5s for the entire rest of
 * the suite, and landing it took CI's Build & E2E job from ~1m50s to 4m2s. The desktop copy walks the
 * same fixed seed by the same rule to the same ending — it is the same run, twice, differing only in
 * press transport, which every other spec here already covers in both projects.
 *
 * The phone is the design target (Pillar 3), so that is the copy that survives. This halves both the
 * runner cost and the flake surface of the slowest thing in the suite.
 */
test('a run that reaches the bottom is a win, and says so', async ({ page }) => {
  test.skip(
    test.info().project.name !== 'phone',
    'eight floors of walking; the phone is the design target and the desktop copy adds no coverage',
  );
  test.slow();
  test.setTimeout(180_000);
  await boot(page);

  // §13's second ending, the one that is a *win*: take the stairs on floor 8. Eight floors of
  // walking is what this costs, and there is no shortcut that does not put a route in the spec.
  await wander(page, {
    stop: summaryShown,
    onContact: 'strike',
    descend: true,
    relight: true,
    limit: BOTTOM_PRESSES,
  });

  await expect(page.getByTestId('summary-verdict')).toHaveText(VICTORY_VERDICT);
  await expect(page.getByTestId('summary-marker')).toHaveText(VICTORY_MARKER);
  // §13: "there is no floor 9". The eighth descent is the ending, so the run ends *on* floor 8.
  await expect(page.getByTestId('summary-floors')).toHaveText('8/8');
  await expect(page.getByTestId('hud-floor')).toHaveText('8/8');
  // A win is not a death: the two endings must not share a screen, and the marker and the verdict
  // are the two non-colour channels that carry the difference (§11).
  await expect(page.getByTestId('summary-verdict')).not.toHaveText(DEATH_VERDICT);
  await expect(page.getByTestId('summary-marker')).not.toHaveText(DEATH_MARKER);

  // The loop closes the same way from either ending.
  await press(page, page.getByTestId('control-restart'));
  await expect(page.getByTestId('hud-floor')).toHaveText('1/8');
  expect(await turn(page)).toBe(0);
});

test('the summary fits a phone, with a thumb-sized way back in', async ({ page }) => {
  test.slow();
  await boot(page);
  await wander(page, {
    stop: summaryShown,
    onContact: 'endure',
    descend: false,
    relight: true,
    limit: DEATH_PRESSES,
  });

  // Pillar 3, on the screen a player reads most carefully. The four-stat band is the part that
  // wraps first, and `tests/unit/play-run-summary.test.ts` budgets it in points; this is the check
  // that the budget was about the right layout.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, 'the summary must not scroll the page sideways').toBe(false);

  const box = await page.getByTestId('control-restart').boundingBox();
  expect(Math.min(box!.width, box!.height), 'RUN AGAIN').toBeGreaterThanOrEqual(44);

  // ── THE BOARD SURVIVES THE SUMMARY APPEARING, AND DOES NOT LAND ON TOP OF ANYTHING ───────────
  // §13's final frame has to still be readable, and the panel is the largest layout change in the
  // game — it replaces a ~100pt band of controls with a ~200pt one, so the board has to give up a
  // fifth of its height. `app/index.tsx` sizes the board from a *measured* space, which means it is
  // one frame behind any change above it, so this is asserted with a retry: what is being pinned is
  // where the layout settles, not what the intermediate frame looked like.
  await expect(async () => {
    const board = await page.getByTestId('board').boundingBox();
    const hud = await page.getByTestId('hud').boundingBox();
    const panel = await page.getByTestId('run-summary').boundingBox();
    expect(board!.height, 'the board must survive the summary appearing').toBeGreaterThan(120);
    expect(board!.y, 'the board must not ride up over the HUD').toBeGreaterThanOrEqual(
      hud!.y + hud!.height - 1,
    );
    expect(board!.y + board!.height, 'the board must not run under the summary').toBeLessThanOrEqual(
      panel!.y + 1,
    );
  }).toPass();

  // All four numbers are on screen at once — a summary you have to scroll is a summary nobody reads.
  for (const key of ['floors', 'kills', 'fuel', 'turns']) {
    await expect(page.getByTestId(`summary-${key}`)).toBeInViewport();
  }
});
