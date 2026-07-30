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
**Review addendum (post-review):** the suite pinned the *generator* but nothing pinned the
*mapping from raw word to helper output* — the surface all game code actually calls. Four
semantics-preserving mutations passed all 76 tests: modulo instead of multiply-high, reversed
`weighted` iteration, reversed `shuffle` result, and `pick` indexed from the far end. Each changes
what a given seed produces while preserving bounds, uniformity, permutation, and exact draw
counts. That mattered because #3 records replay fixtures in terms of `int`/`pick`/`shuffle`, not
raw words, so any of them would have invalidated every stored replay with CI green.

Added a pinned-helper-output block and confirmed each mutation is now killed by its intended test.
Those pins are ground truth by definition, generated from this implementation — they cannot prove
the mapping is correct, only that it has not changed. A deliberate change means re-pinning and
bumping `RunRecord.version`.

Also corrected a comment claiming the distribution and draw-count tests defended against `%` —
they do not, since `%` preserves both. And a collision test whose threshold rested on a
factor-of-1000 birthday-bound error: it tolerated 99 collisions where the expectation is 0.047,
and would have passed for a 22-bit hash.

**Watch:** known risks, deferred cleanup, things that will bite later. Omit if none.
```

Write for a reader with zero context. "Fixed the FOV bug" is useless; "shadowcasting was
symmetric-visible but asymmetric-lit, so enemies could see the player through walls the player
couldn't see through — fixed by computing lighting from the light source rather than the viewer"
is worth the file.

**Be honest about failure.** A record of what did not work is worth more than a record of what
did — it is the only thing stopping a future session from repeating it.

---

## 2026-07-29 — Seeded RNG: xoshiro128**, fixed draw counts, 76 tests (#2)

**Did:** Built `game/rng/` — the project's only source of randomness. Three modules: `seed.ts`
(string → state), `xoshiro128.ts` (the generator), `draw.ts` (`int`/`float`/`pick`/`shuffle`/
`weighted`), plus a barrel. 76 tests across two suites.

**Why xoshiro128\*\* over PCG32:** both were sanctioned by the issue and both are statistically
fine. The deciding factor was JavaScript arithmetic. PCG32's state advance is a 64-bit LCG, and JS
has no 64-bit integer multiply — a faithful port needs either BigInt (allocating, and a
comparatively lightly-exercised path in Hermes) or a hand-rolled 64×64 multiply from 32-bit halves
that must be exactly right on every engine forever, or web and native replays diverge.
xoshiro128** needs only xor, shift, rotate, and multiply-by-constant, all of which `Math.imul` and
`>>>` perform exactly under ECMA-262 with zero implementation latitude. Cross-platform identity by
construction rather than by hope. Its state is also four plain uint32s, so it drops into
`GameState` as JSON-clean immutable data.

**Ergonomics — the decision the whole simulation now lives with:** every operation takes an `Rng`
and returns `{ value, rng }`. The caller threads the new state forward. The rejected alternative
was a mutable cursor (`cursor.int(1, 6)`, hand the state back at the end of the turn), which reads
much better in draw-heavy code like level generation — that is a real cost we are paying, and #3
onwards will feel it. It was rejected because offering both makes the pure form optional, and the
boundary between "code that threads" and "code that mutates" is exactly where a state-reuse bug
hides: a cursor captured in a closure produces *plausible* randomness that quietly repeats. If
level generation turns into a ladder of `rng1, rng2, rng3`, the fix is a scoped combinator that
still returns a `Draw`, not a cursor. Objects rather than `[value, rng]` tuples because
destructuring into pre-declared bindings is genuinely awkward in TypeScript.

**The variable-draw decision, written down so nobody has to reverse-engineer it:** `int()` uses
multiply-high (Lemire) *without* the rejection step — `min + floor(u32 * n / 2^32)` — so it always
consumes exactly one draw, including when `min === max`. Textbook rejection sampling is unbiased
but consumes a variable number of draws, which puts a data-dependent branch on the randomness path
and makes stream position unpredictable. The cost is a bias below `n / 2^32`: about 1.4e-9 for a
d6, 9.4e-7 for a tile on an 80×50 map. Detecting that needs ~10^18 samples; a full run draws maybe
10^6 times. It is unobservable in principle, whereas variable draw counts are the thing the issue
correctly identified as surfacing days later as an unrelated bug. This is what makes `shuffle`
exactly `n - 1` draws. If a genuinely unbiased draw is ever needed, add a separate `intUnbiased`
and document the contract break at its call site — do not change `int`.

**Learned — the tests I wrote first were weaker than they looked.** I wrote the suite, it went
green, and then I mutation-tested it: 18 deliberate breaks of the implementation, checking not just
that the suite failed but that the *intended* test was the one that failed. Three mutations
survived outright:

1. **Rejection sampling in `int()` survived** — the exact bug this issue is about. My "consumes
   exactly one draw" test used a d6, where the rejection zone is 4 words out of 2^32, so a
   rejection implementation would never have triggered it. The fix is to test at spans just above
   2^31, where `floor(2^32 / span)` is 1 and roughly *half* of all draws get rejected; 200 samples
   there gives a rejection implementation a ~1e-31 chance of surviving. Worth internalizing: to
   test that something never resamples, you must pick the input where resampling is likely, not a
   representative one.
2. **Replacing `mulhi32` with naive `Math.floor(a * b / 2**32)` survived** 20,000 random operand
   pairs. The naive form is only wrong when the true 64-bit product lands within ~2048 of a
   multiple of 2^32, i.e. about one pair in a million — so a random sweep finds it never, and a
   real run finds it as a rare out-of-bounds map coordinate. Fixed by searching for adversarial
   pairs (products just below a multiple of 2^32, via modular inverse) and pinning eight of them.
3. **`float()` dividing by 2^32 - 1 survived**, because I had asserted a *range* rather than the
   divisor. Dividing by 2^32 - 1 lets `float()` return exactly 1.0 on the maximum draw and breaks
   every `Math.floor(f * n)` caller. Now asserted exactly: `float(rng).value === next(rng).value /
   2^32`.

Two more were caught only by the pinned-vector tripwire rather than by a test that understood what
was wrong. Dropping the fmix32 finalizer from `hashString` passed my avalanche test because I
measured the *average* number of flipped bits over all 32 positions, which is ~16 either way.
Per-position rates tell the real story: with fmix32 they span 0.484–0.513, without it 0.081–0.953,
because FNV-1a's multiply only propagates entropy leftward so the low bits stay tied to the input's
low bits. Averaging hid precisely the structure that matters. Similarly, `rngFromWords` normalizing
to signed int32 slipped past a test that compared two calls of the same function — self-referential
assertions pass for any *consistent* wrong answer, so it now asserts absolute values.

All 18 mutations are now caught by the intended test. The general lesson is that a green suite says
nothing until you have watched it go red for the right reason, and the tests that fail this
standard are the ones covering rare-but-catastrophic paths — which is most of what matters here.

**Also learned:** the comment-stripping fix from the previous session earned its keep immediately.
`game/rng/index.ts` legitimately documents that "`Math.random()` is a lint error inside `game/`",
which the old infrastructure scanner would have flagged. Predicted last session, confirmed this
one. I also re-verified both gates actually see `game/rng/` by planting five violations
(`Math.random`, `Date.now`, a `react` import, an upward `render/` import, an `async` function) and
watching lint reject all five; the scanner catches four, correctly not the `async` one, which is
the documented ESLint-is-the-authority split.

**Next:** #3 — core types and the `step()` reducer skeleton, with the replay-determinism test.
`Rng` is designed to drop straight into `GameState` as a field; nothing about it needs to change.
The RNG's own mini-replay test (a scripted mix of all five helpers reproducing byte-identically
across 250 turns) is a rehearsal for the real one, not a substitute.

**Watch:** Three things.

- The **pinned stream test** in `xoshiro128.test.ts` fails if the generator or seed derivation ever
  changes. That is deliberate — such a change invalidates every stored replay fixture and must be a
  considered `RunRecord.version` bump. If a future session sees it red, the question is "did I mean
  to change the algorithm", not "how do I update the constants".
- **`weighted` requires integer weights.** If a designer wants 1.5, the answer is to scale the
  table, not to relax the check. Float weights would reintroduce a rounding question this module
  otherwise does not have.
- **Ergonomics are unproven.** `{ value, rng }` threading has never been used by real draw-heavy
  code. M1 level generation is the first honest test of it, and if it is bad, it will be bad in a
  way that shows up as noisy call sites rather than as bugs. Revisit then, deliberately.

## 2026-07-29 — Stripped the Expo tutorial boilerplate (#1)

**Did:** Reduced the app to a single route. Deleted the three tutorial tabs, the modal, six unused
components, the React logo assets, and `scripts/reset-project.js`. Removed five dependencies that
existed only for deleted code: `@react-navigation/bottom-tabs`, `expo-image`, `expo-symbols`,
`expo-web-browser`, `@expo/vector-icons`. Web export went from 9 routes / 25.7 kB to 3 routes /
18.4 kB.

**Why:** Every tutorial file left in place is something a future session has to read and rule out,
and something a search surfaces as a false positive. Cheap to clear now, expensive once real code
sits beside it.

Collapsed the tab bar rather than keeping the renamed `character`/`settings` tabs: a tab bar
permanently occupies thumb space at the bottom of the screen, which is exactly where a
touch-native roguelike wants its controls (Pillar 3). If navigation is needed later it should be a
modal over the game.

**Kept deliberately:** `themed-text`/`themed-view`, the color-scheme hooks, `constants/theme.ts`,
and `expo-haptics`.

A correction on the reasoning, because the first version of this entry cited a requirement that
does not exist. I justified keeping the themed components with "dark mode is an M4 accessibility
requirement" — it is not. ROADMAP M4 and GDD §11 list colorblind-safe palette, text scaling, and
reduced motion; no document mentions color schemes at all. The actual mechanism is `app.json`'s
`userInterfaceStyle: "automatic"`. The honest reason is narrower: they are ~40 generic lines that
give the placeholder something to render and are cheap to delete later. Recording this because a
cited-but-nonexistent requirement becomes folklore the next session defends.

`expo-haptics` is the opposite case and the reasoning does hold — ROADMAP M2 really does say
"sound/haptic feedback for moving blind."

**Learned:** `eslint .` linted the agent worktrees under `.claude/worktrees/`. A design agent was
running in one, so `npm run verify` failed with 19 errors from a *different agent's copy of the
repo* — code not in my branch and not even in my working tree. Confusing failure, and it would
have hit anyone running an agent with worktree isolation. Fixed permanently: `.claude/worktrees/`
is now in `.gitignore`, the ESLint ignore list, and `tsconfig.json`'s `exclude`.

This is a direct consequence of making the lint gate real. `expo lint` only globbed `app/` and
`components/`, so it never saw worktrees; `eslint .` sees everything, which is the point, and
means the ignore list now matters.

**Next:** #2 (seeded RNG). #3 is blocked behind it. The design review (#4) is running in parallel.

**Watch:** The five removed dependencies were judged unused by grep after deletion, and the web
build and E2E pass — but **no native build has ever been run** on this project, so if any of them
was doing something implicit on iOS/Android it will not surface until the M4 native verification
pass. `expo-image` in particular is sometimes pulled in indirectly.

## 2026-07-29 — M0 design review: Emberdepth survives, but not as written

**Did:** Attacked the *Emberdepth* concept (issue #4), kept its skeleton, and replaced its central
claim. Rewrote `docs/GDD.md` — §1-§6, §9, §10 and a new §12 are now specified well enough to
implement M1 without inventing design mid-code. Wrote ADR-0007 (since **Accepted** — see the 07-30 entry) because
the change contradicts the concept seed in `VISION.md`, and annotated that seed so nobody builds
from the stale bullets.

**Why:** The seed's structure was "light costs fuel and gives information; dark is free and gives
none." Each option is one-dimensional, and a choice between two scalars is a threshold rule, not a
decision — "shutter the lantern unless you are lost." Dark also dominated on *both* fuel and safety
(things stay dormant), so the lantern was a failure button. And the turns spent crawling blind with
nothing to read are precisely the autopilot turns Pillar 1 forbids.

The four "open questions" in GDD §1 turned out to be four symptoms of that one flaw, which is why
none of them had an answer inside the seed. Three changes fix all four:

1. **Ember-sense.** Shuttered, you see the *position* of every living thing within radius 6,
   **through walls** — no identity, no health, no intent. Lit, you see terrain, items, creatures
   and intent within radius 4, blocked by walls. Light shows you stone; dark shows you souls.
   Neither state is blind, and the asymmetry (sense passes walls, light does not) means darkness
   tells you something light physically cannot.
2. **Fuel is earned by killing.** Creatures are made of ember. This is what makes the player *want*
   to wake something; without it light is strictly defensive.
3. **The dormant strike** — double damage on a sleeping creature. Darkness gets a capability rather
   than a discount, and the only free kills in the game exist only unlit.

The second axis the wager needed was **HP**, which already existed — fighting converts HP into fuel,
light converts fuel into HP preservation. Adding a heat/sanity/noise bar was the obvious move and
the wrong one.

**Learned:** The instinct to answer "dark needs an upside" with a *new* upside is what produces
bloat. The upside that worked was already implied by the fiction (things that glow in a lightless
ruin) and cost one integer of state. Similarly, "the wager needs a second axis" was true and needed
no new resource. Both times, subtracting or re-reading what existed beat adding.

Also: several candidate mechanics died on Pillar 3 rather than on fun. "Dark costs double action
time" was the first fix for the flatness and is genuinely richer than "dark hides intent" — it lost
because *telegraphing* it ("this enemy acts twice before you do") needs UI on a 6-inch screen that a
missing intent marker does not. Brightness-encoded health in ember-sense died on §11 (colour cannot
be the sole carrier of meaning). Worth remembering that the accessibility requirements are cutting
real mechanics, which is what they are for.

Replacement was seriously considered. The runner-up was pure positional tactics with no resource at
all (Hoplite-shaped); it lost on Pillar 4 — geometry puzzles produce "I played well", not "the
lantern died on floor six" — and it is recorded in GDD §12 as the **designated fallback**, so that
if M2 reports the wager is hollow the response is to strip fuel rather than bolt on another system.

**Next:** M0 #1/#2/#3 are unaffected and remain the implementation entry points. M1 can now be
planned against a real spec: 11×15 chambered-ruin generation (§5), the commit-one-turn-ahead
scheduler (§2), 4-directional bump combat with the dormant strike (§3), and the Cinder (§6). The
owner needs to accept or reject ADR-0007 before `VISION.md` is amended — the GDD is authoritative
in the meantime.

**Watch:** Three named risks with cut signals in the GDD. *Re-dormancy* (creatures return to sleep
after 8 turns of no contact) is the most likely to degenerate into "retreat and press wait"; the fix
is a distance requirement, not a fuel tax. *Dark adaptation* (ember-sense shrinks to 2 on shuttering
and recovers +1/turn) is the most likely to read as a bug rather than a mechanic — if the playtester
cannot explain why the distant dots vanished, it is presentation-broken, not design-broken. And the
whole "dark is not dominant" argument rests on arithmetic — light reveals ~20 tiles for 4 fuel,
touch reveals 8 for ~20 turns — which is reasoning, not evidence. Every fuel number in the GDD is
marked **(tuning)** for that reason; the three economy invariants in §4 are the part that is design.


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
