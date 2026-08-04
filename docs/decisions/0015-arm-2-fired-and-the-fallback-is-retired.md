# ADR-0015: §12's arm 2 has fired — and what it fires is retired, not spent

**Status:** Accepted
**Date:** 2026-08-04

Supersedes [ADR-0012](0012-the-fallback-trigger-is-a-verdict-not-a-signature.md). Decided while ruling
[#139](../../issues/139). It changes what `VISION.md`'s *If this fails* paragraph and GDD §12 promise,
which is the concept's escape hatch, so it is an ADR and not a document edit. It does **not** change a
pillar: all four survive this ruling unamended, and one of them is the reason the ruling comes out the
way it does.

## Context

ADR-0012 restated §12's trip-wire as two arms and a bound:

> 1. **A playtest that cannot name a tense turn.**
> 2. **A playtest that reports the lantern being opened only when lost.**
>
> **Bound: the next broad playtest after #123.**

That playtest ran on **PR #136** (#133's build), 2026-08-03 — 6 hand-played runs across 7 seeds plus 13
automated full runs on 9 seeds, broad by ADR-0012's own bar and then some. It answers arm **1**
emphatically in the negative (a named retellable moment; 13 of 38 sampled turns as real decisions) and
it reports arm **2 in as many words**: *"§12's 'the lantern opened only when lost' arm firing, and it is
not a hypothesis any more."*

**The measurement behind it**, all from that playtest unless marked:

| | |
| --- | --- |
| zero-strategy wanderer, **never opens the shutter** | reached floor 8 on **9 of 9** seeds, no deaths |
| the same bot, lantern left **open** | died in **4 of 4** |
| A/B, seed `pt-11`, floor 1, identical 10-move route | lit **85** fuel *having taken the cache*; dark **89** *having forfeited it* — dark gives up 21 fuel and is still ahead, at identical HP |
| dormant strike in the dark (`pt-195`) | 1 command, **0 HP**, +19 fuel |
| woken kill played lit (`pt-195`) | 5 commands, **2 HP**, +16 fuel, and 16 fuel burnt during the approach — net 0 |
| shutter opened on purpose, across four hand-played runs | **twice**, and the playtester was not clearly glad either time |
| pure-dark autoplay, 8 floors (#108, PR #106) | reached the bottom at **12/12 HP**, no damage in **824 turns** |

**The mechanism is HP, not fuel.** Light converts a free dormant kill into a 2 HP woken kill, and #133
made that worse on purpose: deleting the grace turn removed a discount worth 14.5% of `STALKER`'s woken
kills (56/386 → **0/387**; `FLOODLIT` 22/247 → **0/252**). That was correct — it is what #125 ruled —
and it makes the too-strong arm stronger.

**The constants, re-derived from the build on 2026-08-04 rather than quoted:** `CACHE_SLOTS = 2` with
`count = int(rng, 0, 1)` at `CACHE_FUEL = 25` → **25-50 fuel a floor, gated behind light**
(`game/map/generate.ts:103,612`, `game/content/lantern.ts:62`); `creatureCount = min(2 + floor, 6)` at
`CINDER.emberDrop = 20` → **60-120 a floor, gated behind nothing** (`game/map/generate.ts:127`,
`game/content/creatures.ts:72`). `LIT_RADIUS = 4` against `EMBER_SENSE_RADIUS = 5` through walls
(`game/fov/vision.ts:30,36`). Burn 4 lit against 1 shuttered (`game/content/lantern.ts:34,37`).

**The corpus, re-run today** (`npx vitest run game/systems/economy.test.ts`, 22 passed): `STALKER` cache
take **117/121**, `DARK_PACIFIST` **0/121**; net fuel per floor `STALKER` **+6**, pacifist **−111**;
turns before the lantern dies — floodlit 26, flashing 65, dark 80; **dry crawl reached the stairs on
80 of 80 floors.** (§4 and the roadmap both still carried `114/121` and `+7`, which were true at PR #106
and have been stale through three rule changes since. Corrected in this PR.)

## Decision

**Three parts, and the second is the one that is not a formality.**

### 1. Arm 2 has fired

Plainly, and with no scoping clause added after the fact. A broad playtest inside the stated bound
reported the arm in the arm's own words, with numbers, and nothing about the report is ambiguous.

Every available route to *not fired* requires reading the arm more narrowly than it was written, and
ADR-0012 exists precisely to forbid that: *"a trip-wire that survives its own firing condition is one
nobody will ever trip."* Arm 2 has no tuning escape clause. The three arguments recorded against firing
are each answered below and none of them survives.

### 2. What arm 2 fires is **not** §12's fallback. The fallback's *automatic* character is **retired**

§12's designated fallback is **pure positional tactics with enemies whose fixed patterns force
contact** — a different enemy, a different level generator, a different win condition. **It is not
"subtract fuel", this ADR does not argue against that strawman, and the distinction is load-bearing.**
#63 corrected the misreading, GDD §12 carries the correction eight lines above the #121 trigger block
this ruling supersedes, and ADR-0012 records that *"the whole weight of ruling not fired rests on the
fallback being a rebuild rather than an adjustment."*

**Read correctly, the fallback would work, and that has to be said before anything else.** Forced
contact is an HP mechanism. It delivers proposition (a) below — *a run that never opens the shutter can
die* — **by construction**, because there is no shutter and the enemy is designed to reach you. It is
the only design on the table that delivers (a) without an argument. *(A first draft of this ADR claimed
the fallback "does not address the measured cause". That was written against the wrong reading of §12
and it **inverts** under the right one. It is deleted rather than softened, and it is recorded here
because it is the mistake this project has now made three times.)*

**What is withdrawn is the fallback's *automatic* character** — *if the trigger fires, do this, without
further argument* — which is what made it a **designated** fallback rather than an option. Firing arm 2
does not license the rebuild without further argument, because arm 2's finding is compatible with a much
cheaper subtraction that has never been tried.

**What is not withdrawn is the design.** It is not demoted to the company of *light as a ward* and *a
second resource bar*; on the corrected reading it is the strongest known alternative, and
[#145](../../issues/145) names it as the **leading candidate** at the design review it sends us to if
the cheap subtraction fails. *(A first draft called it "an ordinary alternative that lost". That was
wrong and unfair to it.)*

What survives from §12 as a live rule is the **constraint**:

> The response to a failed wager is **subtraction and rebuild**, never a second mechanic bolted on top.

That constraint is now what `VISION.md`'s *If this fails* paragraph promises, alongside #63's
correction about the fallback's **size**, which `VISION.md` keeps.

ADR-0012 rejected *fired-and-overridden* as "the worst of both", and it was right — but it said the
reason precisely: **"Either the condition is wrong or the conclusion is; here the condition was."** This
ruling takes the other branch. The condition is sound and it fired; the **conclusion — that firing
licenses the rebuild automatically — is wrong**, and it is replaced rather than ignored. Nothing is left
hanging in a document waiting to be re-read as a threat that never lands.

### 3. What is adopted instead: the wager's **cost side** is rebuilt

The finding is not that the concept produces no tension. It is that **the tension is one-sided**: every
source of danger in this game is downstream of the lantern, so the dominant strategy is to decline the
only source of danger. The rebuild target is stated as two propositions that must become true of the
build:

> **(a) A run that never opens the shutter must be able to die of the dark.**
> **(b) Waking something must be able to be worth it.**

And one constraint, inherited from §12 above and from `VISION.md`: **the change must be a subtraction
from an existing rule, not a new system.** If (a) and (b) can only be bought by adding a mechanic, that
is the concept failing, and the new trip-wire below fires.

**This commitment does not depend on any measurement.** There is no result #109 can return that clears
it. A rule changes; #109 decides *which lever and by how much*, not *whether*. It is meant to be quoted
back at the next session that would rather tune something.

**What this costs, as a size rather than by analogy.** *A first draft called it "an M2-scale rebuild"
and that was an overstatement.* The constraint is a **subtraction from an existing rule**, and #144's
recommended lever deletes **one exception clause** in §4. The honest size is **one rule change, its
build, and a playtest** — roughly #31/#41 or #83, not a milestone. **It is far cheaper than spending the
fallback, and that is the point rather than a concession**: the whole ruling is that the cheap
experiment has never been run.

**So the anti-evasion defence does not rest on cost parity, and the first draft's version of it —
*"does the ruling cost as much as firing?"* — is withdrawn.** It rests on two things a reader can check:

- **[#145](../../issues/145) is a real bound**: an issue rather than a sentence, with three fire
  criteria and three clear criteria stated in advance, one of them falsifiable in the corpus — *over at
  least nine seeds the never-flash line must not reach floor 8 on every seed at full HP*.
- **[#144](../../issues/144) cannot be discharged by a tuning pass.** It rejects `CACHE_FUEL` and
  0-fuel-lethality **by name**, and it requires a §4 rule change with a change-log row. A session that
  would rather move a number cannot satisfy it.

**Which lever is a separate ruling** — [#144](../../issues/144), with a recommendation already stated
in it (light-gate the creature ember drop, mirroring #31/#41's rule for caches; runner-up: a dark
strike wakes everything that can feel it). It is separate because the leading candidate collides with
§4's *0 fuel is a desperate state, not a loss state* and that collision has to be ruled with it, not
around it. It is **not** gated on #109: it is ruled in the next design session with or without the
measurement.

## Why arm 2 fired — the three arguments against, answered

**"The playtest classifies its own finding as *tuning*."** It does, and the classification is not the
playtester's to make. ADR-0012's own table records the first playtest's *dark strictly dominates* (#31)
the same way, and that classification has now been falsified twice: #31/#41 was a **rule** change, not a
number, and it was stated at the time as *necessary and not sufficient*. Two rounds of "the numbers will
sort this out" have produced one rule change that worked at exactly what it aimed at and left the
dominance intact.

More decisively, **tuning cannot reach either of the two propositions this ruling adopts** — but the
argument has to be stated carefully, because *a first draft of this ADR stated it wrongly and the wrong
version is checkable in ten seconds.*

**What the draft claimed and what is actually true.** It said the player knows the flash's *exact price
and exact product*, so the decision is a comparison of two known integers. **The product half is false
of the build, and §4 made it false on purpose.** `perceivedTileAt` returns `FLOOR` for any cache the
lantern has never lit (`game/fov/vision.ts`); `render/scene.ts`'s `buildCell` calls it rather than
indexing `grid.tiles`, so nothing above `game/` leaks it; ember-sense returns creature positions and
nothing else (`game/fov/embersense.ts`); and whether a given room holds a cache — and whether the floor
holds one or two — is a hidden draw (`int(rng, 0, CACHE_SLOTS - 1)` over leaf-weighted rooms,
`game/map/generate.ts`). §4 rejected the scuff cue *precisely* to keep the product unknown, so citing
that rejection as evidence the game is already a permission check has it exactly backwards. **The price
half is true only in principle**: containment holds as arithmetic, and #82 measured the containment read
as *"unexecutable on screen — a playtester who had read §4 and knew the metric miscounted a column and
woke a Cinder"*, and it is suspended outright for the four turns of the adaptation ramp, which
`TURNS_TO_FULL_ADAPTATION`'s own comment calls the tensest state in the game for that reason.

**So the flash is a genuine decision — known price, unknown product — and the claim that no band exists
is retracted.** Raising `CACHE_FUEL` *can* make light's ledger positive. That band is reachable.

**What tuning cannot reach is either proposition, and that is all the ruling needs.**

- **(a) A never-flash line able to die.** No constant puts a threat into a shuttered floor. *Nothing
  wakes in the dark* is a rule, and *a pursuer cannot hit a moving player* is a consequence of §2's
  commit rule that #121 ruled unreachable by speed (cadence breaks §2) or by cleverness (a pursuer is
  behind you, so the tile it predicts is one it cannot name). There is no number whose value changes
  either sentence.
- **(b) Waking able to be worth it.** `resolveDeaths` pushes `creatureDefinition(actor.species).emberDrop`
  with **no reference to mind state** (`game/systems/combat.ts`). A sleeper and a hunter pay the
  identical 20. **No value of `emberDrop`, `PLAYER_ATTACK` or `CINDER.maxHp` makes waking beneficial,
  because the same number stands on both sides of the comparison** — while a dormant kill costs one
  command and 0 HP against two commands and 2 HP. Making the two differ requires a branch that does not
  exist, which is a rule change and not a number.

**And the thing tuning *can* reach is a trap worth naming.** Raising `CACHE_FUEL` far enough would
satisfy §4's **invariant 4** — a flashing style out-earning a never-flash one — while leaving both
propositions false, because what it pays for is flashing **away** from creatures: crawl the room dark,
kill everything, *then* flash for the cache. That is the line #108 measured as best today. **So invariant
4 going green is not by itself evidence that the wager works**, and a re-tune aimed at it would buy a
green assertion and no game. That is a sharper reason for §4's freeze than the draft's, and it is why
#109's number must be read *beside* the two propositions rather than instead of them.

**"#109 has not run, so firing now is firing before the diagnosis."** The diagnosis is in hand and #109
does not carry it. #109 is one corpus style; what it produces is a number for *how far* a never-flash
fighter out-earns a flashing one. That the never-flash fighter out-earns is already established three
independent ways — a zero-strategy bot at 9 of 9 against 4 of 4, a hand A/B on an identical route where
dark forfeits a whole cache and still wins, and arithmetic on constants re-derived from the build today
(60-120 against 25-50 a floor, and the 60-120 is the side that is free). **#109 adds precision, not
permission.** Firing a trip-wire that requires a playtest report is not "before the diagnosis" when the
report arrived with the diagnosis attached.

**"Arm 1 came back emphatically negative."** It did, and this is the strongest of the three — but the
arms were written as **either**, deliberately, and they were written that way because they fail
differently. Arm 1 asks whether the concept produces tension anywhere. Arm 2 asks whether the *light
decision* is one a player will pay for. Both can be true at once, and here they are: the run this
playtest could retell is *"I felt a `*` through a wall, walked around it blind, and killed it for 19
fuel and no damage"* — a moment in which **the shutter never opened**. That is arm 1 satisfied by
darkness and arm 2 firing in the same sentence. A concept whose best moment requires never using half of
itself has half a concept working, which is exactly the state arm 2 names.

## Why the fallback is not the response — two reasons, where a first draft had four

**Two of the draft's four are deleted rather than softened, and both died the same way: they argued
against *subtract fuel* instead of against §12's actual text.**

- ***"It does not address the measured cause — the mechanism is HP, not fuel."*** **Inverts** under the
  correct reading. Enemies whose fixed patterns **force contact** are an HP mechanism, so the fallback
  addresses an HP finding head-on and delivers proposition (a) by construction.
- ***"#63's ruling is fatal to it — strip fuel and nothing pays for a fight."*** #63's sentence is
  aimed at the playtester's proposal to strip fuel **from this game**, and it sits in the very paragraph
  that corrects the *subtract fuel* misreading. It says nothing about a design with a different enemy, a
  different generator and **a different win condition**, which does not need an economy to make you
  fight — the level does.

**What remains, and the ruling rests on exactly this:**

**1. It abandons a concept that is measuring well on the pillars it is not accused on.** §12 records why
positional tactics lost: *"It lost on Pillar 4 — a puzzle produces 'I played well', not 'the lantern died
on floor six and I crawled to the stairs' — and because it makes the glyph grid's signature look
(ADR-0003) irrelevant."* Pillar 1 and Pillar 4 are currently being **served**: 13 of 38 sampled turns as
real decisions, and a named retellable moment, **from the same report that fires arm 2**. Trading a
measured Pillar-1 and Pillar-4 success for a documented Pillar-4 regression is not supported by a finding
about the wager's cost side.

**2. The named cause has never once been attacked, and the fallback is the maximal response to it.**
Four rulings have moved rules *adjacent* to it — pursuit (#83), re-dormancy (#121/#123), the cache rule
(#31/#41), the grace turn (#125/#133) — and not one has touched either of the two facts under *What is
actually wrong* below. **Deleting the game before deleting one clause is not decisiveness; it is
skipping the cheap experiment.** #144's recommended lever is a single deleted exception, and if it fails
the fallback is still there, now with a measurement behind it.

**So this ruling is about ordering and proportionality, not about relevance** — a materially weaker
claim than the draft made, and the honest one. It is also why §12's entry is not demoted: on the
corrected reading the fallback would work, and #145 names it as the leading candidate if the cheap
subtraction does not.

*(A third draft argument — "the failure it was written for is not the failure that arrived" — survives
but is folded into reason 1, because it is the same point: a fallback for a concept that produces
nothing is being asked to answer a concept that produces something on one side only.)*

## What is actually wrong, stated once so the next ruling inherits it

Four facts, each verified against the build, which together are the whole of it:

1. **Nothing wakes in the dark** (§4). A run starts with the shutter open (`game/systems/run.ts`), so
   the opening perception is a forced flash — measured to wake at least one creature about **one run
   start in nine** (223 of 2000 through `openRun`). After that, a shuttered player wakes nothing.
2. **A pursuer cannot hit a moving player** (§4's own argument, ruled on #121). Given one legal move,
   the tiles a creature can name and the tiles the player can choose are disjoint.
3. Therefore **the only creature that can ever damage a never-flash player is one the run start woke**,
   and a moving player is not hit by that one either. Darkness is not merely cheap; it is **safe**. The
   824-turn, zero-damage autoplay is not an outlier, it is the structure.
4. **Waking has a cost and no benefit, and this is the fact that no constant can move.** A dormant
   Cinder dies to one strike (`PLAYER_ATTACK` 3 × `DORMANT_STRIKE_MULTIPLIER` 2 = 6 ≥ `CINDER.maxHp` 5)
   for one command and 0 HP; an awake one costs two commands and 2 HP. **And `resolveDeaths` pushes
   `creatureDefinition(actor.species).emberDrop` with no reference to mind state**
   (`game/systems/combat.ts`), so both pay the identical 20. The reward side of the comparison is the
   *same number*, which is why no value of it — or of `PLAYER_ATTACK`, or of `CINDER.maxHp` — makes
   waking worth doing. So light's product is 25-50 fuel a floor of caches, and its price is converting
   60-120 fuel a floor of free kills into 2 HP kills apiece.

**GDD §1's own answer table is falsified by (3) and (4).** It says *"fighting spends HP to earn fuel,
light spends fuel to preserve HP"* and *"do you ever want to wake an enemy? Constantly."* In the build,
light **spends HP**, and you never want to wake anything. Dark took both roles — the offensive one it
was designed for and the defensive one light was designed for — and a wager in which one option is
better on every axis is not a wager. That is the sentence the rebuild has to make false.

## Alternatives

**Rule *not fired* and re-set the bound to the playtest after #109.** The runner-up, and it is what the
roadmap, the journal and two reconciles all read as the likely outcome. It loses on what it would make
the trip-wire mean. The bound is spent; re-setting it to the next convenient milestone, in the same
session that concedes the arm was reported in its own words, converts a verdict into a deadline —
which is the exact thing ADR-0012 says the trip-wire is *not*. It would also be the **third** consecutive
"the measurement is the next step" deferral of the same finding (#31's playtest, PR #119's, this one),
and the pattern is now long enough to be the evidence rather than the excuse. If a trip-wire can survive
a report in its own words with numbers attached, it cannot fire at all, and a document should say so
rather than keep it.

**Rule *fired* and spend the fallback exactly as written.** The genuine alternative, and it is **stronger
than the first draft of this ADR allowed** — the draft argued against *subtract fuel* and was corrected
in review. Read as §12 actually writes it, the fallback is enemies whose fixed patterns **force
contact**, which delivers proposition (a) by construction: there is no shutter to decline, and the enemy
is designed to reach you. It is the only design on the table that does. Add that the project has now
spent four rulings refining a diagnosis that keeps being one layer short, and that §12 calls this design
*"the genuine runner-up and the strongest Pillar 1 and Pillar 3 fit of anything considered."*

**It loses on proportionality rather than on relevance, and that is a narrower win than it looks.** Two
things carry it: the Pillar 4 regression §12 records against it, weighed against Pillar 1 and Pillar 4
being *measurably served right now* by the same report that fires arm 2; and the fact that the named
cause has never once been attacked, while four adjacent rules have. **A fallback is a bet that the
concept cannot be made to work, and the evidence does not say that — it says nobody has tried the cheap
thing.** If #145 comes back with the cheap thing tried and failed, this alternative should win, and
#145 says so.

**Rule *fired*, keep the fallback on the books as the automatic consequent, and defer spending it.**
Rejected for ADR-0012's reason, unchanged: a trip-wire that has fired and been left in place stops
meaning anything. What goes is the *automatic* consequent; the design itself stays on the table and is
named as #145's leading candidate, which is not the same thing as deferring.

**Amend arm 2's wording so it does not fire on this report.** Rejected outright, and named so nobody
proposes it as housekeeping. Narrowing a trigger in the session that watches it fire is the purest form
of the failure ADR-0012 was written to prevent.

## Consequences

- **`VISION.md`'s *If this fails* paragraph loses its automatic prescription and keeps two things**: the
  direction (*subtraction and rebuild, never a second mechanic*), and **#63's correction about the
  fallback's size** — that it is a different enemy, generator and win condition, not "subtract fuel".
  That correction is **kept rather than deleted**; a first draft of this ruling removed it, which is how
  the *subtract fuel* misreading got into this ADR in the first place.
- **GDD §12's positional-tactics entry stops being the *designated* fallback and stays the strongest
  named alternative.** It is not demoted to the company of *light as a ward*. The project no longer has
  an **automatic** fallback, which is a real loss — a named fallback is what stops a failing project
  dithering — and the mitigation is that #145 names this design as the leading candidate at the review
  it sends us to, with three criteria stated in advance for getting there.
- **M2 grows a step and the fuel-economy re-tune is deleted from the plan.** The re-tune was never a
  numbered step; it was the unnumbered bullet gated on step 5. It is now ruled unable to fix the thing it
  was gated for, so it does not come back after #109 — what comes back is the cost-side rule change. Step
  6 (#82) stays last.
- **#109 survives and its job changes.** It stops being *the gate on a re-tune* and becomes *the
  instrument the rebuild is measured against*: a `HARVESTER` baseline taken **before** the rule change,
  so that after it there is a before-number to compare to. It goes next, for the same reason #133 was
  measured before and after.
- **§4's freeze on fuel numbers stays, and hardens — for a narrower reason than the draft gave.** *No
  number in §4 moves* is no longer a sequencing courtesy pending #109; it is a ruling that **no number
  reaches either proposition**, and that the number most likely to be reached for, `CACHE_FUEL`, can
  turn invariant 4 green while leaving both propositions false. A re-tune may follow the rule change. It
  may not replace it.
- **Invariant 4 is demoted from sufficient to necessary.** It was the project's proxy for *the wager
  works*; this ruling establishes it can be satisfied by paying the player to flash **away** from
  creatures. #109's number is read beside the two propositions, never instead of them.
- **M2's exit criterion is unchanged**, for the third time: *the light decision recurring naturally and
  being genuinely tense, with specific turns named*. It is still the right question and this ruling is
  the reason it cannot currently be signed.
- **No pillar changes, and Pillar 2 is explicitly not the culprit.** A draft of this ADR implied
  containment had turned the flash into an arithmetic check; it has not — the product of a flash is
  hidden by design, and #82 measured the price read as unexecutable on screen anyway. Containment is
  kept, unqualified.
- **This ADR is the fourth consecutive ruling on the same finding.** #63, ADR-0011, ADR-0012, and now
  this one. That is worth saying out loud rather than burying: the finding has been correct every time
  and the diagnosis has moved every time. What is different here is that the ruling names a property of
  the build (darkness is safe) rather than a property of a rule, and commits to changing a rule
  regardless of what any measurement returns.

## The signal that this was wrong

**The new trip-wire, replacing ADR-0012's, stated in advance and in measurable terms.**

The concept is spent — and *spent* now means the concept goes back to a full design review with the
evidence, **with §12's positional-tactics design as the named leading candidate**, rather than that
design being adopted without argument — if **any** of these:

1. **The broad playtest after the cost-side rule change ships still reports either arm** — cannot name a
   tense turn, or the lantern opened only when lost.
2. **The rebuild cannot make a never-flash line die without adding a mechanic.** If the ruling on #144
   concludes that (a) and (b) are only reachable by a new system, the constraint has failed and that is
   the concept failing, not the constraint.
3. **`HARVESTER` still out-earns `STALKER` at comparable combat after the rule change** — §4 invariant 4,
   asserted in `game/systems/economy.test.ts` and not computed.

**Bound: the first broad playtest after the cost-side rule change is merged — filed as
[#145](../../issues/145), which *is* the bound.** ADR-0012's bound was a sentence in a document, and
establishing that it had been consumed took three documentation sweeps and this ruling. This one is an
issue, so *which playtest was the judging one* is a link rather than an argument.

Deliberately *not* "the playtest after #109": #109 is an instrument, and binding a trip-wire to a
measurement rather than to a change is how the last two bounds turned into deadlines. **Broad** keeps
ADR-0012's meaning — several runs across several seeds, asked about a *run*, not a narrow
build-verification brief.

**What clears it, so that the next session cannot argue either way from a mood.** All three, measured:

- **`HARVESTER` does not out-earn `STALKER`** in net fuel per floor over the corpus, asserted. Today
  `STALKER` nets **+6** a floor and no `HARVESTER` exists; #109 supplies the before-number.
- **A never-open-shutter line takes damage and can die.** Concretely: over a zero-strategy bot sweep of
  at least 9 seeds, the never-flash line must **not** reach floor 8 on every seed at full HP. Today it
  does — 9 of 9, and 824 turns at 12/12 in the pure-dark autoplay. This is the single number the whole
  rebuild is against.
- **The broad playtest can name a flash it was glad it made.** Not *a tense turn* — arm 1 is already
  satisfied by darkness and that is the trap this criterion exists to avoid. A turn where the player
  **opened the shutter** and was glad. Today the count across four hand-played runs is **two opened and
  zero glad**.

If all three come back and the playtest still cannot sign M2's criterion, then ADR-0012's own unused
fifth consequence applies and should finally be taken seriously: **the criterion is measuring something
a playtester cannot answer**, and that is the thing to fix next rather than the game.
