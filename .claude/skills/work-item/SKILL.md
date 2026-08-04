---
name: work-item
description: Take a single GitHub issue from the queue all the way to a merged PR — branch, design note, implement, test, verify, review, playtest, merge, journal. Use when asked to "work the next issue", "pick up the next task", "keep building", or given an issue number to implement.
---

# Work a single issue end to end

The standard unit of work on this project. One issue in, one merged PR out. Follow every step —
each one exists because skipping it produced a specific failure mode.

If given an issue number, work that one. If not, pick the highest-priority unblocked issue in the
current milestone.

## 1. Orient

**Fetch before you read anything.** A stale local `main` makes merged work look like stranded work:

```bash
git fetch origin --prune
git status -sb          # "behind N" here means every judgment below is against the wrong tree
```

A session opened with `main` three commits behind. A branch whose work had already squash-merged
looked like five commits of abandoned work, and the roadmap looked like it had drifted when it had
not. Both readings were wrong and both came from not fetching. **`gh` shows you the remote's truth
and `git` shows you your checkout's — when they disagree, `git` is the one that is stale.**

```bash
gh issue list --milestone "$(gh api repos/:owner/:repo/milestones --jq '.[0].title')" --state open
gh issue view <n>
gh pr list --state open
gh issue list --state open --json number,title,milestone \
  --jq '.[] | select(.milestone == null) | "#\(.number) \(.title)"'   # untriaged; triage before picking
```

Read the last two entries of `docs/JOURNAL.md`. **The journal is newest-first** — `head`, not `tail`.
Skip anything labeled `blocked` or `needs-owner`.

Claim it so parallel sessions don't collide:

```bash
gh issue comment <n> --body "Starting work on this."
```

## 2. Branch

```bash
git switch main && git pull
git switch -c feat/<n>-<slug>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`. **Never commit to `main`.**

## 3. Design note

For anything non-trivial, comment your intended approach on the issue *before* writing code — the
shape of the change, which files, what could go wrong. Two sentences to a paragraph. This is the
last point where a wrong direction is free to correct.

If the approach contradicts `docs/ARCHITECTURE.md`, stop and write an ADR instead.

If the issue needs a design decision the GDD doesn't answer, invoke `game-designer` first. Do not
invent game design while implementing.

## 4. Implement

Delegate to the specialist:

- `game/` → **gameplay-engineer**
- `render/`, `components/`, `app/` → **ui-engineer**
- test infrastructure or coverage → **test-engineer**

Keep the diff scoped to the issue. Unrelated problems you discover become new issues — **always with
a milestone and a label**, in the same command:

```bash
gh issue create --title "..." --milestone "<milestone>" --label task \
  --body "Found while working #<n>. ..."
```

**An issue filed without a milestone is invisible to the queue** — `gh issue list --milestone ...` is
how every session finds work, so an untriaged issue is filed and lost in the same motion. Four
accumulated this way before one session swept them up. If you genuinely cannot place it, file it and
say so in your report; do not leave it for someone to notice.

**Check it is not a duplicate before filing.** #141 and #76 described the same problem eight weeks
apart, and consolidating them meant moving two contributions across before closing one. Search first:
`gh issue list --state all --search "<distinctive phrase>"`.

**And note that filing an issue makes the roadmap's hand-maintained counts stale immediately** — this
happened *inside* the PR that reported the defect, minutes after a review verified the count. If you
file into a milestone the roadmap enumerates, either fix the count in the same PR or expect the next
reconcile to catch it. #110 exists to delete those numbers.

## 5. Test

Tests ship in the same PR. Non-negotiable for `game/`.

Property tests for invariants, replay tests for anything touching turn resolution, one E2E path
per user-visible feature. For a bug fix, write the failing test first and confirm it fails for the
right reason.

Every test must be able to fail. Name the bug it catches, or rewrite it.

## 6. Verify locally

```bash
npm run verify
npm run build:web && npm run test:e2e
```

Green locally before pushing. CI is a safety net, not your test runner.

## 7. Journal

Append to `docs/JOURNAL.md` **now**, in this PR — not later. Format is in the file. Capture the
*why*, the alternatives rejected, anything surprising, and what's next.

## 8. Open the PR

```bash
git push -u origin HEAD
gh pr create --fill
```

The body must cover what changed, why, how it was verified, and what a reviewer should look at
hardest.

## 9. CI

```bash
gh pr checks --watch
```

Must be fully green. Never merge a red or skipped run. A flaky check is a bug worth an issue, not
a reason to override.

## 10. Review

Invoke **code-reviewer** on the diff. Always.

If the change affects gameplay, also invoke **playtester** against the build.

Address every finding — fix it, or reply explaining why it isn't a problem. "Won't fix" is
legitimate; silence is not. If either agent requests changes, fix and re-run from step 6.

## 11. Merge

Once CI is green and review passed, merge it yourself. That is the standing authorization — do not
wait for a human.

```bash
gh pr merge --squash --delete-branch
gh issue close <n>
```

## 12. Close out

```bash
git switch main && git pull
```

If this was the last issue in a work session, run the **archivist** agent to reconcile docs,
roadmap, and issue state before stopping.

---

## Stop and ask the owner only if

The answer requires something **only he can supply**: external infrastructure or credentials, a
dependency needing an account the project lacks, or anything that spends money or publishes
something under his name.

**Design decisions are not on that list** — not balance, not mechanics, not the pillars, not the
core concept. Those get an ADR and proceed. See `docs/WORKFLOW.md`, which explains why this rule
used to say otherwise and was wrong.

Label the issue `needs-owner`, comment with the specific question **and your recommendation**, then
go work on something else. Don't sit idle.
