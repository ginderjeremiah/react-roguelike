import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Driving the built game the way a player drives it: real presses at real pixels.
 *
 * Shared by every spec in this directory, because "what a press is" is the one thing an E2E suite
 * must not have two answers to — #20 shipped a bug in which the board's press handler was dead on
 * web and the spec that covered it passed, and the repair only works if every spec presses the same
 * way. Nothing here asserts anything about the *game*; it is input, plus the two readouts a driver
 * needs to know when to stop.
 */

/** Whether the running project has touch emulation. The phone project does; the desktop one does not. */
export function touch(): boolean {
  return test.info().project.use.hasTouch === true;
}

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
export async function press(page: Page, locator: Locator): Promise<void> {
  if (touch()) await locator.tap();
  else await locator.click();
}

/** The same, at a raw coordinate. */
export async function pressAt(page: Page, x: number, y: number): Promise<void> {
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
export async function pressTile(page: Page, marker: Locator): Promise<void> {
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
export async function pressWithin(
  page: Page,
  marker: Locator,
  fx: number,
  fy: number,
): Promise<void> {
  const box = await marker.boundingBox();
  expect(box, 'the tile marker has no box to aim at').not.toBeNull();
  const inset = (span: number, fraction: number) =>
    Math.min(span - 3, Math.max(3, span * fraction));
  await pressAt(page, box!.x + inset(box!.width, fx), box!.y + inset(box!.height, fy));
}

/**
 * Press the centre of a **cell**, located by its own test id rather than by a tap marker.
 *
 * The distinction matters exactly once, and it is the reason this exists beside `pressTile`: a
 * finished run has **no tap markers at all** (`render/taps.ts` returns an empty list once the run is
 * over), so a spec that wants to press the board after the ending has nothing to aim at unless it
 * aims at the grid itself. Using the same function on both sides of the ending is what makes "the
 * board refused" and "the board would have accepted" the same measurement.
 */
export async function pressCell(page: Page, x: number, y: number): Promise<void> {
  await pressTile(page, page.getByTestId(`cell-${x}-${y}`));
}

/** The tile the player is standing on. The self-tap target sits on it and nowhere else (§9). */
export async function playerTile(page: Page): Promise<{ x: number; y: number }> {
  const id = await page.locator('[data-testid^="tap-wait-"]').first().getAttribute('data-testid');
  const [x, y] = (id ?? '').replace('tap-wait-', '').split('-').map(Number);
  expect(Number.isInteger(x) && Number.isInteger(y), `no self-tap target: ${id}`).toBe(true);
  return { x, y };
}

/**
 * The same, found by the glyph instead of by the tap target — so it still answers once the run is
 * over and the tap targets are gone. §10 draws `@` at the player's tile and nowhere else, and it is
 * drawn unconditionally, which is §13's "the last thing on screen is the thing that killed you".
 */
export async function playerCell(page: Page): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(() => {
    for (const node of Array.from(document.querySelectorAll('[data-testid^="cell-"]'))) {
      if ((node.textContent ?? '').trim() === '@') {
        const [, x, y] = (node.getAttribute('data-testid') ?? '').split('-').map(Number);
        return { x, y };
      }
    }
    return null;
  });
  expect(found, 'the player glyph is not on the board').not.toBeNull();
  return found!;
}

/** The turn counter, printed beside the fixed seed. `turnsElapsed` from the HUD (§13). */
export async function turn(page: Page): Promise<number> {
  const note = (await page.getByTestId('seed-note').textContent()) ?? '';
  return Number(/turn (\d+)/.exec(note)?.[1]);
}

export async function boot(page: Page): Promise<void> {
  await page.goto('/');
  // The board is sized from a measured layout, so it appears on the second render. Waiting for a
  // real target is more honest than a timeout and fails with a useful message.
  await expect(page.locator('[data-testid^="tap-wait-"]')).toHaveCount(1);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * REACHING AN ENDING WITHOUT A ROUTE AND WITHOUT A PATHFINDER
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * #20 left `onDescend` untested because the two obvious ways to stand on the stairs are both bad: a
 * recorded move sequence dies the day #47 replaces the fixed seed and fails **silently**, as "the
 * control never appeared"; and a breadth-first search inside the spec puts routing — a game
 * question — above `session/`, which is the seam this project exists to keep clean.
 *
 * `wander` is neither. It knows nothing about stairs, creatures, doors or distance. Each turn it
 * looks at the tap targets §9 put on screen and presses **the one it has pressed least**, which is
 * the whole algorithm. That is not routing, it is the absence of routing — it cannot aim at
 * anything, and it works on any floor of any seed because it reads the board it is given.
 *
 * The two behaviours it *does* take are choices about what kind of player it is, and each is one
 * line: `fight` decides whether an adjacent creature is struck or endured, and `descend` decides
 * whether the stairs are taken when offered. Between them they reach both of §13's endings on a
 * board neither of them can see.
 *
 * **`stop` is what a caller is really waiting for**, and it is a condition rather than a count so
 * that a wander cannot pass by arriving nowhere. Every caller asserts on what it found afterwards.
 */
export type WanderOptions = {
  /** Stop as soon as this is true. Checked before every press. */
  readonly stop: (page: Page) => Promise<boolean>;
  /**
   * What to do about an adjacent creature. `strike` bumps it (§3); `endure` spends the turn instead
   * and lets it hit back, which is the only way a player ever runs out of HP.
   */
  readonly onContact: 'strike' | 'endure';
  /** Take the stairs whenever §9 offers them. */
  readonly descend: boolean;
  /**
   * What kind of player this is about the lantern (§4). One line each, and since #149 the choice
   * decides how the run **ends** rather than only how much it sees:
   *
   *   - `hold` — keep it open, re-opening whenever there is fuel to. 4 a turn, so under §4's *The
   *     dark can take nothing* it is 20 turns from a full reserve to a fuel death. It used to be 20
   *     turns to 0 and then an unlimited free crawl, which is the rule that was deleted.
   *   - `crawl` — shutter at the first opportunity and never open again. 1 a turn and no income at
   *     all: **the never-flash line**, and it has 80 turns.
   *   - `flash` — crawl, but open the shutter for one command whenever there is a `♦` on or beside
   *     the player, which is what makes a drop takeable (§4). 5 fuel a flash against a 20-fuel drop.
   *     The only one of the three that earns anything.
   */
  readonly light: 'hold' | 'crawl' | 'flash';
  /** Give up after this many presses rather than hanging. Generous; failure is loud. */
  readonly limit: number;
};

/**
 * Wander until `stop`. Returns the number of presses it took.
 *
 * @throws if `limit` presses go by without stopping — a wander that ran out is a spec that proved
 *   nothing, and it must say so rather than fall through into assertions that read as passes.
 */
export async function wander(page: Page, options: WanderOptions): Promise<number> {
  const visits = new Map<string, number>();
  // Tiles this run has already flashed from. Without it a `flash` wander re-buys the same 4 fuel
  // every time it steps back beside a drop it did not manage to pick up, which is how a bot that is
  // supposed to be earning ends up spending twice what it takes. Cleared on a descent with `visits`.
  const flashedFrom = new Set<string>();

  const worthAFlash = async (): Promise<boolean> => {
    const at = await playerCell(page);
    const here = `${at.x},${at.y}`;
    if (flashedFrom.has(here) || !(await dropWithinReach(page))) return false;
    flashedFrom.add(here);
    return true;
  };

  for (let pressed = 0; pressed < options.limit; pressed += 1) {
    if (await options.stop(page)) return pressed;

    const shut = await shutterIsShut(page);
    const wantsOpen = options.light === 'hold' || (options.light === 'flash' && (await worthAFlash()));
    // The shutter is where it should not be: shut when this policy wants light, or open when it
    // wants the dark. Either way the fix is the same one press.
    if (shut === wantsOpen) {
      const control = page.getByTestId('control-shutter');
      if (await control.isEnabled()) {
        await press(page, control);
        continue;
      }
    }

    if (options.descend && (await page.getByTestId('control-descend').count()) > 0) {
      await press(page, page.getByTestId('control-descend'));
      // A new floor is a new map; where this walked upstairs says nothing about it.
      visits.clear();
      flashedFrom.clear();
      continue;
    }

    const attacks = await markerIds(page, 'tap-attack-');
    const moves = await markerIds(page, 'tap-move-');
    const self = await markerIds(page, 'tap-wait-');

    if (attacks.length > 0 && options.onContact === 'strike') {
      await pressMarker(page, attacks[0]);
    } else if (attacks.length > 0 || moves.length === 0) {
      // §9's self-tap is a real turn, and standing still beside something awake is how a run ends.
      await pressMarker(page, self[0]);
    } else {
      const target = leastVisited(moves, visits);
      visits.set(target, (visits.get(target) ?? 0) + 1);
      await pressMarker(page, target);
    }
  }

  throw new Error(`drive: ${options.limit} presses without stopping — the wander reached nothing`);
}

async function shutterIsShut(page: Page): Promise<boolean> {
  return (await page.getByTestId('hud-shutter').textContent()) === 'SHUT';
}

/**
 * Is there a `♦` on the player's tile or one of the eight around it?
 *
 * Read off the **glyphs**, which is only possible because #81 draws an uncollected drop wherever its
 * tile is perceived or remembered — lit or not. Before that ruling this function could not have been
 * written at all, and that is the point: the information a flash-to-collect decision needs is
 * information the player has.
 *
 * It cannot tell a drop from a lit cache, and does not need to: both are worth a flash and neither
 * is worth two, because the flash resolves whichever it was.
 */
async function dropWithinReach(page: Page): Promise<boolean> {
  const at = await playerCell(page);
  return page.evaluate((player) => {
    const steps = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    for (const step of steps) {
      const node = document.querySelector(
        `[data-testid="cell-${player.x + step.x}-${player.y + step.y}"]`,
      );
      if ((node?.textContent ?? '').trim() === '♦') return true;
    }
    return false;
  }, at);
}

async function markerIds(page: Page, prefix: string): Promise<readonly string[]> {
  return page
    .locator(`[data-testid^="${prefix}"]`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
}

async function pressMarker(page: Page, id: string): Promise<void> {
  await pressTile(page, page.getByTestId(id));
}

function leastVisited(ids: readonly string[], visits: ReadonlyMap<string, number>): string {
  let best = ids[0];
  for (const id of ids) {
    if ((visits.get(id) ?? 0) < (visits.get(best) ?? 0)) best = id;
  }
  return best;
}
