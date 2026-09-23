# Changelog

## 2026-09-23 `52f0633..bf7dbad`

### Fixed
- `compiler/compile-skills.mjs` parses again, and the transcript cleaner's effect-line regex matches `[Music]`-style lines.
- The lint walker skips generated trees, and publish-integrity refuses to pass on a tree it could not observe.

### Added
- Hooks: an overwrite guard for immutable sources, just-in-time rule delivery, and a push-lag nudge, each with tests.
- `secure-push` 2.1 (a push gate tiered by the remote's audience, a history scan, patch notes) and `update-pulse` (deterministic upstream-drift detection).

### Changed
- ADRs 0011–0017 are marked deferred and never built; ADR 0018 records its resolution.
