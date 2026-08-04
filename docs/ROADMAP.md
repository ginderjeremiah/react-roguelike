# Roadmap

Milestones, in order. Each is a vertical slice that leaves the game **playable** — never a
half-built system waiting on the next milestone to mean anything.

Kept in sync with GitHub milestones. Issues live there; this file explains the intent behind them.

**Current milestone: M2 — The light loop.** M1 is **complete**: the simulation, both pure layers, the
screen and the run loop are all built, and the exit playtest (#87, now closed) reached both endings
on a phone. M1 closed on [ADR-0011](decisions/0011-m1-exits-on-the-answer-not-the-outcome.md) — the
concept checkpoint was **answered**, not passed. **The answer was "not yet, and here is the rule that
was wrong"**, so M2 opens with the build order the #83 ruling specifies. Four M1 issues stay open
(#12, #47, #69, #70) and none gated the goal. **They are not all in the same place any more:** #47,
#69 and #70 are in the M2 milestone; **#12 moved to Contract and tooling** with the rest of the
determinism-gate debt (see the split below). So `gh issue list --milestone "M2: The light loop"`
will not show you #12 — that is deliberate, not a lost issue.

**M2 is four steps into a build order of six, plus 3a, 4a and 4b — all done — and it has grown a
step 5b.** 4b (#125) was ruled 2026-08-03 in PR #134 and **built the same day in #133 (PR #136,
`78ee0e5`)**. **#139 is ruled — 2026-08-04, arm 2 fired
([ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)) — and §12's fallback
**loses the word *designated*, not its place** — it stays the strongest named alternative and
#145's leading candidate; what is retired is the *automatic* consequent. What is next is #109 (now a before-number, not a gate), then
[#144](../../issues/144) (the cost-side lever), then its build, then [#145](../../issues/145) (the new
trip-wire's judging playtest).** See the ruled block under *#109 — the `HARVESTER` style* below.
#79 (PR #92) made a wake announce itself, with a
count; #94 (PR #101) gave that announcement two emphasis levels so it is read first; **#31/#41 made a
cache terrain the lantern has to have shown you**, which un-contaminates the fuel corpus; #107 made a
turn that both wakes and pays say both. **The order has changed since the
#83 ruling was written**, so read "The build order for the wager" under M2 below, not #83's issue body.

**Step 4 — #83, a woken Cinder pursues — landed 2026-08-02, and it is the one the other five were
sequenced around.** `nextMind` went from five cases to three: an awake creature now paths toward the
player every turn, lit or shuttered, near or far. It is subtraction — two cases and the `Awareness`
union deleted, no mechanic, no state, no UI — and it is the first step in this build order to change
what the simulation *does* rather than what it says about itself. `RULES_VERSION` 4 → 5. **It was
half the fix**, which is what step 4a below is: #83 replaced the parking and left the eight-turn
clock (the only thing contact still governed *at that point* — it is gone now), and the clock is
where the refund lived.

**#121 is ruled and built: step 4a, `#123` — re-dormancy is deleted.**
The playtest of #83 found that a pursuer cannot hit a player who keeps moving (0 damage across ~30
turns of active flight), and the ruling is that it never will: under §2 a creature's action is fixed
before your command and resolved after it, so **a player who moves cannot be hit at any creature
speed, given one legal move to make.** (`pursue()` names only the tile the player is standing on, so
the threat is a *single* tile and two adjacent creatures name the same one. The qualifier fails only
for a player enclosed on all four sides — a legitimate death, and **not** grounds to reopen cadence.)
All three fixes #121 offered — cadence, geometry-aware pathing, and something at the moment
of adjacency — are rejected, two of them on Pillar 2. **The fix is upstream: fleeing was still
*accomplishing* something.** Eight turns of walking turned a hunter back into a sleeper and pursuit
delivered it to the player's feet. So the eight-turn clock is deleted: **a woken Cinder is awake for
the rest of the floor — you kill it or you take the stairs.** Subtraction, as #83's was: one
constant, one field, one case of `nextMind`, and the whole *contact* concept with it. Full ruling in
GDD §4 (*Awake-creature behaviour*), with §3's *fleeing is hard* deleted rather than pointed at.

**The ruling redenominates the flash's price into HP, which is the only resource with no in-floor
recovery** (§3: no healing within a floor, +2 a descent, 12 max). The exchange rate is arithmetic and
not tuning: **a woken Cinder costs 2 HP or the stairs**, so a run can light and resolve about **13
creatures across eight floors** against the **42** it will meet. That is the wager acquiring a
currency, and it is also how this rule kills people — §4's own floor-8 history (*three flashes, five
Cinders, 10 HP, resolved for no damage*) becomes a dead run.

> **"Exactly" was struck here, and the 13 is an upper bound — [#125](../../issues/125).** #123's
> instrumentation measured 56 of 386 woken kills costing **nothing**: a creature's first action
> resolves a command later than usual whenever the command that woke it did not sweep phase 4 past
> `now`, which is true of every free action *and* of `beginRun`. Two player commands instead of one
> is two strikes, and two strikes is a Cinder. The rule below is unaffected; the price it quotes is
> not yet what the build charges.
>
> **Restored 2026-08-03 by #133 (PR #136): the price above is now what the build charges, and the 13
> is a budget again rather than a ceiling.** The grace turn is deleted, and free woken kills measure
> **0 of 387** (`STALKER`) and **0 of 252** (`FLOODLIT`). The note above is kept rather than
> deleted because the upper-bound reading is what every document here said for a day, and a reader
> who arrives from one of them needs to see it corrected rather than absent.

**#109 — the `HARVESTER` style, step 5 — remains the gate on everything numeric**, and #123 went
ahead of it deliberately: a rule that changes how many turns a run spends and what it spends them on
means the corpus would otherwise be re-measured twice with no way to attribute the difference. **No
fuel number may move until #109**, and §3's combat numbers should not move before it either, for the
same attribution reason — which now matters more, because §3's numbers are where the too-strong arm
gets answered if it fires.

> **The last clause is now wrong, and the freeze is stronger than it was — *2026-08-04, #139,
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)*.** The arm fired, and §3's
> numbers are **not** where it gets answered. ADR-0015 rules that no constant reaches either of the two
> propositions the rebuild is against: nothing puts a threat into a shuttered floor (*nothing wakes in
> the dark*, plus a pursuer cannot hit a moving player), and `resolveDeaths` pays `emberDrop` with no
> reference to mind state — a sleeper and a hunter pay the identical 20, so **no value of that field
> makes waking beneficial.** **The response is a rule change** ([#144](../../issues/144)). *No number
> moves* therefore stops meaning "wait for the instrument" and starts meaning "the instrument is not the
> fix" — a re-tune may follow the rule change, it may not replace it. **And #109 changes job**: from the
> gate on a re-tune to the **before-number** the rebuild is measured against, taken while the old rules
> still stand — and **its invariant 4 is now necessary rather than sufficient**, because raising
> `CACHE_FUEL` could turn it green by paying the player to flash *away* from creatures.

> **#139 IS RULED — 2026-08-04. Arm 2 fired.
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md) supersedes ADR-0012, and it
> did not come out the way this file's read expected.** The read recorded below was *"not yet, and
> #109 is the test"*; it is kept, wrong, because the whole point of writing it down as a read was that
> it might be.
>
> **What was decided, in four lines:**
>
> - **Arm 2 fired.** A broad playtest inside the bound reported it in its own words with numbers. The
>   three arguments against firing all fail — see the ADR; the load-bearing one is that **tuning cannot
>   reach either proposition below**, because `resolveDeaths` pays `emberDrop` with no reference to
>   mind state, so a sleeper and a hunter pay the identical 20 and **no value of that field makes
>   waking beneficial.**
> - **§12's fallback loses the word *designated*, not its place.** Read as §12 writes it — enemies
>   whose fixed patterns **force contact**, a different enemy, generator and win condition — **it would
>   work**, and it delivers proposition (a) by construction. What it loses on is **proportionality**: it
>   abandons a concept measuring well on Pillars 1 and 4 before anyone has deleted a single clause. It
>   stays the strongest named alternative and is #145's leading candidate; **what the project no longer
>   has is an *automatic* fallback.**
> - **What replaces it is a rebuild of the wager's cost side** — one rule change, its build and a
>   playtest, **far cheaper than the fallback, which is the point** — against two propositions: *a run
>   that never opens the shutter must be able to die of the dark*, and *waking something must be able to
>   be worth it*. Constraint: a subtraction from an existing rule, never a new system. **The lever is
>   [#144](../../issues/144)** and **no measurement clears the commitment** — a rule changes whatever
>   #109 returns.
> - **The new trip-wire's bound is an issue, [#145](../../issues/145)**, not a sentence — establishing
>   that the *last* bound had been consumed took three sweeps and a ruling.
>
> **What is next: #109, then #144, then the build, then #145.** #109 goes first only because it is
> cheap and it is the **before-number**; it is no longer a gate, and #144 is explicitly not blocked on
> it. Step 6 (#82) stays last. **The unnumbered fuel-economy re-tune is deleted from the plan** — it
> was gated on step 5 for a job ADR-0015 rules it cannot do.

> **Superseded — the pre-ruling note, kept because the entanglement argument is still the right shape
> and the read in it is a useful record of being wrong.**
>
> **What is next: #139, and then #109. Recorded here, 2026-08-04, replacing this file's *"what is
> next is #133"* note — #133 is built, merged (PR #136) and closed, so that note now misdirects.**
> It is written down rather than inferred because the journal's `Next:` and this list disagreeing is
> how the order has drifted twice before. Everything #125's argument said about getting ahead of #109
> is discharged: the fix landed, and step 4b below is the record of it.
>
> - **[#139](../../issues/139) — has §12's arm 2 fired?** A `game-designer` ruling, not a build. The
>   broad playtest on PR #136 reports *the lantern opened only when lost* in as many words and with
>   numbers: a zero-strategy bot that never opens the shutter reached the bottom on **9 of 9** seeds,
>   and the same bot with the lantern open **died in 4 of 4**. **That playtest is the one ADR-0012
>   bound the trip-wire to, so the bound is consumed** — and a trip-wire with a spent bound and no
>   new one is not a trip-wire.
> - **[#109](../../issues/109) — the `HARVESTER` style, step 5.** Its sequencing argument is finally
>   discharged for the last time: the corpus has now been re-measured for the last rule change, so
>   #109 would measure the game rather than an artefact. Nothing numeric may move until it lands.
> - **They are entangled in both directions.** Tuning a mechanic that is about to be deleted is
>   wasted work; ruling on whether the mechanic survives before #109 has run is ruling before the
>   diagnosis.
>
> **The order is #139 first, and the reason is that a ruling on whether the mechanic survives has to
> precede tuning it** — #109 is a measurement in service of a re-tune, and a re-tune presumes there
> is something to tune. **This is a sequencing decision and not a preview of the ruling.** The
> journal's `Next:` on the #133 entry reads the likely outcome as *"not yet, and #109 is the test"* —
> recorded here **as a read, not as a finding** — in which case #139 hands the order straight back to
> #109 with a re-set bound, which is a legitimate and probably the expected result. **Whoever picks
> #139 up rules it explicitly rather than letting build order rule it**; that is ADR-0012's own
> instruction, and it is the thing this note exists to protect.

**Three measurements are now rejected here, and the third was this ruling's own.** The adjacency
fraction is set by the **player** (0.89, and it reads as the opposite arm). *Unavoidable hits* is
pinned by the **rules** — §2 makes it 0, so it can only move by breaking §2. And the first replacement
#121 wrote — *free ember from a creature you woke, which must be zero* — is pinned by the **numbers**,
which the review of PR #124 caught. **GDD §4 now watches one arm, the too-strong one** (the lantern
opened only when lost), declares the too-weak arm **structurally closed**, keeps the zero-count claim
as a **regression guard** rather than a watch, and records the question that separates the two:
*name the state of the world in which this number comes back different.*
**That watch is now retired because the arm it watched *fired* — 2026-08-04, #139,
[ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md).** §4 keeps the paragraph as the
statement of what was being watched for, with the answer (*yes*) under it, and the one clause it got
wrong corrected: *"§3's combat numbers are the response"* — they are not, no number is.

> **And then the guard was built and failed — [#125](../../issues/125), PR #126.** *"Structurally
> closed"* is **not** true as written: 56 of 386 woken kills in the corpus cost 0 HP, because a
> creature's first action resolves a command late whenever the command that woke it did not sweep
> phase 4 past `now` — every free action, and every run start. The three rejections above stand and
> the question above stands; what falls is the confidence that the third quantity was pinned by the
> numbers. **It was pinned by an argument nobody had run against the build.**
>
> **And then it was closed by a rule instead — #133, PR #136.** *Structurally closed* is true again
> and the word is earned this time: it holds because a woken creature is due when the player is due,
> one rule at one call site, rather than because an arithmetic proof said so. The guard is enabled
> and green (0 of 387, 0 of 252). **It has therefore never caught anything**, which is the same
> epistemic position the proof was in — the difference is that two hand-built reproductions sit
> beside it and fail loudly if the call site drifts.

**§12's trip-wire fired on its second arm, and it is ruled —
[ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md), 2026-08-04, superseding
[ADR-0012](decisions/0012-the-fallback-trigger-is-a-verdict-not-a-signature.md).** The broad playtest
on PR #136 reported *the lantern opened only when lost* in as many words and with numbers; #139 ruled
that it fired.

**And the fallback the arm points at loses the word *designated*, not its place.** §12's fallback is
**not** *subtract fuel* — #63 corrected that reading and §12 carries the correction: it is **pure
positional tactics with enemies whose fixed patterns force contact**, a different enemy, a different
generator and a different win condition. **Read correctly it would work**, and it delivers proposition
(a) below by construction, because there is no shutter to decline. **What it loses on is
proportionality:** it abandons a concept the same playtest measures as serving Pillar 1 and Pillar 4
(13 of 38 turns as real decisions, a named retellable moment) for a design §12 records as losing on
Pillar 4 — and it does so before anyone has deleted one clause. So what is withdrawn is the *automatic*
consequent; the design stays the strongest named alternative and is #145's leading candidate. What
survives as a live rule is the direction: **subtraction and rebuild, never a second mechanic on top.**
**The project no longer has an *automatic* fallback**, which ADR-0015 records as a real loss rather
than a tidy-up.

**What arm 2 fires instead: the wager's cost side is rebuilt — one rule change, its build and a
playtest, far cheaper than the fallback and deliberately so.** Two propositions
must become true — *a run that never opens the shutter must be able to die of the dark*, and *waking
something must be able to be worth it* — because nothing wakes in the dark and a pursuer cannot hit a
moving player, so **darkness is safe** and not merely cheap. The lever is [#144](../../issues/144); the
new trip-wire and its bound are [#145](../../issues/145). **No measurement clears the commitment:** a
rule changes regardless of what #109 returns. See M1's exit section and M2's exit criteria, both
amended again.

---

## M0 — Foundations — **complete**

*Goal: the machinery of autonomous development works end to end, and the design is settled enough
to build against.*

No game yet. This milestone exists so that every milestone after it can move without stopping to
argue or to hand-verify.

- [x] Process, agents, and documentation scaffolding
- [x] CI pipeline: typecheck, lint, unit tests, web build, E2E smoke
- [x] Test infrastructure: Vitest + Playwright, both proven against a real assertion
- [x] Strip the Expo tutorial boilerplate down to a bare shell
- [x] Seeded RNG with a full property-test suite
- [x] Core types and the `step()` reducer skeleton, with the replay-determinism test in place
- [x] Design review of the *Emberdepth* concept — validate, sharpen, or replace it (`design`)

**Exit criteria:** an agent can take an issue from the queue to a merged, CI-verified PR without
human involvement, and `docs/GDD.md` describes a game we are confident is worth building.

**Both met**, and the GitHub milestone is closed. Every PR since #7 has gone queue → merge without
human involvement, and the GDD has survived a design review plus one measured correction
(2026-08-04).

## M1 — Playable core — **complete**

*Goal: you can move around a generated level, fight something, and die — or reach the bottom and
win.*

The first milestone that produces a game. Deliberately narrow — one level type, one enemy, no
items — because the point is to get the turn loop and the feel of movement right before anything
is layered on top.

- [x] Level generation (one algorithm, one theme) — #13
- [x] Field of view and light propagation — #14
- [x] The turn scheduler — #15
- [x] One enemy with legible intent (Pillar 2) — the Cinder, #16
- [x] Deterministic combat resolution — #16
- [x] `GameState`, the four-command union, and the real `step()` — #18
- [x] Descent, and the two ways a run ends — #18, GDD §13
- [x] Presentation model in `render/` — #19
- [x] `session/` owns the run, and `Run` hides `GameState` from the type system up — #45,
      [ADR-0010](decisions/0010-session-layer-owns-the-run.md)
- [x] Player movement and touch input — #20. Tap legality is `Scene.taps` in `render/`, so `session/`
      did not change and ADR-0009's `travel(to)` is one more `TapAction` case in M2
- [x] Death, winning, and a run-summary screen — #21. The run tally (kills, fuel burned, seed) went
      into `GameState` so a replay reproduces it; see the journal on why not `session/`. The last
      issue gating the exit, and the exit playtest followed it (#87)
- [ ] Determinism rules applied to `game/**/*.test.ts` — #12. Moved to the **Contract and tooling**
      milestone with #48, its twin; still M1's leftover, still not gating anything
- [x] A tap on a non-adjacent tile is silent — #60. Found by the first playtest; §2 requires feedback
      for a refusal and this is the first interaction a new player will attempt
- [x] The HUD's ember-sense readout lies while the lantern is open — #61. Found by the first
      playtest; it misreported the consequence of the game's central decision at the moment it is
      made. Fixed before the exit playtest for exactly that reason
- [x] `npm run build:web` and `npm run test:e2e` work inside a git worktree — #49. Not gameplay, and
      here anyway: every agent is told to work in a worktree, and CI runs on a clean checkout so it
      stayed green while two of the five pre-push checks silently did not run. Fixed ahead of #20
      because #20's acceptance evidence *is* those two commands. (**"Every agent is told to" is not
      written down anywhere in this repository** — `.claude/skills/work-item/SKILL.md` says `git
      switch -c` in the main checkout. The practice is real, nine worktrees deep; the instruction is
      oral. #62)
- [ ] Where a run's seed comes from — #47. **Does not gate the exit** — M1 ships a constant seed —
      but it is the one M1 issue that needs `platform/` to exist
- [x] Auto-travel's command shape — settled by [ADR-0009](decisions/0009-auto-travel-command-shape.md);
      **the build moved to M2**, and #32 with it
- [x] Rename the two colliding `Perception` types — #36; now `TurnPerception` (`game/fov/`) and
      `LightQuery`, which lived in `game/entities/` until #123 deleted the rule that asked it and
      moved it down to `game/systems/light.ts`

**A run can be won, which this roadmap never said.** GDD §13 settled it in #18: the run ends by
death *or* by taking the stairs on floor 8 (`LAST_FLOOR`). There is no floor 9 and no boss. The
goal and the exit criterion above are amended accordingly — "complete a run" now has two endings
and the summary screen has to render both.

### Where M1 actually stands

*Re-counted at `0baacfd` (#79, #94 and #31/#41 all merged, so M2's first three PRs are in these
figures) from the tree, not adjusted from the previous count — the
number this section carried four revisions ago ("`game/` is 44 test files and 797 tests") was the
**whole suite** mislabelled as `game/`, and it survived three PRs because a count with no stated
scope cannot be checked. So: **every number below names what it covers and how it was produced.***
**Only the `game/` and `render/` rows moved** (786 → 810 and 166 → 171). `session/`, `tests/unit/`,
`components/` and the E2E count are unchanged — **and an unchanged row is evidence about counts and
about nothing else.** The first draft of this paragraph said the unmoved rows proved PR #106 touched
no file outside `game/` and `render/`; review falsified it with one `git diff --name-only`. #106 also
changed three helpers under `tests/unit/support/` — `scenario.ts`, `lantern-run.ts` and
`run-script.ts` — which hold the row steady only because helpers carry no tests of their own. The one
to know about is **`scenario.ts`**: its floor construction used to make a `cache` tile without adding
it to `floor.caches`, so the contract every cache test is built on changed underneath them.

**This table went stale on every code PR and was repaired by the next docs pass — four for four.**
The total was `1047` at both `9df602d` and `bd4f577` (#92), `1116` at `942136c` (#97, a docs PR) and
`86eda1e` (#101), `1129` at `8c475bc` (#104, a docs PR) and `0baacfd` (#106), and `1158` at
`5c14218` (#111, a docs PR). Tracked as **#110**; the options are automating it or deleting the
numbers.

**#83's PR (PR #119) is the only code PR to have updated it, and the past tense above was premature.**
The way #119 was caught is still worth keeping: the table read `1158`; `main` at `8f29dc3` actually
measured **1166**, because PR #113 (#107) added eight tests under `tests/unit/` and did not touch the
table. So that PR's own delta was **+1**, not +9, and the only way to know it was to run the commands
against `main` as well as against the branch. **A stale baseline does not just make a number wrong —
it silently reattributes the difference to whoever measures next.** That is a better argument for
#110 than the staleness itself, and an argument for automating rather than deleting: a deleted number
cannot be misattributed, but it also cannot be checked.

> **The streak resumed on the very next code PR, so it is back in the present tense — checked, not
> assumed.** PR #126 (#123) touched `ROADMAP.md` by 129 lines and **did not touch this table**, which
> went stale in a way the total hides: `game/` lost `entities/contact.ts`, so the **source-module**
> cell went 45 → 44 while the test total sat still. Verified with `git show 29493d3 -- docs/ROADMAP.md`.
> **A table that only goes stale in the column nobody re-derives is worse than one that goes stale in
> the total**, because the total is the number a reader spot-checks. Five for six now, and #110 is
> still the fix.

```bash
# source modules and test files, per directory, tracked files only
git ls-files <dir> | grep -E '\.tsx?$' | grep -vE '\.test\.tsx?$' | wc -l
git ls-files <dir> | grep -E '\.test\.tsx?$' | wc -l
# tests: npx vitest run, per-file counts bucketed by top-level directory
npx playwright test --list      # E2E: declarations x 2 projects
```

**The table is measured at `29493d3`** (PR #126) and was re-derived from the tree by the reconcile
after it: `game/` 811, `render/` 171, `session/` 28, `tests/unit/` 157, **1167** total, **62** files,
**38** E2E. **Only the `game/` source-module cell moved** (45 → 44, `entities/contact.ts` deleted by
#123); every test count is unchanged, which is a coincidence rather than evidence — #126 both added
and deleted tests. The prose above about *which rows moved* describes the `0baacfd` re-count and has
not been re-derived since — so read the table as current and the deltas as history.

**Everything M1 set out to build exists, endings included.** #21 closed the run loop; the exit
playtest (#87) reached both endings on a phone at `3ea83fa`. What M1 did **not** settle is whether
the light wager is tense — that is M2's, and [ADR-0011](decisions/0011-m1-exits-on-the-answer-not-the-outcome.md)
is why M1 closes without it.

| Directory | Source modules | Test files | Tests |
| --- | --- | --- | --- |
| `game/` — generation, FOV, light, fuel, scheduler, combat, descent, endings | 44 | 42 | 811 |
| `render/` — the presentation model (#19), `taps.ts` (#20), `cues.ts` (#21, #79) | 9 + barrel | 9 | 171 |
| `session/` — the run (#45) | 1 + barrel | 1 | 28 |
| `components/play/` — board, cells, HUD, controls, summary, hit test, theme, `opening`, `status-style` | 14 | 0 colocated | — |
| `components/` (rest) + `app/` — two themed views; `_layout` and the game screen | 2 + 2 | 0 | — |
| `tests/unit/` — contract gates, consumer probe, the six `play-*` suites, helpers | 6 helpers | 10 | 157 |
| **Total (Vitest)** | | **62** | **1167** |

`components/play/` has **no colocated tests**: its **seven** pure modules are tested from
`tests/unit/play-*.test.ts` (hit test, cell style, messages, summary style, theme, opening — and
`status-style` from the theme suite, which is why seven modules make six suites) and its
React is tested by Playwright, per ADR-0005's no-component-test-runner rule. E2E is **38 runs — 19
declarations across 3 spec files, each run under both the `phone` and `desktop` projects**, up from 4
before #20, 34 before #94 and 36 before #107. A green CI log reads **37 passed, 1 skipped**, not 38
passed: the win-the-run spec
self-skips on `desktop` (it is a 30-second dive and the `phone` project already covers it). Stated
because the next person to re-measure this will otherwise think the count is off by one.

**`platform/` still does not exist** — that is #47's, and #47 does not gate the exit. M1 ships a
constant seed, so every run is the same run.

**#20's four inherited constraints are all discharged**, recorded here because each was cheap only
while it was still open:

- **A tap on a distant tile is `unbound` and carries its `at`** — every `TapAction` variant does, so
  ADR-0009's `travel(to)` is one more `case` in M2 rather than a restructuring. It is also *silent*,
  which is #60.
- **Tap legality is `Scene.taps` in `render/`**, not a `blocksMovement` call in a `.tsx`. `session/`
  did not change to carry it.
- **The palette is a provisional theme in `components/play/theme.ts`**, checked for completeness
  against `COLOR_TOKENS` and for contrast. M4 still owns the values.
- **The seed is the constant `emberdepth`**, and the playtest brief did say so.

**What is left in M1 is a playtest, not a feature.** #21 merged with the summary screen, both
endings, and an E2E path over a full run — so the exit criterion is now a thing to *check* rather
than a thing to build. **Both playtest findings that would have distorted that check are cleared** —
#61 (the ember-sense readout lied at the moment of the central decision) and #60 (a silent tap on a
distant tile, the first interaction a new player attempts, reading as a broken touch). Either would
have cost the playtest a finding about the *input* instead of about the game. #12, #47, #69 and #70
are real work that does not stand between the milestone and that check.

**The concept checkpoint was spent early, at #20 rather than at #21.** The exit criteria below say
the first `playtester` run is M1's exit; in fact it ran against #20's branch, six runs on the fixed
seed, before the endings existed. That was the right call — it found #59 (fixed in #56), #60 and #61
while the screen was still open on the bench — but it means **the exit playtest is now a second
one**, and the thing it must add is the part the first could not reach: both endings, and a full run
start to finish. The first run's verdicts are recorded on #32 (auto-travel) and #31 (the wager), and
both are folded into M2 below.

**Caveat that travels with everything the first playtest found:** it built from a working tree with
uncommitted in-flight changes, so its build is not reproducible from any commit. That undermines its
*hit-test* observations specifically. It does not touch the turn-by-turn counts, the fuel and HP
figures or the Pillar 1 ratio, all of which depend only on `game/`, which did not change.

### Scope note: M1 absorbed most of M2's simulation work

Flagged rather than corrected, because the absorption was right and the roadmap was wrong. #17
(fuel, the shutter, the light economy) and #16 (dormant-in-darkness behaviour) landed under M1 and
between them deliver three of M2's five *original* bullets outright and most of a fourth (the list
below has grown since, so counting it today gives a different denominator) — the fuel economy is
implemented and calibrated once, but its tuning is still open below. That was not scope creep by
inattention: the light wager *is* the turn loop, and a "playable core" that resolves turns without
fuel or waking would have been a different game with a second implementation to throw away.

The consequence to be honest about: **M2 is now a tuning-and-feel milestone, not a build
milestone**, and it can no longer be the place we discover that the concept does not work — the
simulation is already committed. The cheap discovery M2 was designed to buy has been partly spent.

**So the concept checkpoint moves here, to M1's exit.** It has to land somewhere, and the first
`playtester` run is the first moment any of this is judged by something other than a passing test.
Everything the wager needs is already implemented — fuel, waking, ember-sense, the dark crawl — so
the question "is this actually the reason to play" is answerable the day there is a screen. If the
answer is no, that is the moment to spend §12's fallback, not a milestone later. *(The answer came
back **not the concept, the cost side** — and on 2026-08-04 §12's fallback was **retired** rather than
spent, because it prescribes subtracting the resource the measurement exonerates.
[ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md).)*

**That checkpoint has now been passed, and it did not return a clean yes.** The verdict is on #31,
the re-ruling it forces is #63, and both are summarised under M2 below: the parts work and produce
genuinely distinct play, but the wager does not currently land *as a wager* — dark strictly dominates
on floor 1 (+26 fuel / 0 HP against −27 fuel / −4 HP lit). The playtester classified it **tuning, not
mechanic**, and recommended **not** spending §12's fallback. **Its stated reason for that
recommendation is false** — see M2 — so the "do not spend it" conclusion rests on the classification
alone and needs a `game-designer` to confirm or overturn it. §12's fallback is **not** spent, and
nobody should treat it as spent.

### Scope note 2: M1 also absorbed the architecture above `game/`

Also flagged rather than corrected, and for the same reason. M1's bullet list was written as
*features*; two of the items now on it are *layers*. `render/` (#19) was always planned. `session/`
(#45) was not — it was discovered, mid-milestone, as the answer to "nothing in this repository can
legally call the function #19 just shipped". The determinism rules widened from `game/` to all three
pure layers in the same PR, because shipping a new layer with a known hole in the gates is how a
gate stops being believed.

Accept it: M1 is now "playable core **and** the layer stack it needs", which is bigger than the
stated goal but is not padding — every part of it is on the shortest path to a screen. **What to
watch is the tail it left**: #47, #48, #52 and #53 all say some version of "the seam is not quite
where we said it was". **Only #47 is still in M2**; #48, #52 and #53 moved to Contract and tooling in
the split below — which changes where they are queued and changes nothing about the observation,
because the point was never the milestone. It is that four issues in a row disagree with the layer
map. Four is a normal amount of settling after a new layer. **If that set grows to six, or a
sixth layer gets proposed, the seam is still wrong** — and that is a design problem to solve once,
not four more issues to work through.

**The set stands at five after #20, one short of the tripwire.** #57 counts — the layer lint matches
import specifiers by path segment, so `components/game/` is rejected as a component reaching into the
simulation and #20's directory is named `components/play/` by the linter rather than by anyone. That
is the rule that enforces the seam being wrong about where the seam is, which is the same family.
**#58 does not count** and must not be added to it: `nativeEvent.locationX` being typed `number` and
`undefined` on react-native-web is a platform-typing bug, not a statement about our layers. Counting
it would fire a tripwire that is measuring something else.

**Exit criteria:** the `playtester` agent can complete a run start to finish on a phone-sized
viewport — **both endings, death and the eighth descent** — report that moving and fighting feel
good, and **the concept checkpoint has been answered: §12's fallback is spent or explicitly not
spent, with the evidence and the consequent design change recorded.**

**Met, and the third clause was amended to get there — see
[ADR-0011](decisions/0011-m1-exits-on-the-answer-not-the-outcome.md).** It used to read "…and that
the flash-and-crawl decision is one it actually made rather than one the rules merely permit," which
is **the same sentence as M2's exit criterion**. Holding M1 open on it meant M1 could not close until
M2 was finished — two milestones with one name. A checkpoint that asks a question is passed by an
*answer*, not by a particular answer.

The exit playtest (#87, `main` at `3ea83fa`, three runs, both endings) signed the first two clauses
without hedging and could not sign the old third: the decision was made about a dozen times in 359
turns and felt tense about three of them, none after floor 3. **The answer to the checkpoint is
therefore "not yet, and here is the rule that was wrong"** — §12's fallback is explicitly not spent
(its trigger never fired; both playtests named tense light moments and complained about their
*frequency*), and the consequent change is ruled in GDD §4/§6 and filed as #83.

**M2 keeps the tension criterion, and it is now load-bearing in a way it was not.** It is the only
place the wager is judged. If M2's playtest also cannot sign it, with #83 landed and measured, the
checkpoint has been answered twice with "not yet" and *that* is what spends §12 — not a deadline.

> **Ruled on #121, 2026-08-02: it did not fire. [ADR-0012](decisions/0012-the-fallback-trigger-is-a-verdict-not-a-signature.md)
> has the reasoning and the alternative that lost.** The short version: *"cannot sign the criterion"*
> and *"says the wager is not tense"* are different findings and only the second is §12's trigger.
> Three playtests, three verdicts — **tense and rare** (M1's exit), **tense and declinable** (PR
> #119), and *not tense*, which nobody has returned. A fallback that fires on any unsigned criterion
> fires on every unfinished milestone, which is the deadline the sentence above says it is not.
>
> **The sentence above is superseded rather than deleted, because the runner-up is real:** the
> trip-wire was written *knowing* #83 was the fix and knowing it would be built and measured before
> the sentence could fire, so "it arrives with a named fix" is an argument it already anticipated. It
> loses on the evidence — #83 fixed what it aimed at, and what PR #119 found is that the *diagnosis*
> was one layer short, not that the concept is dead.
>
> **The replacement trigger, so that "it never trips" is not the next failure mode.** §12 is spent by
> either of: **a playtest that cannot name a tense turn** (not one that could not sign, not one that
> wants it more often, not one that found a way to decline it), or **a playtest that reports the
> lantern being opened only when lost** — VISION's own failure condition, and §4's too-strong arm.
> **Bound: the next broad playtest after #123 is the one that judges it**, because #121's build is
> the last unbuilt thing that changes what the wager *costs*. §12 carries the same text.
>
> **That playtest has run and the bound is spent — PR #136 (#133), 2026-08-03 — and it reports the
> second arm.** *The lantern opened only when lost*, in as many words, on a never-shutter bot
> finishing **9 of 9** seeds against **4 of 4** deaths with the lantern open. The same playtest answers
> the *first* arm emphatically in the negative, and three things cut against firing — it classifies
> its own finding as *tuning*, #109 has not run, and arm 1 says no — against which stands ADR-0012's
> own reason for restating the trigger: **a trip-wire that survives its own firing condition is one
> nobody will ever trip, and arm 2 has no tuning escape clause.**
> **The bound is stated in five places** — here, at the top of this file, in M2's exit criteria, in
> GDD §12 and in ADR-0012 — and all five carry this correction. This one was missed by the
> reconcile that corrected the other four, which is the same undercount every sweep in this family
> has made.
>
> **RULED 2026-08-04 (#139): arm 2 fired —
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md), superseding ADR-0012.** The
> three arguments against all fail. *Tuning* is not the playtester's classification to make, and
> **tuning cannot reach either of the two propositions the rebuild is against**: no constant puts a
> threat into a shuttered floor, and `resolveDeaths` pays `emberDrop` with no reference to mind state,
> so a sleeper and a hunter pay the identical 20 and no value of that field makes waking beneficial.
> **#109** measures how far a never-flash fighter out-earns a flashing one — precision, not permission.
> **Arm 1** was satisfied *by darkness*: the retellable moment named is a turn on which the shutter
> never opened.
>
> **And the trigger's *automatic* consequent is withdrawn in the same ruling.** §12's fallback is not
> *subtract fuel* — it is enemies whose fixed patterns **force contact**, and read that way it would
> work. It loses on **proportionality**, not relevance: it abandons a concept measuring well on Pillars
> 1 and 4 before one clause has been deleted. So it stays the strongest named alternative and stops
> being automatic, and what arm 2 fires is a rebuild of the wager's **cost side** —
> [#144](../../issues/144) for the lever, [#145](../../issues/145) for the new trip-wire and its bound.
> **This section's sentence *"that is what spends §12"* has now been answered twice and both answers
> were surprising**: ADR-0012 said the condition had not fired when it looked as though it had;
> ADR-0015 says it fired and the consequent did not follow. Neither is the deadline this section
> refused to become.

**Two instructions the playtest brief must carry, both because auto-travel is deliberately absent
(ADR-0009).** Both were carried by the first brief and both did their job — keeping them here
because the *exit* playtest still needs them, unless auto-travel has landed by then:

- **Crossing known space is done by hand, up to about twenty tiles a floor.** Report the tap count
  as its own line item, and keep it out of the Pillar 1 autopilot count — or at least separate the
  two. Steps across an already-mapped empty room are not evidence that §5's no-corridors rule
  failed; they are the cost of the missing feature. *(The first run did separate them, which is what
  made the auto-travel gate answerable at all — see M2.)*
- **The fuel numbers from this playtest are weak evidence about the economy.**
  `game/systems/economy.test.ts`'s corpus models one-step play by a tireless script, and a
  tap-fatigued player goes back for fewer caches and chases fewer embers — which is precisely the
  behaviour §4's third invariant is calibrated on. Report what happened; do not re-tune from it
  alone. *(The first run reported invariant 3 failing on the generous side, +26 on floor 1 for dark
  play. Nothing has been re-tuned from it.)*

## M2 — The light loop

*Goal: the core wager from `VISION.md` is real and it is the reason to play.*

This was written as the milestone that determines whether the concept works. **It is no longer that
— the checkpoint moved up to M1's exit** (see M1's scope notes), because the simulation was finished
a milestone early and the first playtest is the first honest judgement of it. §12's designated
fallback (strip fuel, keep the positional tactics) is still what "change direction" means; it is
just spent at M1's exit if it is spent at all. What M2 is *now* is where the wager is made tense,
having already been judged not-dead.

> **The third sentence is wrong twice over — *2026-08-04, #139,
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)*.** Its parenthetical is the
> ***subtract fuel* misreading #63 corrected**: §12's fallback is not *strip fuel, keep the positional
> tactics* — it is enemies whose fixed patterns **force contact**, which means a different enemy, a
> different generator and a different **win condition**. And on the corrected reading the fallback is no
> longer the *designated* answer: it stays the strongest named alternative and #145's leading candidate,
> but firing arm 2 does not adopt it without argument, because it loses on **proportionality** —
> abandoning a concept measuring well on Pillars 1 and 4 before one clause has been deleted. So "change
> direction" now means what `VISION.md` says: **subtraction and rebuild, never a second mechanic bolted
> on top.** The rest of the paragraph stands — M2 is still where the wager is made tense, and it has
> grown a step (5b, the cost-side rule change) to do it.

**And "tuned" is the wrong word for it, which this paragraph used to use.** The M1 exit playtest
re-classified the problem as a **rule** one, not a tuning one — #83 deletes two cases of `nextMind`
and moves no constant — and the ruling explicitly forbids moving a fuel number until #31/#41 land.
M2's first two steps (#79, #94) change no simulation value either. Expect tuning to be the *end* of
this milestone, not its method.

- [x] Lantern fuel as the run clock — landed early, #17
- [x] Dormant-in-darkness enemy behavior — landed early, #16
- [x] Light-dependent visibility and memory of explored tiles — landed early, #14
- [x] **Re-dormancy — landed early, #16, and this line is new because its absence was believed.**
      `nextMind` in `game/entities/behaviour.ts` returns a creature to dormant after
      `TURNS_TO_REDORMANCY = 8` of its own turns without light and without adjacency; it is unit
      tested in `behaviour.test.ts` and pinned end-to-end by `replay.test.ts`'s fixture. **The first
      playtest reported it unimplemented and built a recommendation on that**, almost certainly after
      reading GDD §4's "**Awake-creature behaviour** (M2, ...)" marker, which was stale. §4 is fixed;
      this line exists so the mistake is not repeated from the roadmap instead.
      **And it is now deleted — #121 ruled and #123 built, both 2026-08-02 — so this bullet is
      kept as history and not as a feature.** Read it as *the mechanic that two rulings were spent
      on before anyone questioned whether it should exist*: it was believed missing (#31), then found
      built and blamed for the wrong thing (#63), then had its cause corrected upstream (#83), and is
      now removed because pursuit made the refund it pays *cheaper* to collect rather than harder
- [x] **A wake is announced, in the turn line, with a count — #79 (PR #92).** M2's first code and
      step 1 of the build order below, which made it a *precondition* rather than polish: once #83
      lands, an unannounced wake is an unannounced hunter. It covers all three emission sites — the
      ordinary transition, arrival by descent, and the opening frame of a run, which was built and
      tested and reached no pixel until review caught it (#93). The announcement now **exists**;
      whether it is *read* is #94, below. One seam it left untested is the lit descent, where `woke`
      outranks `descended` — #96
- [ ] **The real-run corpus never collects fuel, so every assertion about the receipt line is
      unexercised by a real run — #114.** Filed by `code-reviewer` on PR #113 and, like #115–#118,
      it never reached this file until the reconcile after #119 — **found by the review of that
      reconcile**, which is the fifth issue from #113's cycle and the one the sweep for the other
      four still missed. Wider than the gap #113 disclosed: not just that no run has a turn with
      both a `woke` and a `fuelGained`, but that two of the three replays produce **zero**
      `fuelGained` cues at all. So the corpus invariant that guards #94's levelling and #107's
      compound is real and its evidence base does not reach the turn shape it was written for.
      Belongs beside #96 above — both are "the seam this shipped is not covered by anything that
      replays a real run"
- [x] **The turn line has two emphasis levels, `alarm` and `report` — #94 (PR #101).** M2's second
      code and step 2 of the build order, *inserted by #79's own playtest*, which answered the
      question #79 was built for with a no. Ruled in GDD §10 with a §11 cross-reference: a wake,
      damage taken and the player's death are `alarm`; every receipt and every refusal is a `report`;
      the two must differ in two channels, one not colour. The level is a property of **the cue that
      won the line**, never of the string — which is what keeps a component from growing a second copy
      of the copy. **Measured and it worked**: 6 runs, 370 presses, `alarm` fired 16 times (1 turn in
      23, against a cut signal of 1 in 6), and on 5 of 5 waking flashes the line was read as *the frame
      changing* and the red `C` found second — the exact reversal of #79's complaint. **Three things it
      left behind**, all filed: `The lantern goes out.` is levelled `alarm` and can never reach a pixel
      (#98), `You take N.` fired five turns running with identical text (#103), and the board jogs 6pt
      on every flash cycle for an unrelated reason (#102)
- [x] **A woken Cinder pursues — #83, build-order step 4, 2026-08-02.** The ruling M2's whole build
      order was sequenced to reach, and the first of the four to move the simulation rather than the
      screen. An awake creature paths toward the player every turn regardless of contact; contact now
      governs only the eight-turn re-dormancy counter, which is unchanged at 8. **Subtraction, as
      ruled:** `nextMind` 5 cases → 3, and `Mind.awareness` deleted with the cases that read it. The
      four rules §4 said this would make load-bearing — §5's loop doorways, §2's step-off-the-marked-
      tile, §4's adaptation ramp, §13's un-followable stairs — now have something to do. **The rule
      is built, and PR #119's playtest has judged it.** Both checks came back: **0 fuel is no longer
      a dead zone** — dead in 6 turns from fuel 0 with two hunters, against 143 inert turns at fuel 0
      and HP 4 before — and the adjacency fraction returned **0.89 and does not discriminate**,
      because the player sets it (0 of 4 walking, 1.0 standing). **§4's too-weak arm fired instead:
      0 damage in ~30 turns of active flight.** That is **#121**, now ruled — see the bullet below
- [x] **Re-dormancy is deleted: a woken Cinder is awake for the rest of the floor — #121 ruled
      2026-08-02, built by #123 the same day, build-order step 4a.** The ruling is that the too-weak arm cannot
      be closed by creature behaviour at all: under §2 an attack names a tile a turn in advance and
      resolves after the player's command, so **a mover with one legal move cannot be hit at any
      creature speed** — and as implemented the threat is a *single* tile (`pursue()` names only the
      player's own), so two adjacent creatures name the same one and cannot pincer. All
      three of #121's proposed fixes are rejected (cadence and attack-of-opportunity on Pillar 2,
      geometry-aware pathing on reach and on §2's legible-over-smart trade). What was actually broken
      is that **fleeing accomplished something**: eight turns of walking converted a hunter into a
      sleeper, and pursuit delivered it *closer than it started* — one measured seven-tile retreat had
      a walk back of four. Deleting the clock removes the only free way out of a wake; §4 listed
      three (*outlast it, kill it, take the stairs*) and outlast was the free one. **Subtraction:**
      `TURNS_TO_REDORMANCY`, `turnsSinceContact`, one case of `nextMind`, and the whole *contact*
      concept including the injected `LightQuery` — the entity layer stops needing to know what light
      is. It closes **#89** by deleting the event #89 wanted announced, and makes **#99** a readout
      rather than a second opinion (the wake count over a floor becomes monotone). **The same edit was
      #83's rejected runner-up**, and the reversal is recorded in GDD §4 and the change log rather
      than made quietly: it lost on *"a permanently-awake **parked** Cinder is furniture"*, and #83
      itself deleted parking. **Its largest cost is stated in §4 and is not the deletion: HP is the
      only resource with no in-floor recovery, and this rule redenominates the flash's price into it
      at 2 HP a wake** — about 13 woken kills a run against the **42** a run meets. **Built
      2026-08-02:** `RULES_VERSION` 5 → 6, all three stored fixtures re-recorded (the combat one's log
      rewritten, not re-pinned — *a creature returned to dormant* was one of the six properties it
      existed for and is now impossible, so the assertion is inverted), `nextMind` returns an awake
      mind **by type**, and no number moved. **The per-creature wake/HP instrumentation was carried,
      and it found [#125](../../issues/125):** §4's regression guard came back **red** — 56 of 386
      woken kills in the `STALKER` corpus cost 0 HP. The cause is a **scheduling invariant**, not a
      fact about flashes: a creature's first action resolves a command late whenever the command that
      woke it did not sweep phase 4 past `now`, which is true of a free action *and* of `beginRun`
      (phase 3 only, **roughly one run start in nine** — measured at 11.2% over 2000 seeds by the
      reconcile after #126; *one in five* was §4's arrival figure misapplied to a run start, which is
      always floor 1) but **not** of a descent. Two player commands is two
      strikes, and two strikes is a Cinder. §4's *"every woken Cinder costs exactly 2 HP"* is wrong
      about one woken kill in seven **in the free-action half alone** — the corpus never calls `beginRun`. That was read as *a floor rather than the size of the defect*, and **#134's distance measurement reversed it**: every generated opening wake is at Manhattan ≥ 3, where the window costs 2 HP, so adding `beginRun` would move the free fraction *down*. It is essentially the whole of the **HP** defect for this style; what the run start hides is the **grace**. Not a regression — it predates #83 — and the fix is a rule
      change, so it is #125's to rule. `economy.test.ts` carries a characterisation test in the
      guard's place, with both routes reproduced by hand and a negative control on descent
- [x] **Rule on the grace turn a wake gets when phase 4 did not sweep — #125, build-order step 4b,
      ruled 2026-08-03 (PR #134).** Found by #123's instrumentation, not a regression, and a
      `game-designer` call because every fix is a rule change. It went ahead of #109 on three grounds,
      argued at step 4b below: attribution (its fix changes what a run spends, so #109 would measure
      the corpus twice), invariant 4 (a flashing style banks ember from ~1 woken kill in 7 without
      paying the HP, which the fuel corpus records as ordinary income), and **§4's honesty** — §4
      said nobody may cite its pricing paragraph as authority that a wake costs something until this
      ruled. #123's playtest reproduced it deliberately and rules it **low priority**, because the
      dormant strike strictly dominates it: one turn, 0 HP, 6 damage, no wake, no 4 fuel spent. That
      was evidence for the ruling and was **not** the ruling.
      **The ruling:** *a creature woken in phase 3 joins the schedule at the instant the player is
      next due to act*, so exactly one **paid command** stands between a wake and the creature's first
      resolution — never two, never zero. Stated over the schedule and not over free actions, because
      `beginRun` has no free action in it.
      [ADR-0014](decisions/0014-a-woken-creature-acts-when-the-player-next-acts.md); GDD §2's phase
      contract is amended and §4 carries the price
- [x] **Built it — #133, 2026-08-03.** One call site: `setMind` reads the player's `nextActAt` out of
      the schedule, *inside* the not-already-scheduled branch (hoisting it above the `hasActor` early
      return throws on every run that ends in a death, because `resolveAttack` unschedules the dead
      player — 33 tests, measured). `wakeInLight` and `lanternPhases` gained no arguments and **no
      paid command moved**: the descent negative control is green and unedited. §4's *What a build
      owes* predicted **9 reds in 4 files** and got exactly those 9; item 7's separate instruction to
      bring `scenario.ts`'s `awaken()` helper to the same instant added **3 more**, all the same class
      of verdict change (a chase loses a frame in which the creature was owed nothing; a retreat leaves
      the hunter a tile closer; a hand-built wind-up turn no longer exists). `RULES_VERSION` **6 → 7**
      with all three fixtures re-recorded — the shuttered crawl reproduced unchanged, and the combat
      log turned out to *re-converge* four commands after the wake, so what moved in its final frame is
      which of two hunters struck the killing blow. §4's regression guard is enabled in place of the
      characterisation block: free woken kills **56/386 → 0/387** (`STALKER`) and **22/247 → 0/252**
      (`FLOODLIT`), and both hand-built reproductions now end at **10/12 HP**. All three of the
      characterisation assertions were confirmed red *together* before anything was deleted, which is
      the condition §4 set. **#109 stays after it**, for the attribution reason above — but it is no
      longer *next*: this build's playtest produced **#139**, and the block under *#109 — the
      `HARVESTER` style* at the top of this file carries the sequencing decision
- [x] **Has §12's arm 2 fired? — [#139](../../issues/139). Yes. Ruled 2026-08-04,
      [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md), superseding ADR-0012.**
      The read recorded here was *not yet, and #109 is the test*, and it was wrong — kept, because it
      was written down as a read for exactly this reason. **The fallback loses the word *designated*,
      not its place**: it is not *subtract fuel* but enemies whose fixed patterns **force contact**, and
      read that way it would work — it loses on **proportionality**, because it abandons a concept
      measuring well on Pillars 1 and 4 before one clause has been deleted. It stays the strongest named
      alternative and #145's leading candidate; what the project no longer has is an *automatic*
      fallback. What arm 2 fires instead is a **rebuild of the wager's cost side** — *a run that never
      opens the shutter must be able to die of the dark*, and *waking something must be able to be worth
      it*, by subtraction and not by a new system, at the cost of one rule change plus a playtest
- [ ] **Rule the cost-side lever — [#144](../../issues/144)** (`design`). Which rule is subtracted.
      Leading candidate: light-gate the creature ember drop, mirroring #31/#41's cache rule; runner-up:
      a dark strike wakes what can feel it. **Not blocked on #109** — no measurement can return
      "nothing to fix"
- [ ] **The judging playtest after the rebuild — [#145](../../issues/145)**, which **is** ADR-0015's
      trip-wire bound. Blocked on #144's build. Fires on either arm, on the rebuild needing an added
      mechanic, or on `HARVESTER` still out-earning `STALKER`; clears on three criteria stated in
      advance, of which the load-bearing one is **a never-open-shutter line must be able to die**
- [ ] Fuel economy and the risk/reward tuning around it — calibrated once in #17. **#63 is ruled**
      and **no fuel number may move yet.** The first of the two reasons is now discharged: #31/#41
      landed 2026-08-01 and `DARK_PACIFIST`'s take went **119 of 121 → 0 of 121**, so the corpus is
      finally measuring the game §4 describes. **Every fuel figure in both playtest reports still
      predates it and inherits the contamination.** What is left before numbers move is a never-flash
      *fighter* in the corpus (step 5, **#109**), which is what invariant 4 is actually asserted
      against — and **#108** has now put a number on what that fighter will be asked to confirm: a
      floor **holds** 25-50 fuel in caches against **60-120 of creature ember, free in the dark**.
      That is arithmetic on the constants rather than an observed take — the ceiling, not the haul,
      which is exactly the difference #109 exists to close. It is the Watch §4 already carried,
      arriving early with numbers, and it is **not** a contradiction of the cache ruling, which said
      necessary-and-not-sufficient and named the never-flash fighter as the case it does not reach.
      What it changes is urgency, not the rule.
      **This bullet is superseded as a *plan* — 2026-08-04, #139,
      [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md).** The freeze stands and
      hardens; what goes is the idea that a re-tune is what happens once #109 lands. No constant reaches
      either of the two propositions the rebuild is against, and — the sharper half —
      **raising `CACHE_FUEL` could turn invariant 4 green while leaving both false**, because what it
      pays for is flashing *away* from creatures. **A re-tune may follow step 5b's rule change; it may
      not replace it.** Left unchecked because the box is still open — just not next
- [ ] Sound/haptic feedback for moving blind — **untouched.** #79 is adjacent and does not discharge
      it: a wake is announced in *text*, which is neither sound nor haptic, and #94 is about the
      pixels of that text. Nothing here has been built
- [ ] Does a creature on a marked tile take the hit? — #28, a design ruling §6 is missing
- [x] Touch perceives ember caches, which §4 says are invisible while shuttered — **#41, with #31**.
      Touch now reports an unlit cache tile as ordinary `floor` and the tile still enters remembered
      terrain, so there is no hole where the cache is; a cache pays only once its tile has *ever*
      been lit. One monotone plane in `Vision`, `RULES_VERSION` 4
- [ ] GDD §10's cell-state names vs the ones `render/` shipped — #46. Until this is ruled on, §10
      and the code disagree; §10 carries a pointer so a playtester reading it is not misled
- [ ] `litQuery`'s once-per-turn invariant has no test behind it — #35
- [ ] `render/glyphs.ts`'s header claims §10 does not name two glyphs — it now does — **#68**. Same
      family as #46 above; whoever rules on §10's cell-state names is already in both files
- [ ] **Every refusal needs an acknowledgement, and every new one has forgotten it** — **#75**. Not
      cosmetic and not really tooling: §2 says a tap that does nothing reads as a missed touch, and
      *three* refusals never reach `step` so none has a cue to speak for it. Two of the three shipped
      silent (#21, #60). This is the mechanism that stops a fourth, and it belongs beside the
      legibility bullet above rather than in a tooling list
      *(Both were open in M2 and mentioned nowhere in this file. Found by re-deriving `gh issue list`
      against it **after** the pass that caught #76/#78 and the seven playtest issues had already
      run — which is the point the Learned note in the journal makes: one sweep is not enough,
      because the sweep is only as complete as the person doing it.)*
- [ ] Auto-travel: implement `travel(to)` per [ADR-0009](decisions/0009-auto-travel-command-shape.md)
      — **#65**, filed because the gate below has been answered and the recommendation is build it.
      #32 was the design ruling and stays closed
- [ ] **The wager is invisible before it is taken and illegible after it** — **fourteen** issues from
      **eight** playtests, none of them tuning and none of them mechanic, all M2. Two are closed:
      ~~**#94** the wake line is the least emphatic text on screen~~ (done, PR #101) and ~~**#107** a
      cache the flash paid for is announced by nothing~~ (done, 2026-08-01 — the wake line now
      carries the turn's fuel receipt as a second sentence). Open: **#82**
      you cannot see which contacts a flash would wake, **#80** the dormant glyph `c` can never be
      drawn, **#81** the ember a kill drops is invisible in the dark beside you, **#84** neither your
      damage nor a creature's health is ever shown, **#85** dying with a dry lantern near-misses
      §13's "The lantern goes out.", **#86** the self-tap target eats half-cell misses, from #94's
      playtest **#103** whether `You take N.` earns `alarm` when it has three carriers already in
      frame and **#102** the board jogs 6pt every flash cycle, and from **#107's playtest** **#116**
      the compound line is additive in reading order but not on screen, **#117** `You gather N
      ember.` prints the turn's *net* delta so the same cache reads 21 and 25, and **#118** a kill you
      make while taking damage is not spoken, and from **#133's playtest** **#138** the board never
      follows the player so the tap zone wanders 385pt up and down the screen. They are
      one family: the exit criterion is a *felt* decision, and none of these change what the
      simulation does. **Those last three reached this list only in the reconcile after #119**, and
      the reason is a timing one rather than a skipped step — **PR #113 (#107) did carry a docs pass**
      (`8f29dc3` touches `GDD.md` +154, `JOURNAL.md` +121 and this file +47). Its playtest filed
      #115/#116/#117 at 01:33–01:34Z and #118 at 01:42Z against a merge at **01:41:44Z**, so the
      docs in that PR were written before the issues existed, and **no reconcile ran between #113 and
      #119** to catch them after. Stated precisely because the first draft of this paragraph said
      #113 "merged without a docs pass", which is false and reads as a working-agreement violation by
      a PR that did the work. The defect is real and is the *gap between* PRs, not the PR;
      #116/#117 were also in no milestone at all and this reconcile put them in M2. (**#115**, the
      turn line wrapping at 320 wide, came from the same playtest and is *not* counted here: its root
      is that this project has never named a minimum supported viewport, which is a missing decision
      rather than a legibility defect. It is in M2 too, as the place the wrap is felt.)
      **By creation time the eight playtests contributed 6 → 1 → 2 → 1 → 3 → 0 → 0 → 1**, and the
      family has never shrunk except by being built. **The trailing 1 is #138** (2026-08-03, from
      #133's playtest): the board is drawn as the whole grid and never follows the player, so the
      five tiles you tap every turn wander a measured **385pt vertically and 245pt horizontally**
      across eight seeds' opening frames. It is the same shape as #86 and #102 — a Pillar 3 reach
      defect rather than a fact the screen fails to say — and it is **pre-existing**, unrelated to
      #133, found because a playtest is where it shows up. So the family resumed growing under a
      broad brief, at one. **The two trailing zeroes are not equal evidence.**
      The first (PR #119) is the measurement this bullet asked for. The second is #123's playtest on
      PR #126, which mapped everything it found onto **existing** issues — #85 (its third sighting;
      #123 makes HP death the ordinary ending, so its near-miss now fires on the common case), #84,
      #117 and #80 — and filed nothing new. That is a real sweep and it is **weaker evidence than
      #119's**, because it was a **narrow build-verification brief** rather than a broad run, so it
      had fewer chances to hit a new one. Read the pair as: the family stopped growing under a broad
      brief, and did not resume under a narrow one.
      This bullet said: *"the measurement that would settle it is the next broad playtest — the one after
      #83"*, and *"if it returns six again, 'the wager is illegible' has stopped being a list of bugs
      and become a finding about the screen."* That playtest ran on PR #119, was genuinely broad
      (6 lines of play across 3 seeds, unlike the four narrow briefs before it whose counts are
      confounded by scope) — and **filed nothing new into this family.** Two caveats and no more: it
      re-hit **#85** live, and the sharpest legibility hole it named is **#99** (the *lit* player has
      no awareness channel at all), which is an existing issue rather than a new one. Its other two
      findings are outside this family by construction — **#121** is a mechanic and **#120** is
      tooling

### The build order for the wager, and where it stands

The #83 ruling fixed an order and made two of its steps hard constraints. **It has changed once
since**, so this list is authoritative and the ruling's issue body is not — the update is a comment
on **#83**.

> **This numbered list is the authority on build order, and it outranks every other record — #83's
> issue body, any `Next:` line in `docs/JOURNAL.md`, and any PR description.** If one of them
> disagrees with this list, **this list wins and the other one is a bug to fix.** Stated because it
> has now drifted twice: once when #83's body kept a superseded order (fixed by the comment on #83),
> and once when #94's journal `Next:` said #83 while this list said #31/#41 (ruled in favour of the
> list, comment `5153249392` on #83, corrected in PR #104). Two records that disagree are a coin flip
> unless one is declared to win. **Amending the order is fine — do it *here*, in the same PR, and say
> why.**

1. ~~**#79** — a wake is announced, with a count.~~ **Done, PR #92.** The ruling's precondition 1:
   being hunted by something you were never told you woke is worse than the bug #83 fixes.
2. ~~**#94** — give that announcement enough emphasis to be read first.~~ **Done, PR #101.** Inserted
   by #79's own playtest, which answered the question #79 was built for with a **no**: *"on every flash
   turn I noticed the red `C` first and read the line second, to confirm rather than to learn."* The
   old line was 13px/400/`#9a9083`, the second-smallest text on screen and **typographically identical
   to `The shutter opens. Light spills out.`** — so at a phone glance, *that was free* and *you have
   company* differed only in which dim grey letters were present. It was sequenced before #83 because
   today a missed wake costs a fact and after #83 it costs a hunter. **Its own playtest says it
   worked** (1 alarm in 23 turns; the line read first on 5 of 5 waking flashes) and adds one verdict
   worth keeping: *#82's tile pulse is not needed for this*, said plainly so nobody spends step 6
   defensively.
3. ~~**#31/#41** — caches are invisible while shuttered, per §4.~~ **Done, 2026-08-01.** It did what
   it was sequenced to do: `DARK_PACIFIST` 119/121 → **0/121**, `STALKER` 121/121 → 114/121 and net
   +8 → +7. **No fuel number moved**, per the rule above. *(The two `STALKER` figures are as measured
   at PR #106 and are stale by three rule changes — #83, #123, #133. Re-run 2026-08-04 they are
   **117/121** and **+6**; the conclusion, that the flashing style barely moved, is more true at 117
   than at 114. GDD §4 carries the same correction.)* Two things worth carrying forward. The
   corpus's `driedAfterTurns` had to be *re-instrumented* — it summed whole floors, and once every
   pacifist style dried on floor 1 it was measuring floor length rather than solvency; that is
   #105's "a threshold in the harness is instrument calibration" applied to the quantity rather than
   to the threshold, and no assertion was loosened. And the *sequencing argument was confirmed by
   the outcome*: the measurement above is attributable to exactly one change.

**~~Step 3a — #107: a cache taken by the flash that lit it is announced by nothing.~~ Done,
2026-08-01.** **Inserted by the reconcile after #106, on that PR's own journal entry's argument**, and it was step 3's own
regression: the pickup condition is *ever lit*, so a flash can pay a cache and wake something on
the same free action, and `describeTurn` returned at the `woke` tier before it ever reached
`fuelGained`. Verified in `components/play/messages.ts` at `0baacfd`. Sequenced here for the reason
#94 was: step 3's entire claim is that **light acquires caches**, and on the one turn where the
acquisition and the light are the same press, the price got the line and the goods did not. It was
also cheaper before #83 than after — once a flash produces a hunter, one more thing competes for the
same row. **Lettered rather than renumbered on purpose**: `docs/JOURNAL.md`, the comment closing #105
and the exit criterion below all cite "step 4"/"step 5"/"step 6", and renumbering would silently
redirect them.

**The precedence question was the `game-designer`'s and is now ruled** (GDD §10, 2026-08-01): a turn
that both wakes and pays says **both, on one line, in two sentences** — `Two things wake. You gather
21 ember.` — wake first, both halves verbatim, at the wake's own `alarm`. **Not** a fourth tier: a
tier list is a total order over which *single* fact gets said, and the turn has two, so reordering
only moves the silence from the goods to the price. **Not** a rule that the shutter may not pay a
cache underfoot: that is a simulation answer to a copy defect and it rebuilds the step-off-step-back
autopilot the *ever lit* clause exists to prevent, so §4 records it as rejected and the clause is not
reopened. It is the **only** compound the turn line has, and the two player tiers never compound.
New pin: the longest line the game can produce is ≤ **41** characters.

4. ~~**#83** — the ruling itself: a woken Cinder pursues.~~ **Done, 2026-08-02.** `nextMind`'s five
   cases become three; the declaration no longer consults contact, and the counter is all contact
   still governs. Two cases and `Mind.awareness` deleted — the ruling promised subtraction and the
   diff is subtraction. `RULES_VERSION` 4 → 5, and **the combat fixture was re-recorded rather than
   re-pinned**: its old log's "retreat" was a one-tile shuffle that only worked because breaking
   contact used to be enough, and under pursuit it became a stand-up fight with no re-dormancy, no
   sleeper and no death — so re-pinning the digest would have deleted three of the six properties
   that fixture exists for. **The post-#83 playtest has since run** (PR #119) and returned both of
   the exit criteria's numbers — see the exit criteria at the end of this section. It did **not**
   settle the ruling: the metric the ruling named turns out to be one the player sets, and the
   too-weak arm fired. **#121** is the consequence and is M2's blocker.

**Step 4a — #123: delete re-dormancy. Ruled on #121 and built, 2026-08-02.** **Lettered rather than
renumbered, for the same reason step 3a was**: `docs/JOURNAL.md`, the comment closing #105 and M2's
exit criterion all cite "step 5"/"step 6", and renumbering would silently redirect them. It is step 4a
and not step 5 because it is the second half of step 4 — #83 replaced the *parking* and left the
*clock*, and the clock turns out to be where the refund lived. **Sequenced ahead of #109 deliberately,
on #83's own argument for putting #31/#41 ahead of itself:** a rule that changes how many turns a run
spends and what it spends them on means the corpus gets measured twice with no way to attribute the
difference, and #109 exists to produce a clean measurement of invariant 4. **The consequence for #109
is not only sequencing** — the ruling widens the gap invariant 4 names, because a flashing style now
pays HP for every creature it lights while a never-flash fighter still one-shots everything it meets.
`HARVESTER`'s brief gains that question. **No number moves in step 4a**, including §3's combat
numbers, for the same attribution reason.

**One thing step 4a carried that is not a deletion: per-creature wake and HP instrumentation — and it
is the reason this step is worth reading twice.** GDD §4 keeps *no run may bank ember from a creature
it woke without paying HP for it* as a **regression guard**, believed true by arithmetic and there to
fail later if #109's re-tune or a creature with 3 HP or less reopened a free-kill route. Nothing in
`game/systems/economy.test.ts` or `tests/unit/support/lantern-run.ts` could assert it — per-floor fuel
income, demand and dry-out turns, and no per-creature attribution at all — so §4 made the guard
conditional on #123 building the instrument, and said that without it the guard must not be listed as
an acceptance criterion.

**#123 built it and the guard came back red.** 56 of `STALKER`'s 386 woken kills and 22 of
`FLOODLIT`'s 247 cost the player nothing. The cause is [#125](../../issues/125), and it is a
**scheduling invariant** rather than a fact about flashes: `wakeInLight` schedules a woken creature at
`now + ACTION_COST`, and whether its first action resolves on the next command or the one after
depends on whether the waking command's **phase 4 swept past `now`**. An ordinary paid command's does.
**Two do not — a free action (phase 4 is `identity`) and `beginRun` (phase 3 only, no free action
anywhere).** In both the player gets two phase-1 actions instead of one before the creature resolves
anything, and two actions is two strikes, and two strikes is exactly a 5 HP Cinder against a 3 damage
player. **Flash next to a sleeper and it dies for 4 fuel and no HP.** (*Corrected 2026-08-03*: that
sentence used to end *"or simply start a run"*, which is false of the build. §5 step 7 keeps a
generated opening at Manhattan 3 or more, and the extra command is worth 0 HP only at Manhattan 1-2,
so **an opening wake already costs the full 2 HP** — the run start hands out the *grace*, and the HP
leaks through the free action. Step 4b below, and GDD §4's distance table.)
`game/systems/light.ts` had recorded the free-action half in plain English since M1 and nobody had
multiplied it by §3's damage. It predates #123 and #83 alike; re-dormancy hid it, because the dominant
free kill was the one on a creature that had gone back to sleep.

**Two things about the shape of it, both of which change what a fix must do.** The `beginRun` route is
live on **roughly one run start in nine** (measured at the reconcile after #126: **223 of 2000** seeds
through `openRun`, 11.2%. *One in five was wrong* — it took §4's change-log figure of 20% of
**arrivals** and applied it to a **run start**, which is always floor 1 and therefore carries
`min(2 + floor, 6)` = 3 creatures against 6 from floor 4 down. Per-depth: floor 1 **11.2%**, then 14.7 / 17.9 / **20.6%**, flat from floor 4 down (the `min` caps spawn at 6, so floors 4-8 are structurally identical and measure bit-identically). `tests/unit/play-opening.test.ts` and `ARCHITECTURE.md` already said one in ten), so
*"schedule a creature woken by a free action at `now`"* — the obvious fix, and the one #125's first
draft named — **would not close it**. And a **descent does not** open the window: `arriveOnFloor` charges the player
and `descendTurn` runs the whole phase list, so phase 4 sweeps and the creature acts on the next
command as §2 promises. The route is `beginRun` and free actions, not arrivals generally.

**And the corpus can only see one half of it.** `arriveOn` in `tests/unit/support/lantern-run.ts`
starts every floor shuttered and never calls `beginRun`, so the 56/386 figure is the free-action half
alone. The run-start route is pinned by a hand-built reproduction in `economy.test.ts` instead.

**The transferable part is the conditional, and it is worth keeping the shape of it.** A quantity was
declared zero by argument, relabelled a guard on the strength of the argument, and never measured
because the measurement did not exist. The rule that no criterion may be claimed until the thing that
would falsify it can be observed is the only reason this was found — and it fired in the direction
nobody expected. #125 owns the fix, which is a rule change; `economy.test.ts` carried a
characterisation test in the guard's place, and **it went red** the day the rule was built — #133,
not #125. #125 was the ruling and closed on its own merge; nothing in `game/` moved until #133.

**Step 4b — #125: rule on the grace turn a wake gets when phase 4 did not sweep. Added to this list by
the reconcile after PR #126; *ruled 2026-08-03 in PR #134 and built the same day in #133 — done*.**
**Lettered rather than renumbered, for the third time and the same reason** as 3a and 4a:
`docs/JOURNAL.md`, the comment closing #105, GDD §12
and M2's exit criterion all cite "step 5"/"step 6", and renumbering silently redirects them.

**Why it goes ahead of #109, which is the whole reason it is written down here rather than inferred.**
Three arguments, and the first is the same one that put #123 ahead of #109 — used unchanged, because
the situation is identical:

- **Attribution.** #125's fix is a rule change that alters what a run spends and what it gets. Build
  #109 first and the corpus is re-measured twice with no way to tell which change moved it, which is
  precisely what #109 exists to avoid — it is the *clean* measurement of invariant 4.
- **#125 is income invariant 4 cannot see.** Invariant 4 is *a style that never opens the shutter must
  not out-earn one that flashes*. A flashing style banked ember from ~1 woken kill in 7 without paying
  the HP, and the fuel corpus recorded it as ordinary income. Measuring the invariant against a
  confounded numerator answers the wrong question. Measured after the build: 0 of 387 for `STALKER`.
- **§4's honesty was gated on it.** §4 stated that **nobody may cite its pricing paragraph as
  authority that a wake costs something** — and the ruling did not lift that, the *build* did. #125
  was ruled to make *every woken Cinder costs exactly 2 HP* true again rather than to soften it, so
  the caveat stood over the arithmetic the whole HP budget rests on **until #133 shipped**. It has,
  and the caveat is gone.

**It is a ruling, not a build** — a `game-designer` call, cheap in the way #121 was, and this roadmap
did not preempt it. #125's body carries both reproductions and the three options it opened with.
**Do not treat the low-priority read from #123's playtest as the ruling**: the playtester's finding is
that the dormant strike strictly dominates the free kill, so it is a discount on an accidental wake
rather than an exploit — real evidence, and it was handed to #125 rather than substituting for it.

**Ruled 2026-08-03, PR #134: the grace turn is deleted.** *A creature woken in phase 3 joins the
schedule at the instant the player is next due to act.* On a paid command that is `now + ACTION_COST`,
so **no paid command moves**; on a command the player was not charged for it is `now`. The runner-up —
accept it and re-price the wake — lost on Pillar 2 (an unreadable clock deciding whether a wake costs
anything), on the medium (the rule the player would have to hold is a paragraph), and on the budget
(§4's exchange rate stops being fixed by arithmetic and becomes partly player-set). One correction the
review forced and it is worth carrying: **the free kill needs the player within Manhattan 2 at the
wake**, and §5 step 7 keeps a run start at Manhattan 3 or more — so the `beginRun` half is a
legibility and *tempo* defect, and the HP leaks through the **free action**. One start in nine is the
frequency of the grace, not of a free kill.
[ADR-0014](decisions/0014-a-woken-creature-acts-when-the-player-next-acts.md) carries the reasoning.
**Built 2026-08-03 in #133**: one call site (`setMind` reads the player's `nextActAt` from the
schedule), `RULES_VERSION` 6 → 7 with all three fixtures re-recorded, and §4's regression guard
enabled in place of the characterisation block — free woken kills 56/386 → **0/387** for `STALKER`
and 22/247 → **0/252** for `FLOODLIT`, with the descent negative control green and unedited. **#109
stays after it.**

5. A **`HARVESTER`** style in `game/systems/economy.test.ts` — never flashes, routes to every
   ember-sense contact, one-shots each dormant — which is what §4's invariant 4 is asserted against.
   **Filed as #109** by the reconcile after #106: it was the one step in this list with no issue behind it,
   and #108 has since measured what it will be asked to confirm.

   > **Its job changed on 2026-08-04 (#139,
   > [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)) and the step survives.** It
   > is no longer *the gate on a re-tune* — ADR-0015 rules that no number is the fix — it is the
   > **before-number the cost-side rebuild is measured against**, and it is worth taking while the old
   > rules still stand, which is the same argument #133 made for measuring the corpus on both sides of
   > a rule change. It is cheap, so it goes next. It does **not** block [#144](../../issues/144).
   > Invariant 4's passing condition is unchanged — `HARVESTER` must not out-earn `STALKER` — but the
   > **invariant is demoted from sufficient to necessary**: raising `CACHE_FUEL` could turn it green by
   > paying the player to flash *away* from creatures, leaving both of the rebuild's propositions false.
   > **Read #109's number beside them, never instead of them.**

5b. **The cost-side rule change — [#144](../../issues/144) rules the lever, and a build issue follows
   it.** Inserted 2026-08-04 by #139's ruling. Two propositions must become true: *a run that never
   opens the shutter must be able to die of the dark*, and *waking something must be able to be worth
   it*. Constraint: a subtraction from an existing rule, not a new system. **Numbered 5b rather than
   renumbering, for the reason this list already gives twice: `ROADMAP.md`, GDD §4 and M2's exit
   criterion all cite "step 5"/"step 6" and renumbering silently redirects them.**
6. **#82 last, unchanged and still explicitly last.** Shipping it before #83 makes the game *worse*:
   drawing the radius-4 footprint turns the containment read into exactly the clean binary the first
   playtest complained about. Correct and desirable, but only once waking has a price.

**"Step 6" means #82 here and nothing else, and two other records use it to mean re-tuning.** The
#106 journal entry ("the measurement without which step 6 tunes the wrong constant") and the comment
closing #105 ("re-derivation remains roadmap step 6") both mean **the fuel-economy re-tune**, which
has never been a numbered step in this list — it is the M2 checklist bullet above, gated on step 5
by §4's *no number moves until the corpus contains a never-flash fighter*. Recorded rather than
renumbered: this list is about what to *build*, and the re-tune is what happens once it is built.

> **And the re-tune is now deleted from the plan — *2026-08-04, #139,
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)*.** It was gated on step 5 to
> do a job the ruling says it cannot do. **No constant reaches either of the rebuild's two
> propositions**: nothing puts a threat into a shuttered floor, and `resolveDeaths` pays `emberDrop`
> with no reference to mind state, so a sleeper and a hunter pay the identical 20. **And the number the
> re-tune would reach for is a trap**: raising `CACHE_FUEL` far enough satisfies §4's invariant 4 while
> leaving both propositions false, because what it pays for is flashing **away** from creatures — clear
> the room dark, *then* flash for the cache, which is #108's measured best line. So the re-tune would
> buy a green assertion and no game. **A re-tune may follow step 5b's rule change; it may not replace
> it**, and it is not what comes back after #109. The three records above are left as written because
> each was true when written; this note is what a session following any of them needs.

**#89 is deliberately not in that list, and its parked question is now answered — against building
it.** Re-dormancy is as silent as waking was, so a shuttered player cannot tell *it gave up* from *it
is still coming*. It is not the inverse of #79 and must not be built as one — waking happens where
the player is looking, re-dormancy by definition does not, so announcing it would tell the player
something they have no in-fiction way to perceive. The parking condition was *"rule it after #83 has
shipped and been played"*; that happened on PR #119, and the finding is that **an ember-sense mark
that stops moving already is re-dormancy announcing itself** — in the fiction, through a channel the
shuttered player is already reading, and it worked every time the playtester used it. **The issue
stays open for the counter-argument, not because the question is unanswered**; closing it is a
`game-designer` call. The hole the finding exposes is a different one and belongs to #99.

**That call was made by #121 rather than by argument, and #89 is now closed** (2026-08-02, verified
against `gh issue view 89`). The ruling deletes re-dormancy, so there was no transition left to
announce — a woken creature is awake until it dies or you descend. It is closed citing #121, not the
counter-argument above, so the record says *the event was removed* rather than *the announcement was
refused*. **#99 moves the other way and gets stronger:** with re-dormancy gone the wake count over a
floor is **monotone**, so a HUD readout of how many things are awake is a running total of the
flash's bill rather than a number that can silently go down. **Whether to build it is still unruled**,
and #123's playtest sharpened the case for it without ruling it either: two woken Cinders in the open
stack their attacks (`You take 4.`, 12 → 8 → 4) where the same two held at a doorway cost 4 HP total,
so *how many are awake* is now the input to the only price control the player has.

**#99's parking reason is discharged, and this reconcile moved it into M2.** A HUD readout of how
many creatures are awake, split out of #94's ruling. It was parked as *"today it would count parked
creatures, which is trivia; after #83 it counts things walking toward you"* — #83 shipped, and PR
#119's playtest found a sharper argument than that one: **ember-sense is sealed while the shutter is
open, so the player who chose light gets one `Something wakes.` and then nothing at all.** One run
carried two hunters for ~10 turns blind and lost 8 HP in three. The player who paid fuel for
information is the one flying blind, which is backwards. **The deliberate un-milestoning no longer
holds** — an issue in no milestone is invisible to `gh issue list --milestone`, and the reason it was
kept out has expired — so it is in M2 and its stale `blocked` label (it was blocked on #83) is gone.
**Whether to build it is still unruled**, and it interacts with #121: how legible a hunter must be
depends on what a hunter can do to you.

**Two measured facts from #79's playtest that bear directly on M2's exit criterion.** The first is
buried in a comment on #83; the second is in no issue and no PR thread, so this roadmap is its only
record.

- **0 fuel *was* a dead zone, and #83 closed it — checked, as this bullet asked.** §13 says it is not
  an ending, and with nothing hunting the player a bot ran **143 turns at fuel 0 and HP 4**, empty
  status line every turn, with no way to finish the run. **After #83 (PR #119's playtest): a reckless
  run hit 0 fuel at turn 20 with two Cinders hunting and was dead by turn 26** — HP 12 → 10 → 8 → 4 →
  dead. 143 inert turns to 6 lethal ones is a total reversal, and it is the strongest single evidence
  the ruling was right. Left here as a matched before/after pair rather than deleted: it is the only
  place in this repository where the two halves sit together
- **8 of 51 consecutive turns on `emberdepth` were real decisions**, with two unbroken autopilot
  stretches of **15 and 22 turns**. Read that as an argument **for** #65 auto-travel, not against:
  the stretches are forward travel across space a flash has already revealed, which is precisely the
  case ADR-0009's stop rules collapse — see the auto-travel section below, where the same mistake
  (evaluating travel against *backtracking*) is described. Compare the first playtest's 9-of-37;
  whether the two counted a "decision" identically is not recorded, so treat the trend, not the
  delta, as the finding.

### The first playtest's verdict on the wager, and one thing it got wrong

Six runs, fixed seed `emberdepth`, 390×844 with touch emulation, against #20's branch. Full report on
**#31**. Recorded here because the tuning work above is judged against it.

**Dark is not currently a trade against light; it is simply better.** Floor 1, measured: floodlit
23 turns, fuel −27, HP −4, two awake kills at two hits each. Dark 21 turns, fuel **+26**, HP 0, two
dormant kills at **one** hit each. A 53-fuel and 4-HP swing, and the dark line was found on the
second run and was not optimised. The light decision was agonising exactly once in six runs, and only
after the player had already burned down to 17 fuel playing badly. Related: **fuel is not the run
timer it is meant to be** — the player died of HP with 66 fuel banked. §4's invariants 1 and 2 hold;
**invariant 3 fails on the generous side** for dark play.

The three causes it named, in its order: a flash costs 5 fuel and **zero turns** (both toggles are
free actions); the containment guarantee turns ember-sense at 5/5 into a **permission check** rather
than a gamble; and light's only unique product — terrain and items — can be deferred indefinitely,
because touch radius 1 plus the four-neighbour guarantee lets you crawl anywhere forever.

**Classification: tuning, not mechanic.** "The dark stalk is genuinely good play and it is the thing
I would come back for; it just needs to cost something."

**Where it was wrong, and it matters because it was the load-bearing reason:** it recommended not
spending §12's fallback *because* §4's re-dormancy was unimplemented, so light was more punishing
than the design intends and the wager was being judged with one counterweight missing. **Re-dormancy
is implemented** (see the checked bullet above), so that argument does not hold and its proposed
sequence — *re-dormancy first, then re-tune, then re-measure* — collapses to **re-tune, then
re-measure**. **#63 is now ruled** (in PR #88, not in whichever PR you are reading this from): the
fallback is **not** spent, on new reasoning — its
trigger names "the first playtest says the wager is not tense", and neither playtest says that; both
named tense light moments and complained about their *frequency*. The classification changed too —
#83 is a **rule** problem, not tuning.

**Two levers it offered and did not decide**, both real trades: charging a turn for the shutter
toggle (§2 argues against it on Pillar 3 grounds), and cutting ember-sense below 4, which breaks the
containment guarantee's use as a permission check without breaking its use as legibility. Also
observed and unfiled as its own thing: six rapid shutter taps burn 15 fuel with zero turns elapsed
and no warning, so a fumbled double-tap costs 5 fuel.

**Contract and tooling debt — no longer parked here. The trigger fired and it has been split out.**
This paragraph used to end *"if M2 starts and this list has grown, move it to its own milestone
rather than carrying it further."* M2 started (#79, PR #92) and the list had grown again — five, then
eight, then **thirteen** — so those thirteen were moved to a GitHub milestone named **Contract and
tooling** (#95 was filed straight into it, making fourteen), and `gh issue list --milestone "M2: The
light loop"` is now **substantially** light-loop work — with three deliberate exceptions, #67, #72 and
#73, kept in M2 for the reasons given below. The list stays written here because the *intent* behind
each item is not in its issue body; the milestone is where they are queued.

None of it gates any milestone exit. **Do not count it as M2 progress**, and do not let it grow back
into M2 — anything of this shape filed from here on belongs in the new milestone on the day it is
filed.

**The split survived its first cycle, with one caveat worth more than the split itself.** #94 produced
exactly one tooling item and it was filed **straight into the new milestone** rather than into M2,
which is the behaviour the paragraph above asks for. But it was **#100, a duplicate of #76** — already
on the list below, same root cause, same fix — filed by an agent that had hit the bug live and did not
check whether it was known. Closed as a duplicate, its new evidence (a second occurrence, and the
current CRLF file list, which has changed since #76) moved onto #76. So the count stays at
**fourteen**. *(#76 itself is now closed, 2026-08-04, as superseded by **#141** — the same evidence
plus a fresh file list. The duplicate-checking lesson below is unaffected; where this paragraph says
#76, the live issue is #141.)* **Filing into the right milestone is not the same as reading it**, and the second habit
is the one that is missing.

**The count moved by five, not by the two filed this session.** #90 and #91 are new (both from #79),
#12 came down from M1's list — and **#76 and #78 were already in the M2 milestone and had never
reached this roadmap at all**, filed during #60/#61 and invisible here ever since. That is the exact
drift this section was written to prevent, happening to this section: a list that claims to make the
queue visible only does so if someone re-derives it from `gh issue list` rather than reading it.

**Fifteen after the reconcile following #106**, which filed **#110** — the count table in this file
has gone stale after every code PR and been repaired by every docs PR, three for three. It went to
this milestone because it is a process defect, which is what this milestone is for; #106's own two
findings (#107, #108) are **not** of that shape and are in M2 where they belong.

**Seventeen at the reconcile after #119, and only one of the two is new.** #119 filed **#120**
straight into this milestone — the second time in a row the "file it here on the day" rule was
followed without prompting, and it is the same family as #90/#91: a guard that still passes while
guarding nothing. The other is **#112**, filed by `code-reviewer` on PR #111 and **never listed
here** until now, which is the #76/#78 failure repeating for the fourth time. **Re-derive this list
from `gh issue list --milestone "Contract and tooling"` rather than reading it** — every count in this
paragraph has been wrong at least once, and always in the same direction.

**Still seventeen at the reconcile after #126, and this is the first pass where the re-derivation
found nothing missing.** Verified with `gh issue list --state open --milestone "Contract and tooling"`:
17 open, and all seventeen are in the list below — #12, #39, #48, #50, #52, #53, #57, #58, #62, #76,
#78, #90, #91, #95, #110, #112, #120. **#123's cycle filed nothing into this milestone**, so the
count held for a reason rather than by luck. One caveat on reading that as the habit sticking: the
same cycle *did* find a process defect and it was filed as **#125**, in M2, correctly — it is a rule
bug, not a tooling one.

**Twenty-one at the reconcile after #136, and the re-derivation found a missing one again — so the
run of clean passes was one, not two.** Re-derived with `gh issue list --state open --milestone
"Contract and tooling"`: **#12, #39, #48, #50, #52, #53, #57, #58, #62, #78, #90, #91, #95, #110,
#112, #120, #132, #137, #140, #141, #143**. Five moves. **#76 is closed** (2026-08-04) as superseded
by **#141**, which
carries the same root cause plus a current file list, the conclusive close-out check, and the reason
a convention cannot replace `.gitattributes`; **repoint any reference to #76 at #141**. **#137, #140
and #141 are new from #133's cycle** and **#143 from this reconcile's own review cycle**, all filed
straight into this milestone on the day — the third, fourth, fifth and **sixth** time that rule has
been followed without prompting. *(That is a count of **issues**; the original counter in the
paragraph above counted **cycles**, and by that measure #143 is the fourth consecutive cycle —
#94's, #119's, #133's and this one, with #126's cycle filing nothing here at all rather than filing
it wrong.)* And **#132 was filed
2026-08-03 at 06:41Z and never reached this list**: the reconcile that should have caught it (PR
#135) merged **3½ hours later** the same morning and did not. That is the #76/#78 failure repeating
for the **fifth** time, and it is why the clean pass after #126 was a cycle that filed nothing rather
than a habit that stuck.

**And then it happened a sixth time, to this paragraph, during the review of this paragraph.** The
`code-reviewer` verified **20** by enumeration and certified this the first clean pass in a while —
and **#143 was filed out of that same review**, minutes later, which made the verified count wrong
before the PR merged. The sixth instance was not an unrelated cycle drifting past a stale document;
**it was the review of the document that reports the defect.** The general form is worth more than
the count: **a hand-maintained count is stale the moment the review that verified it files an
issue**, and the only review that can leave such a count true is one that finds nothing to file.
Nothing caught this but a human running `gh` by hand. **That is [#110](../../issues/110)'s argument
at its strongest — automate this table or delete the numbers and keep the command.** Note also that
the instruction below is the correct mitigation and it did **not** prevent the paragraph from being
wrong; it only stops a careful reader believing it. **Re-derive from `gh`; do not read this
paragraph.**

- [ ] Both contract gates are bypassable by naming a source file `*.test.ts` — #48. Same family as
      #12, which moved with it; whoever does #12 is already in both files
- [ ] `render/` and `session/` may import `platform/`, one import from a clock — #52. **Must be
      settled before or with the PR that creates `platform/` (#47)**, not after
- [ ] `render/`'s barrel lets `components/` name `GameState` via `Parameters<>` — #53. Pre-existing
      from #19; no value path, so it falsifies a documented claim rather than breaking anything
- [ ] Journal and ADR dates from 2026-07-31 onward are fabricated — #50
- [ ] No line-width enforcement anywhere in lint or CI — #39
- [ ] The layer lint rejects `components/game/`, which is why #20's directory is `components/play/`
      — #57
- [ ] `nativeEvent.locationX` is typed `number` and is `undefined` on react-native-web — #58. It was
      a **shipped** bug in #20, fixed there; what is open is the mechanism that stops the next one,
      and the more valuable half is the test shape that hid it — an expectation of "nothing happens"
      cannot distinguish a working refusal from a handler that is never called, and GDD §2 is full of
      legitimate refusals
- [ ] The worktree convention is written down nowhere, and its `node_modules` junction eats the main
      checkout under `rm -rf` — #62
- [ ] Determinism rules are disabled inside `game/**/*.test.ts` — #12, moved here from M1's list
- [ ] No `.gitattributes`, so an ordinary edit silently rewrote a whole file's line endings —
      **#141** (#76 was the original and is closed as superseded by it, 2026-08-04). Verified at this
      reconcile: **no `.gitattributes` exists, and 10 tracked text files carry CRLF** — `theme.ts`,
      `e2e/game-screen.spec.ts`, `eslint.config.js`, `divergence.ts`, `step.bench.test.ts`,
      `accessibility.test.ts`, `cues.test.ts`, `hud.test.ts`, `scene.test.ts`,
      `tests/unit/play-opening.test.ts`. It cost something in PR #136:
      `light.bench.test.ts`'s diff read **332/103** against a real **269/40**, so the stat said the
      whole file was rewritten. On a repo where no human reads diffs, that is the review artefact
      lying. **#141 must be alone in its PR** — its renormalisation is a 10-file whole-file diff
- [ ] Prettier is unconfigured and reformatted three files during a four-comment edit — #78
- [ ] Playwright's `reuseExistingServer` on a fixed port 3000 lets a worktree's E2E run test
      **another checkout's bundle** — #90, from #79, where it cost an hour of chasing real code
      against a stale build. **The dangerous direction is the false green**: a worktree whose change
      never reached `dist/` reuses a working server from elsewhere and reports a required check
      passing for a bundle nobody tested. CI is not exposed (one checkout, clean runner), which is
      exactly why it will keep being rediscovered the expensive way
- [ ] `ensure-worktree-node-modules.mjs` is defeated by a stub `node_modules` — #91. Vitest creates
      `node_modules/.vite`, the guard sees a directory and concludes all is well, and `test:e2e` then
      dies in precisely the case the guard exists to prevent
- [ ] The roadmap's count table goes stale on every code PR — **#110**, filed by the #106 reconcile
      with the three-for-three evidence. Two options and they differ: automate the table, or delete
      the numbers and keep the commands that produce them
- [ ] The journal is append-only and this file blesses rewriting a merged entry in place — **#112**,
      two remedies applied to the same situation on consecutive PRs (#104 struck a stale `Next:`
      through in place; #111 refused to touch the entry and corrected it from above). It matters to
      whoever runs the next reconcile, which is why it is worth more than its size: **the rule is
      currently whichever record you read last**
- [ ] `.gitignore` covers `.playtest/` but the playtester writes to `.scratch/` — **#120**, from
      #119, where `git status` showed `?? .scratch/` after the mandated playtest gate. The ignore
      rule's own comment predicts this failure exactly ("a routine `git add -A` after the mandated
      playtest gate would commit a throwaway harness"); it is simply pointed at a directory nothing
      uses. Quiet in the dangerous direction — a committed throwaway driver reads like a deliberate
      test file to the next session
- [ ] Nothing checks an ADR's `Status:` line against its row in `docs/decisions/README.md` —
      **#143**, filed 2026-08-04 out of this reconcile's own review. The index is the routing table a
      session scans to decide whether an ADR is live, and it went stale within the hour when
      ADR-0008's and ADR-0012's status lines were annotated and their rows were not. A written
      same-edit instruction is in the file now and **it is decoration**; the guard is an assertion,
      and `tests/unit/infrastructure.test.ts` already has the file-scanning harness for it. Same
      family as #48 and #12 — a rule with nothing enforcing it
- [ ] `step.bench.test.ts`'s descent benchmark times out on CI — **#132**, filed 2026-08-03 and
      **missed by the reconcile that ran the next day**. The failure mode is the one its own
      `BATCH_CEILING` guard exists to prevent, which makes it the same family as #90/#91/#120: a
      guard that does not guard
- [ ] Benchmark thresholds should assert a **ratio**, not an absolute millisecond figure — **#137**,
      from #133. The evidence is measured: the same lit turn reads 0.100ms locally and **0.529ms** on
      a runner (4.5x), so any absolute limit must clear the worst of that — and a *real* planted
      regression (recomputing the lit field per light query, the bug #35 names) costs **1.4x** and
      sails under it. **Read it beside [ADR-0008](decisions/0008-benchmark-thresholds-as-ratios.md),
      which currently rules the other way** for subsystem benchmarks: the absolute budgets in
      `fov`/`light`/`generate`/`actors` are what anchor `step.bench.test.ts`'s ratios in real time,
      and ADR-0008 calls converting them "the mistake this ADR exists to prevent in the opposite
      direction". **#137 cannot be built without amending that ADR**, and whoever does owes the
      argument for where the anchor goes instead
- [ ] `.playtest/` is gitignored but not eslintignored, so `npm run verify` fails locally after every
      playtest — **#140**. Verified here: `.gitignore` has `.playtest/`, `eslint.config.js`'s
      `ignores` does not. Same family as #120 — an ignore rule pointed at the wrong scope — and it
      taxes the one gate the working agreement requires before every push
- [ ] The playtester's documented procedure serves a `dist/` that can change underneath it — **#95**,
      filed by this reconcile from a journal Watch note that had no issue. A concurrent build swapped
      the seed mid-session while the port and bundle name stayed right. Worse here than in a spec: a
      playtest's output is prose, so a report that observed the wrong simulation is simply wrong and
      nothing in it says so

**Left in M2 on purpose:** #67, #72 and #73 are the same *shape* (a gate that does not gate, a
projection that widens by nothing, a journal that can be appended in the wrong place), but each rides
on a document the light loop is actively editing, so they are more useful surfacing in the M2 queue
than filed away. If the next session disagrees, move them — but move them deliberately.

### Auto-travel: the gate is answered, and the two arms disagree

Its rules were always settled (ADR-0009); whether it is built was not. It was gated here because the
friction it removes had never been felt. The M1 playtest has now felt it. **Recommendation: build
it** — full ruling on **#32**, build issue **#65**. The evidence is genuinely split and is recorded
split, because flattening it into "the playtest said yes" would destroy the part a future session
needs.

- **The "build it" arm fired, on both of its clauses.** Tedium named in turns rather than vibes: Run
  A turns 24–30 were **seven consecutive** locomotion taps; a forced backtrack on floor 2, (4,13) →
  (6,5), was **16 taps, 16 turns, 16 fuel, zero events and a blank status line for all sixteen**.
  Across one 61-turn measured run, ~45 turns (74%) were a step onto known terrain with no fork and no
  creature in sense range — 29 of 45 (64%) excluding that artificial backtrack.
- **The Pillar 1 count is the number that decides it.** 9 of 37 turns were real decisions — 1 in 4.
  Collapse the locomotion and the same play becomes ~9 decisions in ~17 commands, **53%**. Same
  rules, same play, no other change.
- **#79's playtest saw the same shape again — and the ratio it reported is _not_ comparable to the
  one above.** It counted **8 of 51 consecutive turns** on `emberdepth`, with two unbroken autopilot
  stretches of **15 and 22 turns**. **Do not read 8/51 against 9/37 as a regression.** Three reasons,
  and any one of them is disqualifying: the two playtests are not recorded as having counted "a
  decision" the same way; the second run was played against **#79's build**, where a flash announces
  what it woke, which plausibly *creates* decisions the first run could not register; and it predates
  #83, so every autopilot turn in it was genuinely safe in a way they will not be afterwards. It is
  also **weaker evidence in provenance**: 9/37 has a full report on #31, whereas 8/51 survives only in
  a comment on **#65** and in this file (see the header note where it is first recorded).
  **What it does corroborate — and this is the part that matters — is the _shape_, independently:**
  a 22-turn unbroken stretch of forward travel through already-revealed space, which is exactly the
  case the resolution below identifies and a stronger instance of it than the 16-tap backtrack.
  Re-measure the ratio **after #83**, not before.
- **Re-measured after #83, as asked — PR #119's playtest, 6 lines across 3 seeds.** **8 of 48 sampled
  turns (17%) were real decisions; 8 of 21 (38%) excluding traversal of already-mapped space**, per
  the standing instruction in M1's brief. Traversal was **107 presses to turn 88, longest unbroken
  run 13**. The shape survives pursuit: the stretches got shorter (13, against 22) and did not go
  away. **One caveat that belongs to the metric, not to #65:** two flash decisions sit outside the
  count entirely because the shutter is a **free action** and costs no turn — so **the game's best
  decision is structurally invisible to a per-turn Pillar 1 ratio.** Anyone quoting these numbers
  should quote that with them; it biases every count in this section downward by an unknown amount
- **The "do not build it" arm also fired, on the disambiguating probe this roadmap wrote.** The probe
  was *did you want to go back and decide not to?* — and the answer was **no, not once, in six
  runs.** The single declined backtrack was declined for fuel and turns, which are costs the design
  wants felt; the tap count never entered it. Read literally, that is the do-not-build arm.
- **The resolution is that the gate was aimed at the wrong behaviour.** It was written around
  *backtracking*. The tedium is in *forward* travel through rooms a single flash has already fully
  revealed — one flash reveals a 5×5 room, then 4–8 taps cross a space you can already see,
  containing nothing. ADR-0009's stop rules cover that case unchanged: travel runs over *remembered*
  passable terrain, which is exactly a flashed room.
- **Kill it permanently** if, once built, it stops on nearly every step — untouched by any of the
  above, and untestable until it exists.

**If it is built, expect the win in forward motion, not in returns.** Evaluated against backtracking
it will look like it did not help. And `game/systems/economy.test.ts`'s corpus must be re-measured
with travel in it: travel changes no arithmetic but it changes how many turns a player will spend, and
§4's third invariant was calibrated against scripted one-step play (ADR-0009's Consequences). That
re-measurement now has two reasons — the same playtest reports invariant 3 already failing.

**Exit criteria:** the playtester reports the light decision recurring naturally and being
genuinely tense — and can point to specific turns where it mattered. Unchanged, and now the only
thing M2 is really for. The contract-and-tooling work is a separate milestone now and does not count
toward this exit.

**That playtest has been run — after step 4, as this block required, on PR #119 — and it cannot sign
the criterion yet.** It *can* point to specific turns, and it named a genuine retellable moment
(`ashfall-nine` floor 2: a doorway held for eight turns, 2 HP for 38 ember). **But the tension is
elective.** It exists when the player chooses to stand and evaporates the moment they decline,
because a pursuer cannot hit a player who keeps walking. A wager you can decline for free is not a
wager — which is the same sentence M1's exit playtest wrote about the old rule, arrived at by a
different route. **#121 is what now stands between M2 and this exit.**

**#121 is ruled and #123 is built, so the next *broad* playtest is the judging one — and it is
briefed differently.** Broad as in PR #119's six lines across three seeds; a narrow follow-up may not
spend §12. Three things it must be asked, and none of them is "can you sign the criterion":

> **The judging playtest is still owed, and #123's was not it.** A playtest ran on PR #126 — one full
> run to death on `emberdepth`, 165 turns, floors 1-4, ~20 branch-point replays, plus two lines on a
> second seed — and it was an explicitly **narrow build-verification brief**. It says so and it
> **drew no §12 verdict**, handing its light-affordability observation to `game-designer` under
> ADR-0012 instead. **Nothing may read it as having judged §12**, in either direction. Its findings
> are recorded two blocks down as evidence for the judging brief to check, not as a substitute for
> it. So the bound in ADR-0012 — *the next broad playtest after #123* — is **unspent**, and the next
> broad playtest is the one that spends it.
>
> **That playtest has now run and the bound is spent — PR #136 (#133), 2026-08-03.** Broad by this
> block's own bar and then some: 6 hand-played runs across 7 seeds plus 13 automated full runs on 9
> seeds. **It reports arm 2 in as many words** — *"§12's 'the lantern opened only when lost' arm
> firing, and it is not a hypothesis any more"* — on a never-shutter bot finishing **9 of 9** seeds
> against the same bot dying **4 of 4** with the lantern open, and an A/B where dark forfeits 21 fuel
> of cache and is still ahead because the mechanism is **HP, not fuel**. **It also answers arm 1
> emphatically no** (a named retellable moment, 13 of 38 sampled turns as real decisions), which is
> why this is a ruling and not an arithmetic consequence. Nothing here fires §12; the bound being
> spent means the *question* can no longer be deferred, not that the answer is yes.
>
> **The ruling landed 2026-08-04 (#139): arm 2 fired, and §12's fallback lost its *automatic*
> character rather than being spent —
> [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md). It is still the strongest
> named alternative, and [#145](../../issues/145) names it as the leading candidate if the cheap
> subtraction fails.** The exit criterion below
> is **unchanged for the third time** and is still the right question; what changed is that the reason
> it cannot be signed is now named. The wager's cost side is rebuilt ([#144](../../issues/144)) and the
> playtest that judges the result is [#145](../../issues/145) — which **is** the new bound, an issue
> rather than a sentence, because establishing that *this* bound had been consumed took three
> documentation sweeps and a ruling. **Do not run a judging playtest before #144's build merges**: it
> would re-measure a finding that is already ruled.

> **The three bullets below are the brief for the playtest that has now run, and they are kept as the
> record of it. The brief for the *next* judging playtest is [#145](../../issues/145)**, which carries
> them forward with one change that matters: the first bullet's *can you name a turn where the light
> decision mattered?* was answered **yes, by a turn on which the shutter never opened**, so #145 asks
> the sharper form — *can you name a flash you were glad you made?*

- **Both arms of §12's restated trigger, in VISION's words** (ADR-0012): *can you name a turn where
  the light decision mattered?* and *did you open the lantern only when lost?* An unsigned criterion
  is **not** an answer to either. If the answer to the first is no, or to the second is yes, the
  fallback is spent and no further evidence is needed. *(Answered: no to the first, **yes** to the
  second — and the ruling on 2026-08-04 is that the second firing does **not** spend this fallback,
  because the fallback is the wrong instrument. ADR-0015.)*
- **The too-strong arm is the only arm GDD §4 still watches**, and it is the second question above.
  §4 declares the **too-weak arm structurally closed**: a woken Cinder costs 2 HP or the stairs, by
  arithmetic (5 HP against 3 damage is two strikes, and the player is generally adjacent at their
  decision point only after the creature has declared). **Nothing is watching for it, deliberately.**

  > **Read this bullet with [#125](../../issues/125) in hand — it used to end *"so there is no
  > reachable state in which a wake costs nothing"*, and that is false.** #123 built the
  > instrumentation §4 asked for and measured **56 of 386** woken kills at 0 HP. The arm is *mostly*
  > closed, not structurally closed: a creature's first action resolves a command late whenever the
  > command that woke it did not sweep phase 4 past `now` — every free action, and every run start,
  > since `beginRun` runs phase 3 alone. **What this changes for the playtest is one thing and it is
  > worth stating, because this is the brief for the run that decides §12:** if the playtester
  > reports a wake that cost nothing, that is **#125, not the too-weak arm firing**, and it is not
  > evidence about the ruling. Do not spend §12 on it. The arms above are unchanged.
- **The open band, which is not a trigger: HP spent on woken creatures per floor, against the +2 a
  descent returns.** The exchange rate is decided; **how many wakes a run pays for is not.** Flashing
  freely and still finishing with HP to spare says 2 is not a price at these numbers. Unable to afford
  a second wake on floor 3 is the arm above. **Report it; re-tune nothing** — §3's combat numbers are
  frozen behind #109 for the same attribution reason #123 is.

**Do not re-run the adjacency fraction, do not measure damage taken while fleeing, and do not count
free kills on woken creatures as a verdict.** Set by the player, pinned by the rules, and pinned by
the numbers respectively — three ways of being unfalsifiable, and GDD §4 records all three with the
question that separates a watch from a guard: **name the state of the world in which this number comes
back different.** The third one survives in §4 as a **regression guard** for a later re-tune, and it
needed per-creature wake and HP instrumentation that did not exist — **#123 owned that or the guard
was not built.** #123 built it, ran it, and **the guard failed**: 56 of `STALKER`'s 386 woken kills
cost 0 HP, because a creature's first action resolves a command late whenever the command that woke it
did not sweep phase 4 past `now` — true of every free action **and of `beginRun`**, which is roughly
one run start in **nine** (measured 11.2% at the reconcile after #126; *one in five* was §4's
arrival figure misapplied to a run start). That is [#125](../../issues/125), it predates #83, and it
means *"free kills on woken creatures"* was never pinned by the numbers at all — the third way of
being unfalsifiable was itself unverified. Still not a verdict to run a playtest on; now a defect
with an issue, and build-order step 4b.

**And the question that separated a watch from a guard did not catch any of it — see
[ADR-0013](decisions/0013-a-claim-about-the-build-is-established-by-measurement.md).** *Name the state
of the world in which this number comes back different* is kept and is now **necessary and not
sufficient**: six defects in the session that produced this block were the same shape (a claim
derived correctly from these documents, false of the build) and **all six pass it**. What caught them
was building the instrument or implementing the mutant. That is why the three bullets above are
written as *report it* rather than as arithmetic.

**Both numbers the block asked for came back.** **0 fuel has stopped being a dead zone**: dead in 6
turns from fuel 0 with two hunters, against the 143 inert turns recorded above. That is a total
reversal and the strongest single evidence #83 was right. **The adjacency fraction is the defective
one**: it returned **0.89**, which by its own sentence reads *the 8 comes down*, and the truth is the
other arm — it is a property of the player's policy (0 of 4 in every line where the player walked,
1.0 in every line where they stood). **Do not re-run it as a verdict.** §4's boxed warning has been
**deleted** now that #121 has ruled; the warning it carried is preserved inside §4's new watch, and
the replacement is *not* the *unavoidable hits* the playtest proposed — that one is rejected too, for
the reason above.

### What #123's playtest measured, and what it deliberately did not

*From PR #126. A **narrow build-verification brief**: one full run to death on `emberdepth` (165
turns, floors 1-4, 13 kills), ~20 branch-point replays, two lines on a second seed. Recorded here
because this roadmap is its only record and the judging playtest needs it.* **It drew no §12 verdict
and nothing may read one into it.**

- **Doorways are now the price control on every fight, measured both ways.** Two woken Cinders held
  at a doorway cost **4 HP**; the same two fought in the open **stack their attacks** — `You take 4.`,
  12 → 8 → 4 — for roughly double. Confirmed on the second seed. Doorways went from *a place to
  outlast something* to *the thing that decides what a fight costs*. This is the load §4 predicted
  #83 would put on §5's loop doorways, arriving. **It also corrects a §4 sentence** — *"a second
  pursuer covers nothing a first did not"* is true of **tiles** and false of **damage**.
- **A shuttered floor cost 0 HP for 4 kills; a floodlit floor in the same run cost 10 HP for 3.**
  Floor 2, shuttered with three flashes and dormant-striking everything: **0 HP, 4 kills.** Floor 3,
  floodlit whenever fuel allowed: **10 HP, 3 kills** — on a 12 HP bar. The playtester's read, handed
  over rather than concluded: the flash-*peek* is well priced (5 fuel, zero turns, used deliberately
  about twice a floor at nameable moments) and is **not** VISION's failure condition; **sustained
  light is unaffordable**, and #123 widened that gap rather than narrowing it, because a wake used to
  be a temporary nuisance with a 20-fuel refund and is now a permanent 2-HP debt. **That is the
  too-strong arm's territory.** **It does not meet the arm's stated trigger**, which ADR-0012 defines as
  *the lantern opened only when lost* — and this run opened it deliberately, about twice a floor, at
  moments the playtester could name. **That is a statement about the trigger's wording, not a verdict
  from this playtest**, which was a narrow build-verification brief and is not entitled to one. The
  judging playtest decides whether the arm fires; this bullet only records that the observation and
  the trigger are different claims.
  **The judging playtest ran (PR #136) and the arm fired (#139, 2026-08-04,
  [ADR-0015](decisions/0015-arm-2-fired-and-the-fallback-is-retired.md)).** Keep this bullet's
  distinction and note what moved between the two runs: *about twice a floor, at moments the
  playtester could name* became **twice across four runs, glad neither time**. The playtester's read
  here — *the flash-peek is well priced; sustained light is unaffordable* — is half right and the
  ruling names the other half: the peek is well priced **in fuel**, and it is the **HP** it costs that
  nobody will pay.
- **#125 is findable but nobody would seek it.** Reproduced deliberately (flash beside a sleeper, two
  strikes, HP unchanged) and hit accidentally first — the two-turn stillness is very visible. **But
  the dormant strike strictly dominates it:** one turn, 0 HP, 6 damage, no wake, and no 4 fuel spent.
  So it is a **discount on an accidental wake**, not an exploit, and the corpus' 14.5% reflects a bot
  that flashes constantly being adjacent to sleepers often. Playtester rules it low priority; **that
  read is evidence on #125 and is not the ruling.**
- **Fleeing is honestly worthless and it is felt:** 26 turns of flight cost 26 fuel and 2 HP and
  gained nothing, with no refund at the end of it. Bundle-verified before playing: woke a Cinder at
  turn 7, fled to turn 24, **17 turns later still adjacent and still coming**; repeated at 26 turns
  on a second bundle.
- **Existing issues re-hit, none new:** **#85** for the third time (`The lantern goes out.` as the
  headline for an HP death — and #123 makes HP death the ordinary ending, so this now fires on the
  common case), plus #84, #117 and #80. **#95 fired live again** — the working tree mutated during
  the playtest, against a `dist/` built 10 minutes earlier; the playtester checked that no shipping
  source had changed and the report is sound, but that check was theirs to think of, which is the
  hazard #95 describes.

## M3 — Depth

*Goal: runs vary enough to be worth repeating.*

- Multiple level themes with distinct tactical texture
- 6-10 enemies with real behavioral variety
- Items and abilities that change how you play, not just your numbers
- Progression across floors, and a difficulty curve

**Exit criteria:** two runs on different seeds feel like different runs.

## M4 — Feel and finish

*Goal: it looks and feels like a finished thing.*

- Visual polish — palette, typography, light falloff, animation. **`components/play/theme.ts` is the
  provisional palette #20 shipped**; it is checked for token completeness and contrast, so it cannot
  silently lose a token, but every value in it is M4's to move
- Audio
- Onboarding that teaches by playing, not by text
- Accessibility: colorblind-safe palette, text scaling, reduced motion
- **Non-visual play is undecided** — #64. The board announces that a grid exists and nothing about
  what is in it. That is not one of §11's five requirements, so it is not a regression; the open
  question is whether §11 should have a sixth, and "no" is a legitimate answer that nobody has given
- Save/resume mid-run
- Native (iOS/Android) verification pass — **#34 belongs to this one**: a descent measures 1.7ms of
  ARCHITECTURE's 2ms per-turn budget on a GitHub runner, and ~92% of that is level generation.
  Measure it on a real device before deciding whether it needs fixing.

**Exit criteria:** a stranger can install it, learn it, and finish a run without being told
anything.

## Later — not committed

Deliberately parked. Revisit only after M4, and only if the game is actually good.

- Daily challenge seeds (cheap given determinism — needs a backend, see ADR-0006)
- Replay sharing
- Meta-progression between runs (**skeptical**: risks Pillar 1 — unlocks tend to replace decisions
  with waiting)
- Skia renderer, if glyphs become the limiting factor on feel (ADR-0003)
- App store release

---

## Amending this roadmap

Milestone goals, exit criteria, and the tasks within them are all ours to change as we learn.
Amending a goal or an exit criterion deserves an ADR or at least a journal entry explaining why —
it is a significant act — but it does not need the owner's sign-off. See `docs/WORKFLOW.md`.
