import { describe, expect, it } from 'vitest';
import { atTheStairs, lightTheWayDown } from '@/tests/unit/support/run-script';
import { LAST_FLOOR } from '../content';
import { playerOf } from '../entities';
import { computeLitField } from '../fov';
import { generateFloor } from '../map';
import { type Command } from './command';
import { createInitialState, floorNumberOf, type GameState } from './state';
import { step } from './step';

/**
 * `step()` against ARCHITECTURE.md's **2ms per turn** budget, now that it is the whole simulation.
 *
 * `light.bench.test.ts` measures a turn on a floor; this measures the two things that only exist at
 * this layer and that the turn benchmark therefore cannot see:
 *
 *   - **a descent**, which is by far the most expensive command in the game — it generates a whole
 *     floor (`generate.bench.test.ts` measures that at ~0.3ms) and *then* runs all six phases on the
 *     result. It is the only command that can plausibly approach the budget, and it is the one a
 *     player issues at the most dramatic moment of a floor;
 *   - **a refusal**, which must cost approximately nothing. §2's whole argument for refusing a
 *     fat-fingered tap rests on it being cheap enough that the input layer can call `step` as a
 *     backstop; a refusal that generated a floor and threw it away would be both a determinism bug
 *     and a visible stutter, and only one of those has a test elsewhere.
 *
 * ## Reading a failure here
 *
 * This is a timing test and can fail for reasons that are not about the code — a loaded CI machine,
 * a cold JIT. All three assertions are therefore ratios against a yardstick measured on the same
 * machine, in the same process, in batches *paired with* the thing under test; see below. If one
 * fails intermittently near its threshold, say so in the journal rather than quietly raising the
 * number: the budget is a design constraint from ADR-0004, not a knob.
 *
 * **Calibrate against `npm test`, never against this file alone.** Every threshold below is set
 * from 44 runs of the whole 44-file suite, because that is the only condition under which these
 * measurements are ever taken, and it is far noisier than running this file by itself. Three
 * separate thresholds in this file's history were set from figures measured in isolation, and all
 * three flaked. The numbers a single-file run prints are prettier and they are not the ones to
 * reason from.
 */

/**
 * **Two of these are measured as ratios, not against a millisecond figure, and that is a
 * correction — twice over.**
 *
 * ### Why a ratio at all
 *
 * The descent was first written as "half of ARCHITECTURE's 2ms", which passed here at 0.45ms and
 * failed on a GitHub runner at **1.72ms** — a ~4x slower machine, not a regression. Raising the
 * number until the runner passed would have set the threshold by whichever machine happened to be
 * slowest, and at 1.72ms against a 2ms budget there is no headroom left to raise it into anyway.
 *
 * So the descent is held to what it *is*: a floor generation plus one turn. Generation already has
 * an absolute budget of its own (`generate.bench.test.ts`, 2ms) and a turn has one
 * (`light.bench.test.ts`, 1ms — 0.2ms until that file's fixture was found to be measuring a turn in
 * which nothing acted, which was a factor of 8); what only this layer can see is whether descending
 * costs more than the sum of its two halves. Measuring both in the same process divides the machine out, so the
 * assertion means the same thing on a laptop, a runner, and a phone. Under that first harness a
 * descent cost **1.06-1.09x** a bare generation here (~0.43ms against ~0.41ms) — so generating the
 * floor is ~92% of it and the six phases are noise. The figure under the present harness is below.
 *
 * ### Why the ratio has to be measured the way it is
 *
 * That first ratio version measured the descent to completion and *then* the yardstick, five batches
 * each. A runner then reported `descend: 1.4242ms = 0.69x a bare floor generation (2.0634ms)` — and
 * a descent cannot cost less than the generation it contains, so **the instrument, not the code,
 * produced that number**. The yardstick had been mismeasured by several times, almost certainly a GC
 * or scheduler pause landing in the block that ran second, after the descent loop had filled the
 * young generation with garbage. **That run passed.** A ratio limit protected by luck neither
 * catches a regression nor stays green.
 *
 * Getting a number that can carry an assertion took four attempts, and the three discarded ones are
 * recorded because each looked correct until it was measured against the full suite. Failure counts
 * are out of 30 whole-suite runs:
 *
 *   1. **Median of each series, batches interleaved.** 4 failures. Alternating batches still puts
 *      the two sides in different time windows, and interference in two different windows is not the
 *      same interference. Worse, it is not symmetric: the subject of each pair here has the larger
 *      working set, so it is hurt more when a neighbouring worker evicts the cache. `wait (lit)`
 *      reached **5.59x** against a 5x limit with nothing wrong with the code.
 *   2. **Minimum of each series.** 0 failures, and still wrong. Interference only ever *adds* time,
 *      so the cheapest batch is the least disturbed one — but the two minima come from different
 *      rounds, and the cleanest window the yardstick got is not the one the subject got. It produced
 *      0.818x and 0.892x on a descent, which *contains* its yardstick and cannot honestly be cheaper.
 *   3. **Median of per-round ratios.** 0 failures. Pairing the two batches milliseconds apart makes
 *      most interference common to both members of a pair, and a steal inside a round spoils that
 *      round's ratio and nothing else. Still ranged 3.49-4.38x on `wait (lit)`, because a
 *      disturbance rarely lands neatly inside one batch.
 *   4. **Median of the *undisturbed* per-round ratios**, which is what `compareOnce` does now. A
 *      pair counts only if neither of its batches is more than `UNDISTURBED` above the cheapest
 *      batch of its own series — a cleanliness test that never looks at the ratio, and so cannot
 *      prefer a round for agreeing with the threshold. 0 failures, no impossible readings, and the
 *      ranges below.
 *
 * On top of that sits **a floor on each ratio**: an arithmetic relationship the reading cannot
 * honestly violate, checked before the budget is. A violation is remeasured, and reported *as* an
 * instrument failure if it persists. This is not "retry until green" — a regression pushes every
 * ratio here *up*, so no number of retries can turn a real one into a pass; the retry can only fail
 * closed. Its only job is to stop a destroyed reading from sailing under a threshold, which is
 * exactly what the 0.69x run did.
 *
 * ### The yardsticks are chosen per subject, and that matters more than it looks
 *
 * The runner that produced the 0.69x reading also measured a lit turn ~5.7x slower than this machine
 * while measuring a descent only ~3.3x slower. Floor generation and field-of-view work do not scale
 * together across machines. So each subject is compared against a yardstick of *its own kind*, and
 * in all three cases against something the subject **contains**: the descent against the generation
 * it contains (92% of it), a turn against one of the lit fields it casts, a refusal against the
 * resolved turn whose first two steps it is. Containment is what makes each yardstick both a
 * machine-speed reference and a floor.
 *
 * ### The thresholds
 *
 * Ranges are the full spread over 44 whole-suite runs; the planted figure is the regression each
 * limit exists to catch, measured the same way. Zero failures and zero degraded readings over those
 * 44.
 *
 * | assertion | measured | limit | planted regression |
 * | --- | --- | --- | --- |
 * | descent / its generation | 0.909-1.20x | 1.6x | 2.05-2.06x, a second `generateFloor` |
 * | lit turn / one lit field | 3.42-3.70x | 5x | 5.76-5.85x, phase 3 resolved twice |
 * | refusal / a resolved wait | 0.0062-0.0072x | 0.1x | 40.0x, a floor generated before the refusal |
 *
 * `DESCENT_RATIO_LIMIT` sits at 1.33x the worst honest reading and 1.28x under the mutation, which
 * is as near the middle of the available room as it can be put.
 *
 * `LIT_TURN_RATIO_LIMIT` has 1.35x of margin below and 1.15x above, which is the whole of the room
 * there is: the regression it is aimed at is only 1.6x. It replaces an absolute 0.1ms that measured
 * 0.013-0.016ms here and **0.0839ms on the runner** — 84% of its threshold, with nothing wrong. As a multiple of one lit field a turn
 * is close to a count of casts (§2's phase 3 casts to perceive and again for the light query, phase
 * 4 once more), which is why the number holds across machines. What the limit does *not* catch is
 * calibrated too, so nobody assumes more than is there: recomputing the lit field per query instead
 * of closing over it — the exact invariant `light.ts`'s header states — measures 4.75x on floor 1
 * and passes, because floor 1 has barely any creatures to ask the query about. That bug belongs to
 * `light.bench.test.ts`'s busy floor 8, and today nothing catches it. A regression *inside* the
 * shadowcaster is invisible here by construction, since it moves both halves of the ratio;
 * `fov.bench.test.ts` holds that to an absolute 0.05ms.
 *
 * `REFUSAL_RATIO_LIMIT` is the third correction, and the one that taught the rest. It was left
 * absolute — 0.00006ms against 0.01ms, "two orders of magnitude of headroom, which no hardware
 * spread closes" — and it flaked anyway: **2 failures in 22 whole-suite runs**, one of them
 * `refused descend: 0.01539ms (limit 0.01ms)`, a 250x distortion, while 12 runs of this file alone
 * never moved it off 0.00006ms. A ~60ns operation batched into 0.035ms was so much shorter than the
 * millisecond-scale steals around it that one steal landed as a 500x per-call error. The fix was
 * two-thirds about the *batch* — a refusal is now batched to the same ~2ms of wall time as
 * everything else — and one-third about the threshold. 0.1x is an order of magnitude of margin and
 * still says what the assertion is for: §2's "refused actions run no phases and cost nothing" is
 * operationally *a refusal costs less than a tenth of a turn*, which one phase's worth of stray work
 * (~0.2x) already breaks.
 */
const DESCENT_RATIO_LIMIT = 1.6;
const LIT_TURN_RATIO_LIMIT = 5;
const REFUSAL_RATIO_LIMIT = 0.1;

/**
 * Below this, a reading is not a fast subject — it is a broken measurement, or the subject has
 * stopped doing the thing it is being compared against. The descent and the turn each compare a
 * thing to something it *contains*, so the honest floor is arithmetically 1.0.
 *
 * It is set at 0.8 rather than 1.0 because a descent's own garbage is collected during whichever
 * batch follows it, which is the yardstick's on half the rounds — so a pair can read a little under
 * 1 without anything being wrong. `FLOOR_BATCH` is sized to keep that small; the lowest of 44
 * whole-suite runs is **0.909x**, and it was 0.845x before that batch was widened. 0.8 sits between
 * those and every reading this guard exists to catch: the 0.69x CI mismeasurement that started all
 * this, 0.350x from a yardstick planted three times too slow, and 0.00033x from a subject the
 * optimizer deleted.
 */
const CONTAINMENT_FLOOR = 0.8;

/**
 * The refusal's floor, and it guards a different failure than the other two.
 *
 * A refusal is a *subset* of a `wait`, so containment gives it an upper bound, not a lower one — and
 * the upper bound is already the budget assertion. What can go wrong underneath instead is that the
 * call stops being executed at all: `step(state, descend)` on a refused state returns its argument
 * and the result is discarded, which is the shape V8 is happiest to inline away. A benchmark that
 * passes because the optimizer deleted its subject is this repo's recurring bug in a new costume, so
 * a reading that low is reported rather than celebrated.
 *
 * 0.0015x sits ~4.2x below the honest 0.0064x and ~4.7x above an empty loop, which measures 0.00031x
 * (3ns a call against a refusal's 60ns) when the subject is replaced by one. It cannot be tripped by
 * a busy machine: scheduler noise only ever *adds* time, never removes it, which is what makes a
 * lower bound the one kind of threshold a loaded runner cannot break.
 */
const REFUSAL_FLOOR = 0.0015;

/** Rounds of interleaved batches per reading. Odd, so the median is a measured value. */
const ROUNDS = 31;
/**
 * Full batches of both, discarded, so the JIT has tiered up and **the heap has settled**.
 *
 * Eight rather than the three it started with, and the second half of that sentence is why. The
 * descent's fixture is `atTheStairs`, a scripted seven-floor dive, so the comparison begins on a
 * heap full of that dive's garbage; the first reading was landing 2-4 undisturbed pairs out of 31
 * and being thrown away by `compare` as degraded on 21 of 30 whole-suite runs. That is a warmup
 * problem wearing a noise problem's clothes — the retry was working, it was just paying ~300ms to
 * do what warmup should have. Eight rounds took it to 3 retries in 30.
 */
const WARMUP_ROUNDS = 8;
/** A physically impossible reading is remeasured at most this many times before it is reported. */
const MAX_ATTEMPTS = 3;

/**
 * Batch sizes, chosen so that the two sides of a comparison are the same few milliseconds of work.
 * Equal wall time per batch matters as much as the interleaving does: a 200ms scheduler steal is a
 * far bigger fraction of a 1ms batch than of a 5ms one, so batches of unequal duration reintroduce
 * exactly the bias the interleaving removes.
 */
const FLOOR_BATCH = 12; // ~0.42ms each         -> ~5ms a batch
const TURN_BATCH = 240; // ~0.0088ms each      -> ~2.1ms a batch
const FIELD_BATCH = 850; // ~0.0025ms each     -> ~2.1ms a batch
const REFUSAL_BATCH = 35_000; // ~0.00006ms each -> ~2.1ms a batch
//
// The descent pair is deliberately the long one. At the ~2ms the others use, a batch was 5 calls of
// the most allocation-heavy operation in the game, and a minor GC landing in one member of a pair
// but not the other is then a large fraction of it. Because the subject allocates more than the
// yardstick and the collection lands in whichever batch runs *next*, that asymmetry was one-sided:
// it pushed descent readings as low as **0.845x**, under a ratio that arithmetic says cannot go
// below 1, and left the containment floor only 1.06x away. Twelve calls a batch amortises the
// collections evenly across both members and the readings moved to 0.909-1.20x. Pair tightness is
// still what matters against *scheduler* noise, which moves on a far longer timescale than 5ms.

/**
 * No single batch may run longer than this, checked every `CEILING_STRIDE` calls.
 *
 * This is what keeps a benchmark **failing by assertion rather than by timeout**. A refusal that
 * secretly generated a floor costs ~5000x its honest price, and 75,000 of those is half a minute —
 * a mutant killed by the runner's clock, which `run-script.ts` rightly calls a survivor wearing a
 * red X. Truncating the batch reports the per-call cost of what actually ran, which is the same
 * number, just measured over fewer calls.
 *
 * It cannot distort an honest reading. Every batch here is ~2ms of work, ~7ms on the slowest runner
 * seen, so truncation needs a batch to have already overrun by 3x — and a batch that far above its
 * own minimum is one `compareOnce` was going to drop as disturbed anyway. Truncating reports the
 * cost of the calls that did run, which is the same per-call figure over a shorter sample.
 */
const BATCH_CEILING_MS = 20;
/** How often a long batch looks at the clock. Only batches far larger than this can truncate. */
const CEILING_STRIDE = 32;

type Subject = {
  readonly label: string;
  /** How many calls make one timed batch. */
  readonly batch: number;
  readonly run: () => unknown;
};

/**
 * One comparison, reduced to the numbers an assertion or a reader wants.
 *
 * `ratio` is the median of the **per-round** ratios, not a ratio of two aggregates. See `compareOnce`
 * for why that distinction is the difference between an assertable number and a lottery ticket.
 */
type Reading = {
  readonly ratio: number;
  /** Widest kept per-round ratio over narrowest. How much the box moved under the pairs it kept. */
  readonly spread: number;
  /** How many of `ROUNDS` pairs were undisturbed enough to count. A quiet box gives most of them. */
  readonly quiet: number;
  /** Cheapest per-call cost seen for each side, for the log. ARCHITECTURE's budget is in ms. */
  readonly subject: number;
  readonly yardstick: number;
};

/** Mean per-call cost of one batch, in ms. Truncated at `BATCH_CEILING_MS` — see there for why. */
function batchCost(subject: Subject): number {
  const started = performance.now();
  let done = 0;
  let elapsed = 0;
  while (done < subject.batch) {
    const until = Math.min(done + CEILING_STRIDE, subject.batch);
    for (; done < until; done += 1) subject.run();
    elapsed = performance.now() - started;
    if (elapsed > BATCH_CEILING_MS) break;
  }
  return elapsed / done;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * How far above its own cheapest batch a batch may be and still count as an undisturbed sample.
 *
 * Interference is one-sided — a scheduler steal, a GC pause, a cache evicted by a neighbouring
 * worker can only ever *add* time — so a batch that lands close to the cheapest one seen for that
 * subject is one that got a clean run at the machine. Why that is a legitimate filter and not a way
 * of choosing the answer is argued at `compareOnce`, and it is **not** the obvious argument.
 */
const UNDISTURBED = 1.25;
/** Below this many surviving pairs the filter is abandoned rather than trusted. See `compareOnce`. */
const ENOUGH_CLEAN_PAIRS = 5;

/**
 * Time `subject` against `yardstick` in **pairs**, drop the disturbed pairs, take the median of what
 * is left.
 *
 * ## Why pairs
 *
 * Interleaving was the first fix and it was not enough. Alternating batches puts the two sides in
 * *different* time windows, and on a box running the other 43 test files at once the interference in
 * two different windows is not the same interference. What fails to cancel lands in the ratio, and it
 * does not land symmetrically: the subject of each pair here has the larger working set, so it is
 * hurt more when a neighbouring worker evicts the cache. Measured over 30 whole-suite runs that bias
 * pushed `wait (lit)` from the 3.43-3.61x it reads in isolation up to **5.59x**, through a 5x limit,
 * with nothing wrong with the code. So a round now produces a *ratio*, from two batches a couple of
 * milliseconds apart, and the reading is a median over rounds. A steal inside a round spoils that
 * round and nothing else.
 *
 * ## Why the pairs are then filtered
 *
 * Pairing alone still left `wait (lit)` ranging 3.49-4.38x over 30 whole-suite runs, because a
 * disturbance rarely lands neatly inside one batch. Dropping the pairs where *either* batch is more
 * than `UNDISTURBED` above the cheapest of its own series keeps only the rounds where both sides got
 * the machine to themselves, which is the closest this environment comes to the answer a quiet
 * machine gives.
 *
 * The alternative that does not work, recorded so it is not tried again: taking the minimum of each
 * *series* and dividing. It reads better than a median of series (30 clean whole-suite runs against
 * 26) and is still wrong, because the two minima come from different rounds — the cleanest window
 * the yardstick got is not the one the subject got. That produced 0.818x and 0.892x on a descent,
 * which *contains* its yardstick and cannot honestly be cheaper. A pair cannot do that to itself.
 *
 * ## Why the filter cannot hide a regression
 *
 * The tempting argument is that the predicates never look at the ratio, so they cannot prefer a
 * round for agreeing with a threshold. **That argument is wrong and should not be restored.** The
 * kept set satisfies `s_r <= 1.25 * min(s)` and `y_r <= 1.25 * min(y)`, so every kept ratio lies in
 * `[0.8 * R0, 1.25 * R0]` where `R0 = min(s) / min(y)` — a +-25% truncation centred on the
 * minimum-of-series estimator this very docstring rejects two paragraphs above. Not looking at the
 * ratio plainly does not mean not constraining it.
 *
 * What does hold is **scale invariance**. Each predicate is homogeneous of degree 1 in its own
 * series: multiply every `s_r` by a constant `k` and `min(s)` scales by `k` too, so each comparison
 * is unchanged and the kept set is *identical*. Every kept ratio is then exactly `k` times what it
 * was, so the median of them is too. A regression that makes the subject `k` times more expensive is
 * precisely that multiplication, and the reported ratio moves by exactly `k` — whatever the filter
 * does to the shape of the distribution, it cannot damp a regression by even a percent.
 *
 * **The precondition, which matters to whoever adds a fourth subject.** That proof needs the
 * regression to be *unconditional* — the same factor on every batch. It is, for these three, because
 * each subject is N identical calls of a pure function on a frozen `(state, command)`: per-call cost
 * cannot vary from batch to batch, so a regression cannot be intermittent at batch granularity.
 * Nothing in `game/` can express one either, since the determinism contract bars module-level
 * mutable state, so call #1 and call #2000 do the same work by construction. A subject that stepped
 * a *sequence* of commands would break that precondition: per-call cost would genuinely vary, a
 * regression could bite on only some commands, and it could then correlate with which batches look
 * disturbed. This proof would not cover it, and the filter would need re-arguing rather than reusing.
 *
 * ## When the filter gives up
 *
 * If fewer than `ENOUGH_CLEAN_PAIRS` survive, the machine never went quiet and the filter is
 * abandoned rather than trusted to a handful of samples of nothing. The reading falls back to the
 * median of *every* pair — which is exactly estimator #3 above, with its measured range: 0.889-1.26x
 * on a descent and 3.49-4.38x on a lit turn over 30 whole-suite runs. Every threshold in this file
 * still holds under it, but the lit turn's margin degrades from 1.26x to 1.14x, and that is the cost
 * a reader is being asked to accept. `compare` remeasures first and says so out loud if it persists;
 * see there.
 *
 * The order within a round alternates, so neither side is permanently the one inheriting the other's
 * garbage.
 */
function compareOnce(subject: Subject, yardstick: Subject): Reading {
  for (let i = 0; i < WARMUP_ROUNDS; i += 1) {
    batchCost(subject);
    batchCost(yardstick);
  }

  const subjects: number[] = [];
  const yardsticks: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    if (round % 2 === 0) {
      subjects.push(batchCost(subject));
      yardsticks.push(batchCost(yardstick));
    } else {
      const reference = batchCost(yardstick);
      subjects.push(batchCost(subject));
      yardsticks.push(reference);
    }
  }

  const quietSubject = Math.min(...subjects) * UNDISTURBED;
  const quietYardstick = Math.min(...yardsticks) * UNDISTURBED;
  const clean: number[] = [];
  const all: number[] = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    all.push(subjects[round] / yardsticks[round]);
    if (subjects[round] <= quietSubject && yardsticks[round] <= quietYardstick) {
      clean.push(subjects[round] / yardsticks[round]);
    }
  }

  const kept = clean.length >= ENOUGH_CLEAN_PAIRS ? clean : all;
  const sorted = [...kept].sort((a, b) => a - b);
  return {
    ratio: median(kept),
    spread: sorted[sorted.length - 1] / sorted[0],
    quiet: clean.length,
    subject: Math.min(...subjects),
    yardstick: Math.min(...yardsticks),
  };
}

/** Milliseconds, at a precision that suits the magnitude — these span four orders of magnitude. */
function ms(cost: number): string {
  return `${cost.toFixed(cost < 0.001 ? 6 : 4)}ms`;
}

function describeReading(subject: Subject, yardstick: Subject, reading: Reading): string {
  return (
    `${subject.label}: ${ms(reading.subject)} = ${reading.ratio.toPrecision(3)}x ` +
    `${yardstick.label} (${ms(reading.yardstick)}) ` +
    `[${reading.quiet}/${ROUNDS} quiet pairs, spanning ${reading.spread.toFixed(2)}x]`
  );
}

/**
 * **The floor a ratio cannot honestly fall below**, and why it cannot.
 *
 * Every comparison in this file has one, and it is always an arithmetic fact about the two subjects
 * rather than a performance expectation — which is what makes remeasuring on a violation safe (see
 * `untrustworthy`). What it stops is a reading that has already been destroyed by the machine from
 * sailing under a threshold it was never measuring.
 */
type Floor = {
  readonly at: number;
  /** Why the ratio cannot be lower. Completes "<subject> ...". */
  readonly because: string;
  /** The other explanation for a violation, if the instrument is fine. Completes "or ...". */
  readonly orElse: string;
};

/** Did the machine ever go quiet enough for the filter at `compareOnce` to run? */
function fellBack(reading: Reading): boolean {
  return reading.quiet < ENOUGH_CLEAN_PAIRS;
}

/**
 * Why a reading should not be trusted, or `null` if it should be.
 *
 * Two ways, and both are properties of the *instrument* rather than of the number it produced:
 *
 *   - **impossible** — the ratio is under an arithmetic floor, so the reading has been destroyed;
 *   - **degraded** — too few pairs were undisturbed, so the reading is estimator #3 rather than the
 *     one this file's thresholds were calibrated against.
 *
 * Both are safe to remeasure on, and for the same reason: neither test can be passed or failed *by
 * a regression*. The floor is only reachable from below and a regression pushes every ratio here up;
 * the quiet count is scale-invariant, by the argument at `compareOnce`, so multiplying the subject's
 * cost by `k` leaves it identical. So this is not "retry until green" in either arm — no amount of
 * remeasuring can make a real regression look smaller, and the retry can only ever fail closed.
 */
function untrustworthy(reading: Reading, floor: Floor): string | null {
  if (reading.ratio < floor.at) return 'an impossible';
  if (fellBack(reading)) return 'a degraded';
  return null;
}

/**
 * A reading, remeasured while the instrument is visibly unwell, and loud about it if it stays that
 * way.
 *
 * A degraded reading that persists is **not** turned into a failure. Under load the fallback fired
 * on 2 of 18 readings and both were still comfortably inside their limits; going red because a
 * neighbouring worker was busy is the worse trade, and this file's whole argument is that a flaky
 * assertion teaches people to re-run CI. But it is not allowed to be *silent* either — a
 * silently-degraded instrument reporting green is the exact failure this file exists to have
 * opinions about — so it warns, names the estimator that actually produced the number, and prints
 * the spread of the pairs it had to fall back on. Kept-set spreads of 69x and 83x have been seen
 * when it fires, which is a median that is not measuring much.
 */
function compare(subject: Subject, yardstick: Subject, floor: Floor): Reading {
  let reading = compareOnce(subject, yardstick);
  for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const wrong = untrustworthy(reading, floor);
    if (wrong === null) break;
    console.log(
      `discarded ${wrong} reading — ${describeReading(subject, yardstick, reading)}; ` +
        `remeasuring (attempt ${attempt} of ${MAX_ATTEMPTS})`,
    );
    reading = compareOnce(subject, yardstick);
  }

  if (fellBack(reading)) {
    console.warn(
      `DEGRADED MEASUREMENT: ${subject.label} settled with only ${reading.quiet} of ${ROUNDS} pairs ` +
        `undisturbed after ${MAX_ATTEMPTS} attempts, so the quiet-pair filter was abandoned and the ` +
        `figure below is a median over all ${ROUNDS} pairs spanning ${reading.spread.toFixed(1)}x. ` +
        `That estimator ranges 0.889-1.26x on a descent and 3.49-4.38x on a lit turn, so the ` +
        `assertion still holds, but the lit turn's margin is 1.14x rather than 1.26x. The box was ` +
        `busy; treat a pass as weaker evidence than usual and do not calibrate anything from it.`,
    );
  }
  return reading;
}

function commandSubject(label: string, state: GameState, command: Command, batch: number): Subject {
  return { label, batch, run: () => step(state, command) };
}

/**
 * The yardstick for a descent: the floor generation it contains, measured in this process with this
 * harness.
 *
 * A real workload rather than a synthetic spin loop, because a spin loop is the one thing V8 will
 * happily optimize into nothing, and because generation is already pinned to an absolute budget in
 * `generate.bench.test.ts` — which is what anchors this ratio to ARCHITECTURE's milliseconds. The
 * same `rng` every call, so it is the same floor every call and the reference does not wobble with
 * whatever a different seed happens to lay out.
 */
function generationYardstick(state: GameState): Subject {
  return {
    label: 'the bare floor generation it contains',
    batch: FLOOR_BATCH,
    run: () => generateFloor(state.rng, LAST_FLOOR),
  };
}

/**
 * The yardstick for a turn: **one lit field**, the exact `computeLitField(grid, playerAt)` call
 * `lanternLight` makes.
 *
 * A generation would have worked as a machine-speed reference, but it is ~50x the size of a turn,
 * and a limit set that far above the signal can only catch an order-of-magnitude regression. A lit
 * field is the same order of magnitude *and* the thing a turn is actually made of — §2's phase 3
 * computes one to perceive with and a second for the light query, phase 4 a third — so the ratio is
 * close to "how many fields does a turn cost", which is a number that barely moves across machines
 * because both halves are the same shadowcast over the same grid.
 *
 * It also buys the turn the same containment guard the descent has: a lit turn computes at least
 * one lit field, so a reading below 1.0 is the instrument failing, not a fast turn.
 */
function litFieldYardstick(state: GameState): Subject {
  const grid = state.world.floor.grid;
  const at = playerOf(state.world).at;
  return { label: 'one lit field', batch: FIELD_BATCH, run: () => computeLitField(grid, at) };
}

/**
 * The yardstick for a refusal: **a resolved `wait`**, on the same state, in the same shape.
 *
 * A refusal is a strict subset of it — `step` validates the command and asks `isRefused`, and a
 * `wait` does both of those and then all six phases — so "a refusal costs a small fraction of a
 * turn" is the same claim as §2's "refused actions run no phases and cost nothing", stated in units
 * the machine can be asked about. It is also the yardstick that makes the *bug* obvious: a refusal
 * that quietly generated a floor first measures ~37 turns.
 */
function resolvedTurnYardstick(state: GameState): Subject {
  return commandSubject('a resolved wait', state, { kind: 'wait' }, TURN_BATCH);
}

/**
 * The instrument's own self-check, asserted separately from the budget and before it, because it
 * fails for a different reason and wants a different answer.
 *
 * A ratio under its floor is not a fast subject; it is arithmetic saying the reading is worthless —
 * and a worthless reading sailing under a budget is how a `0.69x` descent went green on CI once
 * already.
 */
function expectAPossibleReading(
  subject: Subject,
  yardstick: Subject,
  reading: Reading,
  floor: Floor,
): void {
  expect(
    reading.ratio,
    `${subject.label} ${floor.because}, so it cannot measure ${reading.ratio.toPrecision(3)}x ` +
      `${yardstick.label}. Either the measurement is broken — a GC or scheduler pause landing in ` +
      `the yardstick's batches, which ${MAX_ATTEMPTS} attempts already tried to shake off — or ` +
      `${floor.orElse}. Do not "fix" this by lowering the floor: a ratio under it means the number ` +
      `the budget assertion reads is not measuring anything`,
  ).toBeGreaterThanOrEqual(floor.at);
}

const A_DESCENT_CONTAINS_A_GENERATION: Floor = {
  at: CONTAINMENT_FLOOR,
  because: 'generates this exact floor and then runs all six phases on the result',
  orElse: "'descend' has stopped generating a floor, which would be a rules bug wearing a benchmark's clothes",
};

const A_LIT_TURN_CONTAINS_A_FIELD: Floor = {
  at: CONTAINMENT_FLOOR,
  because: 'computes at least one lit field, in phase 3',
  orElse: "phase 3 has stopped casting, which would be a rules bug wearing a benchmark's clothes",
};

const A_REFUSAL_IS_STILL_EXECUTED: Floor = {
  at: REFUSAL_FLOOR,
  because: 'still validates the command and asks isRefused, which is real work',
  orElse: 'the optimizer has deleted the call, in which case the budget assertion below is timing an empty loop',
};

describe('step() against the 2ms turn budget', () => {
  it('resolves a descent for little more than the floor generation it contains', () => {
    // The deepest floor a run reaches minus one, so the floor being *generated* is the most
    // populated one §8 produces.
    const state = atTheStairs('step-bench', LAST_FLOOR - 1, lightTheWayDown);
    expect(floorNumberOf(state)).toBe(LAST_FLOOR - 1);

    const descend = commandSubject('descend', state, { kind: 'descend' }, FLOOR_BATCH);
    // `LAST_FLOOR` because that is the floor descending from `LAST_FLOOR - 1` generates: the
    // yardstick is not merely a similar amount of work, it is the identical call `step` makes.
    const generation = generationYardstick(state);

    const reading = compare(descend, generation, A_DESCENT_CONTAINS_A_GENERATION);
    console.log(`${describeReading(descend, generation, reading)}, limit ${DESCENT_RATIO_LIMIT}x`);

    expectAPossibleReading(descend, generation, reading, A_DESCENT_CONTAINS_A_GENERATION);
    expect(reading.ratio).toBeLessThan(DESCENT_RATIO_LIMIT);
  });

  it('resolves an ordinary lit turn for a small multiple of the lit field it computes', () => {
    // Floor 1, shutter open (§4: a run starts open), so phase 3 really does cast — a shuttered
    // turn returns `DARK` without computing a field, and would benchmark the wrong turn and make
    // the containment check below a lie.
    const state = createInitialState('step-bench');
    expect(state.lantern.vision.shutter).toBe('open');

    const wait = commandSubject('wait (lit)', state, { kind: 'wait' }, TURN_BATCH);
    const field = litFieldYardstick(state);

    const reading = compare(wait, field, A_LIT_TURN_CONTAINS_A_FIELD);
    console.log(`${describeReading(wait, field, reading)}, limit ${LIT_TURN_RATIO_LIMIT}x`);

    expectAPossibleReading(wait, field, reading, A_LIT_TURN_CONTAINS_A_FIELD);
    expect(reading.ratio).toBeLessThan(LIT_TURN_RATIO_LIMIT);
  });

  it('refuses a command for almost nothing, and in particular without generating a floor', () => {
    // §2 leans on refusals being cheap: the input layer refuses first and `step` is the backstop, so
    // a refused tap is on the interaction path. It is also the place a stray `generateFloor` would
    // hide — a descent refused *after* generating would be ~0.3ms and a replay-breaking draw.
    const state = createInitialState('step-bench');
    const refused = step(state, { kind: 'descend' });
    expect(refused).toBe(state);

    // Against a resolved turn on the same state rather than against a millisecond figure. This was
    // the last absolute threshold in the file and it was the one that flaked — not because 0.01ms
    // was the wrong number, but because 0.00006ms measured in a 0.035ms batch is not a measurement
    // when 43 other test files are on the box. Both sides are now ~4.5ms of interleaved work.
    const refusal = commandSubject('refused descend', state, { kind: 'descend' }, REFUSAL_BATCH);
    const turn = resolvedTurnYardstick(state);

    const reading = compare(refusal, turn, A_REFUSAL_IS_STILL_EXECUTED);
    console.log(`${describeReading(refusal, turn, reading)}, limit ${REFUSAL_RATIO_LIMIT}x`);

    expectAPossibleReading(refusal, turn, reading, A_REFUSAL_IS_STILL_EXECUTED);
    expect(reading.ratio).toBeLessThan(REFUSAL_RATIO_LIMIT);
  });
});
