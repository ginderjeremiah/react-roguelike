import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The game screen, driven the way a player drives it: taps on tiles, taps on the thumb controls.
 *
 * Everything here goes through the real static export in a real browser, which is the only tier that
 * can see whether the wiring works (ADR-0005) — `render/` and `session/` are unit-tested and cannot
 * tell you that a `Pressable` swallowed a press or that the board never mounted.
 *
 * ## Two things make this suite writable at all
 *
 * **The board is DOM.** ADR-0003 chose glyph cells over a Skia canvas explicitly so that "Playwright
 * can assert that the correct entity is at the correct tile" — every cell is
 * `data-testid="cell-<x>-<y>"` with its glyph as text, so the assertions below read the actual board
 * rather than a screenshot's pixels.
 *
 * **The seed is a constant** (#47), so floor 1 is the same floor every run. That is what lets a spec
 * say "tap the tile north of the player and the player is now there" without first solving the level.
 * When #47 lands and the seed comes from a clock, the helpers below — which locate the player by
 * asking the DOM rather than by hard-coded coordinates — keep working. That is deliberate.
 *
 * The `tap-*` test ids are the touch targets `render/taps.ts` decided on, so their *names* carry
 * §9's classification: `tap-move-3-4` means the model says a tap there is a move to (3,4). Asserting
 * on them is asserting that the rule reached the screen.
 */

/**
 * A real press, in whichever way the running project can produce one.
 *
 * The **phone** project has touch emulation (`devices['Pixel 7']`) and is the design target, so it
 * gets a genuine `touchstart`/`touchend` pair — which is the input path `Pressable` actually takes on
 * a phone, and the one that would break if a handler were bound to a mouse event. The **desktop**
 * project has no touchscreen, and `locator.tap()` throws there rather than falling back. Running the
 * same spec both ways is the cheap version of "does this work on a laptop as well", and it is worth
 * more than skipping desktop outright.
 */
async function press(page: Page, locator: Locator): Promise<void> {
  if (touch()) await locator.tap();
  else await locator.click();
}

/** The same, at a raw coordinate. */
async function pressAt(page: Page, x: number, y: number): Promise<void> {
  if (touch()) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/**
 * Press the middle of a tile, at real screen coordinates.
 *
 * The board is **one** touch surface that resolves a point to a tile by arithmetic
 * (`components/play/hit-test.ts`), so aiming a real press at a real pixel is what a thumb does and
 * what the code has to survive. The `tap-*` markers are `pointerEvents: none` decorations; they are
 * used here only to locate the tile §9 classified, never as the thing that receives the press.
 */
async function pressTile(page: Page, marker: Locator): Promise<void> {
  const box = await marker.boundingBox();
  expect(box, 'the tile marker has no box to aim at').not.toBeNull();
  await pressAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
}

function touch(): boolean {
  return test.info().project.use.hasTouch === true;
}

/** The tile the player is standing on. The self-tap target sits on it and nowhere else (§9). */
async function playerTile(page: Page): Promise<{ x: number; y: number }> {
  const id = await page.locator('[data-testid^="tap-wait-"]').first().getAttribute('data-testid');
  const [x, y] = (id ?? '').replace('tap-wait-', '').split('-').map(Number);
  expect(Number.isInteger(x) && Number.isInteger(y), `no self-tap target: ${id}`).toBe(true);
  return { x, y };
}

/** The turn counter, printed beside the fixed seed. `turnsElapsed` from the HUD (§13). */
async function turn(page: Page): Promise<number> {
  const note = (await page.getByTestId('seed-note').textContent()) ?? '';
  return Number(/turn (\d+)/.exec(note)?.[1]);
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  // The board is sized from a measured layout, so it appears on the second render. Waiting for a
  // real target is more honest than a timeout and fails with a useful message.
  await expect(page.locator('[data-testid^="tap-wait-"]')).toHaveCount(1);
}

test('the board draws the opening floor with the player on it', async ({ page }) => {
  await boot(page);

  const at = await playerTile(page);
  await expect(page.getByTestId(`cell-${at.x}-${at.y}`)).toHaveText('@');

  // GDD §4's opening: floor 1, lantern open, 80 fuel — 20 turns at 4 a turn. §9 requires all five
  // readouts, and the fifth (ember-sense) is the one that gets dropped.
  await expect(page.getByTestId('hud-floor')).toHaveText('1/8');
  await expect(page.getByTestId('hud-hp')).toHaveText('12/12');
  await expect(page.getByTestId('hud-fuel')).toHaveText('80');
  await expect(page.getByTestId('hud-burn')).toHaveText('20 turns');
  await expect(page.getByTestId('hud-shutter')).toHaveText('OPEN');
  await expect(page.getByTestId('hud-sense')).toBeVisible();

  // §9: descend exists only on the stairs, and the run does not start there.
  await expect(page.getByTestId('control-descend')).toHaveCount(0);
  expect(await turn(page)).toBe(0);
});

test('tapping an adjacent tile moves the player, and the board changes', async ({ page }) => {
  await boot(page);
  const before = await playerTile(page);

  // A move target — §9's "tap an adjacent tile to move", as classified by `render/taps.ts`.
  const target = page.locator('[data-testid^="tap-move-"]').first();
  const id = (await target.getAttribute('data-testid')) ?? '';
  const [x, y] = id.replace('tap-move-', '').split('-').map(Number);

  await pressTile(page, target);

  // The player is on the tapped tile and no longer on the old one: the board really redrew, rather
  // than the HUD alone ticking over.
  await expect(page.getByTestId(`cell-${x}-${y}`)).toHaveText('@');
  await expect(page.getByTestId(`cell-${before.x}-${before.y}`)).not.toHaveText('@');
  expect(await playerTile(page)).toEqual({ x, y });

  // Exactly one turn. Two would mean the tap was handled twice — the board's fallback surface and
  // the target on top of it both firing, which is the failure mode of stacking two press handlers.
  expect(await turn(page)).toBe(1);
});

test('tapping your own tile waits, which is a real turn', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  await pressTile(page, page.getByTestId(`tap-wait-${at.x}-${at.y}`));

  // §9: the self-tap is `wait`, not descend. The player has not moved and the turn was spent.
  expect(await playerTile(page)).toEqual(at);
  expect(await turn(page)).toBe(1);
});

test('tapping an impassable neighbour does nothing, and says so', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  // §9: "an impassable neighbour is not a tap target". The model says so; this asserts the screen
  // agrees — and §2 requires the dead tap be acknowledged rather than swallowed.
  const wall = page.locator('[data-testid^="tap-blocked-"]').first();
  await expect(wall).toHaveCount(1);
  await pressTile(page, wall);

  await expect(page.getByTestId('status-line')).toHaveText(/blocked/i);
  expect(await playerTile(page)).toEqual(at);
  expect(await turn(page)).toBe(0);
});

test('tapping a distant tile is unbound — nothing happens at all', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  // ADR-0009: auto-travel is deferred to M2, and until then a distant tile has no gesture bound to
  // it. This taps the board's own surface far from the player, which is the path a travel command
  // will one day take — so it must be reachable, and must currently do nothing.
  const board = page.getByTestId('board');
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  await pressAt(page, box!.x + box!.width - 8, box!.y + box!.height - 8);

  expect(await playerTile(page)).toEqual(at);
  expect(await turn(page)).toBe(0);
  await expect(page.getByTestId('status-line')).toHaveText('');
});

test('the shutter control is a toggle that changes the burn rate', async ({ page }) => {
  await boot(page);

  // §4: 4 fuel a turn lit, 1 shuttered. The burn rate is the number that makes a flash legible, and
  // it is the observable proof that the command reached the simulation rather than a local mirror.
  await expect(page.getByTestId('hud-burn')).toHaveText('20 turns');
  await expect(page.getByTestId('hud-fuel')).toHaveText('80');
  await expect(page.getByTestId('control-shutter')).toHaveText(/CLOSE SHUTTER/);

  await press(page, page.getByTestId('control-shutter'));

  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');
  await expect(page.getByTestId('control-shutter')).toHaveText(/OPEN SHUTTER/);
  // §2: the toggle is free of **tempo**, not of **fuel** — the turn is not spent, and the turn's
  // burn still runs, at the rate the shutter now reads. 80 - 1, then 79 turns of reserve at 1 each.
  expect(await turn(page)).toBe(0);
  await expect(page.getByTestId('hud-fuel')).toHaveText('79');
  await expect(page.getByTestId('hud-burn')).toHaveText('79 turns');

  // And back. The control is a toggle; what it sends is the setting it is toggling to (§9) — so
  // this is `setShutter('open')` and not "the other one", and a flash costs its 4 (§4).
  await press(page, page.getByTestId('control-shutter'));
  await expect(page.getByTestId('hud-shutter')).toHaveText('OPEN');
  await expect(page.getByTestId('hud-fuel')).toHaveText('75');
  await expect(page.getByTestId('hud-burn')).toHaveText('18 turns');
  expect(await turn(page)).toBe(0);
});

test('shuttering hides the room and the ember-sense radius starts climbing', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  // §4's dark column: terrain drops to the eight tiles you can touch, and what you saw before is
  // remembered rather than gone. The observable version of that: a tile the player could see from
  // across the room is still drawn, and the sense radius readout starts moving.
  await expect(page.getByTestId('hud-sense')).toHaveText('1/5');
  await press(page, page.getByTestId('control-shutter'));
  await pressTile(page, page.getByTestId(`tap-wait-${at.x}-${at.y}`));

  // §4: ember-sense recovers +1 per turn from the adaptation floor — and §2 is why it is 2 and not
  // 3: the free shutter action skips the adaptation tick, so only the `wait` climbed the ramp.
  await expect(page.getByTestId('hud-sense')).toHaveText('2/5');
  // §4: 1 fuel a turn shuttered. 80, less the free action's own burn, less the wait's.
  await expect(page.getByTestId('hud-fuel')).toHaveText('78');
});

test('at 0 fuel the shutter control shows itself dead rather than doing nothing', async ({
  page,
}) => {
  test.slow();
  await boot(page);
  const at = await playerTile(page);

  // §4: "at 0 fuel the shutter can no longer be opened", and `game/systems/lantern.ts` says what the
  // renderer owes that: "a control that silently does nothing is worse than one that is visibly
  // dead". Getting there is the only slow thing in this suite — shuttered, the lantern burns 1 a
  // turn, so it takes the whole reserve. Done in the dark on purpose: nothing wakes while shuttered
  // (§4), so the run cannot end in a death on the way and test something else by accident.
  await press(page, page.getByTestId('control-shutter'));
  const self = page.getByTestId(`tap-wait-${at.x}-${at.y}`);
  const box = await self.boundingBox();

  for (let i = 0; i < 120; i += 1) {
    if ((await page.getByTestId('hud-fuel').textContent()) === '! 0') break;
    await pressAt(page, box!.x + box!.width / 2, box!.y + box!.height / 2);
  }

  // The `!` is §11's non-colour carrier for a critical meter: the reading survives greyscale.
  await expect(page.getByTestId('hud-fuel')).toHaveText('! 0');
  await expect(page.getByTestId('control-shutter')).toHaveText(/SHUTTER STUCK/);
  await expect(page.getByTestId('control-shutter')).toHaveText(/no fuel/);
  await expect(page.getByTestId('control-shutter')).toBeDisabled();

  // §4 is also explicit that a dry lantern is a desperate state and **not** a loss state. So the
  // board is still playable: the run has not ended and a step still costs a turn and resolves.
  await expect(page.getByTestId('status-line')).not.toHaveText(/lantern goes out/i);
  const spent = await turn(page);
  await pressTile(page, page.locator('[data-testid^="tap-move-"]').first());
  expect(await turn(page)).toBe(spent + 1);
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');
});

test('the whole screen fits a phone with no horizontal overflow', async ({ page }) => {
  // Pillar 3. The board is width-bound at eleven columns, so an off-by-one in the cell arithmetic
  // shows up here and nowhere else.
  await boot(page);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, 'the page must not scroll horizontally').toBe(false);

  // Every control a thumb has to find is at least 44pt on its short side.
  for (const id of ['control-shutter']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(Math.min(box!.width, box!.height), id).toBeGreaterThanOrEqual(44);
  }
  // The board's targets are 44pt by arithmetic rather than by geometry — a cell is ~34pt and each of
  // §9's five is widened to 44 in `hit-test.ts`, which `tests/unit/play-hit-test.test.ts` pins to the
  // point. What this tier can check is that the widening has somewhere to go: the dead diagonals it
  // spills into really are dead, so a press 5pt outside a target lands on nothing else.
  const at = await playerTile(page);
  const cell = await page.getByTestId(`cell-${at.x}-${at.y}`).boundingBox();
  expect(Math.min(cell!.width, cell!.height), 'the cell a target is widened from')
    .toBeGreaterThanOrEqual(30);
});
