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

## 2026-07-29 — Review caught the determinism contract was never enforced

**Did:** Fixed three blocking bugs the `code-reviewer` agent found in the PR #5 scaffolding, all in
the machinery meant to enforce the project's core invariants.

1. **`npm run lint` never looked at `game/`.** `expo lint` with no arguments lints a hardcoded
   `['src', 'app', 'components']`. `src/` doesn't exist, so it linted `app/` and `components/`
   only — every determinism and layer rule scoped to `game/` and `render/` was dead code. CI
   would have reported green with `Math.random()` in the simulation core. Fixed by switching to
   `eslint .`, which now covers 27 files across every directory instead of 15.
2. **Layer-import rules only matched depth 1.** `../components/*` matches `game/foo.ts` importing
   `../components/x`, but not `game/systems/foo.ts` importing `../../components/x` — and per
   ARCHITECTURE.md every real game file lives at depth 2. The guard protected only the depth where
   no code will ever live. Same hole in the `components/` → `game/` rule, where `components/ui/`
   already exists. Fixed with a `layer()` helper generating `**/dir`, `**/dir/*`, `**/dir/**`,
   which covers any depth plus the `@/` alias in one entry.
3. **Both contract tests passed vacuously**, since `game/` is empty at M0, and the import regex had
   no branch for relative paths anyway. Rewrote the scanner to extract module specifiers first
   (catching `from`, dynamic `import()`, `require()`, and side-effect imports) and match those,
   and — the actual fix — added fixture files of known violations plus tests asserting the scanner
   flags them. The scanner is now proven to work even while the directories it guards are empty.
   `render/` had no backstop at all and now has one.

Also from the non-blocking findings: added `async`/`Promise` lint selectors (ARCHITECTURE.md
claimed promises were lint-enforced; only `await` was), enabled
`strict_required_status_checks_policy`, and put a warning block at the top of `ci.yml` about the
job names being pinned by the ruleset.

**Why:** All three bugs share a shape — the enforcement *looked* correct and reported success, so
nothing would have surfaced them until a determinism bug appeared in gameplay weeks later and the
replay tests couldn't explain it. This is precisely the failure mode ADR-0001 says the review gate
exists to catch, and it was caught on the second PR.

**Learned:** The reviewer verified by *running* things — probe files at real nesting depths,
`gh api` against the live ruleset — rather than reading configs and reasoning. Reading the ESLint
config would not have revealed finding 1; you have to check what `expo lint` actually globs. I
adopted the same approach for the fixes: every one was confirmed by planting a violation, watching
the check fail, removing it, and watching it pass. Assume enforcement is broken until you have
seen it reject something.

Two specific traps now documented rather than latent: a **skipped** CI job reports as *passing* to
required status checks, so adding a `paths:` filter to a required job silently opens the merge
gate. And because required contexts match job display names with no bypass actors, renaming a job
in `ci.yml` makes every PR permanently unmergeable — including the PR that would fix it.

A **second** review pass on the fixes then found two more, both the same shape as the originals —
enforcement scoped to a set that real code can fall outside of:

4. **`.tsx`/`.js` files under `game/` escaped every gate.** Rules were scoped to `*.ts`, and the
   test scanner filtered on `.ts`. A `game/ui/hud.tsx` doing `Math.random()`, `fetch()`, and
   importing `react-native` produced zero signal from lint, tsc, and the test suite. Fixed by
   widening both gates to all source extensions, *plus* a positive assertion that `game/` and
   `render/` contain only `.ts` — a `.tsx` in a pure layer is itself the violation.
5. **The scanner matched comments and string literals.** A legitimate `game/rng/pcg32.ts` whose
   docstring said "replaces `Math.random()`, which cannot be seeded" would have failed CI. That
   would have hit on issue #2, the very next code PR, and the natural response to a spurious
   failure is to reword the doc or loosen the scanner — both worse than the false positive. Now
   strips comments and string literals before scanning, with tests both ways: documented prose
   passes, and real code next to prose still fails.

Also closed from the non-blocking list: `no-restricted-imports` does not inspect `import()` or
`require()` at all, so `await import('@/game/step')` in a component bypassed the layer gate —
added `no-restricted-syntax` selectors covering both across `game/`, `render/`, `components/`, and
`app/`. Added `react-native-*` and `@react-navigation/*` to the banned groups (`react-native` alone
missed `react-native-reanimated`). Added `Promise.*`, `fetch`, `setTimeout`, `XMLHttpRequest`, and
friends, which makes ARCHITECTURE.md's "no promises, no I/O" claim true rather than aspirational.
Added `--max-warnings 0`, since warnings never failed CI and lint is now a real gate.

**Learned (second pass):** esquery, which powers `no-restricted-syntax` selectors, delimits regex
attribute values with `/` and cannot handle an escaped `\/` — it crashes ESLint with a
config-level `SyntaxError` instead of reporting a lint error. Use the `\x2f` hex escape. This cost
a debugging cycle and is noted in `eslint.config.js` at the call site.

**Next:** Unchanged — M0 #1 (strip boilerplate) is the entry point, #3 stays `blocked` behind #2.
The difference is that the contract enforcement those issues rely on is now real.

**Watch:** `required_approving_review_count: 0`, so "the `code-reviewer` agent must approve" is
still convention — an agent is not a GitHub reviewer, and requiring an approval would deadlock a
single-owner repo. This is a known, accepted gap, not a covered one. PR #5 already demonstrated
how it fails.

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
