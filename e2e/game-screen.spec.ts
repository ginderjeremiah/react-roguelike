import { expect, test, type Page } from '@playwright/test';
import { TOO_FAR_MESSAGE, wakeMessage } from '@/components/play/messages';
import { GLYPHS } from '@/render';
import {
  boot,
  playerCell,
  playerTile,
  press,
  pressAt,
  pressTile,
  pressWithin,
  touch,
  turn,
} from './support/drive';

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
 * The presses themselves live in `support/drive.ts`, shared with every other spec here — "what a
 * press is" is the one thing this suite must not have two answers to, given that #20's shipped bug
 * was a press path that was dead on web while its spec passed.
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

test('tapping a distant tile spends no turn, and says why', async ({ page }) => {
  await boot(page);
  const at = await playerTile(page);

  // ADR-0009: auto-travel is deferred to M2, and until then a distant tile has no gesture bound to
  // it. This taps the board's own surface far from the player, which is the path a travel command
  // will one day take — so it must be reachable, and must currently do nothing.
  const board = page.getByTestId('board');
  const box = await board.boundingBox();
  expect(box).not.toBeNull();
  await pressAt(page, box!.x + box!.width - 8, box!.y + box!.height - 8);

  // §2: the tap is acknowledged. This line was `toHaveText('')` until #60 — the spec asserted the
  // silence that the first playtest reported as the game looking broken, which is what an assertion
  // written from the implementation rather than from the rule gets you.
  //
  // It is also the observable this spec never had. Everything below used to rest on a turn counter,
  // and a turn counter cannot tell a working refusal from a handler that was never called.
  await expect(page.getByTestId('status-line')).toHaveText(TOO_FAR_MESSAGE.text);
  expect(await playerTile(page)).toEqual(at);

  // ── THE POSITIVE CONTROL. Weaker than it was, and kept anyway. ───────────────────────────────
  // Until #60 every assertion above held just as well against a board that received no press at
  // all — which is precisely how an earlier version of this spec passed while the press path was
  // dead on web. The message assertion now discriminates that on its own: a handler that never ran
  // writes no status line.
  //
  // This stays because it proves a *different* thing the message cannot: that the distant press
  // spent **no turn**. The count after both presses is 1, so the near press spent one and the
  // distant press spent none. Drop this and a distant tap that quietly advanced the run would pass.
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
  //
  // A run starts with the lantern OPEN, and ember-sense does not operate there at all — `perceive`
  // never calls `senseCreatures` on the open branch. This line used to assert `1/5` here, which is
  // the very lie #61 was filed about: a number that is inoperative now and discarded to the floor
  // the moment you shutter. The readout is sealed until the light goes out.
  await expect(page.getByTestId('hud-sense')).toHaveText('—/5');
  await expect(page.getByTestId('hud-sense-note')).toHaveText('sealed while lit');

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

  // #61's actual repro, and the state "a player sits in for most of a lit stretch": ramp to full,
  // then re-open. The unit tier covers this, but the browser tier is where the bug was *found*, so
  // it is covered here too. The reach must go back to sealed rather than reporting the 5 the run
  // just earned — `Vision.senseRadius` still holds 5 (that is where the ramp keeps its state), and
  // reporting it raw is what told the player they would keep it.
  for (let i = 0; i < 3; i += 1) await pressTile(page, page.getByTestId(`tap-wait-${at.x}-${at.y}`));
  await expect(page.getByTestId('hud-sense')).toHaveText('5/5');
  await expect(page.getByTestId('hud-sense-note')).toHaveCount(0);

  await press(page, page.getByTestId('control-shutter'));
  await expect(page.getByTestId('hud-shutter')).toHaveText('OPEN');
  await expect(page.getByTestId('hud-sense')).toHaveText('—/5');
  await expect(page.getByTestId('hud-sense-note')).toHaveText('sealed while lit');
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
  // inside an edge. And the **desktop** board is height-bound, so the same HUD growth does resize
  // it and the cache stays correct there — so the trigger is asserted below, and only where it
  // exists, rather than assumed.
  //
  // **WHICH edge is load-bearing, and it follows the direction the board moves.** A stale origin
  // shifts the resolved point by the same delta the board moved, so the press must start close
  // enough to a boundary *in that direction* to cross it. This test used the **bottom** edge while
  // the trigger pushed the board **down**; #61 changed the trigger to one that moves the board
  // **up**, and the bottom-edge press then stayed inside the same 37pt cell — the mutant passed and
  // the test proved nothing. Hence the **top** edge now. Verified by mutation both times: re-cache
  // the origin and this test must go red. If you change the trigger again, check the direction.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  const before = await page.getByTestId('board').boundingBox();
  await pressWithin(page, self, 0.5, 0);
  expect(await turn(page)).toBe(1);
  expect(await playerTile(page), 'the baseline edge press').toEqual(at);

  // Now change the HUD's height. **The trigger used to be the shutter press itself** — `hud.sense`
  // gained an `adapting` note where it had none, the HUD grew a line, and the board was pushed
  // down. #61 removed that trigger without touching this test: the sense stat now carries a note in
  // *both* shutter states (`sealed while lit` / `adapting`), so shuttering no longer changes the
  // HUD's height at all. The `moved: true` assertion below went red and said exactly that, which is
  // the whole reason it asserts the trigger instead of assuming it.
  //
  // The surviving trigger is the **end** of §4's ramp: at full adaptation `adapting` clears, the
  // note disappears, and the HUD loses the line it had. Same shape, opposite direction — the board
  // moves *up* without resizing, which exercises the stale cache identically.
  await press(page, page.getByTestId('control-shutter'));
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');
  await expect(page.getByTestId('hud-sense-note')).toHaveText('adapting');

  // Wait out the ramp. Each press is a real turn, so the turn count below accounts for them.
  const rampTurns = 4;
  for (let i = 0; i < rampTurns; i += 1) await pressTile(page, self);
  await expect(page.getByTestId('hud-sense-note')).toHaveCount(0);

  const after = await page.getByTestId('board').boundingBox();

  if (touch()) {
    // The trigger, asserted rather than assumed — otherwise this test could quietly stop exercising
    // anything (a HUD that no longer grows, a board that starts resizing) and go on passing, which
    // is the exact failure mode that let the bug through in the first place.
    expect(
      { moved: after!.y !== before!.y, resized: after!.height !== before!.height },
      'the board must move without resizing, or this test proves nothing',
    ).toEqual({ moved: true, resized: false });

    // **Direction, and far enough to cross a tile edge.** `moved: true` alone passes just as well
    // if a future trigger moves the board *down*, at which point the top-edge press below stays
    // inside the same cell and the mutant survives silently — which is exactly what happened once
    // already in this issue, mirrored. Measured today: HUD 109 -> 97pt, board y 142 -> 136 (half
    // the HUD delta, because the board is centred in what is left), cell 37pt, and `pressWithin`
    // clamps its inset to 3pt. So the press clears the boundary by 3pt and no more. Asserting the
    // margin pins that too: shrink the note's font enough and this would otherwise go quietly
    // green and useless.
    expect(
      before!.y - after!.y,
      'the board must move UP, by more than the press inset, or the press cannot cross a tile edge',
    ).toBeGreaterThan(3);
  }

  // The identical press must still be the identical tile. With the stale cache this resolved one row
  // south — a wall on this seed, so a false refusal; one tile of different terrain and it is a step
  // the player did not aim at, with a turn spent on it.
  await pressWithin(page, self, 0.5, 0);
  expect(await turn(page)).toBe(2 + rampTurns);
  expect(await playerTile(page), 'the edge press after the layout moved').toEqual(at);
  await expect(page.getByTestId('status-line')).not.toHaveText(/blocked/i);
});

/**
 * Every sentence the wake line can be, taken from the copy rather than retyped.
 *
 * §8 caps a floor at `min(2 + floor, 6)` creatures, so six is the ceiling a turn can reach. Imported
 * rather than written out for the same reason `TOO_FAR_MESSAGE` is: a change to the wording should
 * be a change in one place, not a spec that quietly stops matching.
 */
const WAKE_MESSAGES: readonly string[] = [1, 2, 3, 4, 5, 6].map(wakeMessage);

type At = { readonly x: number; readonly y: number };

/**
 * Manhattan distance — steps, not pixels, and deliberately not Chebyshev.
 *
 * The greedy walk below closes on a mark one orthogonal step at a time, and Chebyshev **does not
 * decrease** on a single orthogonal step toward a diagonal target: from (4,3) to (8,7) every legal
 * step leaves `max(dx, dy)` at 4. A first draft used it and stalled on its first attempt, in a spec
 * whose only symptom was a flash at nothing. Manhattan always falls by one on a correct step.
 */
function apart(a: At, b: At): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Every tile the board is currently drawing `glyph` on. */
async function tilesShowing(page: Page, glyph: string): Promise<At[]> {
  return page.evaluate((wanted) => {
    const found: { x: number; y: number }[] = [];
    for (const cell of Array.from(document.querySelectorAll('[data-testid^="cell-"]'))) {
      if ((cell.textContent ?? '').trim() !== wanted) continue;
      const [, x, y] = (cell.getAttribute('data-testid') ?? '').split('-').map(Number);
      found.push({ x, y });
    }
    return found;
  }, glyph);
}

/**
 * Where the dark says something is: the `*` nearest the player, or `null` if it says nothing.
 *
 * §4/§10's ember-sense mark, read straight off the board — the one thing the game deliberately tells
 * a shuttered player, and the thing a player reads before deciding whether a flash is worth it. It
 * carries position and nothing else, so this spec cannot tell a sleeper from a hunter either.
 */
async function nearestMark(page: Page, me: At): Promise<At | null> {
  let best: At | null = null;
  for (const mark of await tilesShowing(page, GLYPHS.contact)) {
    if (best === null || apart(me, mark) < apart(me, best)) best = mark;
  }
  return best;
}

/** The move target that gets closest to `goal`, or `null` if none of the four improves on `me`. */
async function stepTowardId(page: Page, me: At, goal: At): Promise<string | null> {
  const moves = await page
    .locator('[data-testid^="tap-move-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));

  let best: { id: string; at: At } | null = null;
  for (const id of moves) {
    const [x, y] = id.replace('tap-move-', '').split('-').map(Number);
    if (best === null || apart({ x, y }, goal) < apart(best.at, goal)) best = { id, at: { x, y } };
  }
  return best === null || apart(best.at, goal) >= apart(me, goal) ? null : best.id;
}

/** How close the flash is taken from. Manhattan 2 is well inside `LIT_RADIUS` (4), and not adjacent. */
const FLASH_RANGE = 2;

/**
 * From a shuttered board: walk until ember-sense marks something within `FLASH_RANGE`, then open up.
 * Returns what the line said afterwards.
 *
 * **Nothing here is a recorded route** — `support/drive.ts` explains why one dies silently at #47 —
 * and nothing here can see the map. The walk is one greedy step at a time toward a `*` that is on
 * screen, using only the four move targets §9 puts under a thumb; it has no memory, cannot go around
 * anything, and gives up rather than searching. When it cannot close it falls back to `wander`'s own
 * rule, pressing the target it has pressed least.
 *
 * Shared by the two tests below, which are about different halves of the same press: #79's is that
 * the wake is *said*, #94's is that it is said *loudly*. Sharing the walk is what keeps them from
 * being one test doing two jobs, and it is the only expensive part.
 *
 * @throws rather than returning an empty string if it never gets in range — a spec that flashed at
 *   nothing would otherwise fail on an assertion about copy and send the reader to the wrong file.
 */
async function closeOnASleeperAndFlash(page: Page): Promise<string> {
  const shutter = page.getByTestId('control-shutter');
  const visits = new Map<string, number>();

  for (let steps = 0; steps < 40; steps += 1) {
    const me = await playerCell(page);
    const mark = await nearestMark(page, me);

    if (mark !== null && apart(me, mark) <= FLASH_RANGE) {
      await press(page, shutter);
      return ((await page.getByTestId('status-line').textContent()) ?? '').trim();
    }

    const closer = mark === null ? null : await stepTowardId(page, me, mark);
    const targets = await page
      .locator('[data-testid^="tap-move-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
    expect(targets.length, 'the board offered nowhere to step').toBeGreaterThan(0);

    let target = closer;
    if (target === null) {
      target = targets[0];
      for (const id of targets) if ((visits.get(id) ?? 0) < (visits.get(target) ?? 0)) target = id;
    }
    visits.set(target, (visits.get(target) ?? 0) + 1);
    await pressTile(page, page.getByTestId(target));
  }

  throw new Error('game-screen: 40 steps in the dark without a mark inside flash range');
}

test('a wake reaches the line under the board, and says how many (§4, #79)', async ({ page }) => {
  test.slow();
  await boot(page);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE LIGHT WAGER, PLAYED — WHICH IS THE ONLY WAY TO SEE THE LINE THIS ISSUE ADDED
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // The bug: opening the shutter wakes everything in the lit radius (§4) and the game never said so.
  // The M1 exit playtest measured seven turns, two Cinders woken, and the line under the board empty
  // the whole way — the run's most consequential event was the only one with no acknowledgement.
  //
  // So this shutters, walks in the dark until ember-sense marks something, closes on the mark, and
  // opens up. **Nothing here is a recorded route** — `support/drive.ts` explains why one dies
  // silently at #47 — and nothing here can see the map. The walk is one greedy step at a time toward
  // a `*` that is on screen, using only the four move targets §9 puts under a thumb; it has no
  // memory, cannot go around anything, and gives up rather than searching. When it cannot close it
  // falls back to `wander`'s own rule, pressing the target it has pressed least.
  //
  // Shuttered first, and not only to save fuel: §4 says **nothing wakes in the dark**, so every
  // creature is still asleep when the flash lands and the wake under test is the flash's.
  const line = page.getByTestId('status-line');
  const shutter = page.getByTestId('control-shutter');

  // **This opening is silent because nothing woke, not because openings are silent.** §4 starts the
  // lantern open and `beginRun` runs phase 3, so roughly one launch in ten already has a wake
  // sentence on it before a finger touches the screen (`tests/unit/play-opening.test.ts` measures
  // it); `emberdepth` is one of the other nine, which the same file pins by name as its `QUIET_SEED`.
  // (An earlier draft of this comment sent the reader to `session/run.test.ts`, which uses the seed
  // `'session'` and never mentions `emberdepth` — so a future red here would have been debugged
  // against a test about a different world.)
  //
  // So this is a real assertion in both directions now. It fails if the opening census ever starts
  // reporting creatures the light did not wake — the census reads `after` alone, so an over-broad
  // one has nothing to contradict it — and it is what makes the wake below attributable to the
  // flash. It was **not** a real assertion when it was written: the screen dropped `beginRun`'s
  // cues entirely, so this line was empty for every seed and every implementation, and it is
  // exactly the assertion that should have caught that.
  await expect(line).toHaveText('');

  await press(page, shutter);
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');

  const said = await closeOnASleeperAndFlash(page);

  // The exact sentence, not merely "something is written there". The count is the part §4 ruled
  // load-bearing — `Something wakes.` on a turn that woke two is the failure the rule names — and
  // the *empty string* is the bug this issue was filed about, which is what a message assertion
  // catches and a turn counter never could.
  //
  // It also pins the precedence at the only tier that can see it: the shutter was pressed on this
  // very turn, so `The shutter opens. Light spills out.` is exactly what this line would read if
  // `woke` did not outrank `shutterChanged`.
  expect(WAKE_MESSAGES, `the status line read ${JSON.stringify(said)}`).toContain(said);
});

test('one control, two volumes: a flash that wakes is drawn louder than one that does not (§10, #94)', async ({
  page,
}) => {
  test.slow();
  await boot(page);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // THE CONTRAST IS THE ASSERTION. A WAKE BEING LOUD PROVES NOTHING IF EVERYTHING IS LOUD
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // #94's finding was not that the wake line was missing — #79 shipped it — but that *you got away
  // with it* and *you have company*, the two outcomes of the same press, were typographically
  // identical. So this presses **the same control twice** and asks that the screen answer
  // differently: closing it is a `report`, and the flash that wakes two Cinders is an `alarm`.
  //
  // The level is read off the DOM as an attribute rather than off computed styles, deliberately
  // (`status-line.tsx`): this spec asserts §10's *rule*, and it must survive M4 repainting every
  // colour and weight on the screen without going red for a reason nobody cares about.
  const row = {
    alarm: page.getByTestId('status-line-alarm'),
    report: page.getByTestId('status-line-report'),
    empty: page.getByTestId('status-line-empty'),
  };
  const board = page.getByTestId('board');
  const shutter = page.getByTestId('control-shutter');

  // A run that has said nothing yet is neither. `emberdepth`'s opening light finds nobody
  // (`tests/unit/play-opening.test.ts` pins it by name), so the row starts empty — and an empty row
  // is not a quiet claim, it is the absence of one.
  await expect(row.empty).toHaveCount(1);
  await expect(row.alarm).toHaveCount(0);
  const resting = await board.boundingBox();

  // ── PRESS ONE: the shutter closes. You did that on purpose; nothing is against you. ──────────
  await press(page, shutter);
  await expect(page.getByTestId('hud-shutter')).toHaveText('SHUT');
  await expect(page.getByTestId('status-line'), 'the press must be acknowledged at all').not.toHaveText(
    '',
  );
  await expect(row.report, 'a shutter receipt is a report').toHaveCount(1);
  await expect(row.alarm, 'and nothing about it is an alarm').toHaveCount(0);
  const reported = await board.boundingBox();

  // ── PRESS TWO: the same control, and this time something wakes. ──────────────────────────────
  const said = await closeOnASleeperAndFlash(page);
  expect(WAKE_MESSAGES, `the status line read ${JSON.stringify(said)}`).toContain(said);
  await expect(row.alarm, 'a wake is an alarm').toHaveCount(1);
  await expect(row.report, 'and it replaces the report, rather than sitting beside it').toHaveCount(0);
  const alarmed = await board.boundingBox();

  // ── AND THE ROW NEVER MOVED THE THING THE PLAYER IS AIMING AT ────────────────────────────────
  //
  // §10 raised the turn line's size, and the row it lives in is 71pt of the gap between the board
  // and the thumb controls. It reserves two lines' height whether or not it uses them
  // (`status-line.tsx`) precisely so that a message appearing — or getting louder — cannot resize
  // the board underneath it. `board.tsx` resolves a press by measuring where the board is, so a
  // board that moved when the line changed would be #20's stale-origin bug arriving from a third
  // direction. A one-pixel tolerance for sub-pixel layout, and no more.
  for (const [when, box] of [
    ['after a report', reported],
    ['after an alarm', alarmed],
  ] as const) {
    expect(Math.abs(box!.y - resting!.y), `the board moved ${when}`).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - resting!.height), `the board resized ${when}`).toBeLessThanOrEqual(1);
  }
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
  //
  // This used to read the status line for a death headline, which stopped being able to fail the
  // moment #21 moved the ending onto its own screen — `StatusLine` no longer receives an outcome and
  // can never print one. The end of a run is now a *panel that exists or does not*, so that is what
  // is asked. Same intent, and this version can go red.
  await expect(page.getByTestId('run-summary')).toHaveCount(0);
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
