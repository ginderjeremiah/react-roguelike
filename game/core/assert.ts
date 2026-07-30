/**
 * Compile-time exhaustiveness, with a runtime backstop.
 *
 * Every `switch` over a discriminated union in `game/` ends in `default: return assertNever(x, ...)`.
 * The value of doing so is almost entirely at compile time: add a variant to `Command` and every
 * switch that does not handle it stops type-checking, because the new variant is no longer
 * assignable to `never`. That is the mechanism this codebase uses instead of a default case that
 * silently does nothing.
 *
 * The throw matters anyway, because `Command` values can arrive from outside the type system — a
 * `RunRecord` parsed from a save file or a URL is `unknown` no matter what its declared type says.
 * A malformed variant must fail loudly at the point it is first seen rather than fall through to a
 * no-op turn that quietly produces a different run than the one that was recorded.
 */
export function assertNever(value: never, context: string): never {
  // `value` is `never` to the type checker but a real value at runtime; the cast is the point.
  throw new Error(`${context}: unhandled variant ${JSON.stringify(value as unknown)}`);
}
