# ADR-0009: Auto-travel is one `travel(to)` command, and it is deferred to M2

**Status:** Accepted
**Date:** 2026-08-05

Decided by the `game-designer` on issue #32 and accepted in full. It records three rulings, of which
only the first was asked for; the other two fell out of trying to answer it.

## Context

GDD §9 has marked auto-travel *settled* since the M0 design review — "tap a distant **remembered**
tile to path toward it, interrupted the moment anything new becomes visible or sensed, or any
creature wakes" — and has never said how it is **commanded**. That looked like a UI detail and is
not one. The interrupt rule is computed from the lit field, the wake set and **how many creatures the
player is currently perceiving**, and none of those is a thing `components/` may decide, so the loop
and the rule sit on opposite sides of the `game/` boundary and the question is a determinism
question.

The third of those is not merely off-limits to `components/` — **it does not exist anywhere yet**,
and that turns out to matter to this decision rather than to its implementation.
`game/systems/light.ts`'s phase 3 calls `perceive(grid, vision, origin, [])` with an empty creature
list *on purpose*: nothing in the simulation reads the creature half, so passing the real list was a
computation whose result was discarded, and mutation testing confirmed it — "an unkillable line is a
line that should not exist." The creature set the player perceives is derived in the renderer, from
the single post-step `GameState`. Two shapes were on the table:

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
- **§9's interrupt wording cannot be implemented from §9 alone.** "Anything new becomes visible or
  sensed" has no single reading of *new*, and the two available readings behave differently in the
  two vision states. Read against **permanent memory** — the sense §9's own "remembered tile" uses —
  a shuttered travel across mapped space perceives nothing new and the rule is well behaved. Read
  against **the previous step**, the touch radius is 1 and nearly every step perceives a tile it did
  not perceive last turn: travel that never travels. The lit direction is worse and has no good
  reading at all — "anything new becomes visible" at radius 4 through a doorway has no edge a player
  could state, which is the Pillar 2 failure the sentence exists to prevent. So the shape could not
  be settled without settling the rule.
- **Nothing above `game/` exists.** `render/` is #19 and unbuilt; nobody has tapped this game once.
  Auto-travel is a fix for a friction that has never been felt.

## Decision

### 1. The shape: a fifth command

```ts
| { readonly kind: 'travel'; readonly to: Position }
```

`step()` resolves it as **a fold of `move` commands** — one route step at a time, each a complete
six-phase turn (§2) — until a stop condition fires. One `step()` call, one `commandsResolved`, N
`turnsElapsed`. Contract point 5 already split those two counters, which is what makes both readings
expressible: the player made one decision and spent N turns. **It is not the case that the split was
made in anticipation of this** — travel is the first command for which `turnsElapsed` grows faster
than `commandsResolved`, and the suite has an assertion that says it cannot (see *Consequences*).

The load-bearing property, and the first line the implementation's header should carry:

> **A `travel` command must be indistinguishable from the sequence of `move` commands it stands
> for.** Same intermediate states, same fuel, same creature turns, same adaptation ticks. The only
> difference is how many taps it took.

Stated exactly, because the loose version is not testable: `travel(to)` resolved from `S` equals the
fold of the corresponding `move` commands over `S` **in every field but `commandsResolved`**, which
differs by construction — N against 1 — and is the one field that is *supposed* to record that this
was one decision. Everything else, `world` and `lantern` and `rng` and `status` and `turnsElapsed`,
is identical. That is what makes three otherwise separate questions answer themselves: the fuel
economy is arithmetically untouched, the spent turns are obviously spent, and the draw budget is
obviously unchanged. **If a state reachable by travel is not reachable by tapping the same steps one
at a time, travel has become a mechanic, and it is not allowed to be one.**

The draw budget needed less care than #32 feared. `descend` is the only command that draws and
travel never descends, so **a travel command consumes exactly zero draws**; `expectedDrawCount` is
unchanged and `replay.test.ts`'s budget walk needs no new arithmetic, because it counts descents.
Contract point 4 stays true verbatim.

### 2. The stop rule: you stop for the living

§9's "anything new becomes visible or sensed" **narrows**. Terrain never interrupts travel, and the
two kinds of "new" §9 conflated are separated: **stone is remembered, ember is not.** Anything
terrain-shaped would have to be judged new against permanent memory; anything living is judged new
against the previous step. Only the second survives.

**Travel stops after a fully resolved step in which any of these happened:**

1. **You are perceiving more creatures than you were** — keyed to the *count*, which is what the
   player can see. Not to identity, and not to the tile.
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
- **Contact is keyed to the count, and this is the ruling in this ADR that changed most.** An earlier
  draft keyed it to the *creature* — a `*` moving tile to tile is not a new contact, so a dark travel
  with a Cinder tracking you does not stop every turn — and killed count-keying with a swap case: one
  creature leaves as another arrives, the count is unchanged, and "something genuinely new is on
  screen". **That argument was reasoning from the simulation's knowledge rather than the player's,
  and it is wrong twice.**

  *Genuinely new* is not a property the player has access to. §4 gives ember-sense position and
  nothing else, and `game/fov/perceive.ts` implements the promise as a type — `CreatureSense` is a
  union precisely so that a `felt` creature is "a position and *nothing else* — no identity, no
  health, no intent". So in the swap case the player's screen can be **indistinguishable** from one
  creature walking from the first tile to the second.

  **That is narrower than it first looks, and the narrowing is worth writing down rather than
  leaning on the strong form.** Creatures move one orthogonal step per player turn, and marks are
  drawn at absolute tile positions — so a mark appearing more than one step from any previous mark
  *cannot* be a walk, and the player can see that. Both halves of a swap happen at the boundary of
  the sense disc, and two boundary tiles of a Chebyshev-5 square are usually far apart, so the
  **visible** swap is the ordinary case and the indistinguishable one is the exception. The ruling
  does not depend on this: count-keying never stops *wrongly*, it only ever under-stops, and a
  travelling player cannot be hit at all (clause 3), so the residual cost is bounded. But the honest
  statement is that giving up the swap case gives up a little, not nothing — see the revisit below.

  Identity-keying therefore fails Pillar 2 from both ends
  at once. In the swap case travel stops and nothing on screen explains why — a stop the player
  cannot account for. And because the stop is itself observable (mid-route, HP unchanged, nothing
  adjacent, nothing arrived: clause 1 must have fired), a player who knows the rule can run the
  inference backwards and learn *that mark is a different creature* — one bit of identity, which
  §4 promises does not exist. That is free identity information dressed as a stop rule, which is
  structurally the same defect as routing over the true grid, rejected two sections down as free map
  information dressed as a pathfinding detail.

  **Keying on the count fixes both ends and costs nothing the player can perceive.** "You stop when
  there are more marks than there were" is checkable by looking at the screen and counting, which is
  Pillar 2 at full strength. In the swap case travel walks on — and so would a player, who sees one
  mark before and one mark after and has no way to tell it is a different one. That is the
  indistinguishability invariant applied to perception rather than to state: **travel may not key on
  anything the player cannot see.** In M1 it is exactly faithful even in light, where §4 does grant
  identity, because §6 has one creature and two Cinders are the same glyph.
- **Losing contact never interrupts**, and under count-keying this stops being a separate ruling and
  falls out of the word *more*. It is also the right answer on its own terms: otherwise every dark
  travel that outpaces a known pursuer stops on its first step, and an absence is the least legible
  interrupt trigger available — the player would be asked to notice that a `*` is *not* there.
- **The wake clause is redundant today and stays anyway.** Nothing wakes while shuttered (§4), and a
  creature that wakes during a lit travel does so by entering the lit radius, where clause 1 sees it
  on the same step. It stays because it is the clause the player actually reads, and because the
  coincidence is a property of M1 having one creature: a future creature that wakes on proximity
  breaks it, and the rule should not have to be rediscovered then.
- **Clause 1 is evaluated on the post-step state — the state a manual player would be looking at.**
  That is the only state that exists to evaluate it against: phase 3 stores nothing about creatures,
  and the renderer derives its marks from the finished `GameState`, after phase 4 has moved
  everyone. So a creature that crosses into your sense radius during a step **is** newly perceived at
  the end of that step, and travel stops there — before the attack it declared on that same turn
  resolves, because §2 resolves a declared action on the creature's *next* turn. **Travel therefore
  never eats a hit from something it had not already made contact with**, and the earlier draft of
  this ADR, which claimed it ate exactly one, was wrong about the machinery and contradicted clause 1.
  Note that this is a rule about *which* state the condition samples, not a restatement of the
  indistinguishability invariant, which is about equality of resolved states — both true, and not the
  same claim.
- **Clause 3 cannot fire in M1 either, and it stays** — the same status as clause 2, for a reason
  worth having. **A travelling player cannot be hit at all**, and it is structural: the only way HP
  falls is `resolveAttack` finding the player on the marked tile (`combat.ts`), a creature marks its
  tile when it declares in phase 4 of turn T, `ACTION_COST` is 100 for everyone so that mark resolves
  in phase 4 of T+1, and travel moves the player in phase 1 of **every** turn — with clause 4
  guaranteeing the move is a real move and the route strictly decreasing the distance field, so no
  tile is revisited. The player is never standing where the mark is. `actors.ts` says it outright:
  "an attack on a tile the player left hits nothing."

  So **travel dodges by construction, because it never stands still** — which is a strengthening of
  the bullet above rather than an exception to it. Clause 3 is the backstop for the first damage
  source that is not a one-turn-telegraphed attack on a tile: a creature faster than
  `ACTION_COST`, an attack that resolves on the move, a trap. It is written down now because the
  rule the player reads should not change when that creature arrives, and because #32's DoD asks for
  a test per clause — an implementer who does not know this clause is unreachable today will try to
  construct a state the rules cannot produce, and end up testing the test.
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

Auto-travel moves to **M2** and is gated on a playtest signal (`ROADMAP.md` carries it). **This
unblocks #20 from #32 and from nothing else — #20 remains blocked by #19**, which builds the
presentation model it consumes. What #20 inherits from this ADR is one constraint:

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

**Keying clause 1 on the creature rather than on the count.** The runner-up on the stop rule, and
the ruling this ADR reversed under review. It is the more *accurate* rule — it knows when a mark is
genuinely a different creature — and accuracy is exactly its defect: the player cannot know that, so
travel would be deciding on information the player does not have, and the stop would be
unexplainable in the case where the two differ. Worse, the stop is observable, so a player who knows
the rule can invert it and extract one bit of identity that §4 promises does not exist. Count-keying
gives up the swap case and buys a rule the player can check by looking. Full argument in *Decision*.

**Interrupting on a tile-keyed contact change, or on lost contact.** Tile-keying stops nearly every
step in the one mode travel is for, since a tracking creature changes tile every turn. Lost contact
is covered above.

**Build it in M1, after #20, so the milestone ships with the input model complete.** The runner-up on
schedule. It keeps the schedule pressure without buying the evidence: the playtest still arrives at
M1's exit, and by then the interrupt rule has been tuned against imagination. Rejected in favour of
measuring the friction before fixing it.

## Consequences

**Makes easy:** an interrupt rule that is unit-testable at the tier that can test it; a run that is
robust to the platform killing the shell mid-travel; a log whose entries are still what the player
did; #20 freed of *this* dependency at the cost of one sentence rather than one feature; and an M2
implementation that inherits a specification instead of a topic.

**Makes hard:** the presentation layer gets one state jump per travel and has no intermediate states
to animate, so #20's successor must decide what a multi-turn resolution looks like without
re-deriving the path in `components/`. The performance budget also has to be read correctly:
ARCHITECTURE's `< 2ms` is **per resolved turn**, not per `step()` call, and a travel may legitimately
take N times it. The distance field can be computed once per travel command rather than once per step
— during a travel, terrain changes only by cache collection, which turns a cache tile into floor,
passable to passable — but vacancy still has to be checked per step, which is the split
`game/entities/pathing.ts` already makes.

**Two pieces of new machinery, and only one of them is new code.** The first is a
`stepDistanceField` variant masked by remembered terrain, which is small. The second is
**creature perception computed inside `game/` at all** — the thing clause 1 counts, and the thing
`game/systems/light.ts` deliberately removed when it started passing `perceive` an empty creature
list. That is not a licence to undo its ruling, and the distinction is worth stating because an
implementer will meet the comment and stop: light.ts removed the real list because *nothing observed
it*, and "an unkillable line is a line that should not exist" is a statement about observability, not
about the computation being unwanted. **Travel is the observer that was missing**, and the moment it
exists the line is killable — a mutant that filters the list differently changes where a travel
stops.

Because the ruling above keys on the **count**, this needs no new type and no new field:
`perceive(grid, vision, origin, creatures).creatures.length` is exactly the quantity, off the
existing `TurnPerception`, with `CreatureSense` carrying no identity just as §4 requires. One
constraint remains: it belongs to **travel's fold, not to phase 3**. Phase 3 keeps passing `[]` and
keeps storing nothing, because a command that does not travel must not start paying for a set nobody
reads.

**What the deferral costs, stated plainly.** The `playtester` will cross known space by hand at M1's
exit. On a six-room 11×15 floor the longest crossing is about twenty tiles, so a run that backtracks
is a run with a few dozen taps of nothing in it. Three specific risks follow, the first two of them
the `playtester`'s to guard against rather than the design's:

- The Pillar 1 honest-autopilot count will include those steps. That number must not be read as an
  indictment of the level generator: §5 forbids corridors precisely so there are no autopilot turns,
  and a known, empty, already-mapped room crossed on the way back is a different thing from a
  corridor. Report the two separately.
- "Tapping is tedious" is a loud finding and could crowd out the quiet one M1 exists to get — whether
  the flash-and-crawl wager is the reason to play. The playtest brief should say travel is
  deliberately absent and ask for the tap count as its own line item. **This instruction is now in
  M1's exit criteria in `ROADMAP.md`**, because a Consequences section is not somewhere a future
  session looks before running a playtest.
- **M1's fuel data will be measured under a play pattern that matches neither the corpus nor the
  finished game.** `economy.test.ts` models one-step play by a *tireless script*; the playtester is
  not tireless, and tap fatigue suppresses exactly the behaviour §4's third invariant is calibrated
  on — going back for a cache, chasing an ember drop across a floor. So a floor that nets worse than
  +11 at M1's exit is not necessarily evidence about the economy, and neither is a floor that nets
  better. This is a cost of the deferral rather than an argument against it: the alternative was
  measuring under a third pattern, travel-present play, whose stop rule had never been tuned.

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

**Four places become wrong the day `travel` lands** — the ones known today, and none of them should
be touched before that day. #32's checklist carries the reconciliation; they are listed here so the
implementing PR inherits the reasoning rather than rediscovering it:

- **`game/core/replay.test.ts`'s counter assertion — and this one is a red test, not a stale
  comment.** It asserts `turnsElapsed <= commandsResolved` over 120 generated records, on the
  reasoning that "`turnsElapsed` counts a strict subset: every free action resolved is a command
  that cost no turn." **Travel is the first command that makes that false**, and the first for which
  `turnsElapsed > commandsResolved` — one command, N turns. The first generated record containing a
  multi-turn travel turns it red, and `ARCHITECTURE.md` tells the reader that this file going red
  means stop and fix it before anything else, so an unannounced failure here reads as a determinism
  emergency rather than an expected consequence. The assertion is not wrong today and must be
  *replaced*, not deleted: the surviving invariant is that `turnsElapsed` equals the number of
  turn-costing turns resolved, which travel satisfies and a counter bug still would not.
- `docs/ARCHITECTURE.md` says "`Command` is four variants and no more" once, in *Determinism,
  concretely*. (An earlier draft of this ADR said twice; the layer map does not say it.)
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

**Revisit the count-keying if §6 ever ships two creature kinds that are distinguishable in light.**
It is exactly faithful in M1 because every creature is a Cinder and two of them are the same glyph,
so even lit, the count is all the player has. With a `C` and something else on screen, a lit player
can tell a swap from a walk, and clause 1 would then under-stop in a state where the player *does*
have the information — at which point the honest rule in the lit column is the identity one, and the
two columns of §4's table would legitimately key differently. Do not pre-build that; it is an M3
question and lit travel is self-punishing anyway.

**The counted list must be the rendered list, and nothing enforces that across two issues.** The
count is only "checkable by looking" while the creatures the simulation counts are exactly the marks
`render/` draws. Those are chosen in two different places by two different sessions — #19 builds the
presentation model and will pick its own creature list; this rule is #32's. If they ever diverge —
the player counted as a creature, a 0-HP creature not yet resolved, a creature filtered by liveness
in one place and not the other — the count stops matching the screen and the ruling's whole premise
quietly becomes false, with nothing failing. It is latent today (travel samples after phase 5 and
cannot kill anything), but latent-and-unowned is how the `Perception` collision survived three
journal entries. Whoever implements travel must assert the two lists agree, not assume it.

**A refinement deliberately not taken, recorded so it is not re-derived:** the fully principled rule
is one-step explainability of the mark *set* — stop unless every new mark can be accounted for by an
old one moving at most one step. It uses positions only, so §4 stays intact and the identity leak
stays closed, and it catches the *visible* swap that count-keying lets past. It was not taken
because it is a strictly more complex rule bought for a case that costs a travelling player nothing
today, and because "more marks than there were" is a sentence a player can hold while "the new marks
are explained by the old ones" is not. If a playtest ever produces a travel that walked past a swap
the player clearly saw, this is the rule to reach for — it is a `game-designer` call, not an
implementation detail.

**Revisit if:** the first playtest with travel in it reports that it stops on nearly every step. That
would mean the stop rule is wrong at the concept level rather than the tuning level, and a travel
that stops every step is strictly worse than twenty taps because it also lies about what it does —
at which point cut the feature rather than widen the rule. Revisit the *shape* only if a case appears
where a travel must be interruptible by the player mid-resolution; today it cannot be, because it
resolves inside one synchronous call, and that is the property the shape was chosen for.
