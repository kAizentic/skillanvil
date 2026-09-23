# 0009 — A machine check can contradict `verified`, never confer it

- Status: accepted
- Date: 2026-07-16

## Context
`design-system-lint.mjs` decides a parts-bin component's `unverified` status with a regex against a
**hand-typed** marker:

```js
if (!isAtom && !/\d{4}-\d{2}-\d{2}/.test(row.marker.verified || ""))
  report.unverified.push(name + …)
```

It cannot distinguish *"nobody ever drove this component"* from *"somebody typed a date"*. ADR 0008
anticipated this shape ("the INDEX gains a machine-readable marker per row … graduates to explicit
columns later if desired") but left the honour system in place.

On 2026-07-16 the parts-bin harness gained a **gallery** (every component rendered live) and, as a
by-product of a diagnosis, `harness/verify.mjs` — a headless run that mounts every registry entry,
scrolls it, and asserts machine-readable facts (`20/20 passed`). For the first time there is real
mechanical evidence about the bin, and the obvious move is to wire it into the lint's `unverified`
check.

**That obvious move is wrong**, and the reason is the point of this ADR.

Two facts foreclosed it before any merits debate — the *constraint collapse fork resolution*
move (*grep your hard constraints; one may already have decided the fork*):

1. **`verified` already has a stricter definition.** `graduate-to-partsbin-sop` Step 5 defines it as a
   four-property human judgment: *renders · scrubs · recolours from the token seam · falls back legibly
   under reduced-motion*. `verify.mjs` covers roughly one and a half of those.
2. **The SOP's own flagship catch is invisible to a machine.** Step 5's cited win is `DiagonalBorderSweep`
   ramping strokes from `--site-paper` — invisible dark-on-dark. That component **mounts, throws nothing,
   and paints**: every machine check passes it. Wiring machine→`verified` would have destroyed the exact
   signal the SOP advertises.

The same session supplied the third input: *fail closed guard silent degradation* (filed
2026-07-16, from a site-harvest session) — *"if this check broke, how would I find out?"* A contradiction
check's healthy state is **silence**, so stale or missing evidence produces output identical to a clean
bin.

## Decision
1. **The machine check contradicts; it never confers.** `verified:<date>` keeps its exact human meaning
   and its exact marker format. A machine PASS never grants it. A machine FAIL against a row that claims
   `verified` is a **regression the honour marker structurally cannot detect** — that contradiction is
   the whole value being added. This is "verified-until-contradicted" (an ADR-0007 ratified branch) and
   the `intent-scout` dual-flag gate (corroboration raises *confidence*; only the human gate resolves
   *provenance*) transferred to the design system.
2. **Evidence is pinned to the artifact it attests to.** Each entry in the generated
   `components/verify-results.json` records a **content hash** of the component `.tsx`. The lint trusts a
   result only when the hash matches the current file. A non-matching result is **not evidence — it is
   absence**. (Not mtime: the vault lives in the cloud-sync folder, which touches mtimes on sync and would launder
   staleness into a legitimate-looking value — tell #1 of the silent-degradation concept.)
3. **Absence is loud, never silent.** Missing evidence → `no_machine_evidence`; hash mismatch →
   `stale_machine_evidence`. Day one, every component reports `no_machine_evidence`; that noise is the
   honest state and is accepted (the current failure is the opposite — a typed date reading as proof).
4. **Evidence checks are review-scoped, not nightly.** ADR 0008 §3 runs `design-system-lint.mjs` nightly
   to produce `reached-from-bin.json` for `wiki-lint`. The nightly does **not** carry the evidence
   categories (they'd become wallpaper — the "cries wolf" erosion ADR 0008 rejected for false orphans).
   `design-system-review`'s deterministic pass runs **verify → then lint `--with-evidence`**, preserving
   ADR 0008's produce-then-consume ordering, scoped to the human-invoked audit.
5. **`verify.mjs` self-hosts.** It spawns its own Vite server rather than requiring a separate
   `npm run dev`. A hidden precondition would otherwise make the check fail for reasons unrelated to the
   components.
6. **The machine layer owns reduced-motion *presence*, not legibility.** Under emulated `reduce`, content
   must be present and unclipped — the dominant fallback bug in this bin is content stranded at
   `opacity: 0` / translated away because a `motion-safe:` variant no-ops. Presence is mechanical;
   legibility stays Step-5 human judgment.
7. **The INDEX format does not change.** The row marker stays the human's *claim*; the JSON is the
   machine's *measurement*; the contradiction check compares them. Nothing writes into `INDEX.md`.

## Considered options
- **Machine replaces the marker** (the original recommendation). Rejected: overloads a term with a
  stricter existing definition — the same term-collision failure `constraint-collapse-fork-resolution`
  records for "review queue" — and would pass the DiagonalBorderSweep bug.
- **Two independent markers, no contradiction logic.** Rejected: records both signals, catches no
  regressions. Strictly weaker for the same plumbing.
- **mtime freshness instead of content hashes.** Rejected: cloud sync touches mtimes (decision 2).
- **Run `verify` nightly** so evidence is always fresh. Rejected: needs headless Chrome + a Vite server in
  the nightly tail, and the harness deliberately installs *outside* the cloud-sync folder — the nightly would depend on
  a scratch path that may not exist. Re-introduces the nightly-noise problem it was meant to solve.
- **Suppress `no_machine_evidence` until first run.** Rejected: that is the silent branch, and silence is
  exactly the failure mode being guarded against.

## Consequences
- **This is the surprising bit a future reader will hit** (the ADR-0008-style landmine sign): they will
  see a green `20/20` machine PASS sitting next to `verified:-` and reach for the obvious cleanup —
  "just let the harness set `verified`". **Do not.** That collapses two different properties, and the
  one it discards (token-seam + reduced-motion *legibility*) is the one Step 5 exists for and the one the
  SOP's flagship catch depends on. If you ever do wire them, you must first give the machine a way to
  judge dark-on-dark.
- The evidence checks are only as current as the last review — a component can regress between reviews
  and nobody hears. Accepted deliberately: the review is where verification *claims* get audited; the
  nightly is where the manifest gets produced.
- The contradiction check's healthy state is silence, so its **silent branch must be pinned by a
  regression fixture** (per `fail-closed-guard-silent-degradation`); a suite that only tests "does it fire
  when it should" would pass forever while the guard rots:

  | State | Expected |
  |---|---|
  | No `verify-results.json` | `no_machine_evidence` (not silent) |
  | Hash mismatch (component edited since run) | `stale_machine_evidence` (not silent) |
  | Fresh PASS + row claims `verified` | **silent** ← the only discriminating row |
  | Fresh FAIL + row claims `verified` | `verified_but_failing` |
  | Fresh PASS + `verified:-` | silent (Step 5 still owed) |

---
_Provenance: grilled 2026-07-16 (`grill-with-docs`, 4 branches) out of a `skill-portfolio-review` finding,
against ADR 0008, `graduate-to-partsbin-sop` Step 5, `site-harvest/CONTEXT.md`, and the same-day concept
*fail closed guard silent degradation*. The finding that started it — "make `unverified` consume
`verify.mjs`" — was rejected by the grill; what survived is its inverse. Terms `verified` / `machine check`
added to `site-harvest/CONTEXT.md` in the same pass (their absence from the glossary is why the wrong fix
looked reasonable). Numbering: 0007 is reserved for the vault-installer verifier-of-record decision._
