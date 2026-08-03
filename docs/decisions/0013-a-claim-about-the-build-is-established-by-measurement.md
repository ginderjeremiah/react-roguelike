# ADR-0013: A claim about the build is established by measurement, not by argument

**Status:** Accepted
**Date:** 2026-08-02

Written by the reconcile after PR #126. It is not a design decision — it is a decision about **how
this project establishes that something is true**, which is why it is an ADR and not a GDD section.
The evidence for it is six defects that landed in one session, all of the same shape, plus a seventh
found while writing it.

## Context

GDD §4 already carries a test for a proposed measurement, and it is a good one:

> **Name the state of the world in which this number comes back different. If you cannot, it is a
> guard.**

**It did not catch a single one of the six defects below**, and that is the fact this ADR exists to
record. Every author *could* name a state. Each was wrong about whether the state was reachable — or
about whether the state they named was the only one.

| # | The claim | Why it was believed | What it actually was |
| --- | --- | --- | --- |
| 1 | §4's watch: *the fraction of woken creatures reaching adjacency* | Derived from §4's own rule | Set by the **player** — 0 of 4 walking, 1.0 standing. 0.89 read as the opposite arm |
| 2 | The playtest's substitute: *unavoidable hits*, measured at 0 | The player cannot fake it | Pinned to 0 by **§2**. It can only move if §2 breaks |
| 3 | *Every woken kill costs exactly 2 HP* | Correct arithmetic over §3's damage and §2's commit rule | False for **14.5%** of `STALKER`'s woken kills. The proof never asked whether a creature always *gets* its turn |
| 4 | #125's cause is *the free action skips phase 4* | One reproduction, and `light.ts` says it in English | `beginRun` does the same thing with no free action anywhere. The fix the narrow statement implies **leaves the route open** |
| 5 | The #125 guard's own signal comment | Written by the author of the guard | Stated backwards — as written, a narrow fix leaves it **passing** |
| 6 | `felledWithoutEverWaking === felledInOneBlowWhileAsleep` discriminates the clock | "Restoring the clock breaks it" | Restoring the clock measured **1 and 1, equal**. It is an identity by construction |

Three were caught by **building the instrument and running it**; three by **implementing the mutant**
and looking at what actually went red. *(An earlier draft of this line said four and three, over a
six-row table. Caught in review of this ADR — which is the eighth instance and the first one this
document committed against itself, so it is recorded here rather than silently corrected.)* None was caught by re-reading the argument, and #1, #2 and #3
were each re-read by three or more people first.

## Decision

**A claim about what the simulation does is not established until it has been observed against the
build.** Three rules, in the order they bite:

1. **Before a number, a bound, or an *always/never* about the simulation reaches a document, run
   it.** Naming the mechanism is a hypothesis. A mechanism named from one reproduction is a
   hypothesis about one reproduction — defect #4 above is exactly that, one level down from #3.
2. **If the claim is that some change would break something, make the change and look.** The mutant
   is the instrument for a discriminator, and it is cheap. Defects #5 and #6 were both "this
   assertion catches X" claims that had never been run against an X.
3. **If the observation cannot be made because the instrument does not exist, the claim is not an
   acceptance criterion until the instrument is built.** This one is already in the record and it is
   the only reason #125 was found: §4 made its regression guard conditional on #123 building
   per-creature wake/HP attribution, #123 built it, and the guard came back red on its first run.

**And §4's *name the state* test is kept, demoted to necessary-and-not-sufficient.** A metric that
fails it is dead on arrival and the test is worth the ten seconds. Passing it establishes nothing:
all six defects above pass it.

## Why the *name the state* test is not sufficient — the falsification

The test asks the author to search their own model of the rules for a counterexample. Every one of
the six failures above was a case where **the model of the rules was right and the build did
something the model did not describe** — a creature that does not get its turn, a phase list that
`beginRun` does not run, a fixture route that never revisits the tile the assertion turns on. No
amount of re-reading the rules reaches any of those, because the rules are not where the defect is.

**A seventh instance, found while writing this ADR, and it is the cleanest one.** GDD §4, `ROADMAP.md`
in two places and issue #125's body all state that the `beginRun` free-kill route is live on **one run
start in five**, citing §4's change log: *"over 480 generated floors, 97 (20%) wake at least one
creature on arrival."* The citation is accurate and the inference is wrong. **A run start is always
floor 1**, and §5 spawns `min(2 + floor, 6)` creatures — three on floor 1 against six from floor 4
down. Measured over 2000 seeds through `openRun`: **223, or 11.2%** (≈ 11% across seed families at 20 000 — quote *about one in nine*, not three figures; `ARCHITECTURE.md` has the per-family spread and why). Per depth: floor 1 **11.2%**, then 14.7 / 17.9 / **20.6%**, flat from floor 4 down (the `min` caps spawn at 6, so floors 4-8 are structurally identical and measure bit-identically). The 20% is the *deep-floor* rate.

**Naming refined by [ADR-0014](0014-a-woken-creature-acts-when-the-player-next-acts.md), 2026-08-03:
the `beginRun` route is a *grace*, not a free kill.** At the distances §5 step 7 actually produces
(Manhattan 3 or more) an opening wake already costs the full 2 HP, so what one start in nine buys is
an extra *command*; the HP leaks through the free action. **The measurement error this section is
about is unaffected** — one in nine is still the right frequency, and it is still not one in five.

The correct figure was already in this repository — `tests/unit/play-opening.test.ts` pins *"roughly
one opening in ten"*, `components/play/opening.ts` explains why it is lower than a descent's, and
`ARCHITECTURE.md` says "one launch in ten" twice. **So this was not an unmeasured quantity. It was a
measured quantity that a documented number overwrote**, because the documented number was easier to
reach and looked like it applied.

## Alternatives considered

**Leave it in GDD §4, beside the *name the state* test.** The obvious home, and it is where five of
the seven defects were authored. Rejected on two counts. The GDD is supposed to describe **the game
as implemented**; a rule about how the project verifies things is not a rule of the game, and burying
it in §4 means only someone already designing a light metric ever reads it. And the seven span §4,
the roadmap, a playtest brief, an issue body, a test comment and `ARCHITECTURE.md` — a rule that
applies across documents cannot live inside one of them. §4 keeps the *name the state* test and gains
a pointer here.

**One line in `CLAUDE.md`.** Rejected. Without the falsification it reads as a platitude everybody
already agrees with — and **all six defects were committed by authors who agreed with it**. The
evidence is the load-bearing half and it does not fit in a contract file.

**Automate it.** Not available. No lint rule can distinguish a number that was measured from a number
that was argued; that is the whole difficulty. The nearest mechanical thing is rule 3 above, which is
a convention about what may be listed as satisfied, not a check.

**Do nothing — six anecdotes in the journal is a record.** Rejected because it is the status quo and
the status quo produced the seventh. The journal is read three entries deep by design (`CLAUDE.md`
says so); a lesson that has to be reconstructed from six scattered entries is a lesson nobody has.

## Consequences

- **Documentation gets slower and shorter.** A number you cannot afford to measure is a number you do
  not write down. That is the intended trade.
- **The cost is bounded and it is known.** #123's instrumentation was one PR's worth of work carried
  alongside a deletion, and it found #125 on its first run. Nothing in the six cost more than an hour
  to check and one of them cost a milestone's worth of confidence.
- **Scope: claims a reader would act on without re-deriving.** This is not a demand that every
  sentence be benchmarked. It is aimed at the thing that keeps failing — a figure or an *always* that
  the next session will quote rather than re-check.
- **Rule 3 is the one that generalises furthest and is the easiest to skip**, because it is a rule
  about *not* claiming something. It is what made the whole of #125 visible.

## The signal that this was wrong

A session spends real time instrumenting a claim nobody would ever act on, or a PR stalls because a
figure it does not depend on could not be measured. Then the scope line above is too wide and should
be narrowed to *numbers that appear in a watch, an invariant, an exit criterion, or a build-order
argument* — which is where all seven of these were.
