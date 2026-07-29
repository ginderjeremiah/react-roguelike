# ADR-0005: Vitest + Playwright, no Jest

**Status:** Accepted
**Date:** 2026-07-29

## Context

Expo's default testing story is `jest-expo`, which configures Jest with React Native's transforms
and provides `react-test-renderer` for component tests. That is the path of least resistance for a
typical Expo app.

Our situation differs in two ways: nearly all logic lives in pure TypeScript with no React
Native imports (ADR-0004), and we have a real browser available for verification (ADR-0002).

## Decision

Two test tools, no overlap:

- **Vitest** for `game/` and `render/` — pure TypeScript, no transforms, no DOM, no mocks.
- **Playwright** for the UI — drives the real built web app in a real browser.

No Jest, no `jest-expo`, no `react-test-renderer`, no React Native Testing Library.

Playwright runs against the **static export** (`npm run build:web` → `dist/`, served by `serve`),
not the dev server — so what CI verifies is what ships.

## Alternatives considered

**`jest-expo` for everything.** The conventional choice. Rejected because it buys us little: the
majority of our code needs no React Native transform at all, so we would pay Jest's transform cost
and configuration complexity on every test run for a capability only the thin UI layer needs. Jest
is also markedly slower than Vitest on a pure-TS suite, and test speed directly limits how tightly
agents can iterate.

**Vitest + `jest-expo` for components.** Two runners, two configs, two mental models, and the
ambiguity of "which runner does this test go in" on every new test file. The component tests it
would enable are also the least valuable tier — shallow-rendering a component asserts that it
rendered, not that the game works.

**Vitest only, no E2E.** Fast and simple, and blind to everything integration-shaped: routing,
touch handling, persistence, the actual build output. Precisely the failures a human would
otherwise catch by playing, which is what we cannot rely on.

## Consequences

The unit suite runs in milliseconds with zero configuration ceremony, so agents can run it
constantly rather than at the end. There is exactly one obvious place for any given test: does it
touch React? Playwright. Otherwise Vitest.

Testing the static export rather than the dev server means E2E failures are real failures, not
dev-server artifacts — at the cost of a build step before the E2E suite (slower locally, fine in
CI).

The gap we accept: no unit-level component tests. A component bug that E2E does not cover is
invisible. Judged acceptable because our components are deliberately dumb (ADR: layer rules) —
the logic worth testing is in `render/`, which Vitest covers thoroughly.

Some Expo/React Native modules cannot be imported under Vitest. That is a feature, not a
limitation: if a `game/` or `render/` file fails to import in Vitest, it has a dependency it should
not have.

**Revisit if:** the UI layer accumulates enough logic that E2E coverage becomes too coarse — though
the correct fix then is probably to move that logic down into `render/`.
