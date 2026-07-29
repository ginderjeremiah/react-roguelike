# Game Design Document

The living spec for how the game actually plays. `VISION.md` says what we are aiming at and
changes rarely; this document says how it works right now and changes often.

**Status: skeleton.** Only the parts marked *Settled* are decided. Everything else is filled in by
design work during M0 and refined as we build. Owned by the `game-designer` agent.

> Rule: nothing lands in this document without saying which pillar it serves. If it serves none,
> it does not belong in the game.

---

## 1. Core loop — *Proposed*

Descend a lightless ruin. Each turn you choose to burn lantern fuel to see, or move dark and
gamble. Fuel is the run clock; darkness is both cover and blindness. You die, or you reach the
bottom.

The recurring decision (Pillar 1) is *light or dark*, made every few turns, with real information
on both sides of it.

**Open questions for M0 design review:**

- Is one resource (fuel) enough tension, or does the wager need a second axis?
- What makes moving dark *actively* attractive rather than merely cheap? A pure cost saving is a
  weak incentive — there likely needs to be something you can only do in darkness.
- Does the player ever *want* to wake an enemy? If never, light is strictly defensive and the
  decision flattens.
- How does the player form a mental map of unlit space? Memory of explored tiles, sound cues,
  something else?

## 2. Turn structure — *Skeleton*

Energy-based scheduling: each actor accrues energy per tick and acts when it crosses a threshold.
Chosen over strict round-robin because it gives speed a natural meaning, which we will want.

- Player acts, then all actors with sufficient energy act, then the world ticks (fuel burns,
  statuses decay).
- Enemy intent is telegraphed **before** the player commits (Pillar 2).
- No real-time elements anywhere.

Details settle in M1.

## 3. Combat — *Principles settled, numbers open*

*Settled:*

- **Deterministic resolution.** No to-hit rolls, no damage ranges. If you attack, you know exactly
  what happens. Randomness lives in what the level generates and where things are, never in
  whether your correct decision worked. This is Pillar 2, and it is not negotiable.
- Enemy intent is visible for the coming turn.
- Positioning matters more than stats.

*Open:* damage model, health scale, whether attacking costs a full turn, status effects.

## 4. Light and fuel — *Proposed*

The signature system. Fully specified during M2.

- Lantern is on or off; on burns fuel per turn.
- Lit radius reveals tiles, entities, and intent.
- Unlit: the player sees only remembered terrain and immediately adjacent tiles.
- Some enemies are dormant in darkness and wake to light.
- Fuel is found in the level, making exploration itself a fuel wager.

*Open:* fuel per turn, radius, whether radius is adjustable, whether light can be thrown/placed.

## 5. Level generation — *Open*

One algorithm, one theme in M1. Requirements it must satisfy:

- Small enough for a phone screen without panning as the default experience.
- Legible at a glance — layout readable from glyphs alone.
- Guaranteed connected, guaranteed completable.
- Interesting in darkness, not just when lit.

## 6. Entities — *Open*

Starts with exactly one enemy in M1. Enemies must have a *behavior* worth reading, not just
different numbers. Content tables live in `game/content/`.

## 7. Items and abilities — *Open, M3*

Bias: few items, each changing how you play. No stat-stick loot, no inventory tetris (Pillar 1).

## 8. Difficulty and pacing — *Open*

Target run length 15-30 minutes. Difficulty comes from tightening the fuel economy and denser
enemy placement rather than inflating numbers.

## 9. Controls — *Skeleton*

Touch-first (Pillar 3):

- Tap an adjacent tile to move or attack.
- Tap a distant explored tile to path toward it — **interrupted by anything new becoming visible**
  (auto-travel that walks you into an ambush violates Pillar 1).
- Toggle lantern: a persistent, thumb-reachable control.
- Keyboard on web is a convenience layer, never the primary design target.

## 10. Presentation — *Settled at the technology level*

Glyph grid, color-forward (ADR-0003). Light falloff expressed as cell tint and opacity. The
aesthetic goal is "a beautiful terminal," not "a cheap tileset."

Palette, typography, and animation specified in M4.

## 11. Accessibility — *Requirements settled*

Not deferred to the end as a checklist item; these constrain design from the start.

- Colorblind-safe palette; color never the sole carrier of meaning.
- Text scaling respected.
- Reduced-motion honored.
- One-handed play on a phone.
- No timing-dependent input anywhere (free, given turn-based).

---

## Change log

Design changes get a line here with the reason. Not a substitute for git history — a reason,
recorded at the moment we made it, is the part git cannot give us.

| Date | Change | Why |
| --- | --- | --- |
| 2026-07-29 | Document created as a skeleton | Groundwork; M0 design review fills it in |
