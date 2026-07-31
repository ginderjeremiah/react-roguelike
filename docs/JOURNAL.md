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

> **Some headings below this note carry invented dates. Until #50 lands, read position, not date.**
> Past sessions copied the heading above and incremented it rather than reading a clock, so a run of
> entries — and ADR-0008's and ADR-0009's dates — advance past dates on which nothing was committed.
> At the time this was written, `git log --format='%ad' --date=short | sort | uniq -c` against
> `grep -o '^## 20[0-9-]*' docs/JOURNAL.md | sort | uniq -c` showed the divergence directly. **That
> signal fades** — once real time reaches those dates, honest entries and their commits fill them in
> and the histograms agree again. So the rule below is positional, and it is the authority; the
> commands are corroboration, not the test. Either way, **run them rather than trusting any figure
> written here**: a count is stale by the commit that writes it, which is the mistake this note
> exists to describe.
>
> **The boundary is positional, not a date range**, and that is deliberate — a range would sweep up
> honest entries as real time walked into it. **Everything at or above the archivist entry for
> #45/#51 (PR #54) was written by reading a clock and is real.** Only entries *below* it are
> suspect, and that set is closed and cannot grow.
>
> **File order is authoritative — newest first.** The entries for **#45 and #19** sit *above*
> **#32 and #36** despite carrying dates a week *earlier* than them.
> (One exception #50 also inherits: the pre-M0-close tail at the bottom is in *session* order, not
> merge order.) Do not date an entry by copying the one above it, and prefer citing a PR number over
> a date — `#42` resolves, `2026-08-05` does not. #50 decides the policy and reconciles the back
> catalogue; this note is not that fix.

---

## 2026-07-31 — Archivist: a stale milestone marker in the GDD cost a playtest verdict

**Did:** Reconciled `ROADMAP.md`, `GDD.md` and `ARCHITECTURE.md` against `main` at `6e20978` (#20
merged), after #49, #20 and the first `playtester` run. No code. Filed #62, #63, #64 and #65;
commented the corrections onto #31 and #50. The roadmap's stand-and-counts section was re-derived from the
tree rather than adjusted, and the auto-travel gate and the wager verdict were both written into it.

**Why the headline is one line of documentation.** GDD §4 opened its awake-creature block with
"**(M2, but specified here because §6 depends on it)**". Re-dormancy shipped in **#16, under M1**,
and the marker never moved. The first playtest read it, concluded a woken creature stays awake for
the whole floor, and built a recommendation on that: *do not spend §12's fallback, because we are
judging the wager with one of its two counterweights missing — re-dormancy first, then re-tune, then
re-measure.*

None of which is true. `nextMind` in `game/entities/behaviour.ts` returns `DORMANT` at
`turnsSinceContact >= TURNS_TO_REDORMANCY` (8) for any creature with neither light nor adjacency;
`behaviour.test.ts` pins "on the eighth turn and not before"; and `replay.test.ts`'s stored fixture
walks the whole thing — ten commands backing into the dark, asleep by command 10, dormant-struck on
command 13 — under a header calling itself the only fixture in the repo that pins re-dormancy. The
playtester could not have known: it does not read `game/` and it was reading the document we tell it
to read.

**The lesson is not "the playtester was wrong".** It is that **a milestone marker left on an
implemented rule is indistinguishable, from outside the code, from the rule not existing** — and the
GDD is exactly the document consumed by the agents that cannot check. The marker survived #16, #17,
#18 and two archivist passes because nobody reads a parenthetical as a claim. §4 now carries the
correction inline; `ROADMAP.md`'s M2 list carries a checked `Re-dormancy — landed early, #16` bullet
that exists only so the mistake cannot be made a second time from the roadmap; #63 is the re-ruling
of the recommendation it corrupted.

**The recommendation may still be right, and this pass deliberately did not decide that.** "Tuning,
not mechanic" does not depend on the false premise, and the two measured causes — a flash costs 5
fuel and *zero turns*, and ember-sense at 5/5 turns the containment guarantee into a permission check
rather than a gamble — are prices, not mechanics. But an archivist re-ruling a design verdict would
be a worse failure than the one being fixed. #63 asks the `game-designer`, with that recommendation
attached, and until it closes both the roadmap and §12 say **unconfirmed**, not settled.

**Learned:** Four things, and two of them are about numbers.

**The auto-travel gate answered *yes* and *no*, and the roadmap now says so.** This roadmap wrote its
own disambiguating probe — *did you want to go back and decide not to?* — precisely because the
"do not build" arm is confounded by the tap cost it is measuring. The probe returned **no, not once,
in six runs**, which is literally the do-not-build arm firing. The recommendation is still **build
it**, because the friction turned out not to be backtracking at all: it is forward travel across a
room a single flash has already fully revealed, and the Pillar 1 count goes from 9-of-37 (1 in 4) to
~9-of-17 (53%) on identical play if locomotion collapses. Both arms are recorded, with the resolution
that **the gate was aimed at the wrong behaviour**. Flattening this to "the playtest said yes" would
have thrown away the only part a future session needs: the probe was well designed and still asked
about the wrong thing, which is a failure mode worth being able to recognise again. The build issue
is **#65**, filed because the roadmap's own instruction was "file it when the gate opens, not
before" — and an instruction conditional on an event nobody re-reads is an instruction that expires.

**Re-counted at `6e20978`, and the journal's own numbers do not reconcile.** `game/` 45 modules / 42
test files / 774 tests · `render/` 8 + barrel / 8 / 138 · `session/` 1 + barrel / 1 / 26 ·
`components/play/` 10 modules, 0 colocated tests · `tests/unit/` 8 files / 109 · **59 files, 1047
tests**, plus **24 E2E runs** (12 declarations × the `phone` and `desktop` projects). The #20 entry
below says "1040 tests, up from 1005" and "22 E2E specs, up from 4"; the #49 entry says "986, up from
956". 1047 ≠ 1040, 24 ≠ 22, and 1005 ≠ 986. **All three are left as written** — correcting an old
entry destroys the record of what we believed — and the reconciled numbers are here instead. The
likely cause is a count taken before review added tests, which is the ordinary way this goes wrong
and is an argument for taking the count *last*. That covers the E2E figure too: 22 is 11 × 2, a count
taken before review added the twelfth declaration. *(Inference — #20 is squashed into `6e20978`, so
the intermediate count is not recoverable. What is demonstrable is only that neither 12 nor 24 is 22.)*

A first draft of this paragraph blamed the E2E number on unit confusion instead — 12 declarations
across two Playwright projects, so "specs" and "runs" differ by a factor of two. **Arithmetic rules
that out**: neither unit yields 22, so under either one the old entry is simply wrong, and a reader
reconciling "22 specs" through that explanation would infer 22 declarations and 44 runs — wrong twice.
It is kept here because it is the day's mistake in miniature: an explanation that fits the shape of
the problem, is not checked against the numbers, and would have sent the next reader somewhere false.
The advice it carried is still good on its own account — **state the unit as well as the number**, since
12 and 24 are both honest answers to "how many E2E tests" — it just is not the cause of anything here.

**`platform/` still does not exist, and `components/game/` still does not either.** #20's directory
is `components/play/` because the layer lint matches import specifiers by path segment, so
`@/components/game/board` reads as a component reaching into the simulation (#57). That is now in
`ARCHITECTURE.md` next to the module map, where someone about to try it will meet it — the decision
about whether to *narrow* the rule stays with #57.

**"Every agent is told to work in a worktree" is written down nowhere** (#62). It is the premise of
#49, of that PR's promotion into M1 ahead of #20, and of two documents' worth of prose. Grepping
`CLAUDE.md`, `docs/**`, `.claude/agents/*.md` and `.claude/skills/work-item/SKILL.md` finds the
convention only in the places that *assert* it; `work-item`'s step 2 says `git switch -c` in the main
checkout. The practice is real — nine worktrees are on this machine — so the instruction lives in a
launch prompt outside version control. Filed with the other half of the same problem: #49's `Watch`
note that `rm -rf` under MSYS follows the `node_modules` junction into the **main** checkout was
never tracked anywhere either, and it is a live foot-gun.

**Next:** #21 — death, winning, and the run summary. It is the only M1 issue that gates the exit and
it is unblocked. #12, #47, #60 and #61 are the rest of M1 and none of them stand in the way. Note for
whoever runs the exit playtest: **it is the second playtest, not the first** — the concept checkpoint
was spent early against #20's branch, so what this one must add is the part that one could not reach,
both endings and a full run start to finish.

**Watch:** Three.

- **#50's positional date boundary still parses, and it is now the only thing that works.** The two
  entries above the PR #54 anchor are genuinely dated 2026-07-31, and two fabricated entries *below*
  it (#25, #13) carry the same date — so the histogram corroboration in #50's body no longer
  separates real from invented, exactly as its own third comment predicted. Commented there; did not
  touch its work. `GDD.md`'s change log has the same defect and now carries the same positional note.
- **The contract-and-tooling list parked in M2 has grown from five to eight** (#57, #58, #62 joined) and
  M2 has not started. That list's own instruction — split it into its own milestone rather than carry
  it — has therefore triggered, and the next session to open M2 should act on it.
- **The layer-seam tail stands at five of the six that ADR-0010's scope note calls a design problem**:
  #47, #48, #52, #53 and now #57. **#58 is not one of them** and must not be counted — a
  react-native-web typing bug is not a statement about our layers, and counting it would fire a
  tripwire that is measuring something else.

## 2026-07-31 — A run can be finished, and it tells you what it was (#21)

**Did:** The run loop closes. `GameState` gained `kills`, `fuelBurned` and `seed`; `render/` gained
`summary.ts`; `components/play/run-summary.tsx` draws both endings over the frozen board, and
`RUN AGAIN` restarts without a reload. 1082 tests, up from 1047; 32 E2E runs, up from 24. **M1's last
build item.**

**Why the tally is in `game/` and not `session/`.** `session/` sees every intent and `cuesFor` already
emits `died` and `fuelGained`, so a run tally could have been accumulated above the seam with `game/`
untouched. Rejected: a tally accumulated there is a function of *the sequence of calls `session/`
happened to make*, not of the state, so a replay could not reproduce it and `game/`'s replay tests
could not assert it. Pillar 4 makes a run a stored artifact; a summary that is not part of the
replayed state is a summary that can disagree with the run it describes. Kills settle it on their own
— dead actors leave the world, so no single state can be asked how many there were.

The seed went the same way for a duller reason: `render/presentHud` takes a `GameState`, so a summary
built in `render/` cannot see a seed held in `session/`. It also makes **#47's second bullet — "the
seed a run started with is recoverable" — fall out free.** That is not #47: M1 still ships a constant
and `platform/` still does not exist.

**Learned:** Three, and the first is the most reusable thing in this entry.

**A determinism fixture pinned less than it appeared to, and only an experiment showed it.** The
replay suite's stored records compare a hand-written `Digest` projection of `GameState`. New fields
are *reproduced* by a replay but are not *pinned* by the fixture unless someone adds them to the
projection — so the tally could have silently stopped being deterministic while the project's central
invariant stayed green. Verified rather than assumed: with `kills`/`fuelBurned` left out of `Digest`
**and** `kills` stubbed to never increment, both `reproduces the stored final state exactly` tests
passed. Both fields are now in the digest with their arithmetic written beside them.

Its sibling behaved correctly and the contrast is the lesson: `divergence.ts` builds the sorted
**union of both sides' keys**, so it picked the new fields up automatically — and announced itself by
turning a test red, because `fuelBurned` sorts before `lantern` and became the newly-reported first
divergence. **A generic comparator widens by itself; a hand-written projection does not, and it is the
one that looks more rigorous.**

**`RULES_VERSION` went 2 → 3 and no digest was regenerated**, which is the evidence that matters. The
policy in `replay.ts` requires the bump for any new `GameState` field, but every pre-existing recorded
value — status, floor, turns, fuel, shutter, sense radius, remembered, hp, creatures, embers, all four
RNG words — is byte-identical to the version-2 fixtures. Adding fields did not move a rule or a draw.
A regenerated determinism fixture proves nothing about the change that regenerated it, so "we added,
we did not rewrite" is the claim worth being able to make.

**Where a counter increments is a rule, not an implementation detail.** `fuelBurned` is metered as a
*difference* across §2's phase 2 rather than as `burnRate(shutter)`, so the turn you run dry books the
2 that were actually there and not the 4 you would have spent. `kills` is counted across the whole
turn rather than at the phase-5 sweep, because §13 skips phase 5 entirely on the turn the player dies
— counting the sweep would have silently dropped **the last kill of every losing run**. Both are
pinned by one test that constructs the single state where phase 2 has run and phase 5 has not.

**Next:** M1's exit is the second `playtester` run — both endings, on a phone. The first playtest ran
against #20 and its verdict is recorded on #31 and #32. Before that, #60 and #61 are cheap and both
degrade the exit playtest's ability to answer its own question: #61 in particular lies about
ember-sense at the exact moment the game's central decision is made.

**Watch:** Four.

- **The win headline is the flattest text on the screen.** `> REACHED THE BOTTOM` sits directly above
  `You reach the bottom.` — the same sentence twice, at the one moment a player has earned something.
  The duplication is *new*, created by this issue adding a verdict line above copy from #18 that used
  to stand alone. Referred to the `game-designer` rather than reworded here, because choosing what
  winning *means* is a design act and should not fall to whoever is holding the file.
- **A floor-1 death is a mostly-black board** — about 45% unexplored void. Honest (you died knowing
  nothing) but it makes the *common* ending the visually emptiest one.
- **#69: the board is one frame behind any layout change above it**, and the summary band is the
  biggest such change in the game, so the desktop board paints over the HUD for one frame before
  settling. Found by a screenshot catching the bad frame. The E2E pins the *settled* layout, so **the
  suite cannot see this by construction** — the same shape as #49.
- **#70: no `SafeAreaView` on this screen.** `RUN AGAIN` is the only control on the summary, and on a
  device with a home indicator it would sit under it. No native build has ever run, so nothing we
  currently gate on can catch this.

## 2026-07-31 — There is a game on the screen, and you can tap it (#20)

**Did:** The playable screen. A glyph grid built from `Scene.grid`, a five-readout HUD, bump-to-attack
by tapping an adjacent tile, self-tap to wait, a persistent shutter control and a descend control that
exists only on the stairs. `render/` gained `taps.ts`; `components/play/` is ten new files; `app/index.tsx`
holds a `Run` in `useState` and nothing else. 1040 tests, up from 1005. 22 E2E specs, up from 4.

**Why:** M1's last build item, and the reason it is the last one is that #45 had to exist first —
`render/` shipped `presentScene(state)` in #19 and nothing in the repository could legally call it.

**The one thing that had to go below the seam.** GDD §9 says an impassable neighbour is not a tap
target, and nothing in `render/` answered that. It is a game rule, so it could not become a
`blocksMovement` call in a `.tsx` — and it could not be a new `GameState`-taking function either,
because nothing above `session/` can hold a `GameState`. So it rides on `Scene`, which `sceneOf(run)`
already delivers, and `session/` did not change at all.

The shape is `Scene.taps: readonly TapAction[]` — the ≤5 interesting tiles, self first then the four
neighbours in `DIRECTIONS` order — plus `tapAt(taps, x, y)` answering `unbound` for everything else.
Five kinds: `move`, `attack`, `wait`, `blocked`, `unbound`. **`blocked` and `unbound` are deliberately
not the same value**: they need different treatment now (§2 wants feedback for a refusal and silence
for a non-target) and different futures (ADR-0009's `travel(to)` lands on `unbound` in M2). Every
variant carries `at`, so travel is one more `case` rather than a restructuring — which is the
constraint ADR-0009 was shaped to satisfy, now discharged. Storing 165 entries of "nothing happens"
to express a default would have been a per-turn allocation the size of the board.

**Learned:** Three things, and the first is the one that matters.

**A surviving mutant found a bug that was already shipped, and the test that should have caught it
passed for the wrong reason.** The mutation "a distant tile spends a turn" stayed green. The cause:
`nativeEvent.locationX` is typed `number` by React Native and is **`undefined` on react-native-web**,
whose `nativeEvent` is the raw DOM event (own keys: `['isTrusted']`). The guard therefore dropped
*every* press on the board, so tapping was dead on the exact build we ship — and the test passed
because nothing was listening, so "nothing happened" was indistinguishable from the expected outcome.
**A test whose expected result is "nothing happens" cannot tell a working refusal from a dead handler**,
and that is a general trap in a codebase whose §2 is full of legitimate refusals. The touch layer was
rebuilt around a single `Pressable` and a pure, unit-tested `tileAtPoint` with a `pageX − measuredOrigin`
fallback, so every tap in the game now goes through those three lines and any test that taps anything
exercises them.

**Then review found a second, live instance of the same bug in the same file, and the shape of *that*
is the more useful lesson.** The board cached its origin and refreshed it `onLayout` — but **`onLayout`
on react-native-web is a `ResizeObserver`**, which observes size and never position. At a phone
viewport the board is *width*-bound, so shuttering the lantern grows the HUD by a line, moves the
board 6pt, and changes neither its width nor its height: no callback, no re-measure, and a stale
origin on the path of **every press in the shipped build**. A 16% band at the bottom of every tile
resolved to the tile below, for as long as the shutter was shut — which is most of the game this
design is about. The comment above the code asserted the exact property that was false.

**No test could see it, and the reason generalises.** The *desktop* board is height-bound, so there
the same HUD growth does resize it, `onLayout` fires, and the origin is correct — desktop can never
reproduce it. And every phone spec pressed tile *centres*, where a 6pt error vanishes into the ±17pt
half-cell. The bug needed a phone viewport **and** an off-centre press, and nothing combined the two.
The fix for that is not one test: presses are now taken at a *fraction* into a tile, the move spec
presses a corner rather than a centre, and the regression spec asserts the **trigger** — that the
board moved and did not resize — so it fails loudly rather than passing vacuously if a future layout
stops moving the board.

**The repair had a wrong first draft that is worth keeping.** Re-measuring per press with
`measureInWindow` is **asynchronous on web** — a `setTimeout(0)` around `getBoundingClientRect` — so
the tile resolves outside React's event handling and two presses landing in one task both compute
from the same `Run`, silently discarding a turn. That was not theoretical: a spec's press loop lost
two thirds of its presses. It also voided an exemption I had granted on review ("two presses in one
tick is not reachable through a real `touchend`"), which was true only of a *synchronous* handler.
The shipped version has **no cache at all** — it reads the node's rect at the press, synchronously —
because "re-measure more often" is still a theory about what can move the board, and this file has
now been wrong twice about exactly that.

**The same "emission order" assumption was wrong a second time, in a second file, and the test for it
could not fail.** `describeTurn` took the *last* speaking cue, on the grounds that `CUE_KINDS` is in
emission order so the last sentence is the newest news. That holds **between** cue kinds and not
**within** one: `render/cues.ts` emits `damaged` by iterating `world.actors` in ascending id order and
the player is id `0`, so the player's own `damaged` cue is always *first* among a turn's blows and
last-wins always discarded it. **Every turn in which blows were traded said `You strike for 4.` and
never `You take 3.`** At 12 max HP and 3-4 a hit, that is three silent turns from death — and with
nothing animating, the only remaining signal was auditing a HUD number.

The `playtester` found it in six runs ("the only thing that compromised Pillar 2") and review found it
independently. What made it *blocking* rather than a follow-up was the test: its comment named this
exact case — "a turn that opens the shutter and **takes a hit** must say the hit" — while its sample
held **one** `damaged` cue, and the bug needs two. It asserted a property the code did not have,
passed, and would have gone on passing under a comment that told the next reader it was covered.

Fixed as **precedence, not recency**: death outranks damage, damage outranks everything, and only then
does recency decide. Ordering by *who it happened to* rather than by actor id is the point — it does
not care what order the simulation iterates, which is the assumption that broke twice. The same audit
found `fuelGained` is emitted *after* `died`, so last-wins could have reported `You gather 25 ember.`
on the turn the run ended; that is now covered by a named test too.

**`React.memo` on the cells is currently doing nothing measurable, and the honest number is worth more
than the assumption.** 40 real taps against the built web app at a Pixel 7 viewport, timed from
`touchend` to DOM commit: 1.1ms median unthrottled, 8.3ms at 4× CPU throttle, 20.5ms at 8×. Removing
the memo entirely: 8.0ms at 4×, inside the noise. 165 cells is simply not many and the React Compiler
is on. The memo stays — it is free and it is what makes ADR-0003's 40×24 case tractable — but nobody
should believe it is load-bearing today. The issue said measure before optimizing; the measurement says
there is nothing to optimize yet.

**The directory is `components/play/`, not `components/game/`.** The layer lint matches import
specifiers by path segment, so `@/components/game/board` is reported as a component reaching into the
simulation. ARCHITECTURE.md documents the mirror case — a `components/` directory inside `game/` — but
not this one. Filed.

**Next:** #21 — death, winning, and the run-summary screen. It is the last issue in M1 and it carries
the exit criterion in its own body: both endings, and an E2E path over a full run. After that, M1's
exit is the first `playtester` run, which the roadmap has made the concept checkpoint for the whole
light wager.

**Watch:** Five, from actually looking at the screen rather than from the diff.

- **Cells are 34pt at 390pt wide.** The *targets* are 44 by arithmetic — the hit test widens each
  target and snaps from the dead diagonals — but the thing you aim at is 34, and a first-time player
  discovers the widening rather than sees it. This is the most likely source of a bad first
  impression and the playtest should be asked about it directly.
- **"EMBER-SENSE 1/5" with the lantern open will read as a bug.** It is correct — the ramp only climbs
  while shuttered — but it is the one readout that needs a word of explanation.
- **Nothing moves.** No animation was shipped, deliberately, so reduced motion is satisfied vacuously
  and cues are a sentence under the board rather than motion. A turn resolving with no acknowledgement
  beyond the board changing is a little dead, and it is the first thing a playtester will notice.
- **The board is not reachable by a screen reader** — one label announcing that a grid exists is not
  access to it. Not one of §11's five requirements, so filed rather than fixed here.
- **The palette is provisional and M4 owns it (§10).** It is checked for completeness against
  `COLOR_TOKENS` and for contrast, so it cannot silently lose a token, but the values will move.

## 2026-07-31 — Two of the six commands in `CLAUDE.md` never worked where agents run them (#49)

**Did:** `npm run build:web` and `npm run test:e2e` now work from inside a git worktree. Three
independent fixes: `metro.config.js`'s worktree blockList is conditional on the project root not
itself being a worktree, `metro.config.js` gives each project root its own `cacheVersion`, and a
`pretest:e2e` hook links a worktree's missing `node_modules` to the main checkout's. 986 tests, up
from 956.

**Why:** Every agent is told to work in a worktree under `.claude/worktrees/`, and two of the six
commands in `CLAUDE.md` failed there — `Error: No routes found` and `Failed to resolve "extends"
path "expo/tsconfig.base"`. **CI never saw it and never could**: CI runs on a clean checkout where
`.claude/worktrees/` does not exist, so the only mandatory gate is green on exactly the path that
does not have the bug.

The realistic damage was never a red build. It was agents reporting "E2E green" having never run
it, or dropping the step as environment noise — the same shape as the `expo lint` episode, where a
check quietly stopped covering what everyone believed it covered. This is why it was worth fixing
before #20, whose definition of done is *E2E green, screenshot it, look at it*: that issue's
acceptance evidence is precisely the two commands that did not run.

The blockList bug is a nice miniature of the general one. The pattern
`/[\\/]\.claude[\\/]worktrees[\\/].*/` matches **absolute** paths, so it does the right thing from
the main checkout and blocks the worktree's *own* `app/` from inside one. Right rule, wrong frame
of reference.

**Learned:** Three things, and the first cost the most time.

**Metro's cache is per-MACHINE, not per-project, and it poisons brand-new worktrees.** This was the
second, independent cause of `No routes found`, and it outlived the blockList fix. Metro's default
cache store is one directory in the OS temp dir shared by every project root on the box, and the
resolver's blockList is not part of the key. expo-router discovers routes through a
`require.context` that lives in the main checkout's `node_modules` and therefore resolves to the
*same absolute file* from every worktree, so a worktree gets served an expansion of it computed for
somebody else's root. In the failing worktree the evaluated config is provably correct — `blockList`
is Expo's own two entries and matches nothing of ours — which is exactly what made this masquerade
as a bad predicate.

Established by A/B on this machine's real cache, twice, on two worktrees created minutes earlier
and never built: **fix disabled -> `Error: No routes found`; fix restored, same worktree, same
cache, no `--clear` -> 3 static routes.** Both pairs back to back.

**The trigger is a build from another worktree at the same nesting depth. The main checkout neither
poisons nor is poisoned.** In a dedicated empty cache with the fix disabled: worktree P builds (3
routes); sibling worktree Q, created at the same time and never built, then fails; Q with the fix
restored succeeds *in that same poisoned cache*. The prediction that identified the mechanism:
a worktree at `.claude/worktrees/nest/deep/rr-r` — a **different depth** — is immune, and builds
fine in the poisoned cache with the fix still disabled.

Depth is the whole story. Metro keys its transform cache on the path *relative* to the project root,
and every agent worktree sits at exactly `<repo>/.claude/worktrees/<name>`, so expo-router's entry
resolves to `../../../node_modules/expo-router/entry.js` from all of them and they share its cached
expansion. The main checkout is at depth 0 and shares with nothing. (The relative-path key is
inferred black-box from the depth experiment, not read out of Metro's source. The behaviour is
directly observed and deterministic; the explanation is the one soft link in the chain, and it is
flagged here rather than in a comment that reads like fact.)

**This paragraph previously said the trigger was unknown and told you not to look for it.** That was
written after a controlled attempt to poison an empty `TMPDIR` with a single *main-checkout* build
failed to reproduce anything — which was a true observation and, it turns out, the clue: the main
checkout is exactly the root that cannot poison. Having been burned twice in this entry by claims a
clause wider than their evidence, the correction over-steered into telling the next reader to stop
investigating, which is worse — a wrong claim gets falsified, an instruction to stop looking does
not. **Hedge the claim, never the inquiry.** The trigger took three builds to find once someone
ignored the instruction.

**The first version of this entry got the scope wrong, and the reason it did is the reusable
part.** It said the poisoning was a one-off artefact of the reproduction run, with "nil consequence
for the fix, since a fresh worktree has no such cache". That is false, and the mistake was not
analytical — **verification happened in a worktree where `--clear` had already been run, so the
fresh-worktree case, the one the DoD is actually about, was never exercised at all.** Same shape as
the lesson already in this file: verify in the environment that has the bug, and if you have already
"fixed" that environment by hand, it has stopped being one. `--clear` is a manual step, and the DoD
says in as many words that a documented manual step is a step that gets skipped.

The fix is `cacheVersion: <expo's>:root-<md5 of __dirname>`, applied unconditionally in
`metro.config.js`. A hash of `__dirname` in a Metro config looks like superstition, so it carries a
comment saying what deleting it costs.

**The three failures are genuinely independent, which the first runs actively suggested
otherwise.** `build:web` from a worktree needs the two `metro.config.js` changes and succeeds with
**no `node_modules` present at all**, because Metro walks up; only Playwright's tsconfig resolver
is rooted at the config's own directory, and only it needs the link. Worth stating because the
tempting single fix — "give the worktree a `node_modules` and everything goes away" — would have
left both Metro bugs in place under a workaround.

**A test that loads `metro.config.js` in place cannot catch this, and would have read as if it
could.** In the main checkout the real config can only ever be asked the main-checkout question,
and CI is always the main checkout — so re-inlining the bug stays green. The test therefore copies
the real config into a `mkdtemp` sandbox under a `.claude/worktrees/<name>/` path and requires the
copy, so the actual shipped file can be asked the worktree question from anywhere. Confirmed by
reverting the fix verbatim and watching that named test go red. Eighteen mutations were run in
total, each mapped to the named test that caught it, and one test was **deleted** as a result: the
in-place check `expect(blocks(…)).toBe(!isInsideAgentWorktree(ROOT))` computed its expectation from
the function under test, so both sides moved together and it survived all six predicate mutations —
a test that cannot fail, sitting where the most important one appeared to be.

An earlier draft of this entry claimed one of those mutations — splitting paths on `/` only — would
be "green on Linux CI and broken on Windows". **It is caught on Linux too**, by two tests that
assert against hardcoded backslash strings and go red on any platform. The corrected version is
less alarming and matters more: overstating a gap sends the next session off to fix something that
is already covered.

**Next:** #20 — the game screen, grid rendering and touch input. It is the critical path: the last
build item in M1, and the thing standing between the project and its first playtest, which is M1's
exit criterion and the concept checkpoint the roadmap moved here. Pass a constant seed (#47 says so
explicitly).

**Watch:** Three residuals, all filed here rather than fixed.

- **Only `npm run test:e2e` is hooked.** A bare `npx playwright test` in a fresh worktree still
  fails the same way. Acceptable because `CLAUDE.md` documents the npm script, but it is a
  documented-path-only fix.
- **The junction is a junction.** `rm -rf` under MSYS follows it and would delete the *main*
  checkout's `node_modules` contents. Remove it with `fs.rmdirSync`. This is a live foot-gun for
  any agent cleaning up a worktree by hand.
- **The config tests stub `getDefaultConfig`.** Loading `expo/metro-config` for real took 7.6s on a
  cold filesystem cache, which is a unit test that times out on a fresh CI runner, so the sandbox
  harness supplies a stub shaped like what Expo ships today (an array `blockList`, `cacheVersion:
  '1.0'`). If Expo changes either shape, those tests keep passing against a fiction. The composition
  functions are separately tested against both shapes, which bounds the damage but does not remove it.

  (A "drive-letter case" bullet stood here and was wrong: self-linking needs no `node_modules` in the
  main checkout, and that case throws `the main checkout … has none either` first. The behaviour is
  better than the note claimed.)

## 2026-07-30 — Archivist: the roadmap was a milestone behind, and its headline count was never `game/`

**Did:** Reconciled `ROADMAP.md`, `GDD.md` and this file against `main` at `2db3f39` (#45/#51), in
**PR #54**. *(This entry is the anchor the date note at the top of the file points at: everything at
or above it was dated by reading a clock.)* No code. Six issues filed during the #45 session were triaged into milestones, and #20 lost its
`blocked` label.

**Why the roadmap was the whole job.** It claimed `render/` did not exist — seven modules and 124
tests after #19/#42 — and had never heard of `session/`. It said "#19 → #20 → #21, only #19 is
unblocked today" when #19 and #45 are both merged and **#20 is the only *unblocked* issue, with
#20 → #21 left before the exit**. A session starting cold reads `ROADMAP.md` second (CLAUDE.md says
so) and would have gone looking for work that was already done.

**The number was worse than stale, it was mislabelled — and it went in *as a fix*.** The section
asserted "`game/` is 44 test files and 797 tests". `git log -S` puts that string in `03d76ec` (#36),
under a commit message reading "review follow-ups — ... stale counts". At that commit `game/` was 42
test files and the *whole suite* was 44 — `game/` plus the two files then in `tests/unit/`. Someone
re-ran the suite, read the summary line, and attached the total to the wrong noun. `game/` has been
42 files the entire time. #40 then edited this very file without touching it, and #42 and #51 each
made it staler without anyone looking.

Counted now, per directory, with the table naming the directory each number covers: `game/` 42/774,
`render/` 7/124, `session/` 1/26, `tests/` 3/32 — **53 files, 956 tests**. **Quote a count only with
the scope it covers, and re-run it.** A scoped number is falsifiable in one command; an unscoped one
is plausible forever, which is why this one outlived three PRs including the one that "fixed" it.

**Two contradictions between documents, both resolved by pointing rather than by deciding:**

- **GDD §10 names four cell states that `render/` does not use.** §10 says `lit` / `sensed-but-unseen`;
  the code says `visible` / `sensed`, both deviations argued and accepted at review. #46 owns the
  amendment and it is the `game-designer`'s to make, so §10 now carries a block saying the code is
  the truth and this paragraph is the stale copy. **A doc that is wrong and says so is safe; a doc
  that is wrong and confident is what the archivist exists to prevent** — and §10 is exactly what
  someone would read to brief the M1 playtest.
- **GDD §12 said the fallback is spent "if the M2 playtest says the wager is not tense".** The
  roadmap moved that checkpoint to M1's exit when the simulation finished a milestone early, and
  nobody told §12. Now says "the first playtest", with the reason. `ROADMAP.md` contradicted
  *itself* on the same point — M2's opening paragraph still called itself the milestone that
  determines whether the concept works, two screens below M1 saying the checkpoint had moved. M2's
  paragraph now states what M2 is *for* instead.

**Triage of the six issues from the #45 session, and the reasoning, because "be conservative" is
easy to say and each of these had an argument for jumping the queue:**

- **#49 → M1.** The only one promoted, and it is not gameplay. `npm run build:web` and
  `npm run test:e2e` both fail inside a git worktree, which is where every agent is told to work,
  while `npm run verify` passes and CI — running on a clean checkout — stays green. The failure mode
  is not a red build; it is agents reporting "E2E green" having never run it. That is the `expo lint`
  episode again, and it is corrosive to the one gate that is mandatory.
- **#47 → stays M1, but the roadmap now says it does not gate the exit.** It was already milestoned
  M1 and its own text says "not blocking #20 — pass a constant and move on". Left where it is;
  labelled honestly instead of moved, because the M1 issue count is a signal people read.
- **#48, #52, #53, #50, and the older #39 → M2**, under a new *Contract and tooling debt* block that
  says outright it is lodged there rather than aimed at M2 and does not count toward its exit.
  **Unmilestoned was the worse option**: CLAUDE.md sends every session to
  `gh issue list --milestone "<current>"`, so an unmilestoned issue is an invisible issue. Parking
  them in M2 makes them visible at the cost of muddying a tuning milestone; the block carries the
  instruction to split them into their own milestone if the list grows.

**#50 deliberately not fixed here — but its evidence was wrong and that *is* fixed.** #50 as filed
claimed entries run "up to 2026-08-07" and that "every commit landed on 2026-07-30". Re-derived:
as of `2db3f39`, the maximum heading date was **2026-08-05** and every commit had landed on
**2026-07-29 or 2026-07-30**, plus the Expo template's `Initial commit` on 2025-10-25. So the invented headings ran
**2026-07-31 to 2026-08-05**, and every entry dated 07-29 or 07-30 is **accurate and must not be
swept up**. (No per-day totals here on purpose: a count is stale by the commit that writes it, which
is how this went wrong twice already. Run
`git log --format='%ad' --date=short | sort | uniq -c`.) The #45 entry below and #50's body both
carried the wrong version; both are corrected. Reconciling the invented headings, the
cross-references that cite them, and the policy is still not mechanical, so the fix stays #50's.

**The note states that boundary *positionally*, and the reason is worth keeping.** A date range was
the obvious phrasing and it is a trap: 2026-07-31 through 2026-08-05 is *the next six days of real
time*, so an entry written honestly tomorrow lands inside the "fabricated" window and #50's
implementer rewrites a correct heading — the exact failure this paragraph is about, with the sign
flipped. Anchored to this entry's position instead, the suspect set is closed and cannot grow.

What was safe here is the note at the top of the Format section. **Correcting with a new note rather
than editing the entries is the rule in this file, and it is also the cheap fix** — but a note that
is itself wrong is worse than no note, so it makes **no date-keyed claim about which entries are
suspect** and quotes no counts, and points at this entry instead.

**Learned — and this is the finding about the session, not about any one doc. The same failure
happened three times in one work session, twice inside this PR, and each instance was caught only by
the *next* reader:**

1. **`game/` is 44 files and 797 tests** — a whole-suite total attached to a directory. Landed in
   #36 in a commit that said "stale counts", survived three PRs.
2. **"#20 is unblocked and is the only issue between M1 and its exit criteria"** — true of the first
   clause, false of the second, since #21 is open, `blocked`, in M1, and its body *is* the exit
   criterion. Written in the #45 entry's `Next:` line, then promoted by me into `ROADMAP.md`'s
   headline. **I copied a sentence instead of re-deriving it, in the same PR whose whole thesis is
   that copying a number instead of re-deriving it is how docs rot.** Caught by review of this PR.
3. **"every commit landed on 2026-07-30" and "entries run to 2026-08-07"** — the first generalised
   from `git log -3` (three commits of the whole history, which at that point sat entirely on 07-29
   and 07-30 — so the generalisation was not even close to safe), the second read
   off an ADR date the author had written himself minutes earlier. Both were in the #45 entry's
   `Learned:` section *and* in #50's body, i.e. in the two places a future session would go to fix
   the dates. Corrected in the entry, in #50, and in the note above.

The common shape is not carelessness — every one of these was written by someone actively trying to
be accurate. It is that **a figure specific enough to look derived gets read as derived.** "44 test
files", "the only issue", "every commit" all carry the texture of something counted. Re-reading them
feels like checking them, and it is not. **The only defence that worked here was a second reader
running the command** — which is why counts in these docs now name the directory they cover, and why
this entry names the commands (`git log -S`, `git log --format=%ad | uniq -c`) rather than just
their results.

Separately: **`M1`'s GitHub milestone *description* had drifted** from the roadmap's exit criteria —
it still said "complete a run and report that moving and fighting feel good", missing the
two-endings amendment (#18, GDD §13) and the flash-and-crawl clause. **Milestone descriptions are a
doc nobody thinks of as a doc.** Updated, and worth adding to the next archivist pass's checklist:
`gh api repos/:owner/:repo/milestones` is one command and nothing else surfaces it.

Also: `ROADMAP.md` listed "implement `travel(to)` — #32" as open M2 work, but **#32 is closed** — it
was the design ruling, and the build has no issue. A cold session would have opened a closed issue
and drawn the wrong conclusion. The bullet now says the build issue gets filed when the M1 playtest
opens the gate, and not before.

**Next:** #20, then #21. #20 is the only M1 issue that can be *started* today; #21 is still
`blocked` on it and still carries the exit criterion in its own body. The four constraints #20
inherits are listed in `ROADMAP.md`'s "Where M1 actually stands" rather than spread across three
journal entries.

**Watch:** M1 has now absorbed two things its bullet list was not written for — M2's simulation work
(#16, #17) and the whole layer stack above `game/` (#19, #45). Both absorptions were right and both
are argued in the roadmap's two scope notes. The tell to watch for: #47, #48, #52 and #53 all say
some version of "the seam is not quite where we said it was". Four is normal settling after a new
layer. **If that set reaches six, or a sixth layer gets proposed, the seam is wrong** — solve it
once as a design problem rather than working through six issues.

## 2026-07-30 — `session/` owns the run, and `Run` hides `GameState` from the type system up (#45)

**Did:** Added a fifth layer. `session/` sits above `render/` and below `components/`, owns a run,
and is the only place above `game/` where a `Command` value exists. Seven functions —
`beginRun(seed)`, `move`/`wait`/`setShutter`/`descend`, `sceneOf`, `cuesOf` — and one opaque type.
[ADR-0010](decisions/0010-session-layer-owns-the-run.md) is the record. Both contract gates moved
together, and the determinism rules that had been scoped to `game/` alone now cover all three pure
layers. 956 tests, up from 917.

**Why:** #19 shipped `presentScene(state)` and nothing in the repository could legally call it.
`components/` and `app/` are banned from importing `game/` — twice, deliberately, and both gates are
right — so there was no legal home for `createInitialState()` or `step()`. #20 had nowhere to stand.

**The decision that mattered was not *where*, it was that the import ban is a proxy.** The property
anyone actually wants is *nothing above the seam inspects a `GameState`*. An import rule approximates
that mechanically and, like every proxy, can be satisfied while the property is violated: hand a
component `{ state: GameState }` and both gates stay green while `run.state.world.actors[0].hp`
compiles, because structural typing does not need the import to reach the field. So the answer had to
make the *property* structural.

It does, but **the first attempt did not, and the correction is the most useful thing in this
entry.** The shape that shipped for review was
`export type Run = { readonly [RUN_STATE]: RunInternals }`, justified on the grounds that the key was
a module-private `unique symbol` nobody could write. The `code-reviewer` requested changes with a
working exploit: a `components/`-legal file that named `GameState` and read simulation fields with
**no cast, no `any`, no `@ts-expect-error` and no `game/` import**, all three gates green, with full
autocomplete — `tsc` would report `Property 'turn' does not exist on type 'GameState'` from inside
`components/`. Two independent mechanisms, either sufficient alone:

1. **A key you cannot write can still be computed.** `keyof Run` *is* the symbol, so
   `Run[keyof Run]['state']` resolved to `GameState`, by name.
2. **A `type` alias gets an implicit index signature.** `const record: Record<symbol, T> = run` was a
   plain assignment; the symbol reflected off the object then indexed it.

The fix is two words: `Run` is now an **`interface`** (no implicit index signature) whose property
type is **`never`** (nothing to project through `Run[keyof Run]`), with the real internals reached
through one private cast pair. Verified by mutating each word back and watching a *named* test go
red — `interface`→`type` reports the index-signature directive unused; `never`→`RunInternals` fails
the `IsNever` assertion and two more directives.

**The generalisable lesson: unspellable is not unreachable.** `keyof`, indexed access, implicit index
signatures and `infer` all construct references to things no source file can spell. Any future
"private because you cannot name it" argument in this repo should be tested against those four first.

**And the test that was there was worse than no test.** Its comment claimed "nothing the compiler
accepts can get there" while its body asserted only that one expression errors — so it could not fail
when the property it named was violated, and it read as proof, which is what stops the next person
looking. Each mechanism is now asserted separately, and the exploit is kept verbatim in
`tests/unit/session-consumer.test.ts` because a regression test for a hole belongs at the position
the hole was reachable from. Mechanism 1 needs a *positive* `IsNever` assertion rather than a
`@ts-expect-error`, because `Run[keyof Run]['state']` does **not** error when the property is
`never` — it silently resolves to `never`, so the directive would be flagged unused and the test
would fail for the wrong reason while a real regression passed.

**The residual, stated rather than discovered:** `(run as unknown as ...)[getOwnPropertySymbols(run)[0]]`
still reaches the state, because it really is a property of a real object. Accepted — the argument is
about review, not types. The path that had to be closed was the one that *looked like ordinary code*;
a double cast beside `getOwnPropertySymbols` in a component is loud, greppable and the kind of line
review stops on. Both test files pin it so it stays a known quantity.

**Then the correction was itself sent back, and this is the more useful half of the story.** The
replacement claim — "nothing above `session/` can name a `GameState`" — was *also* too strong by one
clause. `@/render` is legal from `components/`, and its API necessarily names `GameState`, so
`Parameters<typeof presentScene>[0]` hands a component the real type with autocomplete and the
identical `Property 'turn' does not exist on type 'GameState'` message we had been quoting as the
exploit we closed. Same route via `cuesFor`, `perceivedCreatures`, and `glyphForCreature` (which
yields a `CreatureActor`, falsifying `render/index.ts`'s "nothing in here hands out a `Tile`, an
`Actor`, or an id you could ask a question of").

That is **the same fact that decided this ADR** — `render/`'s API naming `GameState` is exactly why
the run could not live in `render/` — so the correction overreached past a limit the document states
correctly two sections later. The property is now scoped to what was actually tested: *nothing above
this layer can reach a `GameState` **through a `Run`** without an explicit, visible cast.* The type
route is pre-existing from #19/#42 and is filed separately. It does not weaken `Run`: a type you
cannot obtain a *value* of buys nothing, nothing in `render/`'s surface returns a `GameState`, and
the live state of the run in hand is what `Run` guards.

**Three drafts of one sentence, and the lesson is the sentence-level one:** check the scope of a
correction as hard as the claim it corrects. Both failures were a clause wider than the evidence.

**`render/` was the runner-up and the issue's stated objection to it was wrong**, which is worth more
than the conclusion. The objection was that a run controller "costs `render/` a stateful surface in a
layer that is currently a pure function". It does not — a `Run` written as a value-reducer is
perfectly pure, and that is exactly what `session/` implements. Purity does not settle it. What does:
**`render/` must export `presentScene(state: GameState)`, so its public API necessarily names
`GameState`.** The session layer's whole job is to be the place a `GameState` stops being
*obtainable* — one module cannot both hand out the type and hide the value. (Note the consequence,
which is the finding above: because `render/` still names the type, the seam bounds what you can
*get*, not what you can *say*.) An `app/` exemption lost on the proxy argument
above, plus this repo's own history — a contract rule with a hole in it is a rule that quietly stops
being enforced, because the hole is where the next person puts the thing that did not fit.

**`Command` never crosses the seam, and that is why there are four intents and not one `apply`.**
`apply(run, command)` is one function instead of four and needs no edit when a fifth command lands —
and it forces `components/` to *build* a `Command`, which lives in `game/core/command.ts`. Either the
component imports `game/` or `session/` re-exports the type and the seam is decorative. What crosses
instead is a verb plus plain data. ADR-0009's constraint then falls out free: adding
`travel(run, to)` in M2 is one more function here, not a restructuring.

**Learned:** Three things, and the second is the one that generalises.

**The determinism rules were scoped to `game/` only, and `session/` is the worst possible layer for
that hole.** A `Date.now()` seed in `session/` breaks run-level reproducibility while `game/` stays
provably pure — the prime directive violated with every gate green. Found by the `test-engineer`
while updating the gates, and taken in this PR rather than deferred: an issue about not leaving holes
in layer enforcement should not ship a new layer with a hole in it. Now `game/`, `render/` and
`session/` share one `DETERMINISM_RULES` set, verified by 15 planted probes — three layers × five
sources × both gates. The async/promise/IO bans deliberately did **not** come along: `game/` is a
synchronous reducer, but `platform/`'s `SaveStore` returns promises by design, so banning them in
`session/` would be a rule we repeal the moment save/resume lands — and a repealed rule teaches
people rules are negotiable. That reasoning is now in `eslint.config.js` rather than in this file
alone, because the next agent to see `session/` allowing promises will otherwise "fix" it.

**`npm run build:web` and `npm run test:e2e` do not work inside a git worktree — which is where every
agent is told to work.** `metro.config.js` blocks `.claude/worktrees/` by absolute path, so a build
run *from inside* a worktree blocklists its own `app/` routes and dies with `No routes found`;
Playwright's tsconfig resolver does not walk up to the main checkout's `node_modules` the way node,
tsc and Vitest all do, so it fails before running a test. Both confirmed by experiment — removing the
one blockList line produced 3 routes and a successful export, and a `node_modules` junction made all
4 specs pass. **`npm run verify` works fine, which is exactly what makes this dangerous:** CI runs on
a clean checkout, so it is green and stays green, and the realistic failure is not a red build but
agents reporting "E2E green" having never run it. Same shape as the `expo lint` episode. Filed as #49
with the diagnosis and a fix sketch; verified that `eslint.config.js`'s superficially-similar ignore
is *not* affected, so nobody fixes it by analogy.

**The journal's dates are fabricated from 2026-07-31 onward.** *(Corrected in place by the archivist
pass that followed — the two figures this paragraph originally quoted were both wrong, and the
correction is at the end.)* Headings run to **2026-08-05**, and ADR-0008, ADR-0009 and ADR-0010 were
dated the same way. `git log` says every commit up to this point landed on **2026-07-29 or
2026-07-30**, plus the Expo template's `Initial commit` on 2025-10-25 — so entries dated 07-29 and
07-30 are **accurate**, and the invented ones ran 07-31 to 08-05. (The note at the top of the file
draws that boundary by *position* rather than by date range, because the range is the next six days
of real time and would sweep up honestly-dated entries written into it.)
The #19 entry is misdated such that it sits above entries dated a week later, in a file whose entire
contract is "newest first". ADR-0010's date is corrected here to the real one and this entry uses it.
The rest is left alone deliberately: rewriting nine historical headings is an archivist job with its
own review, not a rider on this PR. **Do not date an entry by copying the entry above it.**

**What this paragraph originally claimed, and why it was wrong** — kept because it is the same
failure the paragraph is *about*. It said entries "run to 2026-08-07" and that "every commit in this
repository landed on **2026-07-30**". The first came from reading ADR-0010's then-current date as if
it were an entry date; it was a date I had written myself minutes earlier, which is not evidence
about anything. The second was generalised from `git log -3` — three commits are not a sample of the
whole history, and the days it skipped held more commits than the day it saw. The consequence ran
the wrong way: it told readers to discard every heading that was already accurate as decoration. **An unverified
figure that looks specific enough to trust is exactly what this entry was filed to complain about.**

**Next:** #20 is unblocked. *(This line originally read "and is the only thing standing between M1
and its exit criteria" — also corrected in place, and it was the more expensive of the two errors,
because it got promoted verbatim into `ROADMAP.md`'s headline before anyone re-derived it. **#21 is
open, `blocked`, in M1, and its body carries the exit criterion**: the summary screen, both endings,
and an E2E path over a full run. #20 is the only issue that can be *started* today; #20 → #21 is
what remains.)* It gets
`beginRun` in a `useState` and three function calls; `const [run, setRun] = useState(() =>
beginRun(seed))`, `setRun(move(run, 'north'))`. Two constraints it still inherits from #19 — the
provisional colour table does not exist, and no layer yet says which of the four neighbours is a
*legal* tap target (§9), which is a game rule and must not end up as a `blocksMovement` call in a
`.tsx`.

**Watch:** Four. **The seed is a constant** until #47 gives `platform/` a clock — every run is the
same run, which will confuse the first playtest if nobody remembers it was deliberate. **`Run`'s
opacity rests on `tsc` alone**; neither gate would notice if `index.ts` started re-exporting the key,
so `npm run verify` is load-bearing in a way the two contract gates are not. **Naming a source file
`*.test.ts` bypasses both gates entirely** in every layer (#48) — the exemption is right, the
filename key is wrong. And **the unit suite now runs at 5.00s against a stated 5s target** with the
cost almost entirely in `transform`; the next agent to add a test file will push it over and should
not conclude their test is the offender.

## 2026-07-30 — `render/` exists: the presentation model, and the two rulings it was asked to settle (#19)

**Did:** Built `render/` — seven modules, ~120 tests. `presentScene(state, previous?)` produces a
board (one flat `Cell` per tile: state, glyph, fg/bg tokens, opacity, tint, telegraph) plus the HUD;
`cuesFor(before, after)` produces animation cues as data. No React, no `.tsx`, no palette. Also
settles the two things the issue said this PR had to settle rather than inherit.

**Why**, decision by decision, because five of these were forks with a wrong branch that compiles:

**The four §10 cell states are carried by two non-colour fields, and the state name changed.**
`opacity` takes four pairwise-distinct values (1 / 0.85 / 0.4 / 0), so **one** luminance channel
separates all four; glyph presence is the second (`unknown` is the only blank, `sensed` is always
`*`). `accessibility.test.ts` asserts the strong form over ~11k real cells: **delete both colour
fields and the state is still a function of what is left.** §10's `lit` is named `visible` here —
with the shutter shut you perceive nine tiles by touch and no light is involved, so `lit` would be a
lie in the vision state the whole game is about. §10 could use the one-word amendment.

**`sensed` was widened past §10's parenthetical, deliberately.** §10 glosses it as "a `*` on a tile
whose terrain you have never seen". Read literally, a contact felt on a *remembered* tile falls into
`remembered` and gets drawn at memory opacity — a living creature as dim as the stone it stands on.
So `sensed` is a felt contact on any tile not perceived this turn. A contact on a tile you *are*
perceiving (adjacent, in the dark) stays `visible` carrying a `*`: you know the tile, not the thing.

**Falloff is emitted, and is provably incapable of lying.** §10 asks for it; §4's lit field is
*binary* and its hard square edge is load-bearing (Chebyshev was chosen so "the player can see where
the light ended"). So: `tint` is a pure function of Chebyshev distance from the player — both ends on
screen, so it can leak nothing — it is discrete by construction (distance is an integer, five
values), every lit cell is ≥ `LAMP_TINT_EDGE` while every other cell is exactly 0, and **the step off
the edge of the light is larger than every step inside it**. That last one is the assertion that
stops the gradient reading as "partly visible".

**`TurnPerception.creatures` gets its consumer — `render/` is the caller that passes the real list**,
after three journal entries as a Watch note. `game/systems/light.ts` keeps passing `[]`; nothing in
`game/` changed. §4's "position only" stays a *type*: identity is looked up only where the sense says
`seen`, and `scene.test.ts` proves it by building two boards differing only in the felt creature's
HP, dormancy and declared intent and asserting the cells are equal.

**ADR-0009's counted list is this list**, and `scene.test.ts` asserts `perceivedCreatureCount(state)`
equals the number of marks drawn, over every state of two runs — the ADR said "assert, do not
assume". The shared definition cannot live in `game/` yet (no `game/`-side consumer means an
unkillable export, which is the thing `light.ts` deleted), so `perception.ts` carries the note:
**whoever builds `travel` moves `livingCreaturePositions` into `game/entities/world.ts` and imports
it from there.**

**Cues are seven facts and no timing.** `refused | descended | shutterChanged | playerMoved |
damaged | died | fuelGained`, each recovered by diffing two states — which is what caps the
vocabulary, since nothing in `game/` emits an event. Reduced motion is `components/` ignoring the
list. `refused` is free and exact: §2 requires feedback for a refused tap, and a refusal *is*
`after === before` by reference.

**Cells are referentially stable**, so #20 gets `React.memo` with the default comparator: an
unchanged cell is the *same object* as last turn, and if no cell changed the whole `grid` object
comes back. `scene.test.ts` asserts the exact property (`sameCell(a, b) ⇒ a === b`) rather than a
percentage that would flake with the seed.

**Learned:** The mutation pass paid for itself four times, and three of the four were **checks that
enforced nothing**, which is the failure this repo keeps finding.

- `Math.round(tint * 100) / 100` was written to keep float noise out of the DOM. At `LIT_RADIUS` 4
  and edge 0.6 the five values are already exact, so it was unkillable — *and the test written for
  it could not fail.* Both deleted; the ramp's five values are pinned instead.
- Two guards that read as defence-in-depth were **masking each other into unkillability**: a
  `contact !== 'seen'` check and an `if (!lamplit) return` in the telegraph pass were both dead,
  because `faceOf` returns on a felt contact before either is reached and `identified` is empty in
  the dark anyway. Deleted — that part stands.
- Both HP-threshold branches and `Math.floor` on turns-of-fuel survived: the corpus tests recomputed
  the level with the *same operator*, and 12 HP / 4 fuel-per-turn make every corpus value land
  exactly on a boundary or exactly on a multiple. Fixed with pinned threshold cases.

**Review addendum — the count above was wrong, and so was one of the "equivalents".** This entry
originally closed at *49/51 killed, two documented equivalents*, and recorded `contacts.get(i) ===
'seen'` vs `.has(i)` as an equivalent survivor "because it states the rule where the rule applies".
**It is not equivalent.** That argument reasoned about `faceOf` — one of the map's *two* consumers.
The other, `gatherTelegraphs`, has no such guard, so under `.has(i)` a **shuttered player adjacent
to an awake Cinder is shown an attack telegraph on their own tile**: §4's vision table says intent
is hidden in the dark, and that is the reason light costs 4 fuel a turn. The mutant survived all 917
tests, and the guard named for the rule could not catch it — its creature sat at Chebyshev 2 with
sense radius 1, so nothing was ever in `contacts` and the mutant had nothing to do. It passed for a
reason unrelated to its own name.

Now killed by a test with the creature *adjacent*, so it is felt **and** inside the touch radius.
The annotation in `scene.ts` is corrected in place, because **a false "provably equivalent" note is
worse than no note**: it instructs the next mutation run not to re-derive exactly the thing it is
hiding. The same round found the `damaged` cue's entire payload unasserted — `at`, `who` and
`amount` all replaceable by constants with nothing failing, which lands at #21 where a floating
damage number is drawn at `cue.at` reading `cue.amount`.

**Restated honestly: 10/11 killed over the re-derived set, one verified equivalent** (`isRunning`
in the death cue, which holds because `deathCues` has one consumer where `contacts` has two — the
asymmetry that broke the other note). The full 51 is *not* restated, because quoting a number
nobody re-ran is what produced this correction. **The lesson generalises past this PR: an
"equivalent mutant" annotation is a claim about every consumer of the mutated expression, and it
should name them.**

The other lesson is about `game/` rather than about this layer: **the simulation's terrain memory
already contradicts §4's "items are invisible while shuttered".** `perceive`'s touch field returns a
`cache` tile like any other and phase 3 folds it into `remembered`, so a cache felt in the dark is
permanently mapped as a cache. `render/` draws what the player is recorded as knowing and does *not*
suppress it — suppressing it here would put a §4 rule in the renderer while `vision.remembered` went
on saying the opposite, which is the two-sources-of-truth failure this codebase keeps refusing. Filed
as its own issue; it is a `game/fov/` question.

**Next:** #20 — the React Native grid and the input model. It consumes `presentScene`/`cuesFor` and
must never import `game/`. Two constraints it inherits: ADR-0009's "leave a tap on a distant tile
unbound", and the memo shape above (pass the whole `Cell` as one prop, or the referential stability
buys nothing).

**Watch:** Three things this PR leaves for #20 or its reviewer. **The token→colour table does not
exist** — `render/` emits semantic `ColorToken`s and M4 owns the palette, so #20 must ship a
provisional theme and the first honest look at a screenshot will move it. **Nothing yet supplies
which of the four neighbours is a legal tap target** (§9: "an impassable neighbour is not a tap
target"); that is a game rule and belongs in `render/`, not in a component — it was left out because
it is input-model shaped and #20 owns the input model, but it must not end up as a `blocksMovement`
call in a `.tsx`. And **the lit/remembered pair is separated by opacity alone** among the non-colour
channels (their glyphs are identical by definition); if the playtester says the board does not read,
the fix is M4 typography — weight or size — and not a second colour.

---

## 2026-08-05 — Auto-travel: `travel(to)`, terrain never interrupts, and the build moves to M2 (#32)

**Did:** Docs only, no code. Settled auto-travel's command shape as **one `travel(to)` command**
resolving many turns inside `step()`, narrowed its interrupt rule, and **deferred the build to M2**.
[ADR-0009](decisions/0009-auto-travel-command-shape.md) is the record; GDD §9's auto-travel bullet is
rewritten and marked ***Settled (design) — deferred to M2 (build)***; `ROADMAP.md` moves the bullet
to M2 with the signal that decides whether it is ever built, and records that **#20 is now blocked
only by #19**. The full ruling with its arguments is on issue #32.

**Why:** Three things, and only the first was asked for.

**The shape.** The runner-up — a UI-emitted sequence of `move` commands with a polled interrupt
query — loses on a rule `game/core/command.ts` already states: "a command carries intent, not
resolution." Under that shape the stored log records *how far you got*, not the one tap that was the
intent. Concretely: a backgrounded app or an unmounted component leaves a run half-travelled with
nothing in `game/` knowing; the interrupt rule becomes a Playwright assertion instead of three Vitest
cases; and the run stays a function of the *log* while ceasing to be a function of the player's
*taps*, so the same seed and the same taps diverge across devices. The draw budget, which #32 flagged
as the cost of the command shape, turned out to be a non-issue: travel never descends, so it consumes
**zero** draws and `expectedDrawCount` is untouched. The property that carries the whole design is
that **a travel must be indistinguishable from the `move` sequence it stands for** — a foldable
property test, and the thing that makes the economy, the spent turns and the draw count all answer
themselves. It has to be stated modulo one field: `commandsResolved` is 1 against N, by construction
and on purpose, and everything else is identical.

**The interrupt rule.** §9's "the moment anything new becomes visible or sensed" never says what
*new* is measured against, and the two readings disagree — **stone is remembered, ember is not.**
Terrain would be judged new against permanent memory, the living against the previous step. Under the
memory reading, a shuttered travel across mapped space is fine; under the previous-step reading,
touch radius 1 means nearly every step perceives a tile it did not perceive last turn and travel
never travels. The lit direction has no good reading at all. Terrain was **cut rather than
qualified**: the route runs over remembered tiles only, so a travel cannot enter unmapped space, and
the only mode travel is economically sensible in is dark, where items are invisible and terrain
reaches one tile. What is left is one sentence — *you walk until something living appears, or
something touches you.* The stop is keyed to the **count** of perceived creatures, never to
identity; the reasoning is under **Learned**, because getting there took two tries.

**The deferral.** Auto-travel creates no decisions; it removes taps. That is legitimate under
Pillar 1 only if the taps it removes are autopilot, and **nobody has tapped this game once** — there
is no `render/`. Every remaining question about the stop rule is a playtest question, so building it
now means tuning it against imagination.

**Learned:** The design question was answerable largely from rules that already existed — the
command module's intent-not-resolution rule decided the shape, and §4's fuel arithmetic decided that
lit travel is self-punishing, which is what made cutting the terrain clause safe rather than
convenient.

**The expensive lesson is the other way round, and the `code-reviewer` caught it: I specified a rule
against machinery I assumed rather than read.** ADR-0009's first draft argued that a travel "eats
exactly one hit", because vision recomputes in phase 3 and creatures move in phase 4 — so a creature
closing to adjacency would not be perceived until the following step. **There is no simulation-side
creature perception at all.** `game/systems/light.ts` calls `perceive(grid, vision, origin, [])` with
an empty creature list *deliberately*: nothing in the simulation read the result, mutation testing
proved the line unkillable, and it was removed. The only creature perception derivable from a
`GameState` is post-phase-4, under which the closing creature *is* newly perceived at the end of that
step — so the stop rule fires before the attack lands, and the eat-one-hit consequence directly
contradicted the ADR's own clause 1. Two things follow, both now in the ADR: the consequence is
**cut**, and identity-keyed creature perception is named as **new machinery** rather than as
something the phases already compute. It belongs in travel's fold, not in phase 3 — travel is the
observer that was missing, which is what makes computing it legitimate against light.ts's "an
unkillable line is a line that should not exist"; that ruling is about observability, not about the
computation being unwanted.

**Then I made the same mistake a second time, in the same document, and it took a second review pass
to see it.** The stop rule was keyed to the *creature*: a mark moving tile to tile is not new
contact, so a tracked Cinder does not stop you every turn. I had explicitly killed the alternative —
keying on the **count** of marks — with a swap case: one creature leaves as another arrives, the
count is unchanged, "something genuinely new is on screen". But *genuinely new* is not something the
player has. `game/fov/perceive.ts` implements §4's promise as a type: `CreatureSense` is a union so
that a `felt` creature is "a position and nothing else". In the swap case **the player's screen is
identical** to one creature walking one tile. So identity-keying stops for a reason nothing on screen
explains — and because the stop is observable (mid-route, HP unchanged, nothing adjacent, nothing
arrived ⇒ clause 1 fired), a player who knows the rule can invert it and learn *that mark is a
different creature*. One bit of identity that §4 says does not exist, which is structurally the same
defect as the route-over-the-true-grid alternative I rejected in the same document as "free map
information dressed as a pathfinding detail."

**Ruled: key on the count.** "You stop when there are more marks than there were" is checkable by
looking, so §4's promise needs no exception and §4 needs no amendment. The swap case is given up
deliberately — a player would walk on too, seeing one mark before and one after. The generalisation
worth carrying out of both mistakes is one line: **the simulation may not decide on information the
player does not have, and I twice reasoned from what the engine knows instead of from what the screen
shows.** The first time it invented machinery; the second it invented an oracle.

One happy consequence: keying on the count means clause 1 needs no new type. It is
`perceive(...).creatures.length` off the existing `TurnPerception`, which is precisely the line
`light.ts` deleted for want of an observer.

Also worth recording: **`game/core/command.ts` rule 3 and `game/core/replay.ts`'s bump
policy contradict each other** on whether adding a `Command` variant bumps `RULES_VERSION`. `command.ts`
says only if it changes what an existing log does (it does not); `replay.ts` — the canonical home per
ARCHITECTURE's *Versioning* section — lists any change to the set of variants. ADR-0009 rules that
`replay.ts` wins. Deliberately **not** filed as an issue and deliberately not fixed here: it is a
two-line edit that only becomes true inside the PR that adds the variant.

**Next:** #19 (presentation model in `render/`) is unblocked and is the only unblocked build issue.
#20 follows it and inherits exactly one constraint from this work: leave a tap on a distant tile
unbound, and make the tap handler able to produce a `Position`, not only a `Direction`.

**Watch:** The M1 playtester will cross known space by hand, up to about twenty tiles a floor. Two
ways that can mislead. The Pillar 1 autopilot count will include those steps, and that is *not* an
indictment of the level generator — §5 forbids corridors precisely so there are no autopilot turns,
and a mapped room crossed on the way back is a different animal; report the two separately. And
"tapping is tedious" is a loud finding that could crowd out the quiet one M1 exists to get, which is
whether the flash-and-crawl wager is the reason to play. **Both instructions are now in M1's exit
criteria in `ROADMAP.md`**, not only here — CLAUDE.md has each session read the roadmap and only the
last two or three journal entries, and by M1's exit this entry is out of that window. A third cost
went there too: `economy.test.ts`'s corpus models one-step play by a *tireless* script, and a
tap-fatigued playtester goes back for fewer caches, which is exactly the behaviour §4's third
invariant is calibrated on — so M1's fuel data matches neither the corpus nor travel-present play.

Two of the five stop clauses are **unreachable in M1 and stay anyway**, both flagged as such in the
ADR so nobody tries to test them into existence. The wake clause is subsumed by clause 1 (nothing
wakes shuttered; a creature woken by your light is also in your light). And **a travelling player
cannot be hit at all** — HP only falls when `resolveAttack` finds the player on the tile a creature
marked when it declared, that mark resolves one turn later at `ACTION_COST` 100, and travel moves the
player in phase 1 of every turn along a strictly-decreasing route. **Travel dodges by construction,
because it never stands still.** The HP clause is the backstop for the first damage source that is
not a one-turn-telegraphed attack on a tile.

Four sites become wrong the day `travel` lands and must not be touched before then, listed in
ADR-0009's Consequences. Three are comments; **the first is a red test.**
`game/core/replay.test.ts` asserts `turnsElapsed <= commandsResolved` over 120 generated records, and
travel is the first command for which that is false — one command, N turns. An unannounced failure
there reads as a determinism emergency, because ARCHITECTURE says a red `replay.test.ts` means stop
everything. The other three: `ARCHITECTURE.md`'s "`Command` is four variants and no more" (once, in
*Determinism, concretely* — an earlier draft of this entry said twice), `step.ts`'s contract point 6
("exhaustive for this build"), and the `command.ts`/`replay.ts` contradiction above.

## 2026-08-05 — `Perception` was two types; now it is `TurnPerception` and `LightQuery` (#36)

**Did:** Pure rename, no behaviour change, no `RULES_VERSION` bump. `game/fov/perceive.ts`'s
`Perception` (the *result* of perceiving: `{ terrain, creatures }`) is now **`TurnPerception`**;
`game/entities/perception.ts`'s `Perception` (the injected *question* `{ isPlayerLightVisibleFrom }`)
is now **`LightQuery`**, and that file is now `game/entities/contact.ts`. The aliasing import in
`game/systems/light.ts` (`type Perception as LightQuery`) is gone. Every parameter of the injected
query — in `behaviour.ts`, `actors.ts`, `combat.ts`, `scenario.ts` — is named `light` rather than
`perception`. The function `perceive` and the file `game/fov/perceive.ts` keep their names.

**Why:** #19 builds `render/`, the first module that genuinely wants to name both types in one file,
and an aliased import is a workaround that scales to exactly one consumer. `LightQuery` is the name
`light.ts` had already chosen for itself, and it makes `game/entities/`'s rule — light is injected,
there is no lighting model in here — legible from the type. `TurnPerception` says the thing a call
site cannot otherwise see: it is one turn's worth, recomputed every turn, never stored; the only
part that outlives the turn does so by being folded into `Vision.remembered`.

**`game/entities/perception.ts` → `contact.ts`, and `game/fov/perceive.ts` left alone.** The fov file
is named after the function it exports, which keeps its name, and that is this directory's
convention (`touch.ts`, `embersense.ts`, `shadowcast.ts`). The entities file, after the rename,
contained the word "perception" nowhere but in its own filename — a grep for the old confusion would
have landed on a file that no longer says it. `contact.ts` is what it is about: `hasContact` and the
one injected half of contact.

**Learned:** "the tests still pass" is not evidence of a pure rename, because a rename that changed
behaviour would still be internally consistent. It was established instead by hashing the **full
JSON of every intermediate `GameState`** — rng, floor grid, tile-set flags, actors, minds and all —
over a 64-run corpus (two scripted whole runs, two death runs, 60 generated logs) before and after,
and getting the same digest. The instrument was checked first by flipping `CINDER.attack` from 2 to
3 and watching the digest move: a comparison harness that cannot fail proves nothing.

**No digest value is quoted here, deliberately.** The harness was temporary and is not in the tree,
so the number has no producer — and the two reports of it disagreed, which is on its own enough to
disqualify it. A precise-looking figure nobody can re-derive is the failure the 2026-08-04 entry
records fixing, and it does not get to come back one entry later. What *is* reproducible, and what
was checked independently before this merged: `game/core/replay.test.ts` is not in the diff at all,
so its two pinned whole-run fixtures are ground truth recorded before the rename — and they
reproduce exactly, digests that cover rng words, creature positions, minds, embers, fuel and terrain
memory across a full run and a death. `RULES_VERSION` is untouched.

**Next:** #19 (`render/`) is unblocked and is the reason this was done now. #32 has a
`game-designer` ruling on the issue — **do not build auto-travel in M1** — which needs landing as an
ADR before #20 starts; #20 needs one constraint from it, not a feature.

## 2026-08-04 — Archivist: 175 lines of journal were filed into the template, and M0 never closed

**Did:** End-of-session reconciliation after #18 merged (`ce47f6f`). No code changed. Docs, ADRs and
the issue tracker were reconciled against the tree, and one long-running structural defect in this
file was repaired.

**The big one: every review addendum since PR #10 was written into the `## Format` template instead
of into its own entry.** 175 lines, seven PRs' worth, sitting inside the ```` ```markdown ```` fence
that is supposed to show a four-line entry skeleton. Mechanism, and it will recur: an agent
appending an addendum after its entry's `**Next:**` line matched **the first `**Next:**` in the
file**, which is the template's. Each PR then appended after the last one, so the block grew every
time and nobody noticed because the entries below still read fine.

Two costs, both real. `CLAUDE.md` tells every session to read this file first, so the first thing a
cold reader met was 175 lines of unrelated prose presented as a *format example* — and the entries
those addenda belonged to were silently incomplete. The map entry (#13) was missing its two applied
design rulings entirely.

**Repaired by moving each chunk verbatim to the end of its own entry**, not by rewriting or
summarising: `git blame` attributed each block to a commit, each commit to a PR, each PR to an
entry. Verified by comparing the non-blank lines of the old and new files as sorted multisets:
of the old file's 1,339 non-blank lines, **1,333 survive byte-identically with unchanged
multiplicity, and the 6 that do not are exactly the three disclosed corrections to #18's entry**
(the stale test count, the millisecond-threshold paragraph, the resolved `Watch` bullet). Nothing
was reworded in the move and nothing was duplicated. This is a relocation, not a history rewrite.

Both the count and the attribution were re-derived independently by the reviewer rather than taken
on trust — the attribution mattering more, because content preservation says nothing about whether
a chunk landed under the *right* entry, and an addendum filed under the wrong PR is worse than one
left in the template: it looks correct.

**Guard for next time:** when appending to an entry, anchor on text unique to *that entry*, never on
a `**Did:**`/`**Next:**`/`**Watch:**` label — those all appear in the template too.

**Two guards, and only one of them is worth much.** The `code-reviewer` agent now checks *where* an
entry landed rather than only what the hunk says. That is the right instruction and it would have
caught this — but it is the same class of defence that already failed seven times, because it works
exactly as long as someone chooses to read. So there is also a test in
`tests/unit/infrastructure.test.ts`. A structural check beats a diligent one, and the reviewer's
argument for writing it now was better than my reason for not: I had been about to file it as an
issue, which is where guards go to wait.

**The first version of that test had two demonstrated bypasses, which is the part worth recording.**
Both were found by the reviewer *walking past the guard*, not by reading it:

- It matched the first ```markdown fence **anywhere in the file**. Inserting an innocuous example
  fence into the prose above `## Format` made it pass green with the full 184-line corruption still
  sitting in the template. No leak-shape change needed — an ordinary documentation edit disarms it.
- Its content check listed the two labels that had actually leaked (`**Review addendum`,
  `**Design rulings`), so a novel one (`**Post-merge note:**`) walked straight through, and the
  ten-line cap had four lines of slack to hide a three-line addendum in.

The fix for the second is the general one and is worth stealing elsewhere: **assert the shape, not
the names.** Every non-blank line of a template is a `## ` heading or a `**Field:**` label, whereas
real entries are wrapped prose — so their *continuation* lines never start with `**`. That catches
any multi-line leak on its second line regardless of what opened it, and it would have caught the
historical one. The named-label check stays for its better failure message; it is just no longer the
thing doing the work. The section is now also found by walking lines with fence state, because the
template's own `## YYYY-MM-DD` heading is inside the fence and a naive "next `## `" search ends the
section in the middle of what it is checking. Verified against all four cases: clean file passes,
`main`'s real 184-line corruption fails by a factor of 15, the decoy-fence bypass fails, the
novel-label leak fails.

**Three factual errors in #18's entry, fixed rather than annotated.** It was written across three
rounds and the later rounds contradicted the earlier ones:

- "793 tests" — the suite is **796**; the review round added three and the `**Did:**` paragraph was
  never updated. Both the entry and PR #33's description carried the stale number.
- The `**Benchmarks:**` paragraph presented absolute millisecond thresholds as what the file
  asserts, and the paragraphs below it describe all three being converted to ratios. A skimmer would
  have taken the wrong one. Marked as a mid-PR measurement, with the three ratio constants named.
- A `**Watch:**` bullet said the GDD "asserts [safe arrival] as a guarantee and two sections lean on
  it" — but the same entry records the `game-designer` pass correcting §4 and §13 *in that PR*. An
  open item that had already been closed 200 lines above it.

**`docs/ROADMAP.md` was the worst-drifted doc in the repo** and said "Current milestone: M0" with
two M0 items unchecked, while M0 had been complete for eleven PRs. Rewritten against verified state.
Two findings worth more than the checkboxes:

- **A run can be won, and the roadmap had never said so.** GDD §13 settled it in #18 — take floor
  8's stairs. M1's goal and exit criterion both described only dying. Amended.
- **M1 absorbed three of M2's five bullets outright and most of a fourth** (#16 dormant behaviour,
  #14 light-dependent visibility, #17 fuel — whose economy is implemented and calibrated once, with
  the tuning still open). Flagged rather than corrected, because the absorption was right —
  the light wager *is* the turn loop — but the consequence is not free: **M2 can no longer be the
  cheap place we discover the concept does not work**, because the simulation is already committed.
  §12's fallback (strip fuel, keep the positional tactics) is still the escape hatch and is now named
  in M2's text.

**#20 and #21 were not unblocked, and that is the finding.** The brief assumed all three `blocked`
issues were waiting on #18. Only **#19** was: #20's own Context says it is blocked by the
presentation model, and #21 needs a screen to draw on. The real chain is **#19 → #20 → #21**, and
only #19 is startable today. #20 has a second, softer blocker in #32 — auto-travel's command shape
decides where the interrupt loop lives relative to the `game/` boundary, so deciding it after the
screen exists means building the screen twice.

**Wrote ADR-0008 (benchmark thresholds are ratios, not milliseconds).** The decision was made under
CI pressure during #18 and recorded only in a test-file header and in journal prose — nothing in
`docs/`. It is precisely the shape of thing a later session "simplifies" back, like `npm run lint`
in `CLAUDE.md`. Reconstructed while the reasoning was still recoverable, including the precondition
that makes the ratio estimator valid (each batch is N identical calls of a pure function, so a
regression is a pure scaling) and the case where it would **not** be — a benchmark stepping a
*sequence* of commands.

**Learned:** the drift that mattered was invisible to everyone who had been close to it. The
template corruption survived seven PRs and at least seven `code-reviewer` passes, because a
reviewer reads the diff — and each diff was a plausible-looking addendum being appended near the top
of a journal. Nobody re-read the file from line 1. That is an argument for this role existing, and
also an argument that "docs are updated in the same PR as the work" is necessary but not sufficient.

**Also fixed, smaller:** ADR-0007's index row said *Proposed* while the ADR itself says *Accepted*
and the journal records the owner accepting it (#8, closed). GDD §1 still said "VISION.md's
concept-seed wording needs the owner's sign-off" — it was signed off and VISION.md amended on
2026-07-30. `ARCHITECTURE.md`'s module map described `game/core/` as owning the rules when #18
deliberately made it thin, did not mention `systems/run.ts`, listed a `systems/` "status effects"
module that does not exist, and described `render/` and `platform/` in the present tense when
neither directory exists. Closed the M0 milestone on GitHub (0 open issues since #18's predecessors
landed). Filed **#36** for the two colliding `Perception` types — a "Watch" note carried across
three entries and never tracked, and cheapest to fix *before* #19 builds the first module that wants
both names.

**Next:** #19 is the only startable M1 issue. #36 before it if anyone wants a five-minute win, since
`render/` is the first consumer that will want both `Perception` types in one file. #32 needs a
decision before #20 starts.

**Watch:**
- **`docs/` dates are ahead of `git`.** Journal entries and GDD change-log rows run 2026-07-29 →
  2026-08-04; every commit in the repo is dated 2026-07-29 or 2026-07-30. #18 is dated 2026-08-03 in
  the journal and 2026-08-04 in the GDD change log — the same PR. Left alone deliberately: the dates
  order the record correctly relative to each other, and rewriting them would be a history rewrite
  for no gain. Do not use a journal date to find a commit.
- **`RunRecord.version` is 2 and there is no fixture from version 1.** Bumping is documented and
  routine; just know that cross-version inspection has only `runCommands()` and no stored counterpart
  to compare against.
- **M3 and M4 now exist as GitHub milestones**, created in this session so that deferred work has
  somewhere to live rather than surviving only as a line in a doc — a milestone-less issue is the one
  that gets forgotten, which is how #36 spent three entries as a Watch note. #34 is filed under M4.

## 2026-08-03 — The real `GameState`, the real `Command`, and a run you can win (#18)

**Did:** Joined every finished subsystem into the real `step()`. The M0 scaffolding — the
`wait | roll` union, `lastOutcome`, `NO_OUTCOME` — is **deleted**, not left alongside. `GameState`
is now `game/systems/`' `LanternWorld` (the floor, everyone on it, the lantern) plus four run-level
fields: `status`, two counters, and the generator. `RULES_VERSION` → 2, fixtures re-recorded. 796
tests, 44 files.

`game/core/` got **thinner**, which was the design constraint. Every rule the reducer needs is a
call into `game/systems/`: `moveCommand`/`waitCommand`/`setShutterCommand` and a new
`game/systems/run.ts` for what spans floors (`beginRun`, `arriveOnFloor`, `isOnStairs`,
`descendTurn`). `step()` validates, refuses, picks a `TurnCost`, and folds
`lanternPhases(cost, phase)`. The only thing it owns that nothing else does is the generator and
the ending.

**Four variants, and two of them are subtractions.** `move | wait | setShutter | descend`. There is
no `attack`: §3 settled bump-to-attack, so a separate command reintroduces the mode §3 removed and
buys nothing, because player attacks resolve against what is there *now*. And it is
`setShutter(to)` rather than `toggleShutter` — **a determinism argument, not a taste one**: a
toggle's meaning depends on prior state, so a stored log with one command dropped silently inverts
the shutter for the rest of the run instead of failing, and at 0 fuel a toggle is the identity, so
a refused open is invisible in the log.

**The counters had to be split, and that is the amendment to the step contract.** Point 5 said
"turn increases by one on every call, without exception" and is now false three ways — free
actions, refusals, and commands after the run ends. It is two fields:

- `commandsResolved` increments on every call that is not a refusal, free actions included. It is
  the replay's cross-check on its own position.
- `turnsElapsed` increments per resolved command that costs a turn. It is what a player retells and
  what #21's summary screen shows.

**A refusal returns the input state itself** — the same reference, not a copy. Byte-identity is the
property and reference identity is the only implementation of it that cannot rot. The consequence
that makes the replay suite work: *a state identical to its predecessor means the command was
refused*, so `commandsResolved` can be cross-checked against a structural walk of the run. That
holds only because `commandsResolved` also increments on the one resolved command that otherwise
changes nothing — `setShutter('open')` on a dry lantern, which §4 says is a legal no-op. Without
that counter, a resolved free action would be byte-identical to a refusal and the cross-check would
be false.

**The draw-count contract is now floor-shaped.** `descend` is the only command that draws, and
`createInitialState` draws before the first command (it generates floor 1). So a log's budget is
`expectedDrawCount(1)` plus `expectedDrawCount(n + 1)` for each descent resolved on floor `n` — it
is a function of *the floors the run visited*, not of the command list, and `replay.test.ts` walks
the run to compute it. That is not circular: the computation never touches `rng`, so a stray draw
anywhere shows up as a mismatch.

**The property generator had to be steered, and that is the interesting test problem.** A log of
random commands never descends — the stairs are one tile in 165 — so the `descend` arm would always
be a refusal and the draw-budget property would be asserting that nothing ever drew. The generator
therefore *plays*: half chaos (which produces the refusals and the wasted flashes), half a step
along a route to the stairs. Measured over 120 cases: 3,544 commands, 72 descents reaching floor 3,
598 refusals, 362 free actions, 3 deaths. Those numbers are asserted, because a generator that
quietly stopped descending would leave the whole file green. (Two of them were *not* asserted when
this was first written, and the review caught it — see the addendum.)

**§13's stop-on-death was not already there, contrary to the design note's guess.** `runActorPhase`
swept to completion regardless, so a player killed by the first of three due Cinders watched the
other two take their turns and then phases 5 and 6 tidied up around the corpse. It needed a `halt`
predicate on `runActorPhase` (required, not defaulted — "keep going" is a rules answer and that file
has no rules in it) and an `unlessTheRunEnded` guard on phases 5 and 6. The observable is the clock:
on the turn the player dies, `schedule.now` does not advance.

**`createVision` now starts at `ADAPTATION_FLOOR`, not `EMBER_SENSE_RADIUS`.** §4's "full adaptation
is always earned". Changing the constructor rather than overriding it at the start-of-run call site
is what closes the door on the next start-state reintroducing the gift. It moved five existing tests
and, notably, nothing in the economy suite: the stalker now spends four turns adapting before its
first flash on each floor, which is what §4 says it should always have been doing.

**A measured contradiction in the GDD, reported not coded around.** §4 and §13 both claim the
opening flash is safe *by construction* — "§5 step 7 puts no creature in the entrance room, so
phase 3 lights a room that is guaranteed empty". The premise is true and the conclusion does not
follow: §5's exclusion is about *rooms*, and the lit field is Chebyshev 4 **with line of sight**,
which runs through a doorway. **Measured over 480 generated floors: 97 of them (20%) wake at least
one creature on arrival.** §4's vision table is not negotiable and a first-turn exemption would be a
fifth vision state invented by an implementation, so the code does the table and
`game/systems/run.test.ts` asserts the honest property (everything awake is something the light
actually reached). The GDD sentence is what needed correcting, and a `game-designer` pass did it in
this PR rather than leaving it for later.

**The ruling survived its broken justification, and the named false step is worth keeping.** The
designer had read a **room** exclusion as a **light** exclusion: §5 step 7 constrains where a
creature may *stand* and says nothing about what is *visible*, and the two facts sat three sections
apart. Start-open stands on its other two reasons — and reason 2 is *strengthened*, because now that
the lit opening is known to cost something one time in five, the shuttered opening is the only
guaranteed-safe one on offer, which makes the four-turn wait-and-adapt ritual more attractive rather
than less. The 20% case was kept deliberately: a guaranteed-safe arrival makes the stairs a reset
button and the descent a formality, and it is what gives the shutter-carries-across-the-stairs
ruling a mechanism instead of a tidiness argument. §4 gained the clause it had always been missing —
containment ("everything a flash can wake, you can already feel") holds only on a floor you have
already felt, and **arrival is a third exception alongside the adaptation ramp and an open
shutter**. What replaces it on arrival is spatial: *you never arrive on top of something; you
sometimes arrive in sight of something.*

**Mutation testing: 54 mutants, 53 killed, 1 documented equivalent.** The killed set includes every
rule this PR is about — refusals resolving, a refusal copying state after a draw, a free action
counting a turn, `commandsResolved` frozen, floor 9 being generated, `canMove` used where `canBump`
belongs (which would make walking into a Cinder a free no-op and delete bump-to-attack), a
re-asserted shutter resolving, descend legal anywhere, a finished run still accepting commands,
death never recorded, the map crossing the stairs, the ramp resetting on descent, the arriving
player not charged, the sweep never halting, and phases 5 and 6 running after the run ended.

Three survived the first pass and two were real gaps: `DIRECTIONS`/`SHUTTER_STATES` had `.sort()`
with no test behind it (`COMMAND_KINDS` had one, and that is exactly how the asymmetry arose), and
`worldOf` could have spread the whole state — which compiles, passes every behavioural test because
the extra fields are dropped on the way back, and quietly makes `game/systems/` able to read `rng`.
Both now have tests. The third — building `moveCommand`'s light query from the charged state rather
than the pre-charge one — is provably equivalent (`lanternLight` does not read the schedule) and is
written down at the site alongside this file's other documented equivalents.

**Benchmarks:** `descend` — the only command that generates a floor *and* runs six phases — costs
0.45ms against ARCHITECTURE's 2ms; an ordinary lit turn 0.015ms; a refusal 0.0001ms. The refusal is
a real assertion and not vanity: a refused descent that generated a floor before throwing it away
would be ~0.3ms *and* a replay-breaking draw, and this is the cheapest place to notice it.
(Written mid-PR. **All three thresholds ended the PR as ratios, not milliseconds** — the paragraphs
below are what happened to each, and `step.bench.test.ts` today asserts only
`DESCENT_RATIO_LIMIT`, `LIT_TURN_RATIO_LIMIT` and `REFUSAL_RATIO_LIMIT`. The figures above are
measurements from this machine, not limits anything checks.)

**The descent benchmark then failed on CI at 1.72ms and had to be rewritten, which the file's own
header asks be written down here rather than fixed with a bigger number.** The runner is ~4x slower
than this machine; nothing regressed. Raising the threshold until CI passed would have set it by
whichever machine happened to be slowest, and against a 2ms budget there was no headroom to raise it
into. So the descent is now measured **as a ratio to a bare `generateFloor` taken in the same
process** — which divides the machine out and means the same thing on a laptop, a runner and a
phone. It measures **1.06-1.09x**: generating the floor is ~92% of a descent and the six phases are
noise. The limit is 1.6x, and it was verified by planting a second `generateFloor` in `step` — 2.07x,
red. The absolute milliseconds are still printed on every run, so a genuine slowdown shows up in the
CI log even when nothing fails.

Worth knowing for later: **on CI-class hardware a descent takes 1.72ms of ARCHITECTURE's 2ms
per-turn budget**, essentially all of it, and a phone is not obviously faster than a GitHub runner.
The cost is level generation, not the turn. Filed as #34 — it is a real number to watch when M4 does
the native pass, not a problem today.

**Learned:** a mutant killed by the test runner *timing out* is a survivor wearing a red X. The
"descend regenerates the same floor number" mutant made `diveToTheBottom`'s outer loop descend
forever; the harness recorded a non-zero exit and called it dead. The fix is in the harness script
under test — the dive is now bounded on floors as well as on turns within a floor, and throws with
a message naming the rule. Any scripted-play helper wants both bounds for the same reason.

**Next:** #21 (the run loop and summary screen) and the `render/`-layer work now have a real
`GameState` to read. Two things they should know: `floorNumberOf(state)` is derived from the floor
rather than stored, and the terminal state is a *snapshot of the moment the run ended*, not a tidied
world — so a summary's counters must be accumulated as they happen rather than derived from it
afterwards (§13 says so explicitly).

**Watch:**
- **Arriving lit wakes something 20% of the time.** Not a bug, and not a balance problem — arriving
  into a room whose doorway shows a Cinder is legible and, arguably, the system working. *(Written
  before the fix. The rest of this bullet said the GDD still asserted safety as a guarantee and that
  two sections leaned on it; the `game-designer` pass later in this same PR corrected §4 and §13 and
  added the 2026-08-04 change-log row, so the doc and the code now agree. Kept as a standing fact
  about the game, not as an open item.)*
- `standUntilDead('grave')` is the death fixture, and most seeds do **not** die: the lantern runs
  dry after 20 lit turns, everything goes dark, and the Cinders re-dormant after eight turns of no
  contact. The helper throws if its seed stops dying, which is the signal you want, but it means the
  death path rests on one seed's geometry.
- A refusal returns its input **by reference**. `purity.test.ts`'s "produces a fresh state object
  every call" had to become "for every command it resolves", and anything that assumes `step`
  always allocates will be wrong.
- `game/fov/` and `game/entities/` still both export a type called `Perception`, meaning different
  things. Untouched here; still an improvement waiting to be made.

**Review addendum:** the reviewer found the sixth check-that-enforces-nothing in six PRs, and this
time it was in the test whose entire stated job is to prove the other tests are not vacuous — **the
corpus tallies were accumulated and never asserted.** `deaths` and `wins` fed nothing but a
`console.log` the default reporter does not print, so `deaths = 0; wins = 0;` inserted before that
log left all 24 tests green. Worse than the gap: **this entry and the PR description both claimed
those counts were asserted.** The claim is what made the thin 3-in-120 death margin acceptable —
the reviewer's ruling on the single-seed death fixture was "accept, *because* the corpus is the
other leg of it" — so an unasserted tally was quietly holding up a decision made on its strength.
Fixed, and three robust combat tallies added beside it with 40-75% margins (runs that woke a
creature 89/120, runs where the player took a hit 57/120, runs that dropped an ember 47/120), so
the loud alarm is not the same number as the thin one.

Deliberately *not* fixed by steering the generator toward deaths: a death needs the **floor** to
have spawned a creature within reach of the entrance, which is a property of generation rather than
of the command log, so no amount of command steering makes it reliable without curating seeds — and
curating seeds would stop the corpus being arbitrary and silently narrow every property in the file.
`standUntilDead` throws "did not produce a death" on 26 of 30 arbitrary seeds, which is the
measurement behind that call.

**Second blocking finding, and it is the same shape: a test named for the bug it could not catch.**
`'leaves the map behind: a fresh, empty, correctly sized memory'` stayed green when
`arriveOnFloor` was mutated to carry `remembered` across the stairs. Two independent reasons, both
worth remembering because they will recur: every generated grid is 11×15, so a *sizing* assertion
cannot fail while all floors are the same shape; and the freshness assertion was `arrived <= before`
against a fixture that arrives from a **shuttered** dive, where the new floor's 9-tile touch field
is already a subset of the carried mask, so the union never grows. It now asserts equality against
the new floor's own field, spelled out from §4's table for both arrival states, and a new
`run.test.ts` case gives the sizing claim a floor that is genuinely not 11×15 so it can fail
somewhere.

**The version-2 fixture pinned half the simulation.** Probed across all 18 states: no creature ever
woke, `embers` was empty throughout, the player never lost HP. So `RULES_VERSION` — whose entire
purpose is to notice that the rules changed — was pinning generation, movement, fuel, the shutter,
descent and a cache, and nothing at all about waking, declaration, damage, the dormant strike,
ember drops, re-dormancy or death. A second fixture now walks that whole loop (wake → shutter →
retreat → re-dormancy at `turnsSinceContact` 8 → dormant strike → ember → collection → reopen →
six landed attacks → death with the clock frozen), and the digest widened from a creature *count*
to the creature list — position, HP, and the whole `Mind`. The decisive measurement: reversing spawn
order in `createActorWorld` is caught by the new fixtures, and **survives** if the digest is
narrowed back to the old count. Widening it bought real coverage rather than more bytes.

**The benchmark went absolute → ratio → interleaved, and each step was forced by a measurement.**
The absolute threshold failed on CI at 1.72ms (a ~4x slower box). The ratio against a bare
generation fixed that and then produced `0.69x` on CI — a descent measuring *cheaper* than the
generation it contains, which is not physically possible and meant the yardstick had been
mismeasured by ~4.5x, because it ran second and inherited the descent loop's garbage. **That run
passed**, which is the part worth internalising: a benchmark can go green because its instrument
failed. Now the batches interleave and swap order every round, an impossible reading fails loudly
instead of flatteringly, and each threshold was calibrated by planting the regression it exists to
catch. The last absolute assertion in the file — the refusal, at 0.01ms — then flaked at ~9% under
the full suite while measuring a 160x margin in isolation, which is the same lesson a third time:
**in-isolation headroom says nothing about a 44-file parallel run.**

And measuring *that* properly showed the two ratios were flaking too — 4 failures in 30 full-suite
runs, none in 30 single-file runs. The bias is not random and does not cancel across interleaved
batches: in each pair the subject has the larger working set, so a neighbouring worker evicting the
cache costs it more than the yardstick. Neither limit was raised. The estimator was fixed instead,
in measured steps: median-of-series (4 failures) → minimum-of-series (0 failures, but it reports
*physically impossible* 0.82x descents, because the two minima come from different rounds) →
**median of per-round ratios, keeping only rounds where neither batch ran more than 1.25x above the
cheapest batch of its own series.** That filter never looks at the ratio, so it cannot prefer a
round for agreeing with the threshold, and interference only ever adds time — so "near its own
minimum" is an independent test of cleanliness. 30 full-suite runs, 0 failures, 0 discards. The
refusal batch was also 500 calls ≈ 0.035ms of wall time against millisecond-scale steals, so one
steal was a ~500x per-call error; it is 2.1ms now, like every other batch.

The file now carries the standing instruction in its header: **calibrate against `npm test`, never
against this file alone.** Three thresholds in its short history were set from isolated figures and
all three flaked.

The reviewer then attacked the estimator and found the *justification* wrong while the behaviour was
right, which is worth recording because the correct argument is more useful than the one it
replaced. "The filter never looks at the ratio, so it cannot prefer a round for agreeing with the
threshold" does not follow: keeping only rounds within 1.25x of each series' own minimum confines
every kept ratio to ±25% of `min(s)/min(y)` — which is estimator #2, the one this file rejects three
paragraphs earlier as biased. Form-blindness is not independence. What actually holds is **scale
invariance**: both predicates are homogeneous of degree 1 in their own series, so scaling every
subject batch by a constant leaves the kept set identical and scales every kept ratio by exactly
that constant. A regression here *is* such a scaling, because each subject is N identical calls of a
pure function on a frozen `(state, command)` and per-call cost cannot vary between batches. So the
filter provably cannot mask one. The precondition is the part worth carrying forward: that argument
fails for a subject whose per-call cost genuinely varies — a future benchmark that steps a
*sequence* of commands rather than repeating one.

The same round made a degraded reading retry rather than pass quietly, **and the retry immediately
found two defects in the harness that nothing else had noticed**: it fired on 21 of 30 whole-suite
runs, always on the descent. The floor batch was 5 calls (~2.1ms), small enough that a minor GC
landing in one half of a pair was a large fraction of it — and one-sidedly, since the subject
allocates more, which pushed readings as low as 0.845x against a 0.8x containment floor. And warmup
was 3 rounds, so the descent comparison began on a heap full of `atTheStairs`' seven-floor dive.
12 calls and 8 rounds: retries 21/30 → 3/30, degraded readings surviving all attempts 0/30, and the
lit turn's margin *improved* without any threshold moving. A retry that fires constantly is
diagnostic output, not a nuisance.

Also from the review, all applied: the GDD's §2 refusal table was written as exhaustive at three
rows while the implementation refuses a fourth (`setShutter` to the setting already held) — the rule
lived only in a reducer comment, which is the shape this PR spent its whole effort avoiding, so it
is now a table row, a justification paragraph and a change-log row. `arriveOnFloor` passed
`previous.lantern.fuel` into `createLanternWorld` and then discarded the lantern it built; the
argument is now load-bearing rather than decorative. A comment claiming `turnsElapsed` and
`schedule.now` must agree was false in three ways and would eventually have been enforced as an
invariant. And two `divergence.test.ts` pins that had loosened to `/^(lantern|rng|world)\b/` and
`\w+` — each of which matches most of what it could be asked about — are tight again.

Filed rather than widened into this PR: **#34** (a descent is 1.7ms of the 2ms turn budget on
CI-class hardware, and the cost is the generator, not the turn), **#35** (nothing catches `litQuery`
recomputing the lit field per call — the mutation measures 4.75x against a 5x limit and passes,
because the benchmark's floor has too few creatures for it to be expensive), and **#32**
(auto-travel's command shape, which is a determinism question rather than a UI one).

## 2026-08-02 — Fuel, the shutter, and the light economy (#17)

**Did:** Built the fuel half of GDD §4 — `game/systems/lantern.ts` (fuel, the shutter transitions,
the 0-fuel rule), `game/systems/light.ts` (the real `Perception`, and five of §2's six phases), and
`game/content/lantern.ts` (the tuning numbers). 90 new tests, 712 total. **Two tuning numbers moved
and are recorded in the GDD change log**; see below, because that is the substantive part of this
entry.

The three seams other PRs left open are now joined: `game/entities/`'s injected light query has a
real implementation, `game/systems/turn.ts`'s phase sketch is a real `lanternPhases(cost, command)`,
and #18 is left with exactly one phase to supply — the player's command.

**The real `Perception` is the player's lit field read backwards, and that only works because the
shadowcaster is symmetric.** `game/entities/` asks "is the player's light visible *from this tile*",
which is a creature's-eye question; `computeLitField` answers a player's-eye one. Those are the same
set if and only if visibility is symmetric — which is exactly why #14 chose Albert Ford's symmetric
variant over the classic Bergström one, and it is the difference between correct code and the bug
this journal's own format uses as its example ("enemies could see the player through walls the
player couldn't see through"). It is now asserted from *this* side of the seam too: every ordered
pair of passable tiles on six generated floors, both directions, ~14,000 pairs, plus a positive
count so a query that answered `false` everywhere cannot pass by being trivially symmetric.

**Two numbers moved, and the reason is the whole point of the issue.** §4's third invariant is "a
floor played well nets **slightly** positive fuel". At the GDD's original numbers — Cinder 30, cache
40 — a scripted competent run netted **+85 fuel a floor** against a starting reserve of 80. One good
floor bought the next two; the lantern stopped being a resource somewhere on floor one. That is the
trivially-winnable economy the issue warned about, and no amount of "fuel is never negative" testing
would have found it.

**Cinder 30 → 20 and cache 40 → 25.** They moved *together* on purpose so a cache stays worth ~1.25
kills (it was 1.33): shrinking only the drop would have made exploration the income side of the
economy and combat the garnish, inverting §1's "fuel comes from kills". At the new numbers the same
corpus nets +11 a floor at an income/spend ratio of 1.10, about one floor in five is a net loss, and
a competent eight-floor run ends with roughly twice the reserve it started with rather than five
times. The burn pair (4/1) deliberately did **not** move: §4's prose is written in terms of that
ratio ("dark is four times cheaper for travelling", "light is roughly three times cheaper in fuel"),
and rescaling income was the change that leaves every sentence in §4 true.

**How the economy suite is built, because "fuel never goes negative" tests nothing.** Every
assertion is a *difference between play styles*, arranged as a 2×2 that varies two things
independently — whether the script fights, and how it works the shutter:

|              | flashes and shutters | holds the shutter open |
| ---          | ---                  | ---                    |
| **fights**   | `STALKER`            | `FLOODLIT`             |
| **pacifist** | `PACIFIST`           | `FLOODLIT_PACIFIST`    |

`STALKER` vs `PACIFIST` isolates combat; `STALKER` vs `FLOODLIT` isolates light. In an economy where
nothing meaningful is ever spent or earned all four cells are identical, and every comparison fails.
The measured corpus: a pacifist's lantern dies on floor 1-3 on **every** seed; the floodlit pacifist
dies after 99 turns against the flashing pacifist's 144 and the never-flashing one's 206 — monotone
in how much light the style buys, which is invariant 2's actual shape rather than one comparison
that could hold by accident; and a floodlit *fighter* still runs dry despite taking every kill and
every cache on the floor.

The scripts route only over `vision.remembered` and only see creatures through `perceive`, so an
unexplored floor genuinely has to be explored at the touch radius if unlit. Two liberties, both
marked in the source: the player does not die (the claim under test is fuel, and if the floodlit
style died first "runs dry faster" would be unmeasurable), and the harness does the descending,
since floor transitions are #18's.

**Two harness bugs found by looking at the output rather than at the assertions**, both of which
would have made the suite lie: the "pacifist" was killing four creatures a floor, because its route
stepped onto occupied tiles and `bump` resolves that as an attack; and the "flash" policy never
closed the shutter, because it waited for the unknown-tile count near the player to reach zero and
tiles behind walls never become known — so the stalker was silently a second floodlit style. Neither
was visible in a pass/fail; both were obvious in a printed tally.

**A measurement trap worth remembering: a clamped meter reads as break-even.** `spend` measured as
"income minus the change in fuel" is exact, but a style that spends a whole floor at zero fuel burns
less than its rate, so income and spend come out equal and the floor reports a net of exactly 0.
That made the pacifist's median net read 0 — a *break-even* floor — when it is a floor the player
could not pay for. The suite now measures **demand** (the burn rate summed over the commands,
ignoring the clamp) and asserts, as the instrument's own test, that demand equals spend on every
floor that never ran dry and is strictly greater on floors that did.

**Four design readings, all read off the GDD rather than chosen, and all flagged for the designer.**
The sharpest is which phases a free action runs. `turn.ts` settled phase 4 and left fuel and dark
adaptation to this issue:

- **Fuel burns on a free action.** §4's exploration arithmetic is priced in it — "a flash buys a
  room ... for 4 fuel ... light is roughly three times cheaper in fuel ... neither dominates, and
  the reason is arithmetic rather than a special rule". If a flash were free, light would be
  *infinitely* cheaper than touch and would simply dominate exploring. This is not the fuel *tax*
  §4 rules out: there is no surcharge for toggling, the lantern just burns at the rate it is set to.
- **Dark adaptation does not.** §4 recovers ember-sense "+1 per *turn*", and a free action is not a
  turn; if it ticked, `shutter → toggle → toggle` would buy ramp progress without spending turns.
- **Lighting and waking does**, non-negotiably: opening the shutter wakes the room *immediately*.
- **A dry lantern is the shuttered column of §4's table, permanently** — not a fifth vision state.
  Ember-sense is the player's dark-adapted eyes, not the lamp. The alternative reading (sense dies
  with the fuel) makes 0 fuel unrecoverable in practice, which is the "unplayable rather than
  desperate" failure §4 exists to prevent. A whole eight-floor run starting from an empty lantern
  reaches the stairs on **80/80** floors, still kills things, and earns its way back above zero.

There is a residual tension in §4 worth a designer's eye: with a free toggle that burns fuel, a
flash costs its 4 fuel but costs **no turn**, so §4's "light is ten times cheaper in *turns* for
exploring" is really "infinitely cheaper". The fuel half of that sentence — the half §4 says the
balance rests on — is preserved exactly. Flagged, not decided.

**Mutation testing: 35 mutants, 33 killed, 2 survivors, both provably equivalent and documented at
the site.** The killed set includes every rule that matters: light costing the shuttered rate, fuel
not clamping, running dry leaving the shutter open, a dry lantern that can be opened, income doing
nothing, light leaking through a closed shutter, the lit query transposed, nothing ever waking, a
free action that burns no fuel / ticks adaptation / runs the actor phase, the toggle costing a turn,
a cache that never stops being a cache, and a cache tile index transposed.

One survivor was a **real gap**: replacing the light query given to the *actor* phase with a
permanently-dark one left the whole suite green. Phase 3 wakes creatures with the correct query, so
the first declaration looked right and every declaration after it silently behaved as though the
shutter were shut — which deletes §6's "the Cinder is drawn to light" one turn after it wakes.
`turnsSinceContact` is the observable, and it now has a test with the shuttered contrast beside it.

Another survivor was resolved by **deleting code rather than adding a test**: `lightingAndWakingPhase`
was computing the living-creature list to hand to `perceive`, whose creature half nothing in the
simulation reads (it is the renderer's, recomputed there). Filtering it by `isAlive` or not made no
difference to anything, because there was no observable to make a difference to. An unkillable line
is a line that should not exist; `perceive` is now handed an empty list and the comment says why.

The two remaining survivors are argued equivalent and written down at the site so a later run does
not re-investigate: phase 3 building its light query from the pre-`remember` lantern (the two differ
only in `remembered`, which the query does not read), and phase 5 collecting before resolving deaths
(a creature dies on its own tile and two living actors never share one, so an ember dropped this
turn can never be under the player this turn).

**Benchmark: 0.0144ms for a lit turn on a floor of six awake creatures, against ARCHITECTURE's 2ms.**
A turn now computes two or three lit fields — phase 3 for terrain memory, phase 3 again for the
waking query, phase 4 so creatures declare against the lighting phase 3 just recomputed. Recomputing
rather than threading one field through is a correctness choice (each phase must see the lighting as
it stands *at that phase*), and it costs nothing worth having. Threshold set at 0.2ms, a tenth of
the budget, deliberately: a threshold a fifty-fold regression satisfies enforces nothing.

**Learned:** rewriting files with Python's default text mode on Windows silently converts them to
CRLF, which broke half of the second mutation run — every multi-line pattern stopped matching and
was reported as `SKIP`, not as a survivor. It was visible only because the skip count changed. If a
mutation harness starts skipping, that is a harness failure and not a smaller mutant set.

**Next:** #18 wires this into `GameState` and `step()`. It needs to supply exactly one phase:
`resolveTurn(state, lanternPhases(cost, command))`, with `TurnCost` stated rather than inferred. The
shutter is already whole — `toggleShutterTurn(state)` takes no cost parameter to get wrong. #18 also
has to answer which way the shutter starts a run (§4 does not say, and `createLantern` refuses to
guess) and bump `RULES_VERSION`, since embedding any of this in `GameState` is the first change that
alters what an existing replay does.

**Watch:**
- The economy numbers rest on scripted play, not on a human. The scripts are honest about what they
  know but they are not optimal, and a `playtester` run in M2 is what should confirm or move the
  numbers next. The thresholds are relative (to the starting reserve, to what the floor cost) so a
  retune of the burn rates does not silently invalidate them.
- The stalker crosses a floor in ~75 turns against §5's "~40-70". It also hunts every creature on
  the floor, which §5's estimate does not assume, so the band in the test is widened at the top
  rather than the estimate being treated as wrong. Worth a look if pacing ever feels slow.
- Collecting a cache rewrites the floor's grid tile to `floor` and drops it from `floor.caches`.
  That is the first thing in the codebase to mutate a generated `Floor` during a run, and
  `map/floor.ts`'s header says a `Floor` "stays valid however the run goes" — it still does, but it
  is no longer constant. The alternative (a run-level list of taken caches) was rejected as a second
  source of truth about what is on a tile.
- `game/fov/` and `game/entities/` both export a type called `Perception` and they mean different
  things. `light.ts` imports one of them aliased. A rename would be an improvement and is not this
  PR's to make.

**Review addendum:** two blocking findings, and the first rhymes exactly with the FOV suite's
square grids.

**Phase 4's light query was not pinned to the player's position.** The test written in this PR to
kill the permanently-dark mutant uses `scenario()`, which sets `floor.entrance` to the `@` glyph —
so `floor.entrance === playerOf(world).at` in every ascii fixture, and the player never moved
during it. A phase-4 query built from `floor.entrance` instead of the player therefore passed all
712 tests while genuinely changing behaviour (the economy log moved from `floodlit 99` to
`floodlit 62`, so it was not an equivalent mutant). The new test walks the player two tiles off the
entrance before the creature re-declares. **Note it took two attempts:** the first version asserted
after the creature merely *woke*, which happens in phase 3 and uses the correct query in both
versions — the discriminating assertion has to come after a phase-4 *declaration*.

**The corpus documentation asserted the opposite of what the corpus does.** `DARK_PACIFIST` is
described as finding no caches "because caches need light". Measured: it collects 119 of 121, and
cache fuel is its entire income. §4 says caches require light to find and its vision table marks
items invisible while shuttered — neither is enforced. `collectFuelUnderfoot` pays on tile kind,
and a shuttered crawler's Chebyshev-1 touch field maps the whole floor. Filed as #31 with the
design question first, since "requires light to find" has three defensible readings.

That one is worth remembering for its shape: the numbers moved in this PR were calibrated against a
model whose *stated* assumptions were false. The invariants still hold in direction — enforcing the
rule makes a pacifist dry sooner — but the calibration rests on ~37 fuel/floor of income that a
style §4 says should have none, so both numbers need re-deriving when #31 lands.

Also corrected: `driedAfterTurns` was labelled "turns before the lantern died" but is turns through
the *end* of the drying floor, and four of ten floodlit-pacifist floors hit the turn cap — censored
rather than measured. The reported 99/144/206 ordering survives (proved by `FUEL_BURN_LIT = 1`
turning it red), but the true gap is wider than those numbers suggest.

## 2026-08-01 — `game/fov/`: symmetric shadowcasting, touch, ember-sense, dark adaptation (#14)

**Did:** Built `game/fov/` — the whole of GDD §4's vision table. Eight modules, 152 new tests
(512 total). Not wired into `GameState`; that is #18, and it is an outcome-changing change that
needs a `RULES_VERSION` bump. Also fixed the two comments in `map/grid.ts` that #25 invalidated.

The surface: `perceive(grid, vision, at, creaturePositions)` returns the terrain field and the
creature list for one turn, dispatching on the shutter; `Vision` holds the three things that
survive a turn (shutter, current sense radius, remembered terrain) and its transitions are
`closeShutter` / `openShutter` / `adaptVision` / `remember`.

**The shadowcasting variant matters and it is not the usual one.** This is Albert Ford's
**symmetric** recursive shadowcasting, not the classic Björn Bergström variant most roguelikes
ship. They differ in one line — whether a floor tile is revealed because the scan reached it, or
only when its *centre* lies inside the wedge — and that line is the difference between an FOV that
is symmetric and one that is not. The classic variant is asymmetric around wall corners, which is
exactly the bug this repo's own journal format warns about: a creature seeing the player through a
wall the player cannot see through. Symmetry is now a property test over every passable pair on
twelve generated floors, and it passed first time, which is the evidence that picking the variant
was the right move rather than patching afterwards.

Cost of symmetry: a few tiles behind a corner that a "generous" FOV would light stay dark. Correct
trade — §4's promise is that the player can state the rule.

**Chebyshev falls out; there is no radius check anywhere.** A wedge scan's `depth` *is* the major
axis and every tile in a row has `|column| <= depth`, so `depth <= radius` **is**
`max(|dx|,|dy|) <= radius`. The #25 ruling predicted this and it held exactly. Anyone adding a
`chebyshevDistance(...) <= radius` to `shadowcast.ts` is either writing dead code or quietly
turning the square into a disc.

**Slopes are exact fractions, not floats.** IEEE-754 doubles would have been deterministic (so
replays would still reproduce), but every comparison in shadowcasting sits *on* a wedge boundary —
all slopes have the form `(2c-1)/2d` — so rounding decides visibility at exactly the tiles that
matter. Comparing `num/den` pairs by cross-multiplication keeps it exact with integers under a
thousand. The lit shape is the one the geometry says it is, not the one the rounding picked.

**Ember-sense is separated structurally, not by comment.** Two defences, because "keep them
separate" is the rule most likely to be lost to a future tidy-up: `senseCreatures(origin, radius,
creatures)` **takes no grid**, so it physically cannot consult a wall — the wall-piercing rule is a
property of the signature; and a test reads `embersense.ts` and fails if it ever imports
`shadowcast`, `light`, or mentions `blocksLight`.

**Containment is property-tested in both directions, which is the point.** "When `senseRadius >= 4`,
every lit tile is inside the sensed region" holds from every standable tile of ten generated
floors (>1000 origins), *and* is genuinely violated at radius 1, 2 and 3 for more than half of
them. Testing only the first half would have passed just as well if the adaptation ramp had been
deleted. There is also a version stated the way the player feels it: every creature a flash could
wake was already in the felt list.

**Learned — mutation testing, 51 breaks, 49 killed, and the two survivors are both provably
equivalent.** Four survived the first pass and three were real gaps:

- *Walls are revealed even when the wedge only clips them* was asserted nowhere. The room pictures
  all had wall centres inside the wedge, so the mutation stayed green. Without that rule the
  boundary of a lit region is a ragged edge of half-drawn walls and a room stops reading as a room.
  Now pinned on a tile reached through a doorway aperture whose centre is outside the cone.
- *Seen creatures were not sorted.* The order-independence test only exercised the shuttered path.
  Not a determinism bug in itself — both runs agree — but the entity layer will hand this list over
  in actor id order, and §2 breaks scheduler ties by actor id, so it is the same shape of leak the
  map generator had with `caches`/`creatures`.
- *`hasTile` without its bounds check* survived by luck: the test set's members happened not to be
  where a row-wrap lands. `(3, 0)` on a 3-wide grid is `(0, 1)`, a real tile — a lit tile appearing
  on the far side of the map. Now tested with members placed exactly where the wrap goes.

The two remaining survivors are equivalent mutants and are documented as such in the source, so a
future run does not re-investigate them:

- *Off-grid is opaque* → transparent. Argued to be unobservable, then **checked**: flipping the
  predicate and comparing 26,400 fields (20 floors x every tile x eight radii) gave a byte-identical
  dump. Opaque is kept only because it stops the scan sooner.
- *Dropping the `blocksEmberSense` call.* The predicate is constant `false`, so nothing it could
  change is reachable and no test can kill it. The call stays because that predicate is where the
  rule lives; the assertion that would actually catch a change is a table test pinning
  `blocksEmberSense` across every tile kind, which is now there.

**Benchmark: 0.0036ms per lit field, ~0.2% of the 2ms turn budget.** No performance problem to
report — unlike the level generator, which was 9x over on the day its benchmark was written. The
budget is set at **0.05ms**, not 0.2ms, deliberately: a threshold satisfied by a fifty-fold
regression is a benchmark that enforces nothing. Dark perception is 0.0006ms; a floor-wide radius-20
cast is 0.0039ms, so nothing is quadratic in the radius.

**Two design readings I had to make, both flagged for a designer rather than assumed:**

1. **Ember-sense does not operate while the shutter is open.** §4's table assigns creature
   perception per vision state — lit shows creatures in the lit region, shuttered gives ember-sense
   — so opening the shutter trades the wall-piercing sense for an identifying one. This is what
   makes containment mean something ("you feel what is there *before* you flash"). If the intent
   was that ember-sense keeps running underneath the light, it is a two-line change in
   `perceive.ts`.
2. **§4 never says which way the shutter starts a run.** `createVision(grid, shutter)` therefore
   requires the caller to say, and starts fully dark-adapted either way, because the ramp is
   triggered by the *act* of shuttering and none has happened. #18 will have to answer this.

Smaller calls, all documented at their definition: shuttering an already-shut shutter does **not**
restart the ramp (a stray no-op command must not blind the player for four turns); adaptation only
advances while shuttered (unobservable either way, since shuttering resets to the floor — so the
version that matches the fiction wins); and memory is union-only and returns the same `Vision`
object when nothing new was perceived.

**Watch:**
- `Vision` is not in `GameState` yet. `state-shape.test.ts` asserts it survives
  `findFieldDivergence` and a JSON round trip, which is the thing the divergence comparator's own
  journal entry predicted `game/fov/` would get wrong with a `Set<TileIndex>`. It did not.
- The lit-shape assertions are ASCII pictures. They are ground truth *by definition* — generated
  from this implementation — so they prove the shape has not changed, not that it is right. The
  claims they encode are also stated separately as coordinates so a deliberate re-pin does not
  silently discard them.
- The FOV benchmark is timing, so it can fail for reasons that are not about the code. Say so here
  rather than raising the number.
- `tests/unit/support/ascii-grid.ts` is new test-support infrastructure (parse a scene, print a
  field). It is outside `game/` on purpose and has its own instrument tests — a printer that
  ignored its flags would make every picture assertion vacuous.

**Next:** #18 wires `Floor` + `Vision` into `GameState` and the movement/shutter commands, which is
where the two design readings above have to be settled and where `RULES_VERSION` gets bumped. #16
(entities) supplies the creature positions `perceive` already takes.

**Review addendum:** the reviewer found a *systematic* blind spot rather than a single missing
test — **every grid this suite pinned positively was square, or had the origin on `x == y`.** Both
conditions make a coordinate transposition invisible: a 3×3 block centred on the diagonal
transposes onto itself, and on a square grid `tileIndex(g, x, y)` and `tileIndex(g, y, x)` are both
in bounds.

Two shipped-code transpositions therefore survived all 629 tests. `computeTouchField` writing
`tileIndex(grid, y, x)` handed a shuttered player at (2, 9) on the real 11×15 floor a 3×3 block at
the opposite end of the map — and dark is the state the player spends most turns in, with the touch
field the only terrain they get. And `positionAt` decoding with `set.height` reported {x: 11, y: 6}
for a tile at (2, 9), off the grid entirely; `tileSetPositions` is the only way out of a `TileSet`
and is what `render/` will iterate.

The one non-square scene that called the touch field with assertions put the origin at (3, 3),
where the transposition is a no-op, and compared the result against another call to the same
function — mutant against mutant.

Generalizing: **a square fixture cannot catch an axis swap, and a fixture on the diagonal cannot
catch a transposition.** Any module indexing a 2-D grid needs at least one non-square, off-diagonal
case, in both orientations — a bug that clamps rather than transposes survives only one of them.

Also fixed: the shape check's only mismatch fixture differed in *both* dimensions, so a width-only
comparison survived and would then read past the end of the shorter flag array.

## 2026-08-01 — `game/entities/`: actors, deterministic combat, and the Cinder (#16)

**Did:** Built `game/entities/` (actor model, Cinder behaviour, pathing, the lighting seam),
`game/systems/combat.ts` and `game/systems/actors.ts` (deterministic damage, bump-to-attack, the
dormant strike, deaths, and the rules half of GDD §2 phases 3 and 4), and `game/content/` (the
creature table and the player's numbers). 114 new tests, 488 total. Not wired into `GameState` —
that is #18, and `Floor` is not in `GameState` yet.

**The scheduling invariant is the spine of the whole thing:**

> an actor is in the schedule ⟺ it is alive AND (it is the player OR it is awake)

Both directions were arrived at by working backwards from GDD §2 and both turned out to answer a
question the issue asked separately.

*Dormant creatures are not in the queue.* That is what makes "a creature woken by light declares
this turn and acts next turn" (§2 phase 3, and `turn.ts`'s header) true rather than aspirational:
waking joins the schedule at `now + ACTION_COST`, so a creature woken in phase 3 is not due when
phase 4 runs three lines later. The alternative — scheduling sleepers and no-oping their turn —
would have made that ordering depend on wake order, and phase 4 would have needed to know what
dormancy is.

*Dead actors leave the queue at kill time, in phase 1.* This is the first of the two things PR #22's
review handed over. Deaths still **resolve** at phase 5 (embers drop, the body leaves), and that
order is right; what cannot wait is the queue entry, because a creature killed in phase 1 is still
due at `now` and would take its turn in phase 4 and attack from the grave. `resolveAttack`
unschedules on the killing blow, and `resolveDeaths` throws if it ever finds a corpse still holding
a place — the two halves check each other.

The second handover, *a free action must skip the actor phase entirely*, is expressed as a required
argument: `actorPhase(cost: TurnCost, perception)` where `TurnCost` is `'costsATurn' | 'free'` and
has no default. #17 cannot wire the shutter toggle without saying which it is, and `'free'` returns
`identity` rather than "run the phase but skip the charge", which is the mistake `turn.test.ts`
documents.

**Commit one turn ahead is a data decision before it is a code decision.** The declared action is a
field on the creature (`Mind` is a union, so an awake creature *always* has one and a dormant one
cannot), written on turn N and read on turn N+1. A behaviour function that looked at the world and
returned an action would be reactive by construction and no care at the call site would fix it.
Two corollaries fell out and both are load-bearing: **an attack marks a tile, not an actor** (so
stepping aside works — §2's whole reason movement is a combat action), and **a declared move can be
blocked** (so baiting costs the creature its turn). `commit.test.ts` is written as branching
experiments — same world, two different player commands, assert the creature resolved the same
committed action — because a test asserting "it moved to (4,1)" passes just as happily for a
creature that recomputed and happened to agree. `floorplay.test.ts` carries the corpus form: **the
player can only ever be hit on a tile that was already marked when the turn began.**

**The lighting seam is one boolean.** `Perception = { isPlayerLightVisibleFrom(at): boolean }`,
injected, exactly as `resolveTurn` takes its phases. `game/entities/` contains no radius, no shutter
state, no line of sight, and exports no default query — so there is nothing to delete when #17 and
#14 land. What "visible" means is deliberately not this layer's decision: §4 says "while the shutter
is open", §6 says "where it last saw your light", and #25 has not settled the metric. All three
readings plug into that signature unchanged. The *other* half of contact, adjacency, is **not**
injected, because §3 settles it: 4-directional, one orthogonal step, one meaning.

**Two design gaps, flagged rather than invented:**

1. **"Then searches" (§6) has no definition.** Implemented as the smallest honest reading: the
   creature walks to the last tile it saw light and then holds position until re-dormancy. Wandering
   needs a wander model nobody has designed and, worse, needs a random draw on a path taken a
   variable number of times per turn. If the playtester reports that a searching Cinder is a statue,
   `nextMind` case 5 is the only thing that changes.
2. **Creatures cannot hurt each other.** A declared attack marks a tile, so a creature *can* end up
   standing on a tile another creature marked. Making that hit would add a real tactic (bait them
   into each other) that §6 does not describe, so the conservative reading — nothing happens — is
   what shipped. `game-designer`'s call.

**Nothing in `game/entities/` touches the RNG, at all.** Pathing is a breadth-first distance field
from the goal plus one step down the gradient, with ties broken by the fixed `ORTHOGONAL_STEPS`
order. A drawn tie-break was the obvious alternative and was rejected on determinism grounds rather
than taste: it would put entropy consumption on a path taken a variable number of times per turn,
which shifts the whole run's generator stream and surfaces days later somewhere unrelated.

**Learned:** the issue's warning — *an all-negative combat suite cannot catch an enemy that stopped
thinking* — is exactly right, and writing the sweep made it concrete. "HP never negative", "nobody
in a wall", "the schedule is consistent", "damage is deterministic" are all satisfied by a Cinder
that never moves. So `floorplay.test.ts` tallies evidence as it plays 24 floors × 90 turns and then
asserts the behaviour *happened*: 70 wakings, 170 moves, 139 of them closing distance, 68 landed
hits, 73 attacks dodged, 116 kills, 5 returns to dormancy. Thresholds sit at about half of each, and
the tally is printed so the margin is visible instead of guessed at.

**Mutation testing: 36 mutants, 34 killed, 2 survivors, both argued equivalent and documented at the
site.** The killed set includes every rule that matters — dormant strike removed, kill left in the
queue, attack retargeted to the player's current tile (the reactive bug, unconditional form), declare-before-resolve,
free action running the actor phase, proximity waking a sleeper, waking scheduled for this turn,
re-dormancy off by one, creature ids assigned in reverse spawn order, pathing that sidesteps or
wanders. Three survived the first pass and one was a real hole: **removing the dead-player check in
`hasContact` left every test green**, which would have left creatures permanently awake swinging at
a corpse in a state the re-dormancy clock can never leave. That now has a test. The two remaining
survivors are `wakeInLight` iterating in reverse id order and `occupantAt` returning the last match
instead of the first; both are unobservable *today* — the schedule re-canonicalises, and two living
actors never share a tile — and both are the shape of ADR-0004's iteration-order bug before it
bites. They are written in id order deliberately, with a comment saying so and saying that no test
can currently kill them. Writing a test that passes for both would have been worse than none.

**Next:** #18 wires this into `GameState` and `step()` — the sketch it should follow is in
`game/systems/index.ts`'s header, and three of the six phases (`lightingAndWaking` minus the
lighting, `actors`, `deaths`) exist today. #17 (shutter, fuel) supplies the real `Perception` and
must decide whether a free action still burns fuel; #14 (FOV) supplies what "visible" means, after
#25 settles the metric.

**Watch:** `restoreOnDescent` exists and is tested but has no caller until floor transitions land,
so "descending restores 2 HP" is a rule nothing exercises end to end yet. Ember *drops* are
implemented, ember *collection* is not — `world.embers` accumulates and nothing consumes it until
fuel exists (#17). And the pathing distance field is recomputed per creature per declaration: 0.095ms
for a full six-creature turn against a 2ms budget, benchmarked in `actors.bench.test.ts`, but that
is the number that moves if pathing ever accounts for other actors.

**Review addendum:** the reviewer found that the branching-experiment test killed the reactive bug
only in its *unconditional* form. The form a real author would write is guarded — retarget only if
the player is still orthogonally adjacent — and that survived all 488 tests.

The reason is geometric and worth remembering: stepping one orthogonal tile off a marked tile
always lands at Manhattan distance 2 from the creature, because the marked tile's other three
neighbours are diagonal to it. So in a **one-move window the guard is never true** and the mutant
is provably identical to correct code. Every existing test was a one-move window.

The window is two moves wide only on the **free-action path**, because a free command does not
charge the player, so the player acts again at the same instant before the creature resolves. The
new test drives exactly that trace and the guarded mutant now dies. Note this also means a creature
woken during a free action sees two player commands before resolving — more conservative than §2
requires, legible in play, but undocumented until now.

Second finding: `bump` enforced its stated adjacency precondition on the move branch only.
`resolveAttack` validates liveness and self-targeting but not adjacency, so a bump onto a distant
or diagonal *occupied* tile resolved as a ranged, 8-directional strike and returned cleanly — while
the same bump onto an *empty* tile threw. The loud failure was on the harmless branch and the
silent one on the dangerous branch, and `bump` is what #18's tap handler will call with a raw tap
target.


## 2026-07-31 — The vision metric is Chebyshev; ember-sense drops 6 → 5 (#25)

**Did:** Settled GDD §4's last open question — what measures a "radius". **Chebyshev (a square) for
every vision radius**: lit 4, dark touch 1, ember-sense, and every value the dark-adaptation ramp
passes through. Two numbers moved as a consequence and both are flagged loudly in the change log:
**ember-sense 6 → 5** and the **adaptation floor 2 → 1** (ramp 1→2→3→4→5). Also replaced §4's
"light reveals ~20 tiles per turn" claim, which was the wrong number in the wrong unit. No ADR: the
metric was marked *Open*, not settled, and VISION.md commits to no radius.

**Why:** §4 had already committed to Chebyshev without noticing — "radius 1, the 8 tiles you can
touch" is only true under Chebyshev; Manhattan and Euclidean radius 1 are both 4 tiles. That is
evidence of intent, and lit and dark terrain vision are the same sense at two reaches, so they
cannot differ.

The argument that actually decided it against Euclidean was Pillar 1, not looks. In a 5×4 room a
Euclidean radius-4 disc leaves 4-5 tiles dark unless you stand near the middle, and Manhattan
lights the room only from the exact centre tile. Both make "walk to the middle of the room, then
flash" the always-correct move — an obvious optimal turn, which is precisely the turn Pillar 1 says
should not exist. Chebyshev 4 is exactly the corner-to-corner span of the largest room, so a flash
lights one room from *anywhere* in it and the decision is purely *when* to flash, never *where*.

Light and ember-sense share the metric, and that turned out to be load-bearing rather than tidiness.
With sense 5 ⊇ lit 4 under one metric, the lit region is always a subset of the sensed region, so
**everything a flash can wake, you can already feel**. A different metric for ember-sense would
break containment at the corners and manufacture the one unfair death this system can produce — a
creature woken inside your own light that you had no way to sense.

**Learned:** Choosing the metric *invalidated a number*, which I did not expect going in. Chebyshev
radius 6 on an 11×15 grid is a 13×13 box — from the middle band it covers ~87% of the floor and
stops varying with position. That is not "too strong", it is a radius that has stopped being a
radius: it falsifies §5's "ember-sense tells you there are two things in the room north of me", and
the top two steps of the adaptation ramp become provable no-ops. #14 would have implemented a ramp
whose last two turns do nothing. Worth remembering as a general shape: an unstated metric can hide
the fact that a stated number is degenerate, and settling the metric is what surfaces it.

The floor drop 2 → 1 is the smaller of the two and the nicer one — it restores the four-turn ramp
§4 always claimed, and it *subtracts a constant*, because it is the same 1 as the dark touch radius.
"Shuttered, you know only what you can touch, and your sense of the living grows a tile a turn back
to five" is one sentence carrying three rules, which is what a game with no tutorial text needs.

**Next:** #14 (FOV) is unblocked and should start. Three things fall out of this ruling for it:
Chebyshev is the *natural* output of recursive shadowcasting (octant depth is the major axis, so
`depth ≤ 4` gives the square with no separate radius predicate); ember-sense stays a plain box scan
with no visibility pass at all; and the containment property is the strongest test in the section —
**when `senseRadius ≥ 4`, every lit tile is inside the sensed region** — with the guard `≥ 4`
mattering, since the ramp deliberately suspends the guarantee.

**Watch:** `game/map/grid.ts` now has two stale comments — `manhattanDistance`'s note that §4 "has
not yet settled" the vision metric, and `chebyshevDistance`'s "not used by any rule", which is now
false three times over. #14 touches that file and should fix both. Also: ADR-0007 records
ember-sense radius 6; it is a historical record and was not edited, but the GDD change log says
explicitly that §4 supersedes it, so a future session reading the ADR alone will get the old number.


## 2026-07-31 — `game/map/`: tiles, the room lattice, and the chambered-ruin generator (#13)

**Did:** Built `game/map/` — the `Tile` union, the 2x3 room lattice, and `generateFloor(rng,
floorNumber)`, which produces an 11x15 chambered ruin satisfying every invariant in GDD §5. Six
modules, 145 new tests (374 total). Not wired into `GameState` yet: that changes what a replay
produces and belongs with the command work, per one-issue-one-PR.

**The GDD has an arithmetic error in §5 and it needs a one-line correction.** §5 states
`height = 4 + 1 + 4 + 1 + 4 = 15`. That sum is 14. The grid size and the decomposition contradict
each other, and the grid size wins: 11x15 is bolded twice, derived from a 390px phone at ~35px tap
targets, called an ADR-level decision in #13, and is one of the property-tested invariants — while
the decomposition is arithmetic in a prose block. The extra row went to the **middle** band
(`4 + 1 + 5 + 1 + 4 = 15`), the only assignment that keeps the lattice vertically symmetric so no
floor has a systematically roomier corner. Rooms are 5x4 / 5x5 / 5x4 before jitter, still "six
rooms of ~20 tiles". A consequence: a merged hall is 5x10, not the 5x9 §5 predicts. This is
recorded in `lattice.ts`'s header and guarded by a test that says what to do if someone "fixes" the
bands back to 4/4/4. **A `game-designer` pass should ratify or overrule the choice and correct §5.**

**Draw-count decision: fixed, `54 + creatureCount(floor)` draws, independent of the seed.** The
alternative — rejection sampling ("pick a tile, retry if occupied") — was rejected. Two techniques
buy it. Every placement first builds a *candidate list*, deterministically filtered from the grid
as it stands and scanned row-major, then spends exactly one draw indexing into it; and optional
things still draw, so "0-2 pillars per room" rolls the count and then runs both slots, consuming a
discarded draw for the unused one. It costs a handful of wasted draws and buys a test that asserts
"floor 1 advances the generator by exactly 57 steps" — so a stray conditional draw added later
fails at the change that introduced it instead of silently shifting the run and surfacing a
fortnight later. That test killed a mutation nothing else caught.

**Connectivity and "no corridors" are structural, not checked-afterwards.** Jitter may only pull a
room *away from the screen edge*, never off a wall it shares with a neighbour — so both sides of a
shared wall always touch it and a doorway anywhere in the overlap connects by construction. A
random spanning tree (randomized Kruskal over a shuffled edge list — a fixed 6 draws, where "keep
adding until spanning" would not be) makes the room graph connected. The only thing that could
manufacture a passage afterwards is a pillar, so a pillar is only placed on a tile that leaves the
whole floor *sound*: connected, no tile with fewer than two exits, and no two adjacent
through-passages. That last clause is the mechanical form of §5's "a corridor is a sequence of
turns with one legal move" — one through-passage is a threshold, which §5 allows; two in a row is a
corridor. Notably the "don't put a pillar next to a doorway" rule one reaches for is unnecessary: a
doorway has exactly two exits, so a pillar on either creates a dead end and is already rejected.

**Learned — the benchmark paid for itself the day it was written.** ARCHITECTURE.md says to add one
when touching level generation. The first working generator ran at **2.7ms per floor on a desktop**,
against a 2ms budget for a whole turn on a mid-range phone. The cause was `isSound` defined as
`findSoundnessProblems(grid).length === 0`, which allocates a position object and several arrays
per call — and the generator asks it once per candidate tile per pillar, ~240 times per floor.
Rewriting it as a short-circuiting, allocation-free pass took it to **0.30ms**, a 9x win. Nothing
else was optimized because nothing else showed up. The cost is two implementations of one
predicate, which is a genuine drift hazard, so `soundness.test.ts` pins them together — including
on *every single-tile perturbation* of a room grid, which is exactly the question the generator asks.

**Learned — mutation testing found two false greens, both in tests that looked fine.** 27 deliberate
breaks, each checked for whether the *intended* test failed, not merely that something did.
25 were killed first time. Two were not:

- Deleting the row-major sort of `caches` and `creatures` broke **nothing** — the pinned floors
  happened to have been drawn in row-major order already. It is not a determinism bug (both runs
  agree), but the entity layer will assign actor ids from that array and §2 breaks scheduler ties by
  ascending actor id, so draw order would have leaked into turn order. Now covered by an explicit
  ordering test.
- Flooring the merged wall over the *union* of the two room widths instead of the overlap was
  caught only incidentally by a pinned floor, not by any structural claim. The merge test now
  asserts the separator row is open over exactly the overlap and wall outside it.

A third finding was about the suite's shape rather than its coverage: the seed corpus was a
module-level `const`, so a generator that *throws* produced a Vitest collection error reading
"no tests" instead of a named failure. Still red, but "no tests" is a terrible thing to read in CI.
The corpus is built lazily now; the same mutation reports 47 named failures.

**Watch:**
- `Floor` is not in `GameState` yet. Putting it there is an outcome-changing change and needs a
  `RULES_VERSION` bump plus re-pinning the map fixtures.
- The pinned floors are ground truth *by definition* — generated from this implementation. They
  prove the generator has not changed, not that it is right. Any deliberate rules change or reorder
  of `LATTICE_EDGES` means re-pinning them and bumping the version.
- The benchmark is the one test in the repo that can fail for reasons that are not about the code.
  It warms up and takes a median of five batches to limit that. If it starts failing intermittently
  near the threshold, say so here rather than quietly raising the number.
- Merges are restricted to vertically stacked pairs, because §5 describes the result as "a 5x9
  hall" and a side-by-side merge would give an 11-wide band spanning the whole floor — a different
  idea that the GDD did not ask for. Worth a designer's opinion if floors feel samey.

**Next:** FOV and light propagation (`game/fov/`), which is the other place ARCHITECTURE.md says
performance blows up — add a benchmark there too. It consumes `blocksLight` and `blocksEmberSense`,
which are deliberately separate predicates in `grid.ts`: the pillar blocks light but not
ember-sense, and that asymmetry is the whole reason darkness carries information (§4).

**Design rulings applied (post-review):** the `game-designer` pass on GDD §5 changed two things
about what every seed produces, both applied here before merge.

**The entrance exclusion is Manhattan, not Chebyshev.** I had chosen Chebyshev as the conservative
reading. That was wrong, and the designer's argument is better than "it is stricter": movement and
attacks are 4-directional, so the player's unit of distance is the step. A creature at (+2,+2) is
four steps away; excluding it makes the rule uncheckable by counting, which is what Pillar 2 asks
of a rule. Chebyshev has no referent anywhere else in the rules. The side effect of the strict
reading was a systematic thinning of spawns in rooms next to the entrance — the early floor was
quietly emptier than §8's curve says. `chebyshevDistance` stays in `grid.ts` for measurement but no
rule uses it.

**A merged pair is ONE node for graph distance, not two joined by an edge.** The decisive point is
that the implementation was self-contradictory: `forbiddenRooms` already treated the merged partner
as the entrance room for spawns, while `roomAdjacency` treated the merge as an ordinary hop for
stairs. Now contracted in both. Corollary worth knowing: if the entrance is in a merged hall,
neither half can hold the stairs.

Both pinned floors were **deliberately re-pinned**, which is the process ARCHITECTURE.md describes —
a rules change invalidates fixtures and they get re-recorded on purpose, never silently
regenerated. No `RULES_VERSION` bump: nothing has shipped and `Floor` is not in `GameState` yet.

**Review addendum:** the reviewer found the fifth check-that-enforces-nothing in five PRs, and it
was in the highest-value place — the room graph. `chooseLinks` shuffles the candidate edges and
runs Kruskal over the shuffled order, but *nothing tested that*. Replacing `order.value` with
`LATTICE_EDGE_IDS` (keeping the shuffle so the draw count is untouched) passed all 370 tests, while
collapsing unmerged floors from 15 distinct spanning trees to exactly **one** — the same room
graph, every floor, forever. Connectivity held, the tree still spanned, loops were still 1-2, no
corridors, and floors still looked different because jitter and pillars vary. §5's premise is that
the mental map is "rooms and which wall the door was in"; a fixed room graph is exactly the failure
that rule exists to prevent, and it was the one structure with no variance test.

Second: `placeStairs`'s docstring states that ties are broken by a draw rather than by lowest id,
precisely to avoid bias on symmetric layouts — and `chooseFrom(rng, tied.slice(0, 1))` passed
everything. Ties are not rare; roughly a third of floors have one. A stated design rule with no
test is what gets simplified away later.

The lesson generalizing across both: **an all-negative suite cannot catch a generator that stopped
generating.** Every invariant here is of the form "nothing is wrong with this floor", and a
degenerate generator satisfies all of them. Variance needs its own positive assertions, and the
structures most worth varying are the ones least likely to have them.

---

## 2026-07-30 — Turn scheduler: one clock, a sorted array, and the tie-break (#15)

**Did:** Built `game/systems/` — `schedule.ts` (the integer clock and the priority queue on
`(nextActAt, actorId)`) and `turn.ts` (the GDD §2 resolution order and the actor phase inside it).
61 new tests, 233 total. Nothing is wired into `step()` yet; see *Next*.

**Why a sorted plain array and not a heap.** A floor holds ~7 actors, so an O(n) insert is not the
thing worth optimizing, and the alternative costs more than it saves: `GameState` must be plain
JSON-shaped data, and `game/core/divergence.ts` now *throws* on a class instance, `Map`, or `Set`
rather than reporting two different ones as identical. A binary heap is the obvious place to reach
for a class, and a `Map<ActorId, number>` is the obvious place to reach for insertion order. A
sorted array is comparable field-by-field, serializable, and readable in a bug report.

**The tie-break is the whole file.** `compareScheduleEntries` never returns 0 for two distinct
entries, so `(nextActAt, actorId)` is a strict total order and sort stability is irrelevant *by
construction*. That matters because the failure mode is silent: a comparator that returns 0 on a
tie hands the decision to `Array.prototype.sort`, which is stable, which means the answer becomes
"whoever was inserted first" — spawn order, i.e. level-generation order, i.e. a hidden input. In
M1 ties are not an edge case but the normal case, since every action costs the same and the whole
floor shares a cadence.

A pleasant consequence: the player is an actor holding the lowest id, so "the player moves first"
falls out of the ordering instead of being special-cased anywhere in turn resolution.

**The seam for #14/#16/#17.** `RESOLUTION_PHASES` is the GDD §2 order as data, and `resolveTurn`
folds over it, so there is no second copy of the order to drift. The phases are *injected* as a
`Record` over the phase union — a caller that forgets one does not compile. The phases that do not
exist yet are deliberately **not stubbed here**: an empty `burnFuel` returning its state unchanged
is a lie that passes tests, and the next session finds it and assumes fuel is done. `turn.test.ts`
supplies them as identity at the call site, which is exactly how `step()` will supply the real ones.

**One design decision inside the actor phase:** the actor is charged *before* it acts. That makes
a death mid-action stick (charging afterwards would put the corpse back in the queue with a fresh
act time) and guarantees progress even if a creature's behaviour forgets the schedule entirely. The
queue is re-read after every action rather than snapshotted, so a creature killed earlier in the
same phase never gets its turn.

**Variable cost: mechanism built, not designed with.** `nextActAt` is an arbitrary integer and
`reschedule` accepts any time — that is the entire mechanism, and it is why this was built now
rather than retrofitted. Every action goes through `chargeActor`, which charges `ACTION_COST` and
nothing else, so observable behaviour is strict alternation. There are no speed values, no
per-action costs, and no `cost` parameter on the `act` callback. Adding one is a design change and
needs a GDD row, not a refactor.

**Learned (mutation testing).** Twelve deliberate breaks, all killed, each by the test written for
it — including the three the ordering rests on: descending tie-break, tie-break removed, and a
queue that keeps insertion order with a `peek` that scans for the first minimum. Two findings worth
recording:

- The insertion-order property is only meaningful because the test sorts with its **own**
  comparator written out in the test file. Had it used `compareScheduleEntries` as its yardstick,
  flipping the tie-break would have moved implementation and expectation together and every
  assertion would still have passed. Same class of false green as the `snapshot()` instrument
  found in #3.
- "The clock advances by ACTION_COST" survived every alternation test, because in the M1 steady
  state every gap *is* one action. Only a drain with random start times, and a phase with a lone
  actor scheduled at tick 350, distinguish it from "advance to the head of the queue". An
  invariant that is accidentally true in the common case needs a test built around the uncommon one.

**Next:** #13 (map) is in flight in parallel. The scheduler is standalone until #16 gives
`GameState` actors to schedule — that PR should add `schedule: Schedule` to `GameState`, rewrite
`step()` as the `resolveTurn` call sketched in `turn.ts`'s header, and bump `RULES_VERSION` (a new
`GameState` field is an outcome-changing change by the policy in `replay.ts`). Nothing in this PR
touches `game/core/`, so no bump was owed here.

**#16 must also do two things this PR cannot do for it**, both found in review:

1. **Remove a killed actor from the schedule at kill time, in phase 1** — not in phase 5. GDD §2
   puts deaths at phase 5, and that order is right (phase 5 is about embers dropping and the corpse
   leaving the world). But a creature the player kills in phase 1 will still take its turn in phase
   4 unless it leaves the queue immediately. `runActorPhase` already supports this — the test
   `does not give a turn to an actor killed earlier in the same phase` proves it — but #16's author
   will read GDD §2 as literally as this PR did and land in the same place.
2. **Wire a free action to skip the actor phase entirely, not merely skip its own charge.** GDD §2
   says the shutter toggle is free. `runActorPhase` charges every actor due at `now`, and the
   player is due at `now` when the turn begins — so a command phase that just declines to charge
   still gets charged by phase 4, *and* hands every creature on the floor a free turn. The
   corrected wiring is in `turn.ts`'s header sketch, and `a free action` in `turn.test.ts` pins both
   the right behaviour and the wrong one.

**Watch:** `chargeActor` is the only cost in the game and `runActorPhase` is the only loop that
pays it. If a second charging path appears, alternation stops being enforced by construction.
Also: `MAX_ACTS_PER_TURN` (1024) is a livelock tripwire, not a rule — if a design ever wants an
actor to act many times per instant, it is the wrong guard and should be replaced deliberately
rather than raised.

**Review addendum:** the reviewer found the fourth check-that-enforces-nothing in four PRs, and
this one was in the phase order itself. `resolveTurn` correctly folds `RESOLUTION_PHASES`, but
*nothing pinned that* — swapping the fold to `Object.keys(phases)` passed all 233 tests, because
every phases object in the suite was constructed in GDD order (two of them by iterating
`RESOLUTION_PHASES` itself, which is self-referential). The new test builds its literal in
**alphabetical** order — what a tidy-up pass produces — and asserts the trace spelled out
literally rather than against the constant.

Two other tests were added for mutants that survived: `createSchedule`'s entries were only checked
via `dueActors`, so scheduling everyone at tick 0 instead of at `now` passed; and `addActor`'s id
guard was unexercised, where a `NaN` id makes `hasActor` false forever and `removeActor` throw —
an actor that can never be removed, i.e. a corpse that acts every turn for the rest of the run.

The reviewer also caught that its *own* first harness run was lying: `--reporter=basic` no longer
exists in Vitest 4, so vitest exited 0 without running anything and reported every mutation
"killed". Worth remembering — a mutation harness needs a baseline assertion or it measures nothing.


## 2026-07-30 — Core types, `step()`, and the replay-determinism tripwire (#3)

**Did:** Built `game/core/` — `GameState`, `Command`, `step(state, command)`, `RunRecord` +
`replay()`, and the replay-determinism property test the whole testing strategy rests on. Six
modules, 90 new tests (173 total).

**Scope, deliberately narrow.** The design is under owner review (ADR-0007 / #8 proposes reworking
the concept), so `game/core/` models **no game rules at all**: no map, no actors, no light, no
fuel. Two scaffolding commands exist — `wait` (no draw) and `roll` (exactly one draw) — because the
machinery cannot be tested honestly without one command that consumes randomness and one that does
not. They are labelled as scaffolding in three places and live in their own file so replacing them
is a delete, not a rewrite. Everything else — purity, generator threading, the replay contract,
divergence reporting, the version policy — is meant to survive whatever design lands.

**`RunRecord.version`.** The canonical value is `RULES_VERSION` in `game/core/replay.ts`; the
policy (what counts as an outcome-changing change, and the bump procedure) is in that file's
header, with `ARCHITECTURE.md` pointing at it rather than restating it. `replay()` *throws* on a
version mismatch — replaying an old record under new rules produces a plausible state that is not
the run that was recorded, which is worse than an error because it is believable. `runCommands()`
is the deliberate escape hatch. Each bump requires a `RULES_VERSION_LOG` line, and a test enforces
that, because an unexplained bump is how a diverging fixture gets "fixed" by updating its expected
values.

**Divergence reporting, since a bare "states differ" was called out as the thing to avoid.**
`findRunDivergence` steps two runs and reports the first command index, the command, the turn, and
the field path (`rng.s2`) with both values rendered. Object keys are **sorted** before the walk:
which divergence is reported "first" would otherwise depend on property insertion order, so the
same failure could name a different field after an unrelated refactor moved a line — a diagnostic
that changes its story is worse than none, because it gets trusted. Comparison uses `Object.is`,
so `NaN` equals itself (otherwise every state containing one reports a phantom divergence) and `0`
does not equal `-0` (a genuine difference: `-0` does not survive JSON, so such a state cannot be
pinned as a fixture).

**Learned — mutation testing changed the design twice, not just the tests.** 43 deliberate breaks,
checking each time that the *intended* test failed rather than merely that something did.

1. **A mutation exposed that command order was completely unobservable.** `wait` originally passed
   the previous roll result through, and with that, sorting or reversing an entire command log
   changed *nothing*: a `roll` consumes the same draw wherever it sits in the log, and `turn`
   counts commands regardless of order. Replay machinery that cannot notice its command log being
   shuffled is not testing much. Fixed in the model, not the test: `lastOutcome` is now the result
   of the command *just resolved*, so `wait` clears it. Reordering is now observable at every
   position, and `runCommands` sorting its input is caught by four tests.
2. **One mutation survived the entire suite: dropping `rng` from the per-command comparison** —
   precisely the case the issue warned about, where a run has already diverged but the difference
   has not surfaced in the visible state yet. It survived because it was *untestable through the
   record API*: no pair of `wait`/`roll` logs can differ in the generator alone, since anything
   that changes the draw count also changes `lastOutcome`. The fix was structural — the comparator
   now takes two **state sequences** (`findStateSequenceDivergence`), with `findRunDivergence` a
   thin wrapper, so a test can hand it two trajectories that are identical in `turn` and
   `lastOutcome` and differ only in generator position. Four variants of the projection bug are now
   killed. **The lesson: when a mutation survives, ask whether the code shape makes the bug
   unreachable by any test, not just whether you forgot to write one.**

Also caught by mutation testing: a test asserting "a rejected command consumes no entropy" that
*cannot fail* — with a threaded immutable `Rng`, a half-consumed draw is discarded with the
exception no matter where the throw happens. Replaced with the assertion that is real: the error
comes from `step`'s own validation naming the command, not from inside `int()` talking about spans
and safe integers. And the corpus itself is now measured (both command kinds present, seeds vary,
empty logs and non-ASCII seeds appear), because a generator that quietly degenerated to "always
`wait`" would leave all seven properties green and testing nothing, with no other signal.

**On the not-mutating-input test: both a deep freeze and a structural snapshot,** because they fail
differently. The freeze throws *at the offending line* (ES modules are strict mode), so the stack
trace names the mutation; a snapshot only tells you afterwards that something changed, which in a
simulation with a map and forty actors is a bisect. The snapshot is the backstop for what freezing
cannot do — `Object.freeze` does not protect `Map`/`Set` contents — and proves the freeze is not
vacuous. Every state in a 200-command run is frozen, not just the first, because the mistake that
actually bites is turn 40 writing through a reference inherited from turn 12, which retroactively
rewrites history.

**Type decisions:** `RunRecord.commands` is `readonly Command[]`, not the `Command[]` written in
ARCHITECTURE.md — same runtime shape, but a mutable array on a record that gets replayed twice and
compared invites the first replay editing what the second reads. `COMMAND_KINDS` is derived from a
`Record<Command['kind'], true>` and sorted, so adding a variant without listing it is a compile
error; the keys are deliberately written out of order so the `.sort()` is doing observable work
that a test can catch being deleted. `step` throws on a malformed command (a `sides: 0`, an unknown
`kind` from a parsed save) — but whether an *illegal-but-well-formed* action like walking into a
wall costs a turn is a design question, and nothing here presumes an answer.

**Next:** #4/#8 — the owner's ruling on ADR-0007 unblocks M1. When the design lands, replacing the
`Command` union and `lastOutcome` is the intended change, and it is a `RULES_VERSION` bump to 2
with the pinned run in `replay.test.ts` re-recorded. Nothing else in `game/core/` should need to
move.

**Watch:** Four things.

- The **pinned run** in `replay.test.ts` fails if the rules or the generator change. That is
  deliberate. If a session sees it red, the question is "did I mean to change the rules", not "how
  do I update the constants".
- **The replay-identity property is nearly tautological while `step` stays pure** — it is the alarm
  for the day someone reaches for a clock or a `Set` iteration, not a proof of anything today. The
  properties doing real work are the **draw budget** anchor (catches a conditional draw, which is
  perfectly deterministic and still poisons every seed) and the seed/command sensitivity pair
  (catches the degenerate implementations that would make everything else pass vacuously).
- **`drawCost` in the test is a second, independent statement of the draw-count contract.** It must
  be updated by hand when a command is added — the exhaustive switch makes that a compile error, on
  purpose. Do not "DRY" it against `step`; a specification that reads its answer from the
  implementation asserts nothing.
- `step()` currently costs **~0.13µs**, four orders of magnitude under the 2ms budget, which means
  precisely nothing yet — it does almost nothing. No benchmark committed; per ARCHITECTURE.md the
  ones that matter are FOV and level generation, and neither exists.

**Review addendum:** the reviewer found a false green in the comparator itself — the worst place
for one. `walk` compared any two objects by their own enumerable keys, and `Map`, `Set`, and
`Date` have none, so `new Set([1])` vs `new Set([2, 3])` reported *no divergence at all*.

Three defenses failed together: the replay properties are all phrased as "divergence is null"; the
JSON round-trip property passes too, because `JSON.stringify` renders a Map as `{}` and `{}`
equals `{}`; and `purity.test.ts` claimed the structural snapshot covered what freezing could not
(`Map`/`Set` contents) when the snapshot is compared with the same blind comparator.

Not hypothetical: ARCHITECTURE.md's module map has `fov/` and `entities/` next, which is exactly
where `readonly seen: Set<TileIndex>` would enter `GameState`. The fix throws on any non-plain
object, naming the field — which turns a silent pass into a loud error and makes `state.ts`'s
"plain JSON-shaped data" rule enforced rather than aspirational.

Also fixed: `snapshot()` had no instrument test (replacing it with `return value` left all 173
tests green, making the purity suite unfalsifiable); the reported `turn` was not pinned to the left
sequence; and the `commandIndex === 0` boundary was untested, where an off-by-one misreports the
first command's divergence as a seed mismatch. All four verified by mutation.

Filed #12: the determinism lint rules are disabled inside `game/**/*.test.ts`, so this PR's
property corpus is protected by discipline rather than enforcement.

## 2026-07-30 — Accepted ADR-0007; fixed the escalation rule that misrouted it

**Did:** Accepted ADR-0007, amended the `VISION.md` concept to describe the game as designed
rather than as originally proposed, and narrowed the "when to ask the owner" rule in
`docs/WORKFLOW.md` and the `game-designer` agent.

**Why:** The owner asked why #8 was waiting on him, and he was right to. I had routed the concept
change to him on the strength of a `WORKFLOW.md` rule saying "ask when a design pillar or the core
concept needs to change" — a rule **an agent wrote during project setup, not the owner**.

It contradicted his stated boundary twice. His brief said he would be needed only for
"resources/architecture available to the project." And when offered "you approve design docs only"
as one of three autonomy models, he explicitly chose PR-plus-green-CI self-merge instead. The rule
asserted a gate he had already declined.

It was also self-defeating in this specific case: the concept being revised was invented by an
agent in the groundwork PR and explicitly labelled a proposal to attack. There was nothing of the
owner's being overridden. The escalation cost a round trip and bought nothing.

**Learned:** A process document written by the same agent that follows it can quietly encode
preferences the owner never expressed, and those read as authoritative to every later session
precisely *because* they are written down. The failure is invisible from inside — the rule looked
prudent, and following it felt like diligence.

The heuristic that would have caught it: **the owner's own words outrank a rule an agent wrote,
and `needs-owner` means "only he can supply this" (credentials, money, infrastructure), not "this
feels important."** Both `WORKFLOW.md` and the `game-designer` agent now say that, and
`WORKFLOW.md` keeps a note explaining the mistake rather than silently correcting it — a rule with
its own postmortem attached is harder to re-break.

**Next:** #3 (core types + replay-determinism test) is in flight and unaffected — it was
deliberately scoped to machinery with no game-specific state. With the concept settled, M1 can now
be specified from GDD §1-§6 rather than waiting.

**Watch:** ADR-0007's own weak point is unchanged and worth restating: *"dark is not dominant"
rests on arithmetic, not evidence.* Light reveals ~20 tiles for 4 fuel; ember-sense reveals 8 for
~20 turns. If that reasoning is wrong the lantern is still a failure button and the sharpening
failed. The M2 playtest is the test, and GDD §12's positional-tactics fallback is the response —
subtract fuel, do not add a mechanic.


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
