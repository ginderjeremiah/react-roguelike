# Workflow

How work actually gets done here. This process exists because the human owner is not reviewing
every change — the rigor has to come from somewhere, so it comes from here.

## The three modes

Work in this project is always in one of three modes. Know which one you are in.

### 1. Ideation

Deciding *what* to build. Output is documents and issues, never code.

- Driven by the `game-designer` agent.
- Proposals land as GitHub issues labeled `design`, or as PRs editing `docs/GDD.md`.
- A design proposal must state: the decision, which pillar it serves, what it costs, what it
  replaces, and how we will know if it is bad.
- **Design work is where the owner's attention is most valuable.** Anything that changes a pillar,
  the concept, or a milestone's goal gets `needs-owner` and waits. Everything else proceeds.

### 2. Development

Building it. One issue, one branch, one PR.

### 3. Review

Two distinct kinds, and both are required:

- **Code review** (`code-reviewer` agent) — is it correct, does it respect the layer rules, is it
  tested. Adversarial by design.
- **Playtest** (`playtester` agent) — does the *game* work. Runs the built app and reports on
  feel. Correct code that is not fun is a failed change; only a human-scale judgment call catches
  that, and the playtester is our stand-in for it.

A gameplay-affecting PR needs both. A pure refactor needs only code review.

## The development loop

```
pick issue -> branch -> design note -> implement -> test -> verify -> PR -> CI -> review -> merge -> journal
```

### 1. Pick

```bash
gh issue list --milestone "M1: Playable core" --state open
gh issue view <n>
```

Take the highest-priority unblocked issue. Assign it to yourself and comment that you have started
so parallel sessions do not collide.

### 2. Branch

```bash
git switch -c <type>/<issue>-<slug>     # feat/12-fov-shadowcasting
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

**Never commit to `main` directly.** Not even docs. Not even a typo. A branch ruleset enforces
this — the remote rejects direct pushes, requires all three CI checks, allows squash merges only,
and blocks force-pushes and branch deletion. There are no bypass actors, so this applies to
everyone including the owner.

### 3. Design note (for anything non-trivial)

Before writing code, comment on the issue with your intended approach: the shape of the change,
which files, what could go wrong. Two sentences to a paragraph. This is cheap and it is the last
point where a wrong direction is free to correct.

If the approach contradicts `docs/ARCHITECTURE.md`, stop and write an ADR instead.

### 4. Implement

Delegate to the right agent — `gameplay-engineer` for `game/`, `ui-engineer` for the presentation
side. Keep the diff scoped to the issue. Discovered unrelated problems become new issues, not
scope creep.

### 5. Test

Tests ship in the same PR as the code. Non-negotiable for `game/`.

Write tests that can actually fail. A test asserting `expect(result).toBeDefined()` is worse than
no test, because it makes the coverage number lie. Prefer:

- Property tests for rules ("damage is never negative", "the player never occupies a wall").
- Replay tests for anything touching turn resolution.
- One E2E path per user-visible feature.

### 6. Verify locally

```bash
npm run verify              # typecheck + lint + unit tests
npm run build:web && npm run test:e2e
```

Green locally before you push. CI is a safety net, not your test runner.

### 7. Pull request

```bash
gh pr create --fill --milestone "<current>"
```

The PR body must cover: what changed, why, how it was verified, and what a reviewer should look at
hardest. The template prompts for all of it.

### 8. CI

Must be fully green. **Never merge a red or skipped CI run.** If a check is flaky, that is a bug
worth an issue, not a reason to override.

### 9. Review

Invoke the `code-reviewer` agent on the diff. For gameplay changes, also invoke `playtester`
against the PR build.

The owner has given standing authorization to spawn any agent in `.claude/agents/` without
asking. Never skip a review pass out of caution about spawning an agent — that trades a real gate
for an imaginary courtesy.

Address every finding — fix it, or reply explaining why it is not a problem. "Won't fix" is a
legitimate outcome; silence is not.

### 10. Merge

Once CI is green and review has passed, **merge it yourself**. That is the standing authorization
from the owner; you do not wait for a human.

```bash
gh pr merge --squash --delete-branch
```

Squash merge, always. `main` stays a clean sequence of complete changes.

### 11. Journal

Append to `docs/JOURNAL.md` in the same PR. See the format in that file. This is the step that
gets skipped and it is the one that matters most across sessions — a future you with none of your
context is going to read it.

## When to stop and ask the owner

Genuinely rare. Label the issue `needs-owner`, comment with the specific question and your
recommendation, and go work on something else — do not sit idle waiting.

Ask when:

- A design pillar or the core concept needs to change.
- External infrastructure is needed (a backend, a paid service, app store credentials).
- A dependency with a restrictive license or a large native footprint is required.
- Two reasonable paths diverge expensively and the choice is a matter of taste, not correctness.

Do **not** ask for: routine implementation choices, library selection within the existing
footprint, balance numbers, refactors, or permission to merge green work. Decide, record the
decision, move on.

## Session hygiene

Starting a session: read the last few `JOURNAL.md` entries, check `gh pr list` for anything you
left open, check `gh issue list --label blocked`.

Ending a session: run the `archivist` agent. It reconciles the journal, roadmap, and issue state
so the next session starts from truth rather than from a half-finished thought.

## Definition of done

An issue is done when all of these are true:

- [ ] Behavior matches what the issue asked for.
- [ ] Tests exist that would fail if the behavior regressed.
- [ ] `npm run verify` and the E2E suite pass.
- [ ] Layer rules respected; `game/` still pure and deterministic.
- [ ] `code-reviewer` approved; `playtester` approved if gameplay changed.
- [ ] Docs updated if behavior or architecture changed.
- [ ] Journal entry written.
- [ ] Merged to `main` and the branch deleted.
