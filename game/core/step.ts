/**
 * `step(state, command) -> state`. The whole simulation.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE STEP CONTRACT — everything in `game/` that resolves a turn must uphold this
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * 1. **Pure.** Same `(state, command)` in, same state out, forever. No clock, no ambient
 *    randomness, no I/O, no module-level mutable state. Enforced by lint and by the scanner in
 *    `tests/unit/infrastructure.test.ts`.
 *
 * 2. **Never mutates its input.** The returned state is a new value; the input is untouched, down
 *    to every nested object. `purity.test.ts` deep-freezes every state in a long run and would
 *    throw on the first in-place write. Structural sharing of *immutable* sub-values is fine and
 *    expected — a turn that perceives nothing new hands the next state the same `remembered` tile
 *    set by reference — because nothing in `game/` ever writes through a reference.
 *
 * 3. **Randomness is threaded, never ambient.** Every draw takes `state.rng` and the resulting
 *    `rng` goes into the returned state. Dropping it (returning `{ ...state }` after drawing)
 *    replays the same value forever; taking it from anywhere but `state` makes the run depend on
 *    a hidden input.
 *
 * 4. **Draw count depends on the command and the state's floor, not on what was drawn.** This is
 *    `draw.ts`'s draw-count contract extended one level up. Exactly one command draws at all —
 *    `descend`, via `generateFloor` — and `generateFloor` consumes a fixed count *for a given floor
 *    number* (`expectedDrawCount`). So a command log's total budget is
 *    `expectedDrawCount(1)` for the starting floor, plus `expectedDrawCount(n + 1)` for each
 *    `descend` resolved on floor `n`. It is computable from the log, which is what makes it an
 *    assertion; it is **not** computable command-by-command, which is why `replay.test.ts` walks
 *    the run to compute it. Game *rules* may branch on a drawn value; a branch must not change how
 *    many draws the turn consumes.
 *
 * 5. **The two counters mean different things, and neither counts `step` calls.** The M0 field
 *    `turn` claimed "increases by one on every call, without exception". That is now false three
 *    ways — a free action, a refusal, and a command after the run has ended — so it is split:
 *
 *    - `commandsResolved` increases by one on every call **that is not a refusal**, free actions
 *      included. It is the replay's cross-check on its own position.
 *    - `turnsElapsed` increases by one per resolved command **that costs a turn** (§2). It is what
 *      a player retells and what a summary screen shows.
 *
 *    A refusal increments neither, because it changes no field at all — see point 6. So
 *    `commandsResolved <= commands.length`, with equality exactly when nothing was refused.
 *
 *    **The other two counters are §13's summary, and each is pinned to a different moment.**
 *    `fuelBurned` is what GDD §2 **phase 2** took, measured inside the turn by `meteredPhases`
 *    below, because by the time `step` sees a resolved world phase 5 may already have refuelled it
 *    and the net is not the burn. `kills` is measured across the turn *as a whole*, by
 *    `killsBetween`, because a kill's blow and its corpse are three phases apart and §13 skips the
 *    later one on the turn the player dies. `fuelBurned` moves on a free action — a flash costs its
 *    4 fuel (§4) — while `kills` cannot, because a free action skips phase 4 and its phase 1 strikes
 *    nothing. Neither moves on a refusal or on the winning descent, which run no phases at all.
 *
 *    All four are **accumulated as they happen and never re-derived from the final state**, which
 *    §13 requires in as many words: the terminal state is the frame of the killing blow, not a
 *    tidied-up world, so the dead creature you killed on that turn is still standing in it.
 *
 * 6. **Refused actions run no phases and cost nothing.** GDD §2 lists three, and the list is
 *    exhaustive for this build: a move into a wall, a pillar, or off the grid; `descend` while not
 *    on the stairs; and any command at all once the run has ended (§13). A fourth falls out of the
 *    command union rather than out of §2 — `setShutter` to the setting the shutter already holds,
 *    which is not the *toggle* §2 makes free; see `isRefused`.
 *
 *    A refusal returns **the input state itself**. Not a copy: byte-identity is the property, and
 *    returning the same reference is the only implementation of it that cannot rot. `{ ...state }`
 *    after touching the generator is exactly the invisible divergence the replay tripwire exists to
 *    catch, and it would pass a `toEqual`.
 *
 *    This is not a licence to probe the dark for free. §4: the touch radius and the adaptation floor
 *    are both 1, so **you always know your own four neighbours** — a bumped wall was already in your
 *    perceived set when the turn began, and nothing is learned by walking into it. What charging a
 *    turn would buy is a fat-fingered tap that also hands every creature on the floor a turn.
 *
 * 7. **Malformed commands throw; illegal-but-well-formed actions do not.** The distinction matters
 *    and is easy to blur. A command that violates its own type contract — an unknown `kind`, a
 *    `dir` that is not one of the four, a `to` that is not a shutter setting, all of which arrive
 *    from parsed save files — is a programmer or data error, and failing loudly is the only honest
 *    response: silently substituting a default would make a replay reproduce a run that never
 *    happened. An action the *rules* forbid is point 6's business and is refused, not thrown,
 *    because a tap landing a frame after the killing blow is an ordinary thing for a phone to
 *    produce (Pillar 3).
 *
 *    **Validated before anything is drawn**, mirroring the corollary in `draw.ts`: nothing may
 *    consume entropy and then throw.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */

import { LAST_FLOOR } from '../content';
import { PLAYER_ID, playerOf } from '../entities';
import { generateFloor } from '../map';
import {
  canBump,
  descendCommand,
  isOnStairs,
  lanternPhases,
  moveCommand,
  resolveTurn,
  setShutterCommand,
  waitCommand,
  type LanternWorld,
  type TurnCost,
  type TurnPhase,
  type TurnPhases,
} from '../systems';
import { assertNever } from './assert';
import { neighbourOf, COMMAND_KINDS, DIRECTIONS, SHUTTER_STATES, type Command } from './command';
import {
  floorNumberOf,
  isRunning,
  killsBetween,
  statusAfterTurn,
  withWorld,
  worldOf,
  type GameState,
} from './state';

/**
 * Resolve one command against one state.
 *
 * @returns a new `GameState`, or **the input itself** if the command was refused (contract 6).
 * @throws on a malformed command — see contract 7.
 */
export function step(state: GameState, command: Command): GameState {
  assertWellFormed(command);
  if (isRefused(state, command)) return state;

  // §13: the eighth descent *is* the ending. It resolves in phase 1 and nothing else runs — there
  // is no floor below to burn fuel on, no creatures to give a turn, and no floor 9 is generated.
  // Checked before the draw, so a won run consumes no entropy.
  if (command.kind === 'descend' && floorNumberOf(state) >= LAST_FLOOR) {
    return {
      ...state,
      status: { kind: 'reachedBottom' },
      turnsElapsed: state.turnsElapsed + 1,
      commandsResolved: state.commandsResolved + 1,
    };
  }

  const plan = planFor(state, command);
  const metered = resolveTurn(
    { lanternWorld: worldOf(state), fuelBurned: state.fuelBurned },
    meteredPhases(lanternPhases(plan.cost, plan.phase)),
  );
  const resolved = metered.lanternWorld;

  return {
    ...withWorld(state, resolved),
    status: statusAfterTurn(state, resolved),
    rng: plan.rng,
    // §13's summary numbers. `fuelBurned` comes back from inside the turn because only phase 2 knows
    // what the lantern took; `kills` is read off the turn as a whole because a kill spans phases and
    // outlives the one that would have swept the body. See `killsBetween` and `meteredPhases`.
    kills: state.kills + killsBetween(state.world, resolved.world),
    fuelBurned: metered.fuelBurned,
    // §2: a free action "does not consume a turn". So it does not increment the count of turns —
    // the free action is free in the sense that matters, which is that `actorPhase('free')` is the
    // identity and no creature gets a move; charging it a turn on the HUD would report a cost the
    // floor never paid.
    //
    // **This counter is not a second copy of the clock.** `turnsElapsed * ACTION_COST` and
    // `schedule.now` are not in correspondence and never were, so do not be tempted to assert it:
    //
    //   - a descent restarts the new floor's schedule at 0 (`run.ts`) while the counter keeps
    //     counting the run;
    //   - the winning descent returns above, incrementing the counter with no phases run and no
    //     clock to move;
    //   - the killing blow halts the actor sweep before `advanceToNextActor` (`turn.ts`), so the
    //     clock stays on the frame the player died in while the turn itself still counted.
    //
    // `schedule.now` orders actors within one floor; `turnsElapsed` is what a player retells.
    turnsElapsed: state.turnsElapsed + (plan.cost === 'costsATurn' ? 1 : 0),
    commandsResolved: state.commandsResolved + 1,
  };
}

/**
 * A `LanternWorld` mid-turn, carrying the one run counter that can only be read from inside one.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THE BURN IS METERED HERE AND NOT COMPUTED AFTERWARDS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `resolveTurn` hands `step` the world after all six phases, and by then the burn is unrecoverable:
 * GDD §2 phase 5 collects embers and caches, so `before.fuel - after.fuel` is the *net*, and on the
 * turn a 20-fuel ember is picked up it is negative. Netting income against the lantern's cost would
 * make a lit, well-looted run report as cheaper than a shuttered one that found nothing — the exact
 * inversion of the arithmetic §4 asks the player to do.
 *
 * The three alternatives were all worse:
 *
 *   - **Re-derive it from the burn rate.** `min(fuel, burnRate(shutter))` is the right formula, but
 *     the lantern it must be evaluated against is the one *after phase 1* — and phase 1 is where
 *     `setShutter` changes the rate, including the dry `open` that §4 refuses. That puts a copy of
 *     `lantern.ts`'s rules in `game/core/`, positioned to drift.
 *   - **Run phase 1 twice**, once to measure and once for real. Pure, so it is correct, and it
 *     rebuilds a whole `Floor` on every descent to learn a number phase 2 already knew.
 *   - **Put the counter in `LanternWorld`.** That type is documented as the pair and nothing else,
 *     by construction, so that a systems phase cannot reach the run's counters. It stays that way.
 *
 * So `game/core/` widens the state instead. `resolveTurn<S>` and `TurnPhases<S>` are generic
 * precisely so the threaded state is the caller's business — `game/systems/` supplies six
 * `LanternWorld` phases and never learns that anything is counting them.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 */
type Metered = {
  readonly lanternWorld: LanternWorld;
  /** The run's `fuelBurned` so far, plus whatever phase 2 has taken this turn. */
  readonly fuelBurned: number;
};

/** A phase that has nothing to say about fuel: run it, carry the count across. */
function unmetered(phase: TurnPhase<LanternWorld>): TurnPhase<Metered> {
  return (metered) => ({
    lanternWorld: phase(metered.lanternWorld),
    fuelBurned: metered.fuelBurned,
  });
}

/**
 * Phase 2, watched: whatever the lantern lost, the run burned.
 *
 * A *difference* rather than `burnRate(shutter)`, so the clamp comes out right for free — `burn`
 * stops at 0, so the turn that runs the lantern dry adds the 2 that were there rather than the 4 the
 * rate would have charged, and the run's total stays fuel that actually existed.
 */
function meteringTheBurn(phase: TurnPhase<LanternWorld>): TurnPhase<Metered> {
  return (metered) => {
    const lanternWorld = phase(metered.lanternWorld);
    const burned = metered.lanternWorld.lantern.fuel - lanternWorld.lantern.fuel;
    return { lanternWorld, fuelBurned: metered.fuelBurned + burned };
  };
}

/**
 * The six phases, lifted to `Metered`, with **only** phase 2 counting.
 *
 * Written out rather than mapped over `RESOLUTION_PHASES`, because `TurnPhases` is a `Record` over
 * the phase union: a phase that stopped being lifted here would not compile, and the one line that
 * differs from the other five is the whole specification of where the burn is measured. A `fuelBurn`
 * wired to `unmetered` and, say, `deaths` wired to `meteringTheBurn` would still type-check, and
 * would report a run that burned nothing at all until it stood on an ember and then burned a
 * *negative* amount — which is why the tests pin this boundary from several directions rather than
 * asserting one number.
 */
function meteredPhases(phases: TurnPhases<LanternWorld>): TurnPhases<Metered> {
  return {
    command: unmetered(phases.command),
    fuelBurn: meteringTheBurn(phases.fuelBurn),
    lightingAndWaking: unmetered(phases.lightingAndWaking),
    actors: unmetered(phases.actors),
    deaths: unmetered(phases.deaths),
    darkAdaptation: unmetered(phases.darkAdaptation),
  };
}

/**
 * What a command costs, what it does in phase 1, and where the generator is left afterwards.
 *
 * The generator is part of the plan rather than something the phases thread, because `descend` is
 * the only command that draws and the phases are `LanternWorld -> LanternWorld` — a shape with
 * nowhere to put an `Rng`, deliberately (`game/systems/` holds no randomness at all; §3).
 */
type Plan = {
  readonly cost: TurnCost;
  readonly phase: TurnPhase<LanternWorld>;
  readonly rng: GameState['rng'];
};

/**
 * Choose the phase and the cost. **This function is the whole of `step`'s decision-making**, and
 * every branch of it hands off to `game/systems/`: nothing here knows what a shutter does, what a
 * bump resolves to, or what crosses the stairs.
 *
 * `TurnCost` is stated per command and never inferred, because `lanternPhases` cannot infer it and
 * getting it wrong is not a small error — a free command declared as costing a turn leaves the
 * player uncharged in phase 4 and throws, and one declared free that should not be hands every
 * creature on the floor a turn for nothing.
 */
function planFor(state: GameState, command: Command): Plan {
  switch (command.kind) {
    case 'move':
      // §3: one directional command. `bump` decides move-or-attack from what is standing there.
      return {
        cost: 'costsATurn',
        phase: moveCommand(neighbourOf(playerOf(state.world).at, command.dir)),
        rng: state.rng,
      };

    case 'wait':
      return { cost: 'costsATurn', phase: waitCommand, rng: state.rng };

    case 'setShutter':
      // §2's free action. It still burns its fuel and still wakes the room (phases 2 and 3).
      return { cost: 'free', phase: setShutterCommand(command.to), rng: state.rng };

    case 'descend': {
      // The one draw in the game. Taken here rather than inside a phase because this is the layer
      // that owns the generator; `descendCommand` receives a finished `Floor`.
      const next = generateFloor(state.rng, floorNumberOf(state) + 1);
      return { cost: 'costsATurn', phase: descendCommand(next.value), rng: next.rng };
    }

    default:
      return assertNever(command, 'step');
  }
}

/**
 * Is this well-formed command one the rules forbid *right now*? Contract 6.
 *
 * Four cases. Three are GDD §2's table verbatim; the fourth is `setShutter`'s and is argued here
 * because §2 predates the command:
 *
 * **`setShutter` to the setting the shutter already holds is refused.** §2 makes *the toggle* free,
 * and re-asserting a setting is not a toggle — nothing changes about the lantern, so resolving it
 * would charge 4 fuel for a double-tap on a thumb control that already showed "open". That is
 * precisely the fat-fingered-tap argument §2 uses to justify refusing an illegal move and to
 * justify the free toggle in the first place, applied to the same control. It is also not
 * exploitable in the other direction: a refusal here cannot be used to skip a turn, because the
 * command it refuses was free.
 *
 * **A dry `setShutter('open')` is *not* refused.** §4 says at 0 fuel "the shutter can no longer be
 * opened", and `lantern.ts` implements that as a legal no-op: the player still has the control under
 * their thumb and pressing it is an ordinary thing to do. So it resolves as a free action — running
 * phases 1, 2, 3 and 5 — and the difference from a refusal is visible in `commandsResolved` (and,
 * on any floor with fuel left, in the fuel). The two look alike and are not, which is the reason
 * this paragraph exists.
 */
function isRefused(state: GameState, command: Command): boolean {
  // §13: "Once the run has ended it accepts no more commands. They are refused, exactly as §2
  // refuses an illegal move — not resolved, and not thrown." A stored log whose commands run past
  // the death must still replay.
  if (!isRunning(state)) return true;

  switch (command.kind) {
    case 'move':
      // §2: "a move into a wall, a pillar, or off the grid — there is nowhere to step". An
      // *occupied* tile is emphatically not refused; that is an attack (§3).
      return !canBump(state.world, PLAYER_ID, neighbourOf(playerOf(state.world).at, command.dir));
    case 'wait':
      // Always legal, everywhere, including on the stairs — §9 is explicit that waiting there is a
      // real move, because the stairs are where §3's "clear this floor or dive now" is decided.
      return false;
    case 'setShutter':
      return state.lantern.vision.shutter === command.to;
    case 'descend':
      // §9/§13: "the stairs are where you take them."
      return !isOnStairs(worldOf(state));
    default:
      return assertNever(command, 'isRefused');
  }
}

/**
 * Reject a command that could not have come from this build. Contract 7.
 *
 * Every payload is checked against the sorted membership lists in `command.ts`, which are derived
 * from the types — so a new `Direction` or a third `ShutterState` is accepted the moment it is
 * declared, and a hand-written second list cannot drift from the first.
 *
 * The `kind` check is last of the three so that a command with a known kind and a bad payload
 * reports the payload; but it is also the one that catches a record from a *different rules
 * version*, which is the case with the least context at the point of failure, so its message says
 * so.
 */
function assertWellFormed(command: Command): void {
  const kind: unknown = (command as { kind?: unknown } | null | undefined)?.kind;
  if (typeof kind !== 'string' || !(COMMAND_KINDS as readonly string[]).includes(kind)) {
    throw new Error(
      `step: unknown command kind ${JSON.stringify(command)}. A record from a different rules ` +
        `version, or corrupt data.`,
    );
  }

  if (command.kind === 'move' && !(DIRECTIONS as readonly string[]).includes(command.dir)) {
    throw new Error(
      `step: move requires a direction of ${JSON.stringify(DIRECTIONS)}, got ` +
        `${JSON.stringify(command.dir)}`,
    );
  }

  if (command.kind === 'setShutter' && !(SHUTTER_STATES as readonly string[]).includes(command.to)) {
    throw new Error(
      `step: setShutter requires one of ${JSON.stringify(SHUTTER_STATES)}, got ` +
        `${JSON.stringify(command.to)}`,
    );
  }
}
