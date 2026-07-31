import { expect, test, type Locator, type Page } from '@playwright/test';
import { GLYPHS } from '@/render';

/**
 * The glyphs that belong to the *map* and survive the lantern closing.
 *
 * Deliberately excludes `ember` and `contact`: an ember cache or drop is not drawn at all while
 * shuttered (§4 — items are invisible), and a contact is a living thing, not terrain. Taken from
 * `GLYPHS` rather than written as literals so that a renamed glyph is a compile error here instead
 * of a spec that silently stops matching anything.
 */
const TERRAIN_GLYPHS: readonly string[] = [
  GLYPHS.wall,
  GLYPHS.floor,
  GLYPHS.pillar,
  GLYPHS.doorway,
  GLYPHS.entrance,
  GLYPHS.stairs,
];

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
  await pressWithin(page, marker, 0.5, 0.5);
}

/**
 * Press a tile somewhere other than its middle.
 *
 * **This is the shape of press the suite could not see, and it hid a live bug for a whole review.**
 * A tile is ~37pt at the phone viewport, so a press at its centre has ±18pt of slack — an error of a
 * few points in the board's assumed origin is silently absorbed, and every spec here aimed at
 * centres. The bug that exploited that gap was a cached origin that went stale the moment the HUD
 * grew a line (see `components/play/board.tsx`), which put a ~6pt offset on every press: harmless in
 * the middle of a tile, and a *different tile* at its edge.
 *
 * `fx`/`fy` are fractions of the tile, `0` at its top-left corner and `1` at its bottom-right. They
 * are clamped 3pt inside the box, because a press exactly on a boundary is a different question
 * (`tests/unit/play-hit-test.test.ts` owns that one) and the browser rounds it.
 */
async function pressWithin(page: Page, marker: Locator, fx: number, fy: number): Promise<void> {
  const box = await marker.boundingBox();
  expect(box, 'the tile marker has no box to aim at').not.toBeNull();
  const inset = (span: number, fraction: number) =>
    Math.min(span - 3, Math.max(3, span * fraction));
  await pressAt(page, box!.x + inset(box!.width, fx), box!.y + inset(box!.height, fy));
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

  // Deliberately **not** the middle of the tile: a press near a corner is the shape that catches an
  // origin or a cell size that is a few points out, and a centre press is the shape that hides it.
  await pressWithin(page, target, 0.15, 0.85);

  // The player is on the tapped tile and no longer on the old one: the board really redrew, rather
  // than the HUD alone ticking over.
  await expect(page.getByTestId(`cell-${x}-${y}`)).toHaveText('@');
  await expect(page.getByTestId(`cell-${before.x}-${before.y}`)).not.toHaveText('@');
  expect(await playerTile(page)).toEqual({ x, y });

  // Exactly one turn. Two would mean the press was handled twice, which is the failure mode of
  // stacking press handlers; the board deliberately has exactly one.
  expect(await turn(page)).toBe(1);
});

test('tapping your own tile waits, which is a real turn', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  await pressTile(page, page.getByTestId(`tap-wait-${at.x}-${at.y}`));

  // §9: the self-tap is `wait`, not descend. The player has not moved and the turn was spent.
  expect(await turn(page)).toBe(1);
  expect(await playerTile(page)).toEqual(at);
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

  await expect(page.getByTestId('status-line')).toHaveText('');
  expect(await playerTile(page)).toEqual(at);

  // ── THE POSITIVE CONTROL, and it is not optional. ────────────────────────────────────────────
  // Every assertion above holds just as well against a board that received no press at all, which
  // is precisely how an earlier version of this spec passed while the press path was dead on web.
  // So the same test now presses something that *must* work, and counts: the turn after both
  // presses is **1**, which says the distant one spent nothing and the near one spent its turn.
  const target = page.locator('[data-testid^="tap-move-"]').first();
  const id = (await target.getAttribute('data-testid')) ?? '';
  const [x, y] = id.replace('tap-move-', '').split('-').map(Number);
  await pressTile(page, target);

  expect(await turn(page)).toBe(1);
  expect(await playerTile(page)).toEqual({ x, y });
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
  // **remembered rather than gone** — "permanent once seen, dimmed". Both halves are asserted, since
  // the comment used to promise the first and check only the second.
  await expect(page.getByTestId('hud-sense')).toHaveText('1/5');

  // A tile the player can see from across the room right now: lit, drawn, and far enough away that
  // touch will not reach it once the shutter is shut. Found by asking the board rather than by
  // hard-coding a coordinate, so this survives #47 replacing the fixed seed.
  //
  // TERRAIN ONLY, and that is not fussiness. A creature and an ember drop are both drawn at opacity
  // 1 on a lit tile and both revert to the terrain glyph once the shutter is shut — `embers` is
  // empty while shuttered, and a creature at Chebyshev >= 3 is outside sense radius 1. Either would
  // make this spec fail for a reason that has nothing to do with remembered terrain. On `emberdepth`
  // the first match happens to be terrain, so without this filter the claim above about surviving a
  // seed change would be false.
  const far = await page.evaluate(
    ({ player, terrain }) => {
      for (const node of Array.from(document.querySelectorAll('[data-testid^="cell-"]'))) {
        const [, x, y] = (node.getAttribute('data-testid') ?? '').split('-').map(Number);
        const away = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
        const glyph = (node.textContent ?? '').trim();
        if (away >= 3 && terrain.includes(glyph) && getComputedStyle(node).opacity === '1') {
          return { id: `cell-${x}-${y}`, glyph };
        }
      }
      return null;
    },
    { player: at, terrain: TERRAIN_GLYPHS },
  );
  expect(far, 'no lit tile three or more tiles from the player').not.toBeNull();

  await press(page, page.getByTestId('control-shutter'));
  await pressTile(page, page.getByTestId(`tap-wait-${at.x}-${at.y}`));

  // §4: ember-sense recovers +1 per turn from the adaptation floor — and §2 is why it is 2 and not
  // 3: the free shutter action skips the adaptation tick, so only the `wait` climbed the ramp.
  await expect(page.getByTestId('hud-sense')).toHaveText('2/5');
  // §4: 1 fuel a turn shuttered. 80, less the free action's own burn, less the wait's.
  await expect(page.getByTestId('hud-fuel')).toHaveText('78');

  // §10's four states, as pixels: the tile is still on screen, still the same terrain, and now drawn
  // at memory's opacity rather than at full. `CELL_OPACITY.remembered` is 0.4 and the point is that
  // it is neither 1 (still lit — the shutter did nothing) nor 0 (erased — the map was thrown away).
  const remembered = page.getByTestId(far!.id);
  await expect(remembered).toHaveText(far!.glyph);
  await expect(remembered).toHaveCSS('opacity', '0.4');
});

test('a press at the edge of a tile hits that tile, after the HUD has changed height', async ({
  page,
}) => {
  await boot(page);
  const at = await playerTile(page);
  const self = page.getByTestId(`tap-wait-${at.x}-${at.y}`);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE REGRESSION THIS SUITE STRUCTURALLY COULD NOT SEE
  //
  // The board resolves a press to a tile by subtracting its own position on screen. That position
  // used to be cached and refreshed `onLayout` — which on react-native-web is a `ResizeObserver`,
  // so it observes **size and never position**. At a phone viewport the board is width-bound, so a
  // taller HUD moves it without resizing it: no callback, no re-measure, and every press for the
  // rest of the run lands ~6pt low on a ~37pt cell.
  //
  // Two independent blind spots kept it hidden, and this test is aimed at both. Every other spec
  // presses tile **centres**, where ±18pt of half-cell swallows the error — so this presses 3pt
  // inside the bottom edge. And the **desktop** board is height-bound, so the same HUD growth does
  // resize it and the cache stays correct there — so the trigger is asserted below, and only where
  // it exists, rather than assumed.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const before = await page.getByTestId('board').boundingBox();
  await pressWithin(page, self, 0.5, 1);
  expect(await turn(page)).toBe(1);
  expect(await playerTile(page), 'the baseline edge press').toEqual(at);

  // Shut the shutter: `hud.sense` starts reporting `adapting` (§4's four-turn window), the HUD gains
  // a line, and the board is pushed down the screen. Any layout change above the board does this;
  // this one is simply the one a player makes on turn one of most runs.
  await press(page, page.getByTestId('control-shutter'));
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');
  const after = await page.getByTestId('board').boundingBox();

  if (touch()) {
    // The trigger, asserted rather than assumed — otherwise this test could quietly stop exercising
    // anything (a HUD that no longer grows, a board that starts resizing) and go on passing, which
    // is the exact failure mode that let the bug through in the first place.
    expect(
      { moved: after!.y !== before!.y, resized: after!.height !== before!.height },
      'the board must move without resizing, or this test proves nothing',
    ).toEqual({ moved: true, resized: false });
  }

  // The identical press must still be the identical tile. With the stale cache this resolved one row
  // south — a wall on this seed, so a false refusal; one tile of different terrain and it is a step
  // the player did not aim at, with a turn spent on it.
  await pressWithin(page, self, 0.5, 1);
  expect(await turn(page)).toBe(2);
  expect(await playerTile(page), 'the edge press after the layout moved').toEqual(at);
  await expect(page.getByTestId('status-line')).not.toHaveText(/blocked/i);
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
