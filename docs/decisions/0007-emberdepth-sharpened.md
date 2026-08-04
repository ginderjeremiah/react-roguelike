# ADR-0007: Emberdepth sharpened — darkness carries information, and fuel is earned

**Status:** Accepted — **its *Revisit if* signal has fired** (2026-08-03, PR #136; ruled 2026-08-04 by
[ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md)). The concept survives and is not
superseded; its **cost side** is being rebuilt. **This file mentions §12's fallback in three places —
*Context*, *Alternatives considered*, and *Revisit if* — and all three are superseded by the same
fact: what the fallback lost is its *automatic* character, not its place.** Each described GDD §12
accurately on the day; none is edited, and the note under *Consequences* is the correction for all
three — including the ***subtract fuel* misreading** two of them repeat. One further sentence of this
ADR is falsified by the build and is called out there too.
**Date:** 2026-07-29

## Context

`VISION.md` carries a concept seed marked *proposed*, written during project setup as something to
attack rather than agree with. M0 issue #4 is the attack. The seed says:

> - Your lantern burns fuel every turn it is lit. Fuel is the run timer, and it is scarce.
> - Lit tiles are safe and legible — you see enemies, their intent, and the layout.
> - Unlit tiles hide the map, but many of the ruin's inhabitants are *dormant in darkness* and wake
>   in light. Moving dark is faster and cheaper but blind.
> - So the central loop is a wager made every few turns: burn fuel to see and be seen, or move dark
>   and gamble on what you cannot see.

The design review found this is not a wager. Light has exactly one benefit (information) and
exactly one cost (fuel, plus waking things). Dark has exactly one benefit (saving fuel, plus things
stay asleep) and exactly one cost (no information). Each option is a scalar, so the choice collapses
to a threshold rule: **shutter the lantern unless you are lost.** Worse, dark dominates on safety
*and* on cost simultaneously, so the lantern becomes a failure button rather than a decision — and
turns spent crawling blind with nothing to read are exactly the autopilot turns Pillar 1 forbids.

The four open questions recorded in GDD §1 — is one resource enough, what makes dark actively
attractive, do you ever want to wake something, how do you map unlit space — are four symptoms of
that one structural flaw, which is why none of them has a satisfying answer inside the seed as
written.

Replacing the concept outright was seriously considered. See `docs/GDD.md` §12 for the alternatives
and why each lost; the runner-up (pure positional tactics, no resource) is recorded there as the
designated fallback if M2 shows the light wager is not tense.

## Decision

Keep the lantern, the fuel, and dormancy. Change three things, and record that the concept seed's
wording in `VISION.md` no longer describes the game.

**1. Darkness is not an absence of information. It is different information.**

Shuttered, the player has *ember-sense*: the position of every living thing within radius 6,
**through walls**. No identity, no health, no intent. Lit, the player sees terrain, items,
creatures, and intent within radius 4, blocked by walls.

> **Amended 2026-07-31.** The radius is now **5**, and the metric is **Chebyshev** — neither was
> stated when this ADR was written. Chebyshev 6 is a 13×13 box on a 165-tile map: from the middle
> band it covers ~87% of the floor and stops varying with position, which falsifies §5's own
> worked example and makes the top two steps of the dark-adaptation ramp provable no-ops. The
> decision this ADR records — that darkness carries information light cannot — is unchanged; only
> the number is. See `docs/GDD.md` §4 and issue #25.

So: **light shows you stone, dark shows you souls.** Neither state is blind. The recurring decision
is which half of the truth you want, and the asymmetry that keeps it live is that ember-sense
ignores walls while light does not — darkness tells you something light physically cannot.

**2. Fuel is earned by killing, not only found.**

Creatures are made of ember; killing one refuels the lantern. This is what gives the player a reason
to *want* to wake something. Without it, light is strictly defensive and the central decision
flattens, exactly as the open question predicted.

**3. Darkness has a capability, not a discount: the dormant strike.**

Attacking a dormant creature deals double damage. Free kills exist and exist only in the dark,
because opening the shutter is what wakes things. Combined with (2), the loop becomes *flash and
crawl*: crawl dark to stalk and steer, flash to learn a room's shape and find its cache, accept
that the flash announced you, deal with what you woke.

A fourth, smaller change follows: the second axis the wager needed is **HP**, which already existed.
Fighting spends HP to earn fuel; light spends fuel to preserve HP. No new resource, no new bar.

The full specification lives in `docs/GDD.md` §1-§6. This ADR records only what changed about the
concept and why, because that is the part `VISION.md` currently states differently.

**`VISION.md` has been amended to match.** The specific sentences that were wrong were "Lit tiles are safe and legible" (they are legible but
they are where everything wakes up, so they are the *unsafe* ones), "Unlit tiles hide the map"
(unlit tiles hide the map and reveal the inhabitants), and "Moving dark is faster and cheaper but
blind" (moving dark is the same speed, cheaper, and differently-sighted). "Fuel is the run timer"
survives — fuel still burns every turn, just at two rates.

## Alternatives considered

**Accept the seed as written and build it.** The failure mode this review exists to prevent. The
seed is not wrong in its parts; it is wrong in that its two options are each one-dimensional, and
one-dimensional options make threshold rules instead of decisions. Discovering that in M2 costs a
milestone; discovering it now costs a document.

**Replace the concept with pure positional tactics, no resource clock.** Strongest Pillar 1 and
Pillar 3 fit of anything considered, and a real contender. Lost on Pillar 4 — geometry puzzles
produce "I played well", not "the lantern died on floor six" — and because it discards the
concept-to-technology fit that ADR-0003 was chosen for. Recorded in GDD §12 as the fallback rather
than dismissed, because if M2 says the wager is hollow, the correct move is to subtract fuel, not to
add another resource.

**Fix the flatness by adding a second resource bar** (heat, sanity, noise). Rejected: HP already is
the second axis, and it is convertible with fuel in one direction, which is what makes an economy
rather than two independent clocks. Adding a bar would have been additive design solving a problem
subtraction solved better.

**Make dark cheaper still (zero burn when shuttered) and let light be a pure event.** Tempting for
drama, and friendlier to a phone player who puts the device down mid-turn. Rejected because a free
turn is a turn with no cost to dithering, and Pillar 1 wants every turn to spend something. Kept as
a tuning lever if playtest reports fuel anxiety suppressing thought.

**Make dark slower (double action cost) to supply the second axis.** Would have worked, and was the
first candidate. Lost to "dark hides intent" because the tempo version is genuinely hard to
telegraph on a 6-inch screen — "this enemy will act twice before you" needs UI that a missing intent
marker does not.

## Consequences

The concept survives with its skeleton intact, so no setup work is wasted, but the claim it is built
on has changed: the game is no longer "pay to see". It is "choose what you can see", and light is
an offensive tool rather than a defensive one.

Makes easy: M1 and M2 have a concrete spec; ember-sense is trivial on a glyph grid (a dim `*` on an
unknown tile); the economy gives the difficulty curve a lever that is not HP inflation.

Makes hard: there are now two vision systems to implement and test rather than one, and two failure
modes to watch — ember-sense through walls may make levels feel transparent, and dark adaptation may
read as an unexplained bug rather than a mechanic. Both are named with cut signals in GDD §4.

**Revisit if:** the M2 playtest reports the light decision is not tense, or reports that the
lantern is opened only when lost. Either signal means the flatness was not actually fixed, and the
fallback in GDD §12 is the response — not another mechanic on top.

> **The second signal has fired — 2026-08-03, PR #136 — and it was ruled on 2026-08-04 (#139,
> [ADR-0015](0015-arm-2-fired-and-the-fallback-is-retired.md)). The last clause of the paragraph above
> is now wrong and the rest of it is right.** GDD §12's fallback is not *the* response any more: what
> is withdrawn is its **automatic** character, not the design. It loses on **proportionality** — it
> abandons a concept the same playtest measures as serving Pillars 1 and 4, before one clause has been
> deleted — and it remains the strongest named alternative and the leading candidate if the cheap
> subtraction fails ([#145](../../issues/145)). What survives of the sentence is its direction, *not
> another mechanic on top*, which ADR-0015 keeps as a hard constraint.
>
> **And this ADR states the *subtract fuel* misreading twice** — under *Alternatives considered*
> (*"the correct move is to subtract fuel, not to add another resource"*) and in the *Revisit if*
> clause. #63 corrected it and GDD §12 carries the correction: the fallback is **pure positional
> tactics with enemies whose fixed patterns force contact** — a different enemy, generator and win
> condition. A first draft of ADR-0015 argued against the misreading rather than against §12's text,
> and two of its four arguments **inverted** when that was caught in review. Read the corrected version
> before citing either sentence here.
>
> **This ADR's concept is not superseded and its central claim is still standing:** darkness carries
> information, and light is offensive rather than defensive. What the measurement found is that
> darkness carries *everything* — intel through walls, free kills, cheap burn **and safety** — because
> nothing wakes in the dark and a moving player cannot be hit. The flatness this ADR fixed is fixed;
> what replaced it is a one-sided wager. The rebuild ([#144](../../issues/144)) is aimed at the cost
> side of exactly the concept this ADR sharpened, not at replacing it.
>
> **One sentence of this ADR was falsified by the build, and it is under *Alternatives considered*
> above: *"'Fuel is the run timer' survives — fuel still burns every turn, just at two rates."*** It
> does burn at two rates, and it was not a timer: GDD §4 subsequently ruled 0 fuel *a desperate state,
> not a loss state*, and `game/systems/economy.test.ts` asserts a dry crawl reaches the stairs on
> **80 of 80** floors (re-run 2026-08-04). A style that does not want the lantern therefore had no
> clock at all, which is half of why the never-flash line dominates. Annotated rather than edited,
> per this directory's rule; [#144](../../issues/144) rules whether the sentence or the rule changes.
>
> **Ruled 2026-08-04 (#144): the sentence stands and the rule changes.** GDD §4's ***The dark can take
> nothing*** deletes *0 fuel is a desperate state, not a loss state* — **a lantern that goes out ends
> the run** — alongside light-gating the kill drop, which is what makes the clock bind on the style it
> was missing. So this ADR's sentence becomes true of the build for the first time when
> [#149](../../issues/149) merges. **The falsification note above is kept**, because the sentence was
> false for four milestones and a reader who finds only the resolution will not know that the
> *survives* was asserted rather than measured — which is the mistake, not the wording.
>
> **Two more of this ADR's sentences are in the same position and are repaired by the same ruling, so
> they get no separate note: *"Fighting spends HP to earn fuel; light spends fuel to preserve HP"*
> (change 4) and *"free kills exist and exist only in the dark"* (change 3).** In the build measured on
> 2026-08-04, light spent HP and bought nothing HP could not buy more cheaply, so the first was
> inverted; under #144 it holds in **both** directions, at a rate set by the order you fight and light
> in. The second is true and always was — the free kill is free of **HP**. What #144 takes from it is
> the *income*: a dark strike is a claim you have to go and light, not a payment.
