import { describe, expect, it } from 'vitest';
import { assertNever, type Command, type GameState } from '@/game/core';
import { cellAt, type Cue } from '@/render';
import { diveToTheBottom } from '@/tests/unit/support/run-script';
import { beginRun, cuesOf, descend, move, sceneOf, setShutter, wait, type Run } from './run';

/**
 * `session/` owns a run so that nothing above it has to. These tests are written the way a component
 * would use it — `beginRun`, then intents, then `sceneOf`/`cuesOf` — because a test that reached
 * inside would be testing a seam that is supposed to be unreachable.
 *
 * The corpus is a **real eight-floor dive**, replayed through the four intent functions rather than
 * through `step`. That is deliberate: it is the only way to reach a descent, a floor change and a
 * finished run without constructing a `GameState` by hand, and constructing one by hand is a thing
 * this layer is specifically built to make impossible.
 */

const SEED = 'session';

/**
 * Drive one command from a scripted run through the intent that stands for it.
 *
 * The `switch` is the test's own, not the layer's: `session/` exports no `apply(run, command)` and
 * must not (see `run.ts`'s header), so a test that wants to replay a `RunRecord` has to translate.
 * `assertNever` means a fifth command variant fails here rather than being silently skipped, which
 * is what would happen if this were a lookup table with a fallback.
 */
function issue(run: Run, command: Command): Run {
  switch (command.kind) {
    case 'move':
      return move(run, command.dir);
    case 'wait':
      return wait(run);
    case 'setShutter':
      return setShutter(run, command.to);
    case 'descend':
      return descend(run);
    default:
      return assertNever(command, 'issue');
  }
}

/** Every `Run` a scripted record produces, opening state first. */
function runsOf(seed: string, commands: readonly Command[]): Run[] {
  const runs = [beginRun(seed)];
  for (const command of commands) runs.push(issue(runs[runs.length - 1], command));
  return runs;
}

const DIVE = diveToTheBottom('session-dive');
const RUNS = runsOf(DIVE.seed, DIVE.commands);

function kinds(cues: readonly Cue[]): string[] {
  return cues.map((cue) => cue.kind);
}

/** A cell as data, for comparing two scenes without comparing their object identities. */
function shapeOf(value: unknown): string {
  return JSON.stringify(value);
}

describe('the opening run', () => {
  it('has a board and a HUD before the player has touched anything', () => {
    // GDD §4: "the entrance room is already on screen — the opening perception is not something the
    // first command pays for." A `beginRun` that returned an unpresented run would leave #20 with
    // nothing to draw until the first tap, which is a black screen on launch.
    const scene = sceneOf(beginRun(SEED));

    expect(scene.grid.cells).toHaveLength(scene.grid.width * scene.grid.height);
    expect(scene.hud.floor.number).toBe(1);
    expect(scene.hud.shutter.state).toBe('open');
    expect(scene.hud.turnsElapsed).toBe(0);
    expect(scene.hud.outcome.kind).toBe('running');
    // Not a blank board: the entrance room has been perceived. A run whose opening scene was all
    // `unknown` would satisfy every assertion above.
    expect(scene.grid.cells.filter((cell) => cell.state === 'visible').length).toBeGreaterThan(4);
  });

  it('has no cues when its light woke nothing, because then nothing has happened yet', () => {
    // The opening state has no predecessor, so there is no *transition* to describe. The two wrong
    // answers this pins against are throwing — `cuesOf` on a fresh run is what a component calls on
    // its very first render — and diffing against a fabricated null state, which would emit a
    // made-up story about a turn nobody played.
    //
    // `session` is a seed whose entrance room light finds nobody, which is the common case (§5 puts
    // no creature in the entrance room) and is asserted here rather than assumed, so that this test
    // failing means the *cue rule* changed rather than the floor generator.
    expect(sceneOf(beginRun(SEED)).hud.shutter.state).toBe('open');
    expect(cuesOf(beginRun(SEED))).toEqual([]);
  });

  it('announces what the opening light woke, because phase 3 really ran (§4, #79)', () => {
    // The argument "the opening has no predecessor, so it has nothing to say" is sound about
    // diffs and wrong about this: §4 starts the lantern **open**, and `game/systems/run.ts`'s
    // `beginRun` is `lightingAndWakingPhase(...)`, so the entrance room's light genuinely wakes what
    // it touches before the player has pressed anything. §4 measures roughly one arrival in five as
    // waking something, and under #83 that is a hunter the player was never told about.
    //
    // `open-1` is a seed where it happens. The assertion is against the state's own actor list
    // rather than a literal tile, so it survives a generator change without going quietly vacuous —
    // and the `toHaveLength` below is what stops it doing so.
    const woke = cuesOf(beginRun('open-1'));
    expect(woke).toHaveLength(1);
    expect(kinds(woke)).toEqual(['woke']);
  });

  it('never reports a move, a blow or a floor change on the opening frame', () => {
    // The census must not become "a diff against something". Over many seeds — including the ones
    // that wake — the opening may say `woke` and may say nothing, and may never say anything else.
    for (let i = 0; i < 40; i += 1) {
      const cues = cuesOf(beginRun(`open-${i}`));
      for (const kind of kinds(cues)) expect(kind, `open-${i}`).toBe('woke');
    }
  });

  it('is a pure function of the seed', () => {
    // No clock, no ambient randomness, no module state. Two runs begun on the same seed are the same
    // run; a different seed is a different floor. If this ever goes red, something in this layer or
    // below it started reading a hidden input.
    expect(shapeOf(sceneOf(beginRun(SEED)))).toEqual(shapeOf(sceneOf(beginRun(SEED))));
    expect(shapeOf(sceneOf(beginRun(SEED)))).not.toEqual(shapeOf(sceneOf(beginRun('elsewhere'))));
  });
});

describe('`Run` is opaque — the property this layer exists for', () => {
  const run = beginRun(SEED);

  it('has no member a consumer can name', () => {
    // These are compile-time assertions with a runtime tail. `@ts-expect-error` fails the build
    // **both ways**: if a line stops erroring, TypeScript reports the directive as unused and
    // `npm run typecheck` goes red. So a future edit that exposes the state — a `state` field, a
    // `stateOf` accessor, an index signature — cannot land quietly. The `expect`s afterwards are
    // there because the rest of the file's style is runtime assertions, and because an accessor
    // added under one of these names would fail here even if someone deleted the directive above it.

    // @ts-expect-error the GameState is behind a module-private symbol; there is no `state` member.
    const state: unknown = run.state;
    // @ts-expect-error nor under any of the other names someone would try first.
    const alias: unknown = run.gameState;
    // @ts-expect-error nor is the scene a public field — `sceneOf` is the only way to it.
    const scene: unknown = run.scene;

    expect([state, alias, scene]).toEqual([undefined, undefined, undefined]);
  });

  it('cannot be forged, so a `Run` can only have come from `beginRun` or an intent', () => {
    // The nominal half of the property. Without it a consumer could hand-build a `{ }` that
    // satisfies `Run` structurally and pass it to `move`, and the first thing `advance` does is read
    // a field that would not be there.

    // @ts-expect-error the required key is a symbol no other module can write down.
    const forged: Run = {};
    expect(forged).toBeDefined();
  });

  it('resists a consumer who declares a symbol of their own', () => {
    // `unique symbol` is nominal: identical description, different key. This is the assertion that
    // says the opacity does not rest on nobody guessing the string.

    // @ts-expect-error IMPOSTOR is not RUN_STATE, however identically it is spelled.
    const guessed: unknown = run[IMPOSTOR];

    // The descriptions really are identical, so this is not passing because the guess was sloppy.
    expect(IMPOSTOR.description).toBe(Object.getOwnPropertySymbols(run)[0].description);
    expect(guessed).toBeUndefined();
  });

  it('resists a consumer who reflects the key out at runtime', () => {
    // The key really is an own property, so `Object.getOwnPropertySymbols` really does hand it over.
    // What stops a consumer is that a plain `symbol` is not a *type* that can index `Run`.
    //
    // ── This test used to claim more than it checked, and that is worth leaving on the record. ──
    // Its previous comment said "nothing the compiler accepts can get there", while the only thing
    // it asserted was that ONE expression errors. A property stated in a comment and unasserted in
    // the body cannot fail when the property is violated — and this one *was* violated, by two
    // mechanisms it never touched (see the two tests below). It read as proof and was not, which is
    // strictly worse than having had no test here at all. The scope of the claim now matches the
    // scope of the assertions, and the claims it used to make are asserted below, separately.
    const keys = Object.getOwnPropertySymbols(run);
    expect(keys).toHaveLength(1);

    // @ts-expect-error a plain `symbol` cannot index a type whose only key is a `unique symbol`.
    const reflected: unknown = run[keys[0]];
    expect(reflected).toBeDefined();
  });

  it('does not let the key be computed, even though it cannot be written (mechanism 1)', () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // A key you cannot spell is still a key `keyof` can hand you.
    //
    // `Run` was declared `{ readonly [RUN_STATE]: RunInternals }`. Nobody outside could *write* the
    // key — and nobody needed to, because `keyof Run` **is** that key, so `Run[keyof Run]` resolved
    // to `RunInternals` and `Run[keyof Run]['state']` resolved to `GameState`, by name, with
    // autocomplete, from a file that had never imported `game/`. Declaring the property as `never`
    // is what closes it: nothing can be projected out of `never`.
    //
    // This is asserted **positively** rather than with `@ts-expect-error`, and that distinction is
    // the whole reason this test can fail. `type X = Run[keyof Run]['state']` does NOT error today —
    // indexed access on `never` is legal and silently yields `never` — so a `@ts-expect-error` on
    // that line would be reported as *unused* and the test would fail for the wrong reason while a
    // regression sailed through. `IsNever` asserts the resolved type instead, so the day someone
    // changes `never` back to `RunInternals`, `insidesAreNever` stops being assignable and
    // `npm run typecheck` goes red naming this line.
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    const insidesAreNever: IsNever<Run[keyof Run]> = true;
    expect(insidesAreNever).toBe(true);
  });

  it('has no implicit index signature, because it is an `interface` (mechanism 2)', () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // The runtime half of the same exploit, and it turns on `type` vs `interface` alone.
    //
    // A **type alias** gets an implicit index signature, so `const record: Record<symbol, T> = run`
    // is an ordinary assignment — after which the symbol reflected off the object indexes it and the
    // insides come out with no cast anywhere. An **interface** gets no implicit index signature, so
    // the same assignment fails with `TS2322: Index signature for type 'symbol' is missing`.
    //
    // That is the entire difference, it is invisible at the call site, and `type` is what most
    // people reach for. If someone ever "simplifies" `interface Run` back to `type Run`, this is the
    // line that stops them.
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    // @ts-expect-error `Run` is an interface: no implicit symbol index signature to assign through.
    const record: Record<symbol, unknown> = run;
    expect(record).toBeDefined();
  });

  it('is reachable only through a cast, which is the residual and is deliberate', () => {
    // The honest limit, asserted rather than promised. The state IS on the object — that is the
    // point of not using a `WeakMap` — so an explicit cast reaches it and no type system can stop
    // that. What changed is the *cost*: this now requires a double cast (`as unknown as`, because
    // one is not enough), which is loud, greppable and impossible to mistake for ordinary code in
    // review. The path that had to be closed was the one that looked innocent, and it is closed.
    //
    // This test exists so the residual is a known, tested quantity rather than a discovery. If a
    // future change makes even this fail — a `WeakMap`, a `#private` class field — that is a
    // deliberate strengthening and this test is the one that should be rewritten to say so.
    // `as unknown as` — two casts, because one is not enough: `Run` and this record type are
    // unrelated in both directions, which is itself a small piece of evidence that the seam holds.
    const smuggled = (run as unknown as Record<symbol, { readonly state: GameState }>)[
      Object.getOwnPropertySymbols(run)[0]
    ];

    expect(smuggled.state).toBeDefined();
    expect(smuggled.state.lantern.fuel).toBeGreaterThan(0);
  });

  it('leaks nothing when logged or serialized', () => {
    // Symbol-keyed properties are invisible to `Object.keys` and to `JSON.stringify`. So a `Run` in
    // a console log, in a React DevTools pane, or accidentally sent to a crash reporter is `{}` —
    // which is a real consequence of the symbol choice and worth pinning, because a public `state`
    // field would turn every one of those into a full dump of the simulation.
    expect(Object.keys(run)).toEqual([]);
    expect(JSON.stringify(run)).toBe('{}');
  });
});

/**
 * `true` only when `T` is exactly `never`.
 *
 * The tuple wrapping is not decoration: a bare `T extends never ? ... : ...` distributes over a
 * naked type parameter, and distributing over `never` yields `never` rather than `true` — so the
 * obvious spelling would resolve to `never` and be assignable to nothing, failing the one test it
 * was written for while looking correct.
 */
type IsNever<T> = [T] extends [never] ? true : false;

/** A consumer's best attempt at spelling the private key. Same description, different symbol. */
const IMPOSTOR: unique symbol = Symbol('session/run: the private state of a run');

describe('a refused command (GDD §2: a refused tap must still produce feedback)', () => {
  it('produces a `refused` cue rather than silence', () => {
    // The opening lantern is already open, so re-asserting the setting is refused (`step`'s contract
    // point 6, fourth case). The bug this catches is the tempting short-circuit in `advance` —
    // `if (after === before) return run` — which would hand `components/` the identical value it
    // already had, skip the re-render, and delete the only feedback the player gets for an illegal
    // tap. On a phone that reads as "the touch did not register", which is a UI failure wearing the
    // costume of a rule.
    const run = beginRun(SEED);
    const refused = setShutter(run, 'open');

    expect(refused).not.toBe(run);
    expect(cuesOf(refused)).toEqual([{ kind: 'refused' }]);
  });

  it('costs no turn and changes no readout', () => {
    const run = beginRun(SEED);
    const refused = descend(run); // §9/§13: the stairs are where you take them, and this is not them.

    expect(kinds(cuesOf(refused))).toEqual(['refused']);
    expect(sceneOf(refused).hud.turnsElapsed).toBe(sceneOf(run).hud.turnsElapsed);
    expect(sceneOf(refused).hud.fuel.fuel).toBe(sceneOf(run).hud.fuel.fuel);
  });

  it('hands back the previous `Scene` by reference, so nothing repaints', () => {
    // The other half of the pair above, and it pulls the opposite way: the run must be new (so the
    // cue is seen) and the scene must be old (so the board does not blink). Recomputing would build
    // a structurally identical `Scene` in a fresh wrapper with a fresh `hud`, and a memo above the
    // board would re-render the whole frame to show nothing new.
    const run = beginRun(SEED);
    expect(sceneOf(setShutter(run, 'open'))).toBe(sceneOf(run));
  });
});

describe('the shutter names a setting, not a toggle', () => {
  it('goes where it is told, twice in a row without flipping back', () => {
    // The bug: implementing `setShutter` as a toggle, or as `setShutter(run, open: boolean)` wired
    // to the negation of the current state. Both pass the first assertion and fail the third — the
    // second `'shuttered'` would re-open the lantern, which is `game/core/command.ts`'s exact
    // argument for why the command names an absolute setting.
    const run = beginRun(SEED);
    expect(sceneOf(run).hud.shutter.state).toBe('open');

    const shut = setShutter(run, 'shuttered');
    expect(sceneOf(shut).hud.shutter.state).toBe('shuttered');
    expect(cuesOf(shut)).toContainEqual({ kind: 'shutterChanged', to: 'shuttered' });

    const again = setShutter(shut, 'shuttered');
    expect(sceneOf(again).hud.shutter.state).toBe('shuttered');
    expect(kinds(cuesOf(again))).toEqual(['refused']);
  });

  it('is free — it burns fuel but spends no turn (§2)', () => {
    const run = beginRun(SEED);
    const shut = setShutter(run, 'shuttered');

    expect(sceneOf(shut).hud.turnsElapsed).toBe(sceneOf(run).hud.turnsElapsed);
    expect(sceneOf(shut).hud.fuel.fuel).toBeLessThan(sceneOf(run).hud.fuel.fuel);
  });
});

describe('scene reuse survives the round trip', () => {
  /** The first direction the opening run will actually accept. Seed-independent. */
  function firstLegalStep(run: Run): Run {
    for (const dir of ['north', 'east', 'south', 'west'] as const) {
      const next = move(run, dir);
      if (!kinds(cuesOf(next)).includes('refused')) return next;
    }
    throw new Error('the opening run refused every direction');
  }

  it('keeps an unchanged cell as the same object across a `wait`', () => {
    // The property #20 depends on: `React.memo` with the **default** comparator is only sufficient
    // if an unchanged cell is the *same object* as last turn (`render/scene.ts`). That is arranged
    // by handing `presentScene` the previous **Scene**, and this layer is now the only thing holding
    // it — so dropping that argument in `advance` is a one-token edit that would allocate ~165 fresh
    // cells per turn, miss every memo, and fail nothing but this test.
    const run = beginRun(SEED);
    const waited = wait(run);
    const before = sceneOf(run).grid.cells;
    const after = sceneOf(waited).grid.cells;

    let reused = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (shapeOf(before[i]) === shapeOf(after[i])) {
        expect(after[i], `cell ${i} is unchanged but was reallocated`).toBe(before[i]);
        reused += 1;
      }
    }
    // Not vacuous: a turn that changed every cell would satisfy the loop without reusing anything.
    expect(reused).toBeGreaterThan(after.length / 2);
  });

  it('reuses across a move as well, where some cells genuinely do change', () => {
    // A `wait` in a quiet room can leave the whole board untouched, in which case `presentScene`
    // returns the previous grid wholesale and the test above proves less than it looks. A step moves
    // the player and drags the lit disc with it, so this one has real churn to reuse *around*.
    const run = beginRun(SEED);
    const moved = firstLegalStep(run);
    const before = sceneOf(run).grid.cells;
    const after = sceneOf(moved).grid.cells;

    let changed = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (shapeOf(before[i]) === shapeOf(after[i])) expect(after[i]).toBe(before[i]);
      else changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(after.length);
  });

  it('does not touch the run it was handed', () => {
    // Every intent is a value returning a value. A `Run` handed to `move` is the same `Run`
    // afterwards, which is what makes it safe to hold in React state and to hand to two callbacks.
    const run = beginRun(SEED);
    const scene = sceneOf(run);
    const cues = cuesOf(run);

    move(run, 'north');
    wait(run);
    setShutter(run, 'shuttered');
    descend(run);

    expect(sceneOf(run)).toBe(scene);
    expect(cuesOf(run)).toBe(cues);
  });
});

describe('a whole run, driven only through the four intents', () => {
  it('reaches the bottom', () => {
    // The full loop the DoD asks for: `beginRun` -> a real command sequence -> a finished run, with
    // a rendered `Scene` at every step and no `GameState` anywhere in this file. §13's win.
    const final = sceneOf(RUNS[RUNS.length - 1]);

    expect(final.hud.outcome.kind).toBe('reachedBottom');
    expect(final.hud.floor.number).toBe(final.hud.floor.last);
    expect(final.hud.turnsElapsed).toBeGreaterThan(20);
  });

  it('presents a complete board at every single step', () => {
    // A scene that went missing, went empty, or changed shape mid-run would be a blank screen at
    // exactly one moment of the game, which is the kind of thing a happy-path test never sees.
    for (const run of RUNS) {
      const scene = sceneOf(run);
      expect(scene.grid.cells).toHaveLength(scene.grid.width * scene.grid.height);
      expect(cellAt(scene.grid, 0, 0)).toBeDefined();
      expect(scene.hud.floor.number).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports every descent as a cue, so the board never swaps silently', () => {
    // §13: a descent replaces the board. #20 animates that, and it is the one transition where
    // animating anything else would be a lie about a floor that no longer exists.
    const descents = RUNS.filter((run) => kinds(cuesOf(run)).includes('descended'));
    expect(descents.length).toBeGreaterThan(1);
    for (const run of descents) {
      expect(cuesOf(run)).toEqual([{ kind: 'descended', toFloor: sceneOf(run).hud.floor.number }]);
    }
  });

  it('advances the turn counter monotonically, and never on a refusal', () => {
    // The counter is `game/`'s and this layer only relays it — but relaying it wrongly (by
    // recomputing, or by counting intents) is exactly the sort of derived value that would end up
    // here if nobody was watching. `turnsElapsed` counts turns spent, not taps.
    for (let i = 1; i < RUNS.length; i += 1) {
      const was = sceneOf(RUNS[i - 1]).hud.turnsElapsed;
      const now = sceneOf(RUNS[i]).hud.turnsElapsed;
      expect(now).toBeGreaterThanOrEqual(was);
      if (kinds(cuesOf(RUNS[i])).includes('refused')) expect(now).toBe(was);
    }
  });

  it('carries fuel across floors and burns it within them (§4, §13)', () => {
    // A smoke test on the thing this layer is threading: if `advance` ever handed `step` a stale
    // state — the classic bug in a reducer that keeps two copies — the reserve would stop moving, or
    // would reset on each floor. The reserve is run-long and it goes down.
    const fuels = RUNS.map((run) => sceneOf(run).hud.fuel.fuel);
    expect(new Set(fuels).size).toBeGreaterThan(5);
    expect(fuels[fuels.length - 1]).toBeLessThan(fuels[0]);
  });
});

describe('the layer is pure', () => {
  it('produces the same run twice from the same seed and the same intents', () => {
    // The determinism guarantee, restated at this layer: `(seed, intents)` is the whole input.
    const twice = runsOf(DIVE.seed, DIVE.commands);
    expect(shapeOf(sceneOf(twice[twice.length - 1]))).toEqual(
      shapeOf(sceneOf(RUNS[RUNS.length - 1])),
    );
    expect(twice.map((run) => kinds(cuesOf(run)))).toEqual(RUNS.map((run) => kinds(cuesOf(run))));
  });

  it('answers `sceneOf` and `cuesOf` with the same objects every time', () => {
    // Accessors, not computations. A lazy `cuesOf` that recomputed would return a fresh array on
    // every call, and a component effect keyed on the cue list would re-fire on every render — a
    // shake animation replaying itself for as long as anything upstream re-renders.
    const run = wait(beginRun(SEED));
    expect(sceneOf(run)).toBe(sceneOf(run));
    expect(cuesOf(run)).toBe(cuesOf(run));
  });
});
