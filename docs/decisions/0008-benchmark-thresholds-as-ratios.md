# ADR-0008: Benchmark thresholds are ratios, not milliseconds

**Status:** Accepted — **but the leaf-benchmark half is under direct challenge by
[#137](../../issues/137), which was filed with the measurement this ADR does not have.** Read
*Decision* below beside the note at the end before writing or converting a benchmark.
**Date:** 2026-08-04

Reconstructed by the `archivist` after PR #33 (issue #18), where the decision was made under
pressure and recorded only in a test-file header and in journal prose. Nothing in `docs/` said it,
and it is exactly the kind of thing a later session "simplifies" back.

## Context

`ARCHITECTURE.md` budgets **2ms for one `step()`**. `game/core/step.bench.test.ts` was written to
hold three operations to absolute millisecond figures measured on a development machine: a descent
at 0.45ms, an ordinary lit turn at 0.015ms, a refusal at 0.0001ms.

The descent assertion then failed on a GitHub Actions runner at **1.72ms**. Nothing had regressed —
the runner is roughly 4x slower than the machine the threshold was set on. Three properties of the
situation made this more than a flaky test:

- **There was nowhere to raise the threshold to.** 1.72ms against a 2ms budget leaves 0.28ms of
  headroom, so a threshold that passes on CI is a threshold that can no longer detect a regression.
- **Raising it sets the bar by whichever machine happens to be slowest**, which is not a property of
  the code and drifts every time the CI fleet changes.
- **The benchmark is the only instrument** that would notice a refused `descend` starting to
  generate a floor before discarding it — a replay-breaking bug worth ~0.3ms and invisible to every
  behavioural test.

Two further failures surfaced while fixing it, and both shaped the decision:

- A ratio measured by running the yardstick batch *after* the subject batch produced **0.69x** — a
  descent measuring cheaper than the `generateFloor` it contains, which is physically impossible.
  **That run passed.** A benchmark can go green because its instrument failed.
- Thresholds calibrated by running the benchmark file alone flaked under the full 44-file parallel
  suite. Measured: 4 failures in 30 whole-suite runs, 0 in 30 single-file runs. Interference is not
  random and does not cancel — in each pair the subject has the larger working set, so a neighbouring
  worker evicting the cache costs it more than it costs the yardstick.

## Decision

**A threshold on a whole-`step()` operation is a ratio against a cheaper quantity measured in the
same process, in interleaved batches whose order swaps each round.** That is `game/core/`'s
benchmark, and today it is the only file here that works this way.

**The subsystem benchmarks keep their absolute millisecond budgets, and that is deliberate — the
ratios depend on them.** `fov.bench.test.ts` (0.05ms per lit field, 2ms floor-wide),
`generate.bench.test.ts` (2ms per floor), `light.bench.test.ts` (**1ms per lit turn and 0.3ms per
flash** — 0.2ms when this ADR was written; #133 found both of its fixtures were measuring a turn in
which nothing happened, rebuilt them, and recalibrated) and
`actors.bench.test.ts` (2ms per actor phase) are all still absolute, and `step.bench.test.ts`'s own
header cites two of them as the reason it does not need to be: a ratio says a descent costs little
more than the generation it contains, and it takes an *absolute* budget somewhere to say that the
generation itself is affordable. A ratio alone cannot notice everything getting slower together.

So the rule is scoped by what is being measured, not by taste:

- **A composite operation** — one built from parts that have budgets of their own — is asserted as a
  **ratio** to its dominant part. It is the only assertion that means the same thing on every
  machine, and the composite is where hardware spread is worst.
- **A leaf operation** — one nothing decomposes further — keeps an **absolute** budget, because
  there is no yardstick inside it to divide the machine out with, and because the frame budget has
  to be anchored to real time somewhere or it is not a budget.

**The taxonomy is about which benchmark owns the anchor, not about which operations happen to be
composite** — and one case makes the difference visible. A lit turn *is* composite: it contains the
lit field `fov.bench.test.ts` budgets at 0.05ms, and `step.bench.test.ts` measures exactly that
decomposition as a ratio (`A_LIT_TURN_CONTAINS_A_FIELD`). Yet `light.bench.test.ts` holds the same
operation to an absolute 0.2ms, and that is correct, because **a subsystem benchmark anchors the
layer it owns in real time even where that layer decomposes**. The ratio form is for whole-`step()`
composites, where hardware spread is worst and where an absolute figure has already been shown to be
unsettable. So the same operation is legitimately measured both ways, by two files with two
different jobs: one asks "is this layer still affordable in milliseconds", the other asks "does the
whole turn still cost about what its parts cost". Converting the subsystem files to ratios would
delete the anchor the ratios are interpreted against, which is the mistake this ADR exists to
prevent in the opposite direction.

The leaf budgets are set an order of magnitude above measurement (0.05ms against ~0.004ms actual)
precisely so a 4x machine spread does not reach them. That is what makes them survivable as
absolutes and what made the descent's 1.72ms-against-2ms unsurvivable.

Four rules follow, all of them paid for, and all of them about the ratio side:

1. **The yardstick is a component of the subject.** A descent is measured against a bare
   `generateFloor`; a lit turn against the lit field it computes; a refusal against an ordinary
   turn. This divides the machine out, so the same number means the same thing on a laptop, a CI
   runner and a phone.
2. **An impossible reading fails loudly rather than passing flatteringly.** A subject that measures
   cheaper than the component it contains is an instrument failure, and is asserted against.
3. **Calibrate against `npm test`, never against the benchmark file alone.** Three thresholds in
   this file's short history were set from in-isolation figures and all three flaked.
4. **Verify a threshold by planting the regression it exists to catch** and watching it go red. The
   1.6x descent limit was verified by planting a second `generateFloor` in `step()` (2.07x, red).

Absolute figures are still **printed** on every run, so a genuine slowdown is visible in the CI log
even when nothing fails. They are just not asserted.

**Precondition, and the thing to check before reusing this:** the ratio estimator filters rounds by
nearness to each series' own minimum, and that provably cannot mask a regression only because both
predicates are homogeneous of degree 1 in their own series — a regression scales the subject batch
by a constant, so it scales every kept ratio by exactly that constant. **This holds because each
batch is N identical calls of a pure function on a frozen `(state, command)`.** It does *not* hold
for a benchmark whose per-call cost genuinely varies — one that steps a *sequence* of commands, for
instance. Such a benchmark needs a different estimator, not this one reused.

## Alternatives considered

**Raise the absolute threshold until CI passes.** The obvious move, and the one this ADR exists to
prevent being made again. It sets the bar by the slowest machine that has ever run the suite, gives
up on detecting the regression the benchmark was written for (there is 0.28ms of headroom), and has
to be re-raised every time the CI fleet gets slower. It also quietly converts a performance
assertion into a liveness check.

**Delete the benchmark and rely on the 2ms budget as documentation.** Cheaper and honest about the
fact that nothing measures a phone. Rejected because the refusal assertion is load-bearing for
*correctness*, not just speed: a refused `descend` that generates a floor before discarding it draws
from the RNG and breaks every stored replay, and no behavioural test sees it.

**Pin the CI machine class and keep absolutes.** Not available on hosted runners in any way we
control, and it would still leave the developer machine and a phone disagreeing with CI.

**Run benchmarks only in a dedicated serial job.** Would fix the parallel-interference flake without
the estimator work. Rejected as a bigger change to CI for a narrower benefit — it does not address
the 4x hardware spread at all, which was the original failure.

## Consequences

**Makes easy:** a threshold that means the same thing everywhere and never needs re-tuning for
hardware; benchmarks that can run inside the ordinary `npm test` invocation rather than a special
job; regressions detectable at a fixed multiple regardless of the box.

**Makes hard:** every new benchmark needs a *cheaper component of itself* to measure against, and
finding one is real design work. A ratio also cannot answer "does this fit in the frame budget" —
only "did this get slower relative to its parts". That question is still open and is why #34 exists:
on runner-class hardware a descent is 1.7ms of the 2ms budget, and only a measurement on a real
device will settle it.

**Revisit if:** a benchmark's subject has genuinely variable per-call cost (see the precondition
above), or if we ever get a pinned device in CI, at which point an absolute frame-budget assertion
becomes meaningful again and should sit *beside* the ratios rather than replace them.

## Challenged 2026-08-03 by #137, and this ADR has not been amended — read both

**The leaf rule above was argued, not measured, and #137 measured it.** From PR #136: the same lit
turn reads **0.100-0.105ms** on an idle local box, **0.115-0.198ms** under the full suite, and
**0.478/0.529ms** on a GitHub runner — a **4.5x** machine spread, so an absolute limit a runner
cannot trip cannot catch anything smaller than roughly a doubling. Concretely: recomputing the lit
field per light query — the exact bug `step.bench.test.ts` says *"belongs to `light.bench.test.ts`'s
busy floor"*, tracked as #35 — costs **1.4x** and sails under the threshold. The same operation
expressed as *turn / lit field* reads 25.1, 29.2, 31.4, 32.1 and 34.0x across two machine classes:
a spread of **at least ~36%** (quote it as a floor and expect it to widen — it has been quoted at 7%,
16% and ~36% as points were added) against **4.5x**.

**What this ADR still holds against that, and it is not nothing.** The absolute budgets are the
anchor the ratios are interpreted against: a ratio says a descent costs about what its generation
costs, and it takes an absolute figure *somewhere* to say that the generation is affordable at all.
Converting every subsystem file to a ratio deletes the anchor — the mistake named in *Decision*
above. **So #137 is not a licence to convert `light.bench.test.ts`; it is an argument that this ADR's
taxonomy is missing a case**, and building it means amending this ADR with an answer to *where the
anchor lives once the leaves are ratios*. It also needs the paired-batch harness extracted out of
`step.bench.test.ts` first, which is why #133 recalibrated the absolutes and filed the issue instead.

**One thing to preserve whatever is decided:** #133 replaced both `light.bench.test.ts` guards after
finding they asserted a *state* (`mind.kind === 'awake'`) that was true in the working and the broken
case alike, while the fixtures measured a turn in which no creature acted and a flash that never
asked the light query. The replacements assert the **work**. Those assertions are what caught it; the
timing assertion passed throughout.
