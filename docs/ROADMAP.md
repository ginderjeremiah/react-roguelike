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

**M2 is two steps into a six-step build order.** #79 (PR #92) made a wake announce itself, with a
count; #94 (PR #101) gave that announcement two emphasis levels so it is read first. Neither moved a
simulation value. **The order has changed since the #83 ruling was written**, so read "The build order
for the wager" under M2 below, not #83's issue body.

**Next up is #31/#41 — caches invisible while shuttered — and then #83.** That is step 3 of the build
order below, and it was **re-confirmed against a contradiction** during PR #104: the journal's #94
entry ended `**Next:** #83`, skipping step 3. The list won. Ruling and reasoning are comment
`5153249392` on **#83**; the short version is that #83 moves no fuel number but *does* change the game
the corpus measures, so taking it first costs two re-measurements instead of one and the second cannot
attribute which change moved the number.

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
      `LightQuery` (`game/entities/`)

**A run can be won, which this roadmap never said.** GDD §13 settled it in #18: the run ends by
death *or* by taking the stairs on floor 8 (`LAST_FLOOR`). There is no floor 9 and no boss. The
goal and the exit criterion above are amended accordingly — "complete a run" now has two endings
and the summary screen has to render both.

### Where M1 actually stands

*Re-counted at `86eda1e` (#79 and #94 both merged, so M2's first two PRs are in these figures) from
the tree, not adjusted from the previous count — the
number this section carried three revisions ago ("`game/` is 44 test files and 797 tests") was the
**whole suite** mislabelled as `game/`, and it survived three PRs because a count with no stated
scope cannot be checked. So: **every number below names what it covers and how it was produced.***
**Only the rows #94 touched moved** — `components/play/`, `tests/unit/`, both totals and the E2E
count. `game/`, `render/` and `session/` are byte-identical to the previous count because PR #101
changed no file in any of them, which is itself the evidence that #94 was a presentation change.

```bash
# source modules and test files, per directory, tracked files only
git ls-files <dir> | grep -E '\.tsx?$' | grep -vE '\.test\.tsx?$' | wc -l
git ls-files <dir> | grep -E '\.test\.tsx?$' | wc -l
# tests: npx vitest run, per-file counts bucketed by top-level directory
npx playwright test --list      # E2E: declarations x 2 projects
```

**Everything M1 set out to build exists, endings included.** #21 closed the run loop; the exit
playtest (#87) reached both endings on a phone at `3ea83fa`. What M1 did **not** settle is whether
the light wager is tense — that is M2's, and [ADR-0011](decisions/0011-m1-exits-on-the-answer-not-the-outcome.md)
is why M1 closes without it.

| Directory | Source modules | Test files | Tests |
| --- | --- | --- | --- |
| `game/` — generation, FOV, light, fuel, scheduler, combat, descent, endings | 45 | 42 | 786 |
| `render/` — the presentation model (#19), `taps.ts` (#20), `cues.ts` (#21, #79) | 9 + barrel | 9 | 166 |
| `session/` — the run (#45) | 1 + barrel | 1 | 28 |
| `components/play/` — board, cells, HUD, controls, summary, hit test, theme, `opening`, `status-style` | 14 | 0 colocated | — |
| `components/` (rest) + `app/` — two themed views; `_layout` and the game screen | 2 + 2 | 0 | — |
| `tests/unit/` — contract gates, consumer probe, the six `play-*` suites, helpers | 6 helpers | 10 | 149 |
| **Total (Vitest)** | | **62** | **1129** |

`components/play/` has **no colocated tests**: its **seven** pure modules are tested from
`tests/unit/play-*.test.ts` (hit test, cell style, messages, summary style, theme, opening — and
`status-style` from the theme suite, which is why seven modules make six suites) and its
React is tested by Playwright, per ADR-0005's no-component-test-runner rule. E2E is **36 runs — 18
declarations across 3 spec files, each run under both the `phone` and `desktop` projects**, up from 4
before #20 and 34 before #94. A green CI log reads **35 passed, 1 skipped**, not 36 passed: the
win-the-run spec
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
answer is no, that is the moment to spend §12's fallback, not a milestone later.

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
      this line exists so the mistake is not repeated from the roadmap instead
- [x] **A wake is announced, in the turn line, with a count — #79 (PR #92).** M2's first code and
      step 1 of the build order below, which made it a *precondition* rather than polish: once #83
      lands, an unannounced wake is an unannounced hunter. It covers all three emission sites — the
      ordinary transition, arrival by descent, and the opening frame of a run, which was built and
      tested and reached no pixel until review caught it (#93). The announcement now **exists**;
      whether it is *read* is #94, below. One seam it left untested is the lit descent, where `woke`
      outranks `descended` — #96
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
- [ ] Fuel economy and the risk/reward tuning around it — calibrated once in #17. **#63 is ruled**
      and **no fuel number may move yet**, because the corpus is measuring a different game than the
      one we designed: §4 says caches are invisible while shuttered, the code pays on tile kind, and
      `DARK_PACIFIST` takes **119 of 121 caches** — dark play receives light's entire income stream,
      ~37 fuel a floor. **Every fuel figure in both playtest reports inherits that.** #31/#41 first,
      then a never-flash fighter in the corpus, *then* numbers
- [ ] Sound/haptic feedback for moving blind — **untouched.** #79 is adjacent and does not discharge
      it: a wake is announced in *text*, which is neither sound nor haptic, and #94 is about the
      pixels of that text. Nothing here has been built
- [ ] Does a creature on a marked tile take the hit? — #28, a design ruling §6 is missing
- [ ] Touch perceives ember caches, which §4 says are invisible while shuttered — #41
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
- [ ] **The wager is invisible before it is taken and illegible after it** — now **nine** issues from
      **three** playtests, none of them tuning and none of them mechanic, all M2. One is closed:
      ~~**#94** the wake line is the least emphatic text on screen~~ (done, PR #101). Open: **#82**
      you cannot see which contacts a flash would wake, **#80** the dormant glyph `c` can never be
      drawn, **#81** the ember a kill drops is invisible in the dark beside you, **#84** neither your
      damage nor a creature's health is ever shown, **#85** dying with a dry lantern near-misses
      §13's "The lantern goes out.", **#86** the self-tap target eats half-cell misses, and from #94's
      playtest **#103** whether `You take N.` earns `alarm` when it has three carriers already in
      frame, and **#102** the board jogs 6pt every flash cycle. They are
      one family: the exit criterion is a *felt* decision, and none of these change what the
      simulation does. **The family grows by roughly three per playtest and has never shrunk except by
      being built** — worth watching, because at some point "the wager is illegible" stops being a
      list of bugs and becomes a finding about the screen

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
3. **#31/#41** — caches are invisible while shuttered, per §4. This is what un-contaminates the fuel
   corpus, and **no fuel number moves before it.** ← **NEXT**, confirmed against a contradiction in PR
   #104 (the #94 journal entry said #83; the list won — comment `5153249392` on #83). **It is not
   enough that #83 moves no fuel number:** it changes the game the corpus *measures*, so this first
   buys one re-measurement against a clean baseline and the other order costs two, the second of which
   cannot say which change moved the number.
4. **#83** — the ruling itself: a woken Cinder pursues.
5. A **`HARVESTER`** style in `game/systems/economy.test.ts` — never flashes, routes to every
   ember-sense contact, one-shots each dormant — which is what §4's invariant 4 is asserted against.
6. **#82 last, unchanged and still explicitly last.** Shipping it before #83 makes the game *worse*:
   drawing the radius-4 footprint turns the containment read into exactly the clean binary the first
   playtest complained about. Correct and desirable, but only once waking has a price.

**#89 is deliberately not in that list.** Re-dormancy is as silent as waking was, so a shuttered
player cannot tell *it gave up* from *it is still coming*. It is not the inverse of #79 and must not
be built as one — waking happens where the player is looking, re-dormancy by definition does not, so
announcing it would tell the player something they have no in-fiction way to perceive. Rule it
**after #83 has shipped and been played**: the pursuit has to be felt before anyone can say whether
its ending should be legible.

**Two measured facts from #79's playtest that bear directly on M2's exit criterion.** The first is
buried in a comment on #83; the second is in no issue and no PR thread, so this roadmap is its only
record.

- **0 fuel is currently a dead zone.** §13 says it is not an ending, and with nothing hunting the
  player a bot ran **143 turns at fuel 0 and HP 4**, empty status line every turn, with no way to
  finish the run. That is not a separate bug; it is a direct measurement of the hole #83 exists to
  close, and the strongest single argument that #83 is load-bearing rather than a nicety. **Check
  after #83 lands that it actually closed it.**
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
**fourteen**. **Filing into the right milestone is not the same as reading it**, and the second habit
is the one that is missing.

**The count moved by five, not by the two filed this session.** #90 and #91 are new (both from #79),
#12 came down from M1's list — and **#76 and #78 were already in the M2 milestone and had never
reached this roadmap at all**, filed during #60/#61 and invisible here ever since. That is the exact
drift this section was written to prevent, happening to this section: a list that claims to make the
queue visible only does so if someone re-derives it from `gh issue list` rather than reading it.

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
- [ ] No `.gitattributes`, so an ordinary edit silently rewrote a whole file's line endings — #76
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

**The playtest that judges this must be run after step 4 of the build order at the earliest**, and it
has two numbers to bring back beyond the verdict: the fraction of woken creatures that reach adjacency
at least once before re-dormanting (near 0 means the pursuit is theatre and #83 was wrong; near 1
means the flash is a bill rather than a wager and the 8 comes down), and whether **0 fuel has stopped
being a dead zone** — the 143-turn run recorded above is the before-measurement.

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
