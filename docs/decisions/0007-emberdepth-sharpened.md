# ADR-0007: Emberdepth sharpened — darkness carries information, and fuel is earned

**Status:** Proposed — needs owner
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

**Requested of the owner:** amend the concept seed in `VISION.md` to match, or reject the change.
The specific sentences that are now wrong are "Lit tiles are safe and legible" (they are legible but
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
