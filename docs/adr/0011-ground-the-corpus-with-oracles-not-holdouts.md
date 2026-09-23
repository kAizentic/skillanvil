# 0011 — Ground the corpus with oracles, not holdouts

- Status: **superseded by [0012](./0012-shadow-ablation-and-the-sealed-audit.md)** (same day)
- Date: 2026-08-15

> **Superseded, and kept deliberately.** A research pass against external literature falsified four of
> the decisions below — most importantly the "structural gift" (that taste pages need no oracle) and
> the rejection of the control arm. This ADR is retained unedited because the reversal is the record:
> it was derived by consulting only the corpus it was designed to audit, which is the failure mode it
> exists to prevent. Read this one for why the decisions changed — but note (added 2026-09-21) that
> **none of the chain's decisions are in force**: 0012–0017 were priced out on 2026-08-15 and the
> apparatus was never built. See the deferral note in
> **[0012](./0012-shadow-ablation-and-the-sealed-audit.md)**.

> **`decay_class` shipped as `verifiability:` — noted 2026-08-20.** Decision 3's key was never written
> under that name, which made this ADR read for five days as an open, unbuilt gate. It is not. The same
> job — *which oracle can settle this page's claims, and which must refuse* — shipped in
> *vault page schema* as **`verifiability:`** on 2026-08-15, graduated to **HARD** on
> 2026-08-19 (`verifiability_missing`), and now carries a value on effectively every `concepts/` page
> (101 across 102; 116 vault-wide) with the two consumers this ADR required: challenger-pass routing,
> and `wiki-lint`'s `external_provenance_untraceable`. **Do not add `decay_class` as a second key** —
> that is a duplicate over a HARD-enforced contract (*keyed extractor widening is a migration*).
> The shipped taxonomy differs deliberately and is richer: `re-executable` · `contestable` · `external` ·
> `none`, typed **per claim, not per page**, with the failure mode of mis-routing documented per value —
> including the one this ADR missed, that `none` makes *absence of confirmation read as disconfirmation*.
> Only the **decay** half of the name remains unbuilt: there is no TTL, no `last_verified` on any live
> page, and nothing schedules the oracle pass. Its value-of-information has never been priced — the
> 2026-08-15 kill in *price the measurement before building it* priced the *demand/demotion*
> instrument, whose error is reversible, not this one.

## Context

The vault is a compounding corpus that **governs the behaviour which would generate its own
counter-evidence**. A rule nobody acts against looks permanently validated. Every mechanism in the
system increases *exploitation* (capture, distill, lint, promote, codify, gate); nothing budgets
*exploration*. The formal name is **self-confirming equilibrium** (Battigalli 1987; Fudenberg &
Levine 1993), whose load-bearing consequence is that *the option value of experimentation vanishes
in the limit* — exploration decays on its own, which is the formal reason this harness has never
executed a rule retirement in the absorption sense (*rolling evidence decays toward deletion*).

Six failure modes were enumerated in a 2026-08-15 handoff. Mode 4 (self-confirmation) was named the
target; modes 1 and 5 were addressed by a context-trim pass the same day. Underneath all six: **the
system has no type distinction between a finding and a rule.** A page recording *"here is what
happened"* and a bullet saying *"always do X"* are the same object, retrieved the same way, carrying
the same authority.

The obvious instrument — a **holdout**: suppress a rule or page, see whether the work degrades — was
designed across a five-branch grill and **did not survive it**. Four measurements killed it:

1. **Rule-level holdouts have no candidates.** Applying `rolling-evidence-decays-toward-deletion` §2's
   three disqualifiers to the 14 machine-measurable standing rules leaves nothing: the `class` filter
   (only `discipline` makes "the model outgrew it" coherent) admits 4; blast radius drops
   `deploy-target`; `bg-register` (12 friction) and `task-complete` (1) are currently FAILING, so they
   need an instrument not a holdout; `narrow-width` is already superseded by a hook, so holding out its
   prose would measure the hook — the `file-url` duplicate trap. **Zero eligible.**
2. **There is no seam to suppress a page behind.** `knowledge/index.md` reaches context via CLAUDE.md's
   `@`-import, which is resolved at context assembly — **no tool call, therefore no hook**. Measured
   over 9 days: `index.md` was *Read* 4 times (12 of its 17 touches are Edits) while concept pages were
   Read **192** times; on 08-13 and 08-14 there were **zero** index reads against 10 and 19 concept
   reads. The router is neither interceptable nor the discovery path.
3. **A correction-based outcome measure is underpowered by ~2 orders of magnitude.** The
   trace-divergence miner holds 36 correction moments: **32 in July, 4 in August, 0 found this run** —
   ≈**0.16 corrections per attended session** across 224 attended transcripts. 59% of sessions (325 of
   549) are headless and can produce zero corrections by construction. The handoff's own prior art
   killed ANAMNESIS on 13 positive events; this would be worse.
4. **Blinding was solving the wrong problem.** It was required only because the graders were the operator
   and the model. An oracle cannot be biased by knowing, so replacing the grader dissolves the need for
   blinding *and* for suppression.

The reframe that resolves it: **self-confirmation only bites where an external truth-maker exists and
can move.** For a page about taste, voice, commercial intent, or a boundary the operator set, his
preference *is* the truth and "the corpus shapes behaviour that would disconfirm it" is simply having
preferences. For a page about PowerShell's BOM behaviour, a competitor's pricing, or a model's API,
the world moves underneath the claim. **The dangerous set and the automatable set are therefore the
same set** — which is what makes a near-zero-human-judgment design possible rather than aspirational.

## Decision

1. **No holdout, no suppression, no blinding.** The corpus is grounded by **oracles**, not by
   controlled absence. Both the rule-level and corpus-level holdout designs are rejected (see
   Considered options).

2. **Two instruments, with different jobs, different authority, and different lifespans.**

   | | **Demand** | **Oracle re-verification** |
   |---|---|---|
   | Answers | which pages earn their retrieval | which claims have gone false |
   | Failure mode served | 2 (monotonic accumulation) | 4 (self-confirmation), 3 (staleness) |
   | Method | observational: `activity.jsonl` × `applies_when` | execution / web oracle, gated by `decay_class` |
   | Human input | none | none, except the named residue |
   | Retirement | **none — permanent standing hygiene** | **cost inversion** |

3. **`decay_class` gates the oracle pass**, with three values and a fail-closed default:
   - `re-executable` — the claim is settled by running something. Oracle: execution.
   - `external` — the claim is about a world that moves. Oracle: web re-verification
     (inward-pointed `intel-scan`, i.e. *ai os vs traditional os* optimization **row 3**,
     still the one unbuilt row in that table).
   - `none` — no oracle exists. The pass **refuses** and logs the refusal. This is the *named residue*,
     and it must stay enumerated rather than silently skipped.

   **Ambiguity resolves toward `checked`, never toward `exempt`.** Whoever assigns `decay_class`
   controls the audit's own scope; a model that could classify pages as oracle-less could quietly
   exempt the corpus from its own check — mode 4 re-entering through the back door. Classification is
   **proposed eagerly by a deterministic script** for all pages and **ratified lazily by a human on
   first citation** (the same trigger as the `applies_when` backfill, so it is one pass, not two).
   An unratified page is still audited; it is merely audited more often than necessary, which is cheap.

4. **Authority: auto-demote, human-gated delete.** The instruments may set `status: contested` /
   `deprecated` and drop a page from the router **automatically**. **Archival and deletion require a
   human.** This is ADR 0009 applied one layer out — *a machine check can contradict a verified claim,
   never confer one*; demotion is contradiction, deletion is a different act that 0009 does not
   license. It is also the direct answer to `rolling-evidence-decays-toward-deletion`'s warning that
   *"an audit biased toward deletion is worse than no audit: it launders forgetting as progress."*

5. **`applies_when` is promoted from hygiene to prerequisite.** It is the page's own pre-registered
   claim about when it should matter, and without it the demand instrument cannot separate *"this page
   did not earn its place"* from *"the situation never arose"* — the DORMANT row, `books-hands-off` at
   activity 0, and *empty set passes every check*. Currently **14 of 89** concept pages
   carry it. Backfill **on first citation only**; an uncited page needs demotion, not a predicate.

6. **The demand instrument is declared permanent, in writing.** Same category as `wiki-lint`: standing
   hygiene a growing corpus always needs. The failure mode is not having permanent infrastructure — it
   is having permanent infrastructure that was never *admitted* to be permanent and therefore drifts
   into being un-retirable by default. This clause is the admission.

7. **The oracle pass retires on cost inversion** — when human review time exceeds the retrieval
   attention it saves. Deliberately *not* "retire on absorption" (N clean runs), because
   `rolling-evidence` demonstrates that exact signal decays toward "clean" for measurement reasons
   rather than behavioural ones. Cost inversion is immune to that decay. It is also **review-scoped,
   not nightly**, per ADR 0009 §4 — a nightly evidence check becomes wallpaper.

## Considered options

- **Rule-level removal test** (delete a standing rule, watch for the problem's return). Rejected:
  zero eligible candidates, measured 2026-08-11 and re-derived here. Class, blast radius, and probe
  coverage each independently empty the queue.
- **Rule-level holdout** (suppress a rule for one attended session; reversible, so cheaper than
  removal). Rejected: same zero candidate set. Reversibility relaxes the *blast* disqualifier but not
  `class`, and the surviving `discipline` rules are either currently failing or already instrumented.
- **Corpus-level blinded holdout** (suppress a page from retrieval, measure seeking). Rejected on the
  seam (decision context §2) and on power (§3). It was the leading design for three branches of the
  grill; the `@`-import measurement killed it.
- **Observational comparison without a control arm** (correction rates in sessions where a page was
  read vs not). Rejected as the *primary* mechanism: *observational vs causal promotion*
  caps this at Tier 2 (`corpus-supported`) and forbids the observing stage from self-promoting to
  Tier 3. Retained only as the demand instrument, where the question is descriptive (*is this page
  wanted*) rather than causal, and Tier 2 is the honest and sufficient answer.
- **Similarity-based staleness detection.** Rejected before build on external evidence: cosine
  similarity cannot separate a contradiction from a duplicate — contradictions are *more*
  embedding-similar to the original than genuine rephrasings are (MemStrata, arXiv 2606.26511; AUROC
  0.59, max precision 0.67). This vault hit the same wall empirically twice.
- **Staleness forecasting** (predict which pages will go stale). Rejected before build: measured as a
  null — forward AUROC 0.665 vs logistic regression 0.6647 on 13 positive events, with 76.8% of the
  apparent gain coming from an annotation that is constant in production (ANAMNESIS, 2026-08-03).
- **Draft-anchored auditing** (check the draft against the corpus). Rejected in favour of
  state-anchored: StateAuditor (arXiv 2608.01619) scores **.38 recall** on *implicit* stale premises
  because the stale dependency is usually unsaid. **Audit state → draft, not draft → state.**
- **Full-auto including archive**, with the append-only ledger as undo. Rejected: deletion is the
  expensive-to-undo direction and this system has documented evidence of an audit drifting toward it
  for non-behavioural reasons.
- **Retire the demand instrument on absorption** (N consecutive clean runs). Rejected per decision 7.

## Consequences

- **The surprising bit a future reader will hit:** they will find a fully-specified holdout design in
  the 2026-08-15 handoff, note that this ADR builds none of it, and reach for the obvious cleanup —
  *"just add the control arm, it's the rigorous version."* **Do not**, without first re-measuring the
  two things that killed it: whether `index.md` (or whatever replaces it) is reachable by a hook, and
  whether the correction rate has risen far enough to power the arm. Both are cheap to re-check and
  both were decisive.
- **Mode 4 is mitigated, not eliminated, and only on the subset that has an oracle.** The `none` class
  keeps its self-confirmation property permanently. That is accepted because on that subset the bias
  is not harmful — but the claim depends entirely on `decay_class` being assigned honestly, which is
  why decision 3's fail-closed default is load-bearing rather than defensive.
- **The residue must stay visible.** A `none`-class page is exempt from verification; if the exempt
  list is not enumerated in the pass's own output, the system reports "all checked" while a growing
  fraction is unchecked. Measured on a crude structural classifier, the residue is **3–13 of 88
  pages (~4–15%)** — small enough to be tractable, large enough to hide in.
- **Per the ratified `mechanize-gates-over-prose` binding conditions**, both instruments ship with a
  silent-branch fixture and a non-empty assertion. The demand instrument's non-empty assertion is not
  theoretical: `activity.jsonl` is hook-dependent and 9 days old, so an empty read is entirely
  plausible and **must not** render as "0 dead pages".

  | State | Expected |
  |---|---|
  | `activity.jsonl` missing or unwritten since last run | `no_activity_evidence` (**not** "0 dead pages") |
  | Page has no `applies_when` | `unscoped` — excluded from demotion, counted in the report |
  | Page idle **and** `applies_when` predicate fired in window | `demotion_candidate` ← the only discriminating row |
  | Page idle, predicate never fired | **silent** (dormant ≠ dead) |
  | `decay_class: none` | `refused_no_oracle`, enumerated in the residue list |
  | Oracle contradicts a page claiming `last_verified` | `verified_but_contradicted` |

- **A known blind spot, recorded rather than solved:** the activity log records *reads*, not
  *citations*. A page being opened is not the same as a page being load-bearing for the output. That
  gap is what `citation-nudge.mjs` and `citation-ledger.mjs` were built to close, and it remains open
  — the hook is wired to `Stop` + `UserPromptSubmit` in the vault's project-scoped settings and has
  **never produced a pending file**. Demand is therefore a proxy, and the two states it collapses are
  *"consulted and used"* and *"consulted and discarded"*. Named here so it is not rediscovered as a
  surprise.

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, 5 branches) against the 2026-08-15 six-failure-modes
handoff, *rolling evidence decays toward deletion*, *observational vs causal promotion*,
*codification ladder*, *system trajectory* (mechanize-gates + its three binding
conditions), ADR 0009, and marketing-ops-pipeline ADR-0005. The design that started the grill — a blinded
corpus holdout — was rejected by it at branch 4; what survived is its inverse. Measurements taken this
session: 549 transcripts (325 headless / 224 attended); `activity.jsonl` 2554 records over 9 days; 66 of 89
concept pages touched, 23 idle, 32 touched once; concept retrieval 192 `Read` vs 8 MCP; `index.md` 4 reads
vs 192 concept reads. Terms added to `agent-os/CONTEXT.md` in the same pass. Numbering: 0007 remains
reserved for the vault-installer verifier-of-record decision._
