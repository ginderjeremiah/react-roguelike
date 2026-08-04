# ADR-0014: A woken creature is scheduled at the instant the player next acts

**Status:** Accepted
**Date:** 2026-08-03

The ruling on [#125](../../issues/125), M2 build-order step 4b. **Design only — no game code changed
by this document.** It is an ADR rather than only a GDD row because it amends GDD §2's phase-3
contract, changes a rule the simulation is built on (`setMind`'s scheduling of a woken creature), and
therefore bumps `RULES_VERSION`.

## Context

GDD §2 says a creature woken in phase 3 *declares this turn and acts next turn*. The build implements
that by putting the woken creature in the queue at `now + ACTION_COST`. That is correct **only when
the waking command's phase 4 sweeps the clock forward to that instant**, which an ordinary paid
command does. Two commands do not, and they are different in kind:

- a **free action** — the shutter toggle — where `actorPhase('free')` is `identity`, so phase 4 never
  runs; and
- **`beginRun`**, which runs *phase 3 only*, to put the entrance room on screen before the first
  command. No free action anywhere and the shutter is never touched.

In both, the next command spends its own phase 4 doing the advance, so the player gets **two** phase-1
actions before the creature resolves anything. Two actions is two strikes at 3 damage, and two strikes
is exactly a 5 HP Cinder. **A descent does not open the window** — `arriveOnFloor` charges the player
and `descendTurn` runs the whole phase list — which is the boundary of the claim and is pinned by a
negative-control test.

This falsifies the sentence GDD §4's entire HP budget rests on: *every woken Cinder costs exactly 2
HP, or the stairs*, from which §4 derives 13 resolvable woken kills a run (12 HP + 2 per descent × 7
descents = 26, ÷ 2) against the 42 a run meets. Measured with #123's per-creature instrumentation,
**56 of 386** of `STALKER`'s woken kills and **22 of 247** of `FLOODLIT`'s cost 0 HP — and that corpus
never calls `beginRun`, so it sees the free-action half only. The run-start half is live on **about
one run start in nine** (#127; ~11% over 2000 seeds through `openRun`).

Two facts shape the decision and are easy to get backwards:

- **The route is not an optimum.** #123's playtest reproduced it deliberately and rules it low
  priority, correctly: the dormant strike strictly dominates it — one turn, 0 HP, 6 damage, no wake
  and no 4 fuel — so nobody optimising flashes next to a sleeper. What this is, in the playtester's
  words, is *a discount on an accidental wake*.
- **Stating the cause narrowly points at a fix that does not work.** #125 opened with *schedule a
  creature woken by a free action at `now`*. `beginRun` has no free action in it. This was found by
  implementing that fix as a mutant and looking at what went red — [ADR-0013](0013-a-claim-about-the-build-is-established-by-measurement.md)
  records it as instance 4 of the shape this project keeps producing.

## Decision

> **A creature woken in phase 3 joins the schedule at the instant the player is next due to act.**

On a command the player was charged for, that instant is `now + ACTION_COST`, which is what the build
already computes — **no paid command changes, byte for byte**. On a command the player was not charged
for (a free action, or `beginRun`) the player is still due at `now`, so the creature is scheduled at
`now` and resolves in phase 4 of the next command the player pays a turn for.

The observable rule, which is what GDD §2 now states:

> **However a creature was woken, exactly one *paid* command stands between the wake and the
> creature's first resolution. Never two, and never zero.**

**"Paid command", not "action" and not "command".** Free actions do not count, by construction — flash,
shut the shutter again, then move, and three commands have passed with one turn in them. The looser
wordings are true of turns and false of commands, and that conflation is what produced this defect;
the unit the schedule advances on is the unit the rule is stated in.

**Never zero holds by construction rather than by care:** phase 1 charges the player before phase 3
runs, so on a paid command the rule yields a strictly future instant and the creature cannot resolve
inside the command that woke it. Commit-one-turn-ahead (§2, `commit.test.ts`) is untouched — the
creature's action is still fixed before the player's command and resolved after it.

**The rule is expressed over the schedule, not over the command's `TurnCost`.** Whether the player has
been charged is already in the state; a second copy of it threaded down as a parameter is a second
thing to get out of step, and it is the shape of the narrow fix that does not close `beginRun`.

## Alternatives considered

**Accept it and re-denominate §4's arithmetic** — price the wake as *2 HP, or 0 if you spend a flash
to set it up*. **The runner-up, and a real option**: it costs nothing to build, the dominance argument
above says it distorts no optimum, and #123's playtest — which reproduced the route deliberately —
reports it as *"very visible"*, *"a discount on an accidental wake, not an exploit"* and *"low
priority"*. **Those are their words and they are evidence for this option.** It lost on three counts.

1. **It is a hidden state machine, and §4 deleted the last one in #121/#123, the build-order step
   immediately before this one.** The
   player has no readout of the clock. Two boards that look identical differ in whether the woken
   creature hits back, and the difference is which command last advanced a queue nobody can see. That
   is #121's invisible eight-turn counter re-entering through the scheduler. It runs in the player's
   favour, which makes it pleasant and not legible.
2. **The rule the player would have to hold does not fit the medium.** *A woken Cinder costs 2 HP* is
   one clause that teaches itself in one fight. *…unless the command that woke it did not advance the
   clock* is a paragraph about a mechanism with no representation, in a game with no tutorial text.
3. **It makes the budget partly player-set.** §4's claim is that the exchange rate is *fixed by
   arithmetic and not a matter of play* — that is the only reason 13-against-42 is a design fact.
   Derived: if a fraction *f* of woken kills is free, a run resolves 26 ÷ 2(1−*f*) ≈ **13/(1−f)**, so
   `STALKER`'s 14.5% makes it about **15**. And *f* is set by how often the player flashes beside
   things. §4 already carries the rule that *a number the subject sets cannot adjudicate the design*;
   here it would not be a metric but the price list.

**Schedule a creature woken by a *free action* at `now`.** #125's option 1, and the fix the first
statement of the mechanism implied. Rejected because it is the same rule read off one reproduction:
it closes the flash route and leaves the run start open on about one start in nine, and — worse — it
leaves `economy.test.ts`'s `beginRun` reproduction **passing**, which is the signal that would get
§4's guard enabled over a corpus that cannot see the remaining route.

**Advance the clock on a free action.** #125's option 2. Rejected outright: that is what "free" means.
A free command that hands every creature on the floor a turn is the exact failure `turn.test.ts` and
`TurnCost`-with-no-default exist to make unavailable, and it would price tempo when the thing being
priced is waking (§2's argument for the free toggle, on Pillar 3, is unchanged).

**Make `beginRun` run the full phase list.** Superficially attractive — it would make the run start
identical to a descent by construction. Rejected: phase 2 would burn the opening's fuel and phase 6
would tick the adaptation ramp, both of which §4 explicitly says the opening perception does not pay
for, and phase 4 would hand the floor a turn before the player has had one. It fixes one route by
breaking three settled rules, and it does nothing for the free action.

## Consequences

- **§4's cornerstone sentence becomes true again** rather than being softened, and its regression
  guard — *no run may bank ember from a creature it woke without paying HP for it* — becomes
  enable-able. It then stands on a scheduling rule with one call site instead of on an arithmetic
  proof that had a hole in it.
- **The opening gets a command tighter on about one run start in nine — not 2 HP more expensive, and
  the first draft of this ADR said otherwise.** Measured over a `beginRun` wake played
  close-then-strike, and re-measured by the review as the **minimum over every legal line of play**
  (moves, the bump, `wait`, and the free shutter toggle) to depth 9: the window is worth **0 HP at
  Manhattan 1-2** and is otherwise spent closing the
  distance (2 HP at 3 and at 4), with **no line of play making a Manhattan-3 or -4 opening free**.
  The same search from a *flash* wake gives the same four cells, so the two routes are mechanically
  identical and what separates them is only the distance distribution §5 imposes on an opening.
  §5 step 7 keeps every creature at least Manhattan 3 from the
  entrance, so **an opening wake already costs the full 2 HP** on a generated floor: one in nine is
  the frequency of the *grace*, not of a free kill, and the HP leaks through the **free action**.
  #125's Reproduction B is a hand-built floor at Manhattan 2 — a correct proof of the mechanism, not
  a shape the generator produces at an opening. It cannot produce a first-command hit either: that
  far out, a woken creature always declares a *move*. **State the free kill by its condition** —
  *the player can land both strikes before the creature resolves an attack on the tile they are
  standing on* — and not by adjacency, which is narrower than the evidence.
- **One retellable moment is deleted** — *I flashed, it woke, and I killed it before it could swing*.
  Paid deliberately: the thing it was buying is a wake that costs nothing.
- **`RULES_VERSION` 6 → 7**, with all three stored fixtures re-recorded. Any record whose log contains
  a `setShutter` that woke something, or whose run start woke something, replays differently.
- **No number in §3 or §4 moves.** #109 still gates every fuel and combat constant, and this ruling is
  sequenced ahead of #109 precisely so that #109 measures the game rather than this artefact.
- **Baiting survives**, checked rather than assumed: under the rule, #125's `beginRun` reproduction has
  the creature spend its first action resolving a *move* onto a tile the player has since occupied.

### What would make us revisit it

A playtest reporting that a **run start** which wakes something is unfair — a player taking damage on
floor 1 before they have understood what the lantern does. That would mean the cost landed on the one
frame §4 reserves for teaching, and the response is to keep this rule and make the opening safe by
*generation* (§5's exclusion radius), not to restore the grace turn: a grace turn is invisible and an
exclusion radius is not.

The signal that would **not** reopen it is the too-strong arm — a playtest reporting the lantern opened
only when lost. That arm is already watched in §4, it spends §12 rather than a constant, and §3's
combat numbers are its answer, after #109.

> **That arm fired on 2026-08-03 and was ruled on 2026-08-04
> ([ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md)), and this paragraph's conclusion holds
> while its last clause does not.** This ADR is **not reopened**: the ruling records #133 as having
> pushed the arm the wrong way *deliberately and correctly* — deleting the grace turn removed a
> discount worth 14.5% of `STALKER`'s woken kills, which is what #125 ruled and what §4's cornerstone
> sentence requires. What is wrong is *"§3's combat numbers are its answer"*: ADR-0015 rules that **no
> number is the answer**, and the response is a rule change ([#144](../../issues/144)) aimed at the
> wager's cost side.

### How this was verified

Twice, because ADR-0013 says the arithmetic is not to be trusted on its own.

**Before the ruling was written**, the rule was applied by hand to an already-woken creature through
the exported `reschedule`: both of `economy.test.ts`'s reproductions end at **10/12 HP**, i.e. §3's 2
in both, against 12/12 in the build as it stands; and the paid path reads
`player@100, creature@100, now=100`, which is what `now + ACTION_COST` already produces.

**On review of the ruling**, it was implemented as a mutant in `setMind` and the whole suite run.
**9 of 1167 tests red, in four files**, every one of them enumerated in GDD §4's *What a build owes*
and classified there as re-point or re-author. The corpus goes from **56 of 386** free woken kills to
**0 of 387** — the guard holding, measured rather than argued. The mutant also found the trap in
criterion 1: reading the player's due instant *above* `setMind`'s `hasActor` early return throws on
every run that ends in a death, because `resolveAttack` unschedules the dead player — **33** further
tests. That is exactly the class of thing this ADR's own subject says you find by building it and
not by reading it.
