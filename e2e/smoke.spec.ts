import { expect, test } from '@playwright/test';

/**
 * Proves the E2E harness works end to end: the static web export builds, serves, boots React,
 * and renders. Runs at both a phone and a desktop viewport (see playwright.config.ts).
 *
 * As the game grows, real feature specs live alongside this. This file stays minimal — it only
 * ever asserts that the app comes up at all.
 */

test('the app boots and renders', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');

  // Expo's static export mounts into #root. If React failed to boot, the element exists but
  // stays empty — so assert on content, not just presence.
  const root = page.locator('#root');
  await expect(root).toBeVisible();
  await expect(root).not.toBeEmpty();

  // Assert on actual content, not just that something rendered. Without this the spec passes
  // identically whether the router serves the index route, the sitemap, or an error boundary —
  // so a routing regression would slip through both assertions above.
  //
  // This was `getByText('EMBERDEPTH')`, the M0 placeholder's title, and #20 deleted that screen. It
  // kept passing anyway: `getByText` is a case-insensitive substring match by default, and the game
  // screen prints its fixed seed as `seed "emberdepth"`. A passing assertion for the wrong reason is
  // worse than a failing one, so this now names the HUD — the frame around the board, present on
  // every state of the game and on nothing else. What each readout *says* is `game-screen.spec.ts`'s.
  await expect(page.getByTestId('hud')).toBeVisible();

  expect(consoleErrors, 'the app booted without console errors').toEqual([]);
});

test('renders at a phone viewport without horizontal overflow', async ({ page }) => {
  // Pillar 3: touch-native. A layout that only works on a wide viewport is a layout that
  // does not work. Catching this in CI is cheaper than catching it in a playtest.
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows, 'page must not scroll horizontally').toBe(false);
});
