# ADR-0003: Glyph-grid rendering behind a renderer seam

**Status:** Accepted
**Date:** 2026-07-29

## Context

A roguelike needs a way to draw a grid. Three realistic options existed: text glyphs in React
Native `View`/`Text`, a GPU canvas via `@shopify/react-native-skia`, or image tiles via
`expo-image`.

The owner delegated this decision, with one instruction: **there is no time pressure — prioritize
making something good over making it fast.**

That instruction is what decided it, though not in the direction it first appears to.

## Decision

Render the grid as React Native `View`/`Text` cells containing glyphs, styled with color and
opacity. Light falloff is expressed as cell tint.

Critically, this is **not** a permanent commitment to glyphs. A `render/` layer translates
`GameState` into a renderer-agnostic presentation model (cells, glyphs, colors, HUD values,
animation cues). `components/` consumes only that model. Swapping to Skia later means rewriting
one layer, not the game.

## Alternatives considered

**Skia canvas.** The highest visual ceiling — real lighting, particles, sprites — and it was the
tempting answer to "make it good." Rejected because it would break the project's ability to verify
itself. A canvas is opaque pixels: Playwright cannot assert that the correct entity is at the
correct tile, and an agent cannot inspect what it drew. Every visual check would require a human
looking at a screenshot, which is exactly the involvement the owner does not want to provide.

This is the crux: *good* in an agent-driven project means the option that keeps the feedback loop
closed. A higher ceiling I cannot verify against is worth less than a solid one I can iterate on
freely. Skia also adds a heavy native dependency and complicates the web build.

**Image tiles via `expo-image`.** Middle ground visually. Rejected on the asset pipeline — it
requires sourcing or generating consistent art, which is a genuine bottleneck for agents and would
make art the rate-limiting step on every content addition. It also gives up the thing glyphs are
best at: instant, unambiguous legibility of a dense grid.

**Glyphs permanently, no seam.** Simpler. Rejected because the seam is cheap now and expensive
later, and because it is the honest hedge against being wrong about the ceiling.

## Consequences

Zero new dependencies. Identical behavior on web and native. Rendering is trivially testable —
Playwright asserts on the DOM, unit tests assert on the presentation model. Adding an enemy is a
data-table entry, not an art task.

The aesthetic target is "a beautiful terminal," not a cheap tileset — Cogmind and Caves of Qud
demonstrate the ceiling is high when palette, typography, spacing, and animation are treated
seriously. M4 treats visual polish as real work, not decoration.

The performance risk is real: a ~40x24 grid is ~1000 `View`s, and React Native has a per-view
cost. The presentation-model seam is also the mitigation here — memoized cells, or a renderer
swap, without touching the game.

**Revisit if:** the playtester repeatedly reports that visual expressiveness is the limiting factor
on feel, or grid rendering misses the 16ms frame budget and cell-level optimization does not fix
it. In either case the seam means the switch is contained.
