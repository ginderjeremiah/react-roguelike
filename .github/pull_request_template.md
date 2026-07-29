## What

<!-- What changed, in a couple of sentences. -->

Closes #

## Why

<!-- The reasoning. If you rejected an obvious alternative, say which and why — that is the part
     git history cannot recover later. -->

## How it was verified

<!-- Be specific. "Tests pass" is not verification; say what the tests would have caught. -->

- [ ] `npm run verify` passes (typecheck, lint, unit tests)
- [ ] `npm run build:web && npm run test:e2e` passes
- [ ] New tests added that would fail if this behavior regressed
- [ ] Verified visually at a phone viewport (UI changes only)

## Review focus

<!-- Where should the reviewer look hardest? What are you least sure about? An honest answer here
     is worth more than a confident one. -->

## Contract check

- [ ] `game/` is still pure and deterministic — no `Math.random()`, no clock, no upward imports
- [ ] No iteration over `Set`/`Map`/object keys where order affects the simulation
- [ ] Layer boundaries respected (`game/` → `render/` → `components/` → `app/`)
- [ ] `docs/JOURNAL.md` updated in this PR
- [ ] Docs updated if behavior, architecture, or design changed

## Reviews

- [ ] `code-reviewer` approved
- [ ] `playtester` approved (gameplay changes only)
