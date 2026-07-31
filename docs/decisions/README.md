# Architecture Decision Records

Short documents capturing decisions that were expensive to make and would be expensive to
relitigate. Numbered, immutable once accepted.

If you find yourself thinking "why on earth is it done this way," the answer should be here. If it
isn't, the decision was made carelessly and is fair game to change — but write an ADR when you do.

## When to write one

- A choice with real consequences that a reasonable person would question later.
- Rejecting a plausible alternative for a non-obvious reason.
- Anything that changes `VISION.md`, a design pillar, or a layer rule in `ARCHITECTURE.md`.

Not for routine implementation choices. Those go in the journal, or nowhere.

## Format

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Superseded by ADR-NNNN
**Date:** YYYY-MM-DD

## Context
The situation and the forces at play. What makes this a real decision.

## Decision
What we are doing. Present tense, definite.

## Alternatives considered
Each with an honest reason it lost. This section is the point of the document.

## Consequences
What this makes easy, what it makes hard, and what would make us revisit it.
```

Superseding, never editing: to reverse a decision, write a new ADR and mark the old one
`Superseded by ADR-NNNN`. The record of what we used to believe is the valuable part.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-agent-driven-development.md) | Agent-driven development with self-merge | Accepted |
| [0002](0002-web-first-native-compatible.md) | Web-first, native-compatible | Accepted |
| [0003](0003-glyph-grid-rendering.md) | Glyph-grid rendering behind a renderer seam | Accepted |
| [0004](0004-deterministic-pure-core.md) | Deterministic pure-TypeScript simulation core | Accepted |
| [0005](0005-vitest-and-playwright.md) | Vitest + Playwright, no Jest | Accepted |
| [0006](0006-local-first-no-backend.md) | Local-first persistence, no backend | Accepted |
| [0007](0007-emberdepth-sharpened.md) | Emberdepth sharpened — darkness carries information | Accepted |
| [0008](0008-benchmark-thresholds-as-ratios.md) | Benchmark thresholds are ratios, not milliseconds | Accepted |
| [0009](0009-auto-travel-command-shape.md) | Auto-travel is one `travel(to)` command, deferred to M2 | Accepted |
| [0010](0010-session-layer-owns-the-run.md) | A `session/` layer owns the run | Accepted |
