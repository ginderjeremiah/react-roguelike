# ADR-0006: Local-first persistence, no backend

**Status:** Accepted
**Date:** 2026-07-29

## Context

The owner offered to provision infrastructure — he can stand up services on Railway, with the
constraint that nothing require licensed software — and left the decision to us.

The question is whether the game needs a server, and if so, when.

## Decision

No backend. All state persists on-device behind a `platform/` interface:

```ts
interface SaveStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
```

Implemented with `localStorage` on web and `AsyncStorage`/`expo-file-system` on native, faked in
tests.

Persisted data is small by construction: a run is `{ seed, commands[] }` (ADR-0004), so a save is
kilobytes and a full run history is trivial.

## Alternatives considered

**Provision a backend now.** Rejected because nothing needs it. A single-player turn-based
roguelike has no server-side requirement, and adding one now would introduce secrets management,
deployment, availability concerns, and a dependency on the owner — costs paid immediately against
benefits that are entirely hypothetical until the game is good.

**Firebase/Supabase.** Same objection, plus a vendor dependency for a project with no
requirement it addresses. The owner has used neither, and Railway is his comfortable ground —
worth noting for when we do need something.

**Design without a persistence abstraction, add one later.** Marginally simpler now. Rejected
because the interface is a handful of lines and retrofitting it through call sites later is
tedious. This is the rare case where the abstraction genuinely costs almost nothing.

## Consequences

Zero cost, zero secrets, zero owner dependency, and no privacy surface — nothing leaves the
device. Agents are never blocked on provisioning, and the offline story is automatic.

Determinism means the eventual backend, if we build one, is nearly trivial: a leaderboard entry is
a seed plus a command log, verifiable server-side by replaying it. Cheat resistance comes free
from the same property. That is why deferring costs us nothing — the expensive groundwork is
already done.

What we give up: no cross-device sync, no leaderboards, no daily challenges, no telemetry. All
parked in `ROADMAP.md` under "Later," all downstream of the game being worth competing over.

**Revisit when:** the game reaches M4 and is genuinely good, and daily challenges or leaderboards
would meaningfully add to it. At that point: Railway + Postgres + a small API that accepts and
replay-verifies run records. Raise it with the owner then — he has explicitly offered.
