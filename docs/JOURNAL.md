# Journal

Append-only development log, newest at the top. **This is the primary memory of the project across
sessions.** Session state, agent context, and reasoning all evaporate; this file does not.

## Why this exists

A future session starts with no memory of this one. It will read the code and see *what* was
built, and read git history and see *when*. Neither tells it *why* — why an obvious-looking
approach was rejected, what was tried and abandoned, what is currently half-finished, what is
about to break. That is what goes here.

## Format

One entry per meaningful work session or merged PR. Newest first.

```markdown
## YYYY-MM-DD — Short title

**Did:** what changed, in a sentence or two. Link the PR/issue.
**Why:** the reasoning, especially any non-obvious choice or rejected alternative.
**Learned:** anything surprising. Wrong assumptions, gotchas, things that cost time.
**Next:** the immediate next step, specific enough to act on cold.
**Watch:** known risks, deferred cleanup, things that will bite later. Omit if none.
```

Write for a reader with zero context. "Fixed the FOV bug" is useless; "shadowcasting was
symmetric-visible but asymmetric-lit, so enemies could see the player through walls the player
couldn't see through — fixed by computing lighting from the light source rather than the viewer"
is worth the file.

**Be honest about failure.** A record of what did not work is worth more than a record of what
did — it is the only thing stopping a future session from repeating it.

---

## 2026-07-29 — Branch protection and agent authorization

**Did:** Added a branch ruleset on `main` (PRs required, all three CI checks required, squash-only,
no force-push, no deletion, **no bypass actors**) and recorded the owner's standing authorization
to spawn any agent in `.claude/agents/` without asking.

**Why:** The "no direct commits to `main`" rule was documentation, which means it was a rule that
held exactly as long as nobody made a mistake. Now the remote rejects the push. Deliberately no
bypass actors: agents operate with the owner's token, so an admin bypass would be an agent bypass,
and the rule would protect nothing.

The agent authorization matters more than it sounds. During setup I merged PR #5 without a
`code-reviewer` pass because I had a standing instruction not to spawn agents unasked — so the
first PR in a process built around adversarial review shipped without any. The owner made the
permission explicit so that cannot recur. It is now written in two places (`CLAUDE.md` and
`WORKFLOW.md` step 9) with the reasoning attached, because a bare permission gets read as optional.

**Learned:** Verified the ruleset by actually attempting a direct push to `main` and confirming
rejection, rather than trusting the API's success response. Worth the thirty seconds — a
protection rule you have not seen reject something is a rule you are only assuming works.

Note for future sessions: `gh` on this machine defaults to an account with read-only access to
this repo. `gh auth switch --user ginderjeremiah` is required before any GitHub write, and the
failure mode is confusing because `gh auth status` shows both accounts as authenticated.

**Next:** M0 issues are unblocked and #1 (strip boilerplate) is the entry point. #3 stays labeled
`blocked` until #2 (seeded RNG) lands.

**Watch:** The ruleset has no bypass, so if CI ever breaks in a way that blocks all merges, fixing
it requires editing the ruleset in repo settings. That is the correct trade — but it is a
single point of failure worth remembering when CI is red and the fix is itself a PR.

## 2026-07-29 — Project groundwork

**Did:** Set up the entire development system before any game code. Documentation spine
(`VISION`, `GDD`, `ARCHITECTURE`, `ROADMAP`, `WORKFLOW`, ADRs, this journal), seven specialized
agents in `.claude/agents/`, GitHub CI running typecheck/lint/unit/build/E2E, issue and PR
templates, Vitest + Playwright wired up and proven with real tests, and the M0/M1 issue queue.

**Why:** The owner intends minimal involvement, so the project needs to be self-verifying. Every
choice here follows from that: determinism so tests can be exhaustive rather than sampled, a web
build so a browser can be automated, a hard sim/render seam so logic is testable without a
renderer, and an adversarial review agent because there is no human reading each diff.

Four things were decided up front with the owner: web-first (mobile-compatible), self-merge on
green CI + agent review, glyph rendering, and no backend. The first three came from him; the
rendering and backend calls were delegated to me with the instruction to prioritize quality over
speed.

**Learned:** Chose a glyph grid over Skia *specifically* because glyphs render to a real DOM tree,
which Playwright can assert against — a canvas would be opaque pixels and would have forced a
human into every verification loop. Quality-over-speed here meant picking the option that keeps
the feedback loop closed, not the option with the higher visual ceiling. The `render/` seam is the
hedge: if glyphs become the limit on feel, swapping renderers touches one layer (ADR-0003).

Also settled: no Jest. The pure-TS core makes Vitest sufficient, and the UI is better verified by
driving the real app in a browser than by shallow-rendering components (ADR-0005).

**Next:** Strip the Expo tutorial boilerplate (#1), then seeded RNG (#2) — the RNG blocks
essentially everything else, since determinism depends on it, and #3 (core types + the
replay-determinism test) depends on it directly. In parallel, the M0 design review (#4) should
attack the *Emberdepth* concept before M1 commits to it.

**Watch:** The concept is unvalidated — `VISION.md` states it as a proposal deliberately, and M0
exists partly to kill it if it does not hold up. The replay-determinism test does not exist yet;
until it does, nothing is actually enforcing the project's central invariant. And no native build
has ever been run: web-first means iOS/Android drift is possible and will not surface until the
M4 verification pass, so keep native-hostile APIs out of the codebase in the meantime.
