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

### 2. What arm 2 fires is **not** §12's fallback. The fallback is **retired**, not spent

§12's designated fallback — *pure positional tactics, no resource at all*: delete fuel, the lantern and
the economy, and rebuild the enemy, the generator and the win condition around forced contact — **is
withdrawn as the prescribed response and is returned to being what the rest of §12 is: an alternative
that lost.**

What survives from §12, and it is the durable half, is the **constraint**:

> The response to a failed wager is **subtraction and rebuild**, never a second mechanic bolted on top.

That constraint is now what `VISION.md`'s *If this fails* paragraph promises. The prescription is gone.

ADR-0012 rejected *fired-and-overridden* as "the worst of both", and it was right — but it said the
reason precisely: **"Either the condition is wrong or the conclusion is; here the condition was."** This
ruling takes the other branch. The condition is sound and it fired; the **conclusion** is wrong, and it
is being replaced rather than ignored. Nothing is left hanging in a document waiting to be re-read as a
threat that never lands.

### 3. What is adopted instead: the wager's **cost side** is rebuilt, at M2 scale

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
it. A rule changes; #109 decides *which lever and by how much*, not *whether*. That sentence is what
separates this ruling from the evasion it would otherwise be, and it is meant to be quoted back at the
next session that would rather tune something.

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

More decisively, **tuning cannot reach this one, and the reason is structural rather than a matter of
degree.** §4's proudest Pillar-2 property is containment: *everything a flash can wake, you can already
feel*, guaranteed because `EMBER_SENSE_RADIUS` (5) exceeds `LIT_RADIUS` (4) and light additionally needs
line of sight. So at the moment of the flash decision the player knows the **exact** price in creatures
and the **exact** product (a room's shape, and 25 or 50 fuel if it holds a cache). Combat is
deterministic; there are no rolls. **A comparison of two known integers is not a wager — it is an
arithmetic check with a fixed answer.** Moving `CACHE_FUEL` does not create a band where the answer is
interesting; it moves *which side always wins*. Too low and the lantern is opened only when lost, which
is where we are. Too high and flashing is compulsory, which is §4's other watch (*flashing because it
must rather than because it chose to*) and is the same failure from the other end. §4 already refused a
proposal for exactly this shape — a cue on an unlit cache — on the ground that it *"makes the wager a
permission check"*. The game's dominant line is that permission check today.

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

## Why the fallback is the wrong instrument

**It does not address the measured cause.** §12's fallback is written as *subtract fuel*. The playtest's
own finding, in its own words, is that **the mechanism is HP, not fuel** — a dark line forfeits 21 fuel
of cache and still wins, because what it is really buying is not being hit. Deleting the resource the
measurement exonerates is not a fix; it is a change of subject.

**It trades a measured pillar success for a documented pillar regression.** §12 records why positional
tactics lost in the first place: *"It lost on Pillar 4 — a puzzle produces 'I played well', not 'the
lantern died on floor six and I crawled to the stairs' — and because it makes the glyph grid's
signature look (ADR-0003) irrelevant."* Pillar 1 and Pillar 4 are currently being **served**: 13 of 38
sampled turns as real decisions and a retellable moment, from the same report that fires arm 2. Adopting
a design the project has already ruled worse on Pillar 4, on the strength of a finding about the wager's
cost side, is not a trade the evidence supports.

**Its own prior ruling still holds and is fatal to it.** #63 established: *"strip fuel and nothing pays
for a fight, every fight is pure HP loss, and the optimal line becomes engaging nothing, ever — which
deletes the one state both playtests found excellent."* Nothing measured since weakens that. What the
new measurement adds is that the current game **already** has a line that takes no damage in 824 turns;
removing the reason to fight would generalise it rather than cure it.

**And the failure it was written for is not the failure that arrived.** §12's fallback answers *"the
light wager is not tense"*. What arrived is *"the light wager is tense and strictly dominated"* — a
different diagnosis with a different treatment. A fallback aimed at a concept that produces nothing is
the wrong tool for a concept that produces something on one side only.

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
4. **Waking has a cost and no benefit.** A dormant Cinder dies to one strike (`PLAYER_ATTACK` 3 ×
   `DORMANT_STRIKE_MULTIPLIER` 2 = 6 against 5 HP) and drops the same 20 ember an awake one does. So
   light's product is 25-50 fuel a floor of caches, and its price is converting 60-120 fuel a floor of
   free kills into 2 HP kills apiece.

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

**Rule *fired* and spend the fallback exactly as written.** The genuine alternative, and it is not a weak
position: the document says what it says, the project has spent three milestones refining a diagnosis
that keeps being one layer short, and §12 calls the positional design *"the genuine runner-up and the
strongest Pillar 1 and Pillar 3 fit of anything considered."* It loses on the four points under *Why the
fallback is the wrong instrument*, and above all on this: a fallback is a bet that the concept cannot be
made to work. The evidence in hand does not say that. It says one named, unaddressed asymmetry — dark
being safe as well as profitable — has never once been touched, while three other things around it have.
Spending a rebuild against a cause nobody has tried to remove is not decisiveness, it is a change of
subject with a milestone attached.

**Rule *fired*, keep the fallback on the books, and defer spending it.** Rejected for ADR-0012's reason,
unchanged: a trip-wire that has fired and been left in place stops meaning anything. Either it goes or
it fires. It goes.

**Amend arm 2's wording so it does not fire on this report.** Rejected outright, and named so nobody
proposes it as housekeeping. Narrowing a trigger in the session that watches it fire is the purest form
of the failure ADR-0012 was written to prevent.

## Consequences

- **`VISION.md`'s *If this fails* paragraph loses its prescription and keeps its direction.** Subtract
  and rebuild, yes; *pure positional tactics*, no longer. `VISION.md` and GDD §12 both carry the change.
- **GDD §12's positional-tactics entry becomes an ordinary *alternative that lost*** — which is what the
  rest of that section is. The project no longer has a designated fallback, and that is a real loss: a
  named fallback is what stops a failing project dithering. It is accepted because a fallback the
  measurement says is the wrong instrument buys nothing but the illusion of a plan.
- **M2 grows a step and the fuel-economy re-tune is deleted from the plan.** The re-tune was never a
  numbered step; it was the unnumbered bullet gated on step 5. It is now ruled unable to fix the thing it
  was gated for, so it does not come back after #109 — what comes back is the cost-side rule change. Step
  6 (#82) stays last.
- **#109 survives and its job changes.** It stops being *the gate on a re-tune* and becomes *the
  instrument the rebuild is measured against*: a `HARVESTER` baseline taken **before** the rule change,
  so that after it there is a before-number to compare to. It goes next, for the same reason #133 was
  measured before and after.
- **§4's freeze on fuel numbers stays, and hardens.** *No number in §4 moves* is no longer a sequencing
  courtesy pending #109; it is a ruling that numbers are not the fix. A re-tune may follow the rule
  change. It may not replace it.
- **M2's exit criterion is unchanged**, for the third time: *the light decision recurring naturally and
  being genuinely tense, with specific turns named*. It is still the right question and this ruling is
  the reason it cannot currently be signed.
- **No pillar changes.** Pillar 1 is what condemns the flash-as-arithmetic-check; Pillar 2's containment
  guarantee is what makes it an arithmetic check, and it is kept anyway, because a legible wager that is
  currently one-sided is a better problem than an illegible one that is balanced.
- **This ADR is the fourth consecutive ruling on the same finding.** #63, ADR-0011, ADR-0012, and now
  this one. That is worth saying out loud rather than burying: the finding has been correct every time
  and the diagnosis has moved every time. What is different here is that the ruling names a property of
  the build (darkness is safe) rather than a property of a rule, and commits to changing a rule
  regardless of what any measurement returns.

## The signal that this was wrong

**The new trip-wire, replacing ADR-0012's, stated in advance and in measurable terms.**

The concept is spent — and *spent* now means the concept goes back to a full design review with the
evidence, not that a pre-chosen fallback is adopted — if **any** of these:

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
