# ADR-0002: Web-first, native-compatible

**Status:** Accepted
**Date:** 2026-07-29

## Context

Expo targets iOS, Android, and web from one codebase. Which target is *primary* determines how
agents verify their work, and verification is the bottleneck in an agent-driven project.

Native verification requires a simulator or device, a build step measured in minutes, and — in
practice — a human looking at a screen. Web verification is a static export, a headless browser,
and assertions in CI.

## Decision

Web is the primary development and verification target. All code stays React Native-compatible so
native builds continue to work, and native gets an explicit verification pass in M4.

- Development happens against `expo start --web`.
- CI builds the static web export and runs Playwright against it.
- Agents screenshot and interact with the real running game to verify their own work.
- Native-hostile APIs (raw DOM, `window`, web-only CSS) are banned outside `platform/`.

## Alternatives considered

**Mobile-first.** Truest to "a React Native game," and rejected because it puts a human in every
verification loop. An agent that cannot see the result of its change is guessing, and guessing
compounds. The user chose this option's opposite for that reason.

**Web only, drop native.** Maximum automation. Rejected because native is part of the point, and
because staying RN-compatible costs very little as long as the discipline is maintained from day
one. Retrofitting native compatibility later would be far more expensive than maintaining it.

## Consequences

Agents can close their own feedback loop: change code, build, drive the browser, assert, screenshot,
critique. That is the single most valuable property of this setup.

The risk is native drift — something works on web and silently breaks on iOS. Mitigations: the
ban on web-only APIs, the `platform/` abstraction boundary, and a native verification pass in M4.
It is a real risk and we are accepting it knowingly; the alternative costs more.

Touch is the design target even though development happens with a mouse. E2E tests use a
phone-sized viewport and touch emulation by default so this does not quietly slip.

**Revisit if:** native drift shows up as repeated breakage rather than an occasional fix, or a
native-only capability becomes central to the game.
