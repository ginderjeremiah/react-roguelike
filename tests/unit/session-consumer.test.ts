import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS, GLYPHS, cellAt, type Cue, type Scene } from '@/render';
import {
  beginRun,
  cuesOf,
  move,
  sceneOf,
  setShutter,
  wait,
  type Direction,
  type Run,
  type ShutterState,
} from '@/session';

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * THE SPIKE: THIS FILE IS A COMPONENT, MINUS THE PIXELS
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Issue #45's definition of done asks for a spike that gets from a fresh run to a rendered `Scene`
 * and back through a resolved command, using only what `components/` is allowed to use. So this file
 * obeys `components/`' import rules exactly:
 *
 *   - **It imports `@/session` and `@/render`. Nothing else.** No `@/game`, static or dynamic, and
 *     no test-support helper — `tests/unit/support/run-script.ts` imports `@/game/core`, so reaching
 *     for it would quietly reintroduce the very dependency the spike exists to prove is unnecessary.
 *   - It never names a `GameState`, a `Command`, an `Actor`, a `Tile` or an id, because it cannot.
 *   - Every question it asks is answered by the presentation model.
 *
 * If this file ever needs an import from `@/game` to do something a UI plainly has to do, that is a
 * hole in the seam and the fix belongs in `session/` or `render/`, not here. **That is the whole
 * assertion.** The lint rule and `infrastructure.test.ts` police the import graph of `components/`
 * and `app/`; this policices whether obeying that graph is actually *sufficient*, which is a
 * different question and the one #45 was filed about.
 *
 * `session/run.test.ts` covers the layer's behaviour in depth, and does so from inside the layer
 * (where importing `@/game` is legal). What is proved here and nowhere else is reachability from
 * outside.
 */

/** The whole of a component's state. In React this is `useState<Run>(() => beginRun(seed))`. */
function open(seed: string): Run {
  return beginRun(seed);
}

/**
 * A renderer, at the only fidelity a Vitest process has: one character per cell, row-major.
 *
 * This stands in for the ~165 `View`s #20 will mount. It touches nothing but `Cell` fields, which is
 * the point — a real glyph grid needs `glyph`, `fg`, `opacity` and `bg`, and every one of them is
 * already on the model with no rule left to apply.
 */
function paint(scene: Scene): string[] {
  const rows: string[] = [];
  for (let y = 0; y < scene.grid.height; y += 1) {
    let row = '';
    for (let x = 0; x < scene.grid.width; x += 1) {
      const cell = cellAt(scene.grid, x, y);
      expect(COLOR_TOKENS).toContain(cell.fg);
      row += cell.glyph === '' ? ' ' : cell.glyph;
    }
    rows.push(row);
  }
  return rows;
}

/** What a HUD component would put on screen, as one line. Values only; no rules applied. */
function readout(scene: Scene): string {
  const { health, fuel, floor, shutter, sense } = scene.hud;
  return [
    `HP ${health.hp}/${health.maxHp}`,
    `fuel ${fuel.fuel} (${fuel.turnsRemaining} turns)`,
    `floor ${floor.number}/${floor.last}`,
    shutter.state,
    `sense ${sense.radius}/${sense.max}`,
  ].join('  ');
}

/** What an animation layer would do with a turn: react to facts, or ignore them entirely (§11). */
function react(cues: readonly Cue[]): string[] {
  return cues.map((cue) => {
    switch (cue.kind) {
      case 'refused':
        return 'shake';
      case 'descended':
        return `swap board to floor ${cue.toFloor}`;
      case 'shutterChanged':
        return `fade to ${cue.to}`;
      case 'playerMoved':
        return `slide ${cue.from.x},${cue.from.y} -> ${cue.to.x},${cue.to.y}`;
      case 'damaged':
        return `flash ${cue.who} for ${cue.amount}`;
      case 'died':
        return `dissolve ${cue.who}`;
      case 'fuelGained':
        return `pulse +${cue.amount}`;
    }
  });
}

describe('a consumer that may not import `@/game`', () => {
  it('gets from a seed to a painted board with one intent in between', () => {
    // The DoD's path, end to end. Everything here is what a component does on mount and on a tap.
    const run = open('spike');
    const opening = paint(sceneOf(run));

    expect(opening).toHaveLength(sceneOf(run).grid.height);
    expect(opening.join('\n')).toContain(GLYPHS.player);
    expect(cuesOf(run)).toEqual([]);

    const after = wait(run);
    const next = paint(sceneOf(after));

    expect(next.join('\n')).toContain(GLYPHS.player);
    expect(react(cuesOf(after))).not.toContain('shake');
    // A turn really was spent, so the round trip went through the simulation rather than round a
    // cache: the whole point of the spike is that a tap reaches `step()` and comes back presented.
    expect(sceneOf(after).hud.turnsElapsed).toBe(sceneOf(run).hud.turnsElapsed + 1);
  });

  it('can bind four buttons without naming a command', () => {
    // The second half of the seam: `components/` builds no `Command`. It knows four verbs and two
    // plain-data vocabularies, and both of those are nameable from here — which is what lets a d-pad
    // declare `onStep(dir: Direction)` rather than widening to `string` or spelling
    // `Parameters<typeof move>[1]`.
    const dPad: readonly Direction[] = ['north', 'east', 'south', 'west'];
    const settings: readonly ShutterState[] = ['open', 'shuttered'];

    let run = open('buttons');
    for (const dir of dPad) run = move(run, dir);
    for (const to of settings) run = setShutter(run, to);

    expect(readout(sceneOf(run))).toContain('floor 1/8');
    expect(sceneOf(run).hud.shutter.state).toBe('shuttered');
  });

  it('gets feedback for an illegal tap without knowing why it was illegal', () => {
    // §2. The opening lantern is already open, so this is refused — and the component learns exactly
    // one thing: shake. It is not told about walls, stairs, fuel or run status, and it must not be:
    // the moment a component branches on *why*, a rule has moved out of `game/`.
    const run = open('refusal');
    const refused = setShutter(run, 'open');

    expect(react(cuesOf(refused))).toEqual(['shake']);
    expect(readout(sceneOf(refused))).toBe(readout(sceneOf(run)));
    // And the board is the identical object, so a memoised grid re-renders nothing.
    expect(sceneOf(refused).grid).toBe(sceneOf(run).grid);
  });

  it('cannot reach the simulation state through the handle it holds', () => {
    // `session/run.test.ts` asserts the same property against `./run`; this asserts it against the
    // **public surface**, which is the one that would break if `index.ts` ever re-exported the key
    // or added a debug accessor. Both are needed: the first says the module hides it, the second
    // says the barrel does not hand it back.
    const run = open('opaque');

    // @ts-expect-error `Run` is an opaque handle: there is no member here to read.
    const state: unknown = run.state;
    // @ts-expect-error and no accessor smuggled in under another name.
    const internal: unknown = run.internal;

    expect([state, internal]).toEqual([undefined, undefined]);
    expect(Object.keys(run)).toEqual([]);
    expect(JSON.stringify(run)).toBe('{}');
  });

  it('cannot name `GameState` by computing the key — the PR #51 review exploit, verbatim', () => {
    // ═══════════════════════════════════════════════════════════════════════════════════════════
    // THIS IS THE EXPLOIT THAT FAILED REVIEW, KEPT WHERE IT WAS FOUND
    //
    // The first version of this layer shipped a `Run` that leaked the entire simulation to any
    // `components/`-legal file: no cast, no `any`, no `@ts-expect-error`, no `game/` import, all
    // three gates green, and full autocomplete on `GameState`. It is reproduced here **unchanged**,
    // in the one file in the repo that is bound by a component's import rules, because a regression
    // test for a hole belongs at the position the hole was reachable from.
    //
    // Two independent mechanisms, each of which is sufficient on its own, so each gets its own
    // directive. A single `@ts-expect-error` over the whole block would go on passing if one of the
    // two reopened, and would tell nobody which.
    // ═══════════════════════════════════════════════════════════════════════════════════════════

    // ── Mechanism 1: the key cannot be *written*, but `keyof` computes it. ──────────────────────
    // Closed by declaring the property `never`, so nothing can be projected out of it. Note this
    // line itself does NOT error — indexed access on `never` is legal and yields `never` — which is
    // exactly why the assertion has to be on the *use* below and on `IsNever` in `run.test.ts`,
    // rather than a `@ts-expect-error` here that would be reported as unused.
    type GameStateLeaked = Run[keyof Run]['state'];

    function insides(run: Run): Run[keyof Run] {
      // ── Mechanism 2: a `type` alias's implicit symbol index signature. ───────────────────────
      // Closed by declaring `Run` an `interface`, which has no implicit index signature.
      // @ts-expect-error TS2322: Index signature for type 'symbol' is missing in type 'Run'.
      const record: Record<symbol, Run[keyof Run]> = run;
      return record[Object.getOwnPropertySymbols(run)[0]];
    }

    function gameRuleInAComponent(run: Run): boolean {
      // @ts-expect-error TS2339: Property 'state' does not exist on type 'never'.
      const state: GameStateLeaked = insides(run).state;
      // @ts-expect-error TS2339: Property 'world' does not exist on type 'never'.
      return state.world.actors.some((a: { kind: string; hp: number }) => a.kind === 'creature' && a.hp <= 0);
    }

    // The exploit still *runs* — mechanism 2's cast is erased, so `insides` returns the real object
    // at runtime and the rule evaluates. That is the residual, stated below, and it is why the
    // assertions that matter here are the four compile errors above rather than this line.
    expect(typeof gameRuleInAComponent(open('exploit'))).toBe('boolean');
  });

  it('reaches the state only through an explicit cast, which is the residual', () => {
    // What is NOT closed, said plainly so nobody has to discover it: the state is a real property of
    // a real object, so `as any` plus reflection reaches it, and no type system prevents a cast.
    //
    // That is accepted, and the reason is about *review* rather than about types. The path that had
    // to be closed was the one that looked like ordinary code — the block above passes a reading
    // eye, passes ESLint, passes the scanner, and passes `tsc`. This one does not: `as any` in a
    // component, next to `getOwnPropertySymbols`, is loud, greppable and the kind of line a reviewer
    // stops on. The property that now holds is "nothing above the seam inspects a `GameState`
    // **without an explicit, visible cast**", which is weaker than the sentence the first version of
    // this layer claimed and is the one that is actually true.
    // Note what this file still cannot do even here: it cannot say `GameState`, because naming the
    // type needs an import it does not have. The shape below is hand-written and structural, so the
    // smuggler gets no field names, no autocomplete and no compiler help — which is a meaningfully
    // worse position than the exploit above enjoyed, and is the rest of why this residual is
    // tolerable.
    const run = open('residual');
    const smuggled = (
      run as unknown as Record<symbol, { readonly state: { readonly world: { actors: unknown[] } } }>
    )[Object.getOwnPropertySymbols(run)[0]];

    expect(smuggled.state.world.actors.length).toBeGreaterThan(0);
  });
});
