# ADR-0012: §12's fallback is spent by a verdict, not by an unsigned criterion

**Status:** **Superseded by [ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md)** — the bound
was spent by the PR #136 playtest (2026-08-03), #139 ruled on 2026-08-04 that **arm 2 fired**, and
ADR-0015 replaces the trigger, the bound, and what firing spends. **The restated trigger below is
history, not the live one** — do not act on it; ADR-0015 carries the live trip-wire. What survives
unchanged is this ADR's *reasoning* about why an unsigned criterion is not a verdict, and its table of
three playtests, both of which ADR-0015 relies on.
**Date:** 2026-08-02

Decided while ruling issue #121. It settles a sentence in `ROADMAP.md`'s M1 exit section that
[ADR-0011](0011-m1-exits-on-the-answer-not-the-outcome.md) wrote and that has now become live, and it
amends what M2's exit criterion implies about the concept. `WORKFLOW.md` says amending a milestone
exit deserves at least a journal entry and preferably an ADR; this one gets an ADR because the thing
on the other side of it is **deleting the game's central mechanic**.

## Context

ADR-0011 closed M1 on the concept checkpoint being *answered* rather than on the answer coming out a
particular way. It ended with a trip-wire, which `ROADMAP.md` carries verbatim:

> **M2 keeps the tension criterion, and it is now load-bearing in a way it was not.** It is the only
> place the wager is judged. If M2's playtest also cannot sign it, **with #83 landed and measured**,
> the checkpoint has been answered twice with "not yet" and *that* is what spends §12 — not a
> deadline.

Every clause of that condition is now satisfied on its face. #83 landed on 2026-08-02 and was
measured. The broad playtest the exit criteria call for ran on PR #119. It **could not sign** M2's
exit criterion: *"the light decision recurring naturally and being genuinely tense — and can point to
specific turns where it mattered."*

The reconcile after #119 declined to rule on it, recorded the recommendation against firing, and said
plainly that it is a `game-designer` call to be made deliberately rather than inferred. This is that
call.

§12's fallback is **pure positional tactics, no resource at all** — enemies with fixed readable
patterns, tension entirely from geometry. In practice: delete fuel, delete the lantern, delete the
economy that makes killing the income side, and rebuild the enemy, the generator and the win
condition around forced contact.

## Decision

**The trip-wire did not fire. §12's fallback is not spent.**

**And it is restated, because a trip-wire that survives its own firing condition is one nobody will
ever trip.** It now reads as two arms and a bound:

> §12's fallback is spent by either of:
>
> 1. **A playtest that cannot name a tense turn.** Not one that could not sign the criterion, not one
>    that wants the decision more often, not one that found a way to decline it — one that cannot
>    point at a single turn where the light decision mattered.
> 2. **A playtest that reports the lantern being opened only when lost.** VISION's own stated failure
>    condition, and the too-strong arm of §4's watch.
>
> **Bound: the next broad playtest after #123** — the build of #121's ruling — is the one that judges
> it. #121's fix is the last unbuilt thing that changes what the wager *costs*; build-order steps 5
> (#109) and 6 (#82) change what it is measured with and what it draws.

**That bound was met on 2026-08-03 and arm 2 was reported — see *The signal that this was wrong* at
the end of this file. Nothing has ruled on it: [#139](../../issues/139) is open.**

**The trigger above is restated in four other places and no two are word for word** — GDD §12 (its
own longer version, different bullet text), `ROADMAP.md`'s M1 exit section (the closest to this
text), `ROADMAP.md`'s header (a one-sentence summary) and M2's exit criteria (explicitly *"in
VISION's words"*). **All four now carry the same correction**, which is the part that was checked;
the wording is not, so read the site rather than assuming this one.

## Why it did not fire

**Because "cannot sign the criterion" and "says the wager is not tense" are different findings, and
only the second is §12's trigger.** §12's own words are *"if the first playtest says the light wager
is not tense"*. Three playtests have now returned three verdicts and they are not the same verdict:

| Playtest | Verdict | §12's question |
| --- | --- | --- |
| First (#31, against #20) | The parts work; dark strictly dominates. Classified **tuning, not mechanic** | not asked |
| M1 exit (#87) | **Tense and rare** — a dozen flash decisions in 359 turns, tense in about three, none after floor 3 | no |
| Post-#83 (PR #119) | **Tense and declinable** — a retellable moment (a doorway held for eight turns, 2 HP for 38 ember), specific tense turns named, and no pressure at all on a player who keeps walking. Pillar 1 rate 8 of 48, or 8 of 21 excluding traversal | no |

Each named a *different* tense thing: the containment read before a flash; fighting blind with intent
hidden; a doorway held against two hunters. A concept that produces a new species of tense moment
every time it is examined is not a concept nobody can find tension in.

**And a fallback that fires on any unsigned criterion is a fallback that fires on every unfinished
milestone.** `ROADMAP.md`'s own sentence ends *"not a deadline"*; reading it as "the second time a
criterion is unsigned" makes it exactly a deadline, measured in playtests instead of days.

Three further facts, none of which carries the ruling alone:

- **The PR #119 verdict arrives with a diagnosis, not a dead end.** #121 does not say the wager
  cannot be made to cost; it says the specific thing that made declining free is a rule, names it,
  and rules it out of existence.
- **It is the *earliest permissible* judging playtest**, build-order step 4 of six, not M2's last.
- **The two "not yet"s are not the same "not yet".** M1's was *the decision is too rare*; M2's is
  *the decision can be declined*. The second is not a repeat of the first — it is the discovery that
  the first was misdiagnosed. Being wrong twice about the cause is not evidence that the concept has
  no cause.

## Alternatives

**Rule that it fired and spend the fallback.** The serious runner-up, and it is not a weak position.
The trip-wire was written *knowing* #83 was the fix and *knowing* it would be built and measured
before the sentence could fire — so "it arrives with a named unbuilt fix" is an argument the sentence
already anticipated and rejected once. Ruling it again is, on its face, moving the goalposts.

It loses on the specific evidence rather than on principle. The trip-wire's premise was that #83
would either make the wager tense or prove it cannot be made tense. Neither happened: #83 measurably
fixed a thing it was aimed at, and revealed that the *diagnosis* had been one layer short. The
fallback exists for a concept that does not work, not for a project that has now twice found the
wrong layer of a working one.

**One qualification on that evidence, because a first draft of this ADR used the same measurement two
ways that cannot both hold.** The A/B from PR #119 — walking away 17 turns and −9 fuel against
standing's 9 turns and +6 — was cited here as *"the retreat exploit is no longer optimal"*, while GDD
§4 cites the same save point as leaving a sleeper worth 20 ember. Both cannot be read as the whole
ledger. **The reading that survives, and it is the one GDD §4 now states:** the A/B was run to the
moment each line *resolved*, and the walk-away line resolved with the creature asleep and alive, so
**the −9 excludes a refund that was still available.** With it, walking away is roughly +11 for about
four more turns of walking, against standing's +6 and 2 HP. **So the optimum moved much less than the
A/B alone suggests, and this ADR does not lean on it.** What it leans on instead is the one #83 result
that is unambiguous and was measured end to end: **0 fuel went from 143 inert turns with no way to
finish to a dead run in 6.** That is a total reversal, it is not a partial ledger, and it is enough to
carry *"#83 fixed a thing it was aimed at"* on its own. Recorded rather than quietly reworded, because
the weaker reading is the honest one and the next session should inherit it.

It also loses on what it costs to be wrong. Spending §12 is not a tuning pass — §12 itself says so,
and #63's ruling says so at length: it is a different enemy, a different generator and a different
win condition, and it deletes the mechanic that makes fighting pay. Getting that wrong costs the
project everything it has built; getting *this* wrong costs one more playtest.

**Rule that it fired but do not spend the fallback — treat it as fired-and-overridden.** Rejected as
the worst of both: it leaves a trip-wire in the document that has fired and been ignored, which is
how a trip-wire stops meaning anything. Either the condition is wrong or the conclusion is; here the
condition was.

**Leave the trigger as written and only rule this instance.** Rejected, and this is the part of the
ruling that is not a defence. A trigger that survives its own firing condition unamended is a trigger
that will never fire, because the next session will read this ADR and reason by analogy. If the
answer is "not this time", the document owes a statement of *which* time — which is why the decision
above is two named arms and a bound rather than a ruling on one playtest.

## Consequences

- **M2's exit criterion is unchanged.** What changes is what failing to sign it means: it means M2 is
  not finished, not that the concept is dead.
- **The next broad playtest is a judging one and should be briefed as such.** It runs after #123
  (#121's build) and it is asked both arms explicitly, in VISION's words, rather than being asked
  whether it can sign a criterion. **(It ran on PR #136 and was briefed this way; it answered arm 1
  no and arm 2 yes. The consequence this bullet did not anticipate is that the two arms can
  disagree, which is why #139 is a ruling rather than a readout.)**
- **§12 carries the restated trigger**, not just this ADR, because a session reaching for the
  fallback reaches for §12.
- **The fallback's cost is now written down where the trigger is.** It was previously easy to read
  §12 as "subtract fuel"; #63 already corrected that and this ADR repeats it, because the whole
  weight of ruling *not fired* rests on the fallback being a rebuild rather than an adjustment.
- **If both arms are silent and the criterion still cannot be signed after #123, the honest reading
  is neither "spend it" nor "not yet" but that M2's criterion is measuring something a playtester
  cannot answer.** That is a third possibility this project has not considered and it should be
  considered before a fourth playtest is spent on it.

## The signal that this was wrong

The next **broad** playtest after #123 names no tense turn, or reports the lantern being opened only
when lost. Then
the fallback is spent, on the terms above, with no further evidence required — and this ADR was a
milestone's delay bought for nothing.

**It has run, and it reports the second one — 2026-08-03, PR #136 (#133's build).** Broad by this
ADR's own bar: 6 hand-played runs across 7 seeds plus 13 automated full runs on 9 seeds. Its words:
*"§12's 'the lantern opened only when lost' arm firing, and it is not a hypothesis any more."* The
measurement behind it — a zero-strategy bot that never opens the shutter finishing **9 of 9** seeds,
the same bot dying **4 of 4** with the lantern open, and dark forfeiting **21 fuel** of cache on an
identical route and still finishing ahead, because the mechanism is **HP, not fuel**.

**This ADR does not rule on it, and no reader may infer the ruling from this note.** It is filed as
[#139](../../issues/139) precisely because the *Decision* above says the call is a `game-designer`'s
to make deliberately rather than inferred, and the evidence is not one-sided: the same playtest
answers arm **1** emphatically in the negative (a named retellable moment; 13 of 38 sampled turns as
real decisions), it classifies its own finding as **tuning** — the classification the table above
gives the first playtest's *dark strictly dominates* — and **#109, the gate that exists to measure
invariant 4, has not run**, so firing now is firing before the diagnosis. Against all three stands
this ADR's own reason for restating the trigger: a trip-wire that survives its own firing condition
is one nobody will ever trip, and arm 2 has no tuning escape clause.

**Two things #139 owes whichever way it goes.** If the arm fired: §12's fallback is a rebuild and
needs an ADR superseding this one. If it did not: **the bound is spent and a trip-wire with no bound
is not a trip-wire**, so it must be re-set to a specific later playtest — the obvious candidate being
the one after #109 — with the argument for why that is not simply the deadline this ADR refused to
become.

> **Ruled 2026-08-04 (#139): the arm fired, and the first branch is taken —
> [ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md) supersedes this ADR.** It takes one turn
> this ADR did not anticipate, and the turn is inside this ADR's own words. Under *Alternatives* above,
> *fired-and-overridden* is rejected with the sentence **"Either the condition is wrong or the
> conclusion is; here the condition was."** ADR-0015 takes the other branch: the condition was sound and
> it fired, and **the conclusion — §12's positional-tactics fallback — is what is wrong.** The fallback
> is therefore *retired* rather than spent, and what arm 2 fires instead is a rebuild of the wager's
> **cost side**, because the playtest's own finding is that the mechanism is **HP, not fuel**, and
> "subtract fuel" does not reach it. Read ADR-0015 before citing any sentence on this page.
