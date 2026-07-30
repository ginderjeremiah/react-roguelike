# ADR-0009: Auto-travel is one `travel(to)` command, and it is deferred to M2

**Status:** Accepted
**Date:** 2026-08-05

Decided by the `game-designer` on issue #32 and accepted in full. It records three rulings, of which
only the first was asked for; the other two fell out of trying to answer it.

## Context

GDD §9 has marked auto-travel *settled* since the M0 design review — "tap a distant **remembered**
tile to path toward it, interrupted the moment anything new becomes visible or sensed, or any
creature wakes" — and has never said how it is **commanded**. That looked like a UI detail and is
not one. The interrupt rule is computed from the lit field, the sensed set and the wake set, none of
which `components/` may touch, so the loop and the rule sit on opposite sides of the `game/`
boundary and the question is a determinism question. Two shapes were on the table:

- **One `travel(x, y)` command** resolving many turns inside `step()`. The rule stays in one place;
  a single command consumes an unbounded number of turns.
- **A UI-emitted sequence of `move` commands**, with the interrupt rule still inside `game/` but
  exposed as a query the presentation layer polls between commands. `step()` stays uniform; the loop
  lives above the simulation.

Three forces made this worth an ADR rather than a comment:

- **`game/core/command.ts` already has a rule that decides it**, and neither the issue nor the M0
  design review noticed: "a command carries intent, not resolution ... the moment the caller
  computes part of the answer, part of the rules live outside `step` and the replay stops being
  authoritative."
- **§9's interrupt wording is unimplementable as written, in both directions.** Travelling
  shuttered, the touch radius is 1 and nearly every step perceives a tile it has not perceived
  before — travel that never travels. Travelling lit, "anything new" is so broad it has no edge a
  player could state, which is the Pillar 2 failure the sentence exists to prevent. So the shape
  could not be settled without settling the rule.
- **Nothing above `game/` exists.** `render/` is #19 and unbuilt; nobody has tapped this game once.
  Auto-travel is a fix for a friction that has never been felt.

## Decision

### 1. The shape: a fifth command

```ts
| { readonly kind: 'travel'; readonly to: Position }
```

`step()` resolves it as **a fold of `move` commands** — one route step at a time, each a complete
six-phase turn (§2) — until a stop condition fires. One `step()` call, one `commandsResolved`, N
`turnsElapsed`. Contract point 5 already split those two counters for exactly this reason, and both
readings are the right ones: the player made one decision and spent N turns.

The load-bearing property, and the first line the implementation's header should carry:

> **A `travel` command must be indistinguishable from the sequence of `move` commands it stands
> for.** Same intermediate states, same fuel, same creature turns, same adaptation ticks. The only
> difference is how many taps it took.

That is a property test — `travel(to)` from `S` equals folding the corresponding `move` commands
over `S` — and it is what makes three otherwise separate questions answer themselves: the fuel
economy is arithmetically untouched, the spent turns are obviously spent, and the draw budget is
obviously unchanged. **If a state reachable by travel is not reachable by tapping the same steps one
at a time, travel has become a mechanic, and it is not allowed to be one.**

The draw budget needed less care than #32 feared. `descend` is the only command that draws and
travel never descends, so **a travel command consumes exactly zero draws**; `expectedDrawCount` is
unchanged and `replay.test.ts`'s budget walk needs no new arithmetic, because it counts descents.
Contract point 4 stays true verbatim.

### 2. The stop rule: you stop for the living

§9's "anything new becomes visible or sensed" **narrows**. Terrain never interrupts travel.

**Travel stops after a fully resolved step in which any of these happened:**

1. **A creature you were not perceiving is now perceived** — keyed to the creature, not to the tile.
2. **Any creature woke.**
3. **Your HP went down.**

**Travel stops before taking a step when:**

4. **The next tile on the route is occupied.** Travel never attacks, ever.
5. **There is no next step** — you arrived, or there is no route.

**And travel stops immediately if the run ends**, by §13's rule that a terminal state stops the turn
where it happens. A travel must not resolve one turn past a `died` status.

For the player that is one sentence, which is the test a rule has to pass in a game with no tutorial
text: **you walk until something living appears, or something touches you.**

Six rulings hang off that, and each is the answer to a question the implementation would otherwise
have invented:

- **The route runs over remembered, passable terrain only; unknown tiles are impassable.** This
  follows straight from §9's word *remembered*. A route over the true grid would walk the player
  through walls they have not discovered, and they would learn the floor's shape by watching where
  auto-travel chose to go — free map information, a Pillar 2 violation dressed as a pathfinding
  detail. The upside is that the route is legible by construction: it is computed from the same map
  the player is looking at, so they can trace it themselves. It also means **travel can never enter
  unmapped space**, which is what makes cutting the terrain clause safe.
- **Contact is keyed to the creature, not the tile.** A `*` moving from one tile to another is not a
  new contact, so a dark travel with an awake Cinder tracking you does not stop every turn. The
  player reads this as "a mark I had not seen before appeared", which is what identity-keying
  produces on screen even though the player is never given identity. A creature that leaves sense
  and re-enters correctly re-interrupts. It cannot be keyed to contact *count*: one creature leaving
  as another arrives leaves the count unchanged while something genuinely new is on screen.
- **Losing contact never interrupts.** Otherwise every dark travel that outpaces a known pursuer
  stops on its first step. An absence is also the least legible interrupt trigger available — the
  player would be asked to notice that a `*` is *not* there.
- **The wake clause is redundant today and stays anyway.** Nothing wakes while shuttered (§4), and a
  creature that wakes during a lit travel does so by entering the lit radius, where clause 1 sees it
  on the same step. It stays because it is the clause the player actually reads, and because the
  coincidence is a property of M1 having one creature: a future creature that wakes on proximity
  breaks it, and the rule should not have to be rediscovered then.
- **You can eat exactly one hit during a travel, and that is correct.** Vision recomputes in phase 3,
  before actors move in phase 4, so a creature that closes to adjacency during a travel step is not
  perceived until the next step's phase 3 — by which time its declared attack resolves in that
  step's phase 4. This is **not** extra exposure: a player walking one step at a time has the
  identical blind spot, because it is a property of §2's phase order, not of travel. Clause 3 bounds
  it to one hit.
- **An interrupted travel costs every turn it spent. There is no rewind**, at any granularity, ever.
  A travel *is* those turns: fuel burned, creatures acted, adaptation ticked.

**Refusals** are §2's kind — no phases, no cost, the input state returned by reference, neither
counter incremented:

| Refused | Because |
| --- | --- |
| `to` is the player's own tile | That is `wait` (§9) |
| `to` is not remembered | §9: a *remembered* tile. You cannot travel where you have not seen |
| `to` is remembered but impassable | There is nowhere to arrive |
| No route to `to` over remembered passable terrain | Reachable in play — the lit field can leave a remembered region that is not four-connected to you |

`to` **adjacent** is not refused; it resolves as a one-step travel. Refusing it would put a cliff at
distance 1 that a UI off-by-one turns into a dead tap, and there is no ambiguity to protect: travel
never attacks, so travel onto an adjacent creature stops rather than striking, which is a coherent
and different outcome from tapping it as a `move`. A `to` that is not an integer position on the
grid is **malformed and throws** (contract point 7) — the grid is fixed at 11×15 by the rules, so an
off-grid coordinate is corrupt data, not a fat-fingered tap.

**Travel never changes the shutter**, and needs no rule to make it a dark tool because the
arithmetic already is one. Lit travel burns 4/turn and wakes every room it crosses — a ten-step lit
travel is 40 fuel, half the starting reserve — so it is available and almost always wrong, which is
the right kind of wrong: self-punishing by the economy rather than forbidden by a rule. Dark travel
burns 1 and wakes nothing, which is precisely §4's "dark is four times cheaper for travelling
through space you have already seen". **Auto-travel is the button that sentence has always been
describing**: a *return* tool, not an exploration tool. And in the mode it is for, the whole stop
rule collapses to clause 1, because shuttered there are no items, no cache, one tile of terrain and
nothing wakes.

### 3. It is not built in M1

Auto-travel moves to **M2** and is gated on a playtest signal (`ROADMAP.md` carries it). #20 is
unblocked, and what it inherits from this ADR is one constraint:

> **#20 must leave a tap on a distant tile unbound.** No inspect mode, no long-press-to-examine, no
> pan or drag gesture may claim it, and the tap handler must be able to produce a target `Position`
> — not only a `Direction` — without restructuring.

## Alternatives considered

**The UI-emitted `move` sequence with a polled interrupt query.** The genuine runner-up on shape,
and it loses on `command.ts`'s existing rule rather than on taste: the stored log would record *how
far you got* — seven moves, and implicitly where the interrupt fired — rather than the intent, which
was one tap on one tile. "It is just a loop" is not a defence; a loop with a stopping condition is a
rule. Three consequences make the violation concrete. A phone can kill the loop mid-travel (a call
arrives, the app backgrounds, the component unmounts) and `game/` never knows — the log is simply
three moves, where the command shape is synchronous and atomic and the platform cannot interleave
with it. The interrupt rule becomes an E2E assertion in a browser instead of three Vitest cases,
which is a worse test for the rule that decides whether the player dies. And the run stops being a
function of the player's *inputs* while remaining a function of the *log* — which is why the shape
looks safe — so the same seed and the same taps produce different runs on different devices, and a
bug report replays a run the player did not make. Pillar 4 wants a run to be a shareable artifact;
one that depends on the reporter's frame rate is not one.

**Rewind on interrupt** — hold the pre-travel state, discard the resolved turns. It has to be named
because it is what someone will reach for. It makes travel a **free scout**: tap across the floor,
see what appears, rewind, know. That is unbounded free information and the worst available attack on
Pillar 2 — randomness would still decide the situation, but the player would no longer be deciding
under it. It also puts a checkpoint-and-discard capability into a reducer whose whole value is that
it only moves forward, against §13's "no continue, no rewind".

**Route over the true grid** rather than remembered terrain. Simpler, and it makes travel work on a
floor you have barely seen. Rejected: it hands the player the map for free, by inference from the
route.

**§9 read literally — terrain interrupts too.** Four reasons it lost, of which the fourth decides
it. The mode travel is economically sensible in is dark, where items are invisible and terrain
reaches one tile, so a terrain clause is dead by construction where it would matter. Every version
of the clause needs a paragraph to explain, against a one-sentence alternative. Cutting it deletes
the hardest sub-question rather than answering it. And since the route runs over remembered tiles
only, new terrain during a travel is only ever the fringe of the lit field spilling a tile or two
past a doorway already known about — the case people imagine, travelling lit into a fresh room of
dormant Cinders, cannot occur, and a creature lit at the fringe wakes and is seen, so clauses 1 and
2 catch it regardless.

**Interrupting on a tile-keyed contact change, or on lost contact.** Both make travel stop nearly
every step in the one mode it is for. Covered above.

**Build it in M1, after #20, so the milestone ships with the input model complete.** The runner-up on
schedule. It keeps the schedule pressure without buying the evidence: the playtest still arrives at
M1's exit, and by then the interrupt rule has been tuned against imagination. Rejected in favour of
measuring the friction before fixing it.

## Consequences

**Makes easy:** an interrupt rule that is unit-testable at the tier that can test it; a run that is
robust to the platform killing the shell mid-travel; a log whose entries are still what the player
did; #20 unblocked today at the cost of one sentence rather than one feature; and an M2
implementation that inherits a specification instead of a topic.

**Makes hard:** the presentation layer gets one state jump per travel and has no intermediate states
to animate, so #20's successor must decide what a multi-turn resolution looks like without
re-deriving the path in `components/`. The performance budget also has to be read correctly:
ARCHITECTURE's `< 2ms` is **per resolved turn**, not per `step()` call, and a travel may legitimately
take N times it. The distance field can be computed once per travel command rather than once per step
— during a travel, terrain changes only by cache collection, which turns a cache tile into floor,
passable to passable — but vacancy still has to be checked per step, which is the split
`game/entities/pathing.ts` already makes. The one genuinely new piece of machinery is a
`stepDistanceField` variant masked by remembered terrain.

**What the deferral costs, stated plainly.** The `playtester` will cross known space by hand at M1's
exit. On a six-room 11×15 floor the longest crossing is about twenty tiles, so a run that backtracks
is a run with a few dozen taps of nothing in it. Two specific risks follow and both are the
`playtester`'s to guard against rather than the design's:

- The Pillar 1 honest-autopilot count will include those steps. That number must not be read as an
  indictment of the level generator: §5 forbids corridors precisely so there are no autopilot turns,
  and a known, empty, already-mapped room crossed on the way back is a different thing from a
  corridor. Report the two separately.
- "Tapping is tedious" is a loud finding and could crowd out the quiet one M1 exists to get — whether
  the flash-and-crawl wager is the reason to play. The playtest brief should say travel is
  deliberately absent and ask for the tap count as its own line item.

**What the deferral buys** is the measurement. The alternative was tuning an interrupt rule against
a friction nobody had felt, and the signal that decides it is now written down in `ROADMAP.md` under
M2 rather than left to the next session's taste.

**One economic caveat for whoever implements it.** Travel changes no arithmetic — fuel burns per
turn at the current rate, and the indistinguishability invariant is the proof — but it changes *how
many turns a player is willing to spend*, because twenty taps and two taps are not the same decision
on a phone. #17 calibrated §4's third invariant ("a floor played well nets slightly positive") at
**+11 fuel per floor** against scripted one-step-at-a-time play. Fifteen extra dark turns a floor is
15 fuel, which would flip +11 to −4. The net sign is genuinely unknown — the same returns collect
caches and kills — so the requirement is not a number but an order: **re-measure `economy.test.ts`'s
corpus with travel in it**, because the invariant's empirical status was established against a play
pattern travel changes.

**Three places in the codebase become wrong the day `travel` lands, and none of them should be
touched before that.** They are listed here so the implementing PR inherits them rather than
rediscovering them:

- `docs/ARCHITECTURE.md` says "`Command` is four variants and no more" (twice, in the layer map and
  under *Determinism, concretely*).
- `game/core/step.ts`'s contract point 6 calls §2's refusal list "exhaustive for this build".
- **`game/core/command.ts`'s rule 3 and `game/core/replay.ts`'s bump policy disagree**, and this ADR
  rules that **`replay.ts` wins**. `command.ts` says adding a variant is a `RULES_VERSION` bump *if*
  it changes what an existing stored command sequence does, which adding a variant does not;
  `replay.ts` — the canonical home, per ARCHITECTURE's *Versioning* section — lists "a change to the
  meaning, shape, or set of `Command` variants" outright. So: **bump, log it in
  `RULES_VERSION_LOG`, and make `command.ts` rule 3 match while there.** Being conservative costs
  nothing, because a bump is a normal act; being wrong the other way means a stale build accepts a
  log it cannot resolve. This does not need its own issue — it is a two-line edit that only becomes
  true inside the PR that has to make it.

**Revisit if:** the first playtest with travel in it reports that it stops on nearly every step. That
would mean the stop rule is wrong at the concept level rather than the tuning level, and a travel
that stops every step is strictly worse than twenty taps because it also lies about what it does —
at which point cut the feature rather than widen the rule. Revisit the *shape* only if a case appears
where a travel must be interruptible by the player mid-resolution; today it cannot be, because it
resolves inside one synchronous call, and that is the property the shape was chosen for.
