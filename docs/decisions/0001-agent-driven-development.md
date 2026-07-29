# ADR-0001: Agent-driven development with self-merge

**Status:** Accepted
**Date:** 2026-07-29

## Context

The owner wants this game built by Claude Code agents with minimal personal involvement. He will
oversee direction and unblock infrastructure, but will not review each change.

That removes the safety mechanism most software processes are built around. Something has to
replace it, or quality degrades silently — and silently is the dangerous part, because an agent
that has drifted will keep confidently producing work.

The repository is public, so GitHub Actions minutes are free. Automated verification is
effectively unlimited, which is worth designing around.

## Decision

Agents develop the project autonomously, with rigor enforced by machinery instead of by human
attention:

1. **Every change goes through a PR.** No direct commits to `main`, ever.
2. **CI gates the merge** — typecheck, lint, unit tests, web build, E2E. All required.
3. **A `code-reviewer` agent reviews every PR** adversarially, separately from the agent that
   wrote it.
4. **A `playtester` agent evaluates gameplay changes** by playing the built game.
5. **Agents merge their own PRs** once CI is green and review passes. Standing authorization; no
   human wait.
6. **Documentation is part of the work**, not a follow-up — journal entries ship in the PR that
   they describe.

The owner is consulted only for pillar/concept changes, external infrastructure, licensing, or
expensive taste-driven forks. Those get a `needs-owner` label, and work continues elsewhere
meanwhile.

## Alternatives considered

**Human approval on every PR.** The obvious safe choice, and rejected because it directly
contradicts the goal. It also degrades in a specific way: a reviewer facing a queue of agent PRs
rubber-stamps them, producing the *appearance* of oversight while providing none. Better to make
the automated gates genuinely strong and be honest that they are what is holding the line.

**No process, just build it.** Fast at first. But an agent with no memory across sessions and no
enforced invariants produces a codebase that drifts, and nothing detects the drift until it is
structural. The determinism invariant in particular is only worth anything if something checks it
on every commit.

**Human approval on design only, free rein on code.** Genuinely appealing, and close to what we
do. Rejected as the *stated* rule because implementation choices routinely turn into design
choices in a game — a combat implementation detail is a balance decision. Instead, design work is
where owner attention is *directed* (`needs-owner` on pillar-level changes), without pretending a
clean line exists.

## Consequences

Development runs at agent speed rather than review speed, with a complete audit trail: every
change is a PR with a CI run, a review, and a journal entry. Nothing is unrecoverable — `main` is
squash-merged history the owner can read or revert at leisure.

The cost: CI is now load-bearing. A gap in the test suite is a gap in the only thing standing
between a bad change and `main`. Test quality matters more here than in a human-reviewed project,
which is why `WORKFLOW.md` explicitly bans tests that cannot fail.

The `code-reviewer` agent reviewing work from a sibling agent shares model-level blind spots — it
is not equivalent to independent human review, and we should not pretend otherwise. Its prompt is
written to be adversarial and evidence-driven to partially compensate.

**Revisit if:** merged changes repeatedly turn out to be wrong, CI green stops correlating with
"it works," or the owner wants closer involvement.
