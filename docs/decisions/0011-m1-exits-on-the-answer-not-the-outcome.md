# ADR-0011: M1 exits on the concept checkpoint being *answered*, not on the wager being tense

**Status:** Accepted — **its trip-wire ("The signal that this was wrong", below) is restated by
[ADR-0012](0012-the-fallback-trigger-is-a-verdict-not-a-signature.md) and the restated version has now
**fired**: [ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md) ruled arm 2 fired on 2026-08-04
(#139), and §12's fallback **lost its *automatic* character rather than being spent** — it remains
the strongest named alternative. Do not act on the last section of this
document without reading ADR-0015; ADR-0012 is itself superseded. Nothing else here is superseded, and
M1's exit stands.
**Date:** 2026-07-31

Decided after M1's exit playtest (issue #87) and the `game-designer` ruling on #83/#63. It amends a
milestone exit criterion in `ROADMAP.md`, which `WORKFLOW.md` says deserves at least a journal entry
and preferably an ADR — this one gets an ADR because the criterion it changes is the one the whole
concept checkpoint hangs on.

## Context

M1's exit criterion has three clauses. The exit playtest signed off two without hedging:

- both endings — death and the eighth descent — reachable on a phone viewport, and
- moving and fighting feel good (60 taps at 16.6ms apart produced 60 turns with nothing dropped;
  one misfire in ~530 taps).

It could not sign the third:

> …and that the flash-and-crawl decision is one it actually made rather than one the rules merely
> permit.

Made about a dozen times in 359 turns, tense about three of them, none after floor 3.

**The reason is now understood and is not the one we held that morning.** The first playtest blamed
dark's dominance on §4's re-dormancy being unbuilt; that premise was false (it shipped in #16, and a
stale `(M2)` marker in the GDD misled it — see the journal). The exit playtest showed re-dormancy is
not a missing counterweight but the active cause: a flash that wakes something is undone by walking
away, and the retreat *profits* — measured at net **+4 fuel** after paying for the whole round trip,
and **fuel 23 → 60 with no damage taken** on floor 8 with the run on the line.

The `game-designer` then found the hole one layer further up: an awake creature that loses contact
**parks**. Re-dormancy is the refund; parking is what makes the refund collectable. The ruling is
that a woken Cinder **pursues** — recorded in GDD §4/§6 and built under #83.

## The problem with the criterion itself

**M1's third clause and M2's exit criterion overlap substantially enough that M1 cannot close before
M2 does.**

Not *the same sentence* — an earlier draft said that, and review pointed out the draft refutes itself
by printing both underneath. M1 asks whether the decision was **made rather than merely permitted**;
M2 asks whether it **recurs naturally and is genuinely tense**. Those differ, and on the exit
playtest's own evidence — made about a dozen times, 8 of 8 commands as real decisions with something
awake nearby — M1's literal clause was arguably already signable. The correction matters because this
ADR is what the next criterion amendment will cite.

What holds is the structural point:

- M1: *the flash-and-crawl decision is one it actually made rather than one the rules merely permit*
- M2: *the light decision recurring naturally and being genuinely tense*

Holding M1 open on that clause means **M1 cannot close until M2 is finished**, which makes them one
milestone with two names. `ROADMAP.md` half-admits this already: the concept checkpoint was moved
into M1's exit because "it has to land somewhere, and the first `playtester` run is the first moment
any of this is judged by something other than a passing test."

That reasoning was right about *when* the checkpoint should happen and wrong about *what passing it
means*. A checkpoint that asks a question is passed by an **answer**, not by a particular answer.

## Decision

**M1's third exit clause becomes:**

> The concept checkpoint has been answered — §12's fallback is spent or explicitly not spent, with
> the evidence and the consequent design change recorded.

M1 closes on that. **M2 keeps the tension criterion**, which is its actual job, and opens with #83's
build plus the re-measure the ruling specifies.

By that criterion M1 exits: the fallback is explicitly **not** spent, the evidence is on #87 and #31,
and the consequent design change — pursuit replacing parking — is ruled in GDD §4/§6 and filed as
#83.

## Alternatives

**Hold M1 open until a third playtest confirms the wager is tense.** Rejected: it is precisely the
collapse described above. M1 would close on M2's criterion, and the two milestones would become
indistinguishable — while M1's own goal (move around a generated level, fight something, and die or
reach the bottom) has been met and demonstrated.

**Drop the concept checkpoint from M1 entirely and let M2 own it.** Rejected for the reason the
roadmap moved it here in the first place: M1 is the first milestone that produces something a
playtester can judge, and deferring the *question* would waste that. What was wrong was tying M1's
exit to the answer coming out a particular way, not asking the question here.

**Declare the wager broken and spend §12's fallback now.** Rejected — see the ruling on #63. The
trigger is "the first playtest says the light wager is not tense"; neither playtest says that. Both
named tense light moments (the containment read, fighting blind with intent hidden, the adaptation
ramp) and complained about their **frequency**. §12's fallback is a different enemy, generator and
win condition, and it does not fix frequency.

## Consequences

- **M1 closes with five issues open** (#12, #47, #69, #70, and #87 — the exit verdict itself). None
  gates the goal; they move to M2 or stay open against M1 as record.
- **M2's exit criterion is now load-bearing in a way it was not.** It is the only place the wager is
  judged, so it must not be softened the way this clause was — if M2's playtest says the decision is
  still not tense, that is the moment the fallback is genuinely live.
- **The fallback survives unspent and its trigger is unchanged.** If a later playtest finds the
  concept dead after all, §12 is still there. This ADR narrows what M1 promises, not what the project
  is willing to conclude.
- **A milestone may now close while the thing it was meant to validate is still unproven**, which is
  a real cost and is the reason this is an ADR rather than a roadmap edit. The mitigation is that the
  unproven thing is named, owned by a milestone, and has a filed build plan (#83, #79, #31/#41, #82,
  and a corpus style) rather than being a hope.
- **The replacement clause is close to unfailable, and that is a genuine weakness rather than a
  quibble.** Review put it plainly: "the checkpoint has been answered, with the evidence recorded" is
  satisfied by a ruling of *any* quality. It is accepted here because the alternative — an exit
  criterion that requires a particular answer — is what produced the collapse this ADR exists to fix,
  and because the quality gate for a design ruling in this project is the `game-designer` and
  `code-reviewer` pass, not the milestone. **But it means M1's exit is no longer a real check**, and
  anyone citing this ADR to soften a future criterion should be made to argue the same trade rather
  than inherit it.

## The signal that this was wrong

If M2's playtest also cannot sign its tension criterion, and the ruling on #83 has landed and been
measured, then the checkpoint has been answered twice with "not yet" and the honest reading is that
the concept does not work. **That is what spends §12** — not a milestone deadline.
