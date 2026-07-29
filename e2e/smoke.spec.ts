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
