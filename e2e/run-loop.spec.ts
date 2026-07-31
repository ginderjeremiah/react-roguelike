import { expect, test, type Page } from '@playwright/test';
import { DEATH_MARKER, DEATH_VERDICT, VICTORY_MARKER, VICTORY_VERDICT } from '@/render';
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

/** A press budget with room to spare. A wander that exceeds it throws rather than passing quietly. */
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

  // ── POSITIVE CONTROL, PART ONE ───────────────────────────────────────────────────────────────
  // Everything below about the ended board asserts that nothing happened, and "nothing happened" is
  // exactly what a dead press handler looks like — that is not hypothetical, it is #20's shipped
  // bug. So the same press, at the same kind of target, found the same way, is proved to work
  // *first*: press the centre of a cell's box and a turn is spent.
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

  // ── THE BOARD REFUSES, AND IT IS A REFUSAL RATHER THAN A DEAD HANDLER ─────────────────────────
  const target = await stepTarget(page);
  await pressCell(page, target.x, target.y);
  await expect(page.getByTestId('summary-turns'), 'a finished run spends no turns').toHaveText(
    String(spent),
  );
  expect(await playerCell(page), 'a finished run moves nobody').toEqual(grave);
  await expect(page.getByTestId('run-summary')).toBeVisible();

  // ── POSITIVE CONTROL, PART TWO ───────────────────────────────────────────────────────────────
  // The screen is not frozen: a press still reaches the application in this exact layout, and this
  // is the button that proves it.
  await press(page, page.getByTestId('control-restart'));

  // §13's loop, closed. A fresh run, in place, no reload: floor 1, full HP, the opening reserve, and
  // a turn counter back at zero.
  await expect(page.getByTestId('run-summary')).toHaveCount(0);
  await expect(page.getByTestId('hud-floor')).toHaveText('1/8');
  await expect(page.getByTestId('hud-hp')).toHaveText('12/12');
  await expect(page.getByTestId('hud-fuel')).toHaveText('80');
  await expect(page.getByTestId('control-shutter')).toHaveCount(1);
  await expect(page.getByTestId('status-line')).toHaveText('');
  // The build note is back with the run it belongs to, and it is counting from zero again.
  await expect(page.getByTestId('seed-note')).toHaveCount(1);
  expect(await turn(page)).toBe(0);

  // ── POSITIVE CONTROL, PART THREE ─────────────────────────────────────────────────────────────
  // The same helper, the same geometry, the same browser — and now a turn is spent. Together with
  // part one this brackets the refusal above: the mechanism used to press the ended board is one
  // that demonstrably reaches the handler both before the run ended and after a new one began.
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

test('a run that reaches the bottom is a win, and says so', async ({ page }) => {
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
