# 0015 — Error rates, variance reduction, and sequential allocation

- Status: **DEFERRED — NEVER BUILT** (see the note below). Accepted 2026-08-15, priced out the same
  week. Amended while live: decision 2 by
  [0016](./0016-task-replay-ambient-fingerprint-and-the-capped-queue.md).
- Date: 2026-08-15
- Amends: [0014](./0014-shadow-only-promotion-and-the-two-tier-metric.md) decisions 3 and 5.
  Adds a control absent from **0011–0014 entirely**.

> **DEFERRED — NEVER BUILT.** This ADR is one link in the 0011–0017 measurement-apparatus chain,
> which was priced out on 2026-08-15 and never implemented — on two independent grounds: **cost**
> (50–70M tokens plus months, against a decision that is reversible by design, where a zero-cost
> heuristic proposed most of the same set) and **unit of analysis** (page-level ablation is
> formally refuted on a deliberately dense wiki-link graph, where redundant pages mutually mask).
> Status corrected 2026-09-21; it read `accepted` for five weeks while the kill lived only in
> `knowledge/concepts/`. Full deferral note and the re-open condition:
> **[0012](./0012-shadow-ablation-and-the-sealed-audit.md)**. Reasoning:
> *price the measurement before building it* ·
> *attribution fails under redundancy*.

> **0016 caps the review queue by size rather than by threshold.** The asymmetry below stands, but the
> loose side is now bounded by *drain capacity*, not confidence: measured drain rate falls from 61.8%
> to 28.1% as a queue grows, so a threshold-surfaced queue is unbounded by construction and
> self-destructs. Queue health is measured as drain-rate decline against baseline, not depth.

## Context

A research pass against 0014 found one hole and two economies. The hole is the serious item.

### 89 pages are 89 hypotheses, and nothing in four ADRs controlled for that

The instrument tests one hypothesis per page — *does page X influence behaviour?* — across **89
pages**. At α = 0.05, **~4–5 false positives are expected by chance alone**. In this design a positive
means *no influence detected → demote*, and 0012 decision 4 grants **automatic** demotion authority.

**As specified across 0011–0014, the instrument would automatically demote roughly four or five
perfectly good pages purely by chance, with no human in the loop.** That is exactly the hazard
*rolling evidence decays toward deletion* names — *"an audit biased toward deletion is
worse than no audit: it launders forgetting as progress"* — reintroduced through a statistical door
after being carefully excluded through the design door.

The two errors are asymmetric and were being held to one threshold:

| Error | Cost |
|---|---|
| **False demotion** — good page loses its router slot on noise | reversible, but degrades retrieval quietly and invisibly |
| **False retention** — dead weight persists | mode 2; the failure that has actually occurred, 134 times |

### The control arm was mis-costed as pure overhead

**CUPED** (Deng et al., WSDM 2013) reduces variance using pre-experiment data as a covariate, and its
central empirical finding is that **the best covariate is the same metric measured before the
experiment** — which is precisely what 0014's mandatory control arm produces. Measured at Bing across
three experiments: **45%, 52%, 49% variance reduction**, i.e. the same power from **half the samples**.
The 2023 augmentation treatment extends this to ratio and percentile metrics, which matters because
TSS is ratio-like.

So the control arm is not an 8× tax that buys interpretability. It is *simultaneously* the noise floor
and the covariate that halves the treatment arm.

### Fixed allocation was the wrong sampling scheme

Sequential procedures cut experiment duration **by up to 66%** versus single-step tests. Always-valid
p-values (Johari, Pekelis & Walsh) permit stopping the instant evidence suffices, without invalidating
inference. Adaptive best-arm allocation needs `2·Σ Δ⁻² log(1/δ)` samples against
`K·max Δ⁻² log(K/δ)` for uniform allocation.

## Decision

1. **Online FDR control (LORD) governs the page-level test population.** Hypotheses arrive
   sequentially as pages are sampled, are monitored continuously, and are tested against an α-wealth
   schedule rather than a fixed per-page threshold. Batch correction (Bonferroni/BH) was rejected:
   this is not a fixed batch, and treating it as one either over-corrects early or invalidates
   continuous monitoring.

2. **Thresholds are asymmetric, keyed to the reversibility of the action they authorise.**
   - **Auto-demotion** (no human) → **strict** control. This is the consequential, invisible action.
   - **Surfacing to the human review queue** → **loose** control. Cheap, reversible, and a human reads it.

   This extends 0012 decision 4's existing principle — authority already splits by reversibility — from
   *who acts* to *at what confidence*. Applying one threshold to two actions of very different cost
   was the underlying error.

3. **The control arm doubles as the CUPED covariate.** Unablated replicates serve both as the noise
   floor (0014 decision 3, unchanged in force) and as the variance-reduction covariate, cutting the
   treatment-arm samples needed by roughly half. **0014 decision 3 is not weakened — it is made
   affordable.**

4. **Sampling is sequential and adaptive, not fixed-allocation.** Samples flow to whichever
   (turn, page) pairs remain unresolved; clear results stop early, ambiguous ones continue. Inference
   uses always-valid p-values so that continuous monitoring does not invalidate the test.

5. **0014 decision 5 — the declared trajectory-length blind spot — is retired.** It declared that
   long, noisy turns would be under-measured and required the gap be reported. Sequential allocation
   **solves** it: noisy turns simply consume more samples until they resolve, quiet ones stop early,
   and the budget flows to the uncertainty rather than away from it. **No screening, no stratification,
   no declared blind spot.** Coverage reporting by trajectory length is retained as a *check* that the
   allocator is in fact reaching long turns — but it is now a monitor, not an apology.

6. **Revised cost model, labelled indicative.** The ~135M-token backfill under 0014 falls to roughly
   **50–70M** with CUPED and sequential stopping. The two reductions are **not independent** and this
   figure is not computed from first principles; it is a planning estimate to be replaced by measurement
   after the first sweep.

## Considered options

- **FDR at α = 0.05 uniformly (LORD, one threshold).** Rejected: applies one error rate to two actions
  with very different reversibility.
- **FWER control.** Rejected: near-zero false demotions bought at the price of demoting almost nothing,
  which is the status quo the instrument exists to break. It would produce a rigorous, expensive
  confirmation of monotonic accumulation.
- **No multiple-comparisons control** (the 0011–0014 position, by omission). Rejected on measurement:
  ~4–5 expected false demotions.
- **Batch correction (Bonferroni / Benjamini–Hochberg).** Rejected: the test population is sequential,
  not a fixed batch.
- **Fixed-allocation sampling with a declared blind spot** (0014 decision 5). Rejected: sequential
  allocation removes the need to declare it.
- **Screening or stratifying by trajectory length.** Rejected in 0014 and still rejected — screening
  hides coverage bias, stratification re-inflates cost. Sequential allocation dominates both.

## Consequences

- **C degenerates into FWER if the review queue is not drained.** The loose threshold is only
  defensible because a human reads what it surfaces. **If the queue goes unread, the design silently
  becomes "demote only at strict confidence" — which is option B, chosen by neglect rather than
  decision.** Queue depth and time-to-drain are therefore instrument health metrics, not
  housekeeping, and a queue that grows monotonically must trigger a re-decision rather than a reminder.
- **α-wealth is a budget and can be exhausted.** Under LORD, a long run of non-discoveries depletes
  the wealth available for later tests, making late-tested pages harder to demote than early-tested
  ones. Test order therefore has consequences; it must be the deterministic rotation of 0014
  decision 4, never influenced by expected outcome.
- **Sequential stopping interacts with the sealed audit.** Stopping rules depend on accumulated
  evidence, which lives in the sealed store outside agent context (0012 decision 3). The allocator
  must therefore run outside that context too, or it leaks the audit state it is not permitted to see.
- **Fixture additions:**

  | State | Expected |
  |---|---|
  | Demotion proposed without FDR adjustment | **refused** — raw per-page p-values are not admissible |
  | α-wealth exhausted | `budget_exhausted` — testing halts loudly; **not** "no further candidates" |
  | Review queue depth increasing across N cycles | `queue_not_drained` — escalate; the loose threshold is no longer justified |
  | Sequential test stopped early | record stopping time; always-valid p-value only, never a fixed-horizon one |
  | CUPED covariate correlation ≈ 0 | fall back to unadjusted variance; **report the lost sensitivity**, do not silently proceed |
  | Coverage by trajectory length skewed short | `allocator_not_reaching_long_turns` — the monitor for decision 5 |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, round five) following a `web-research` pass against
ADR 0014 and its unresolved items. Sources: Deng et al. WSDM 2013 (CUPED; 45/52/49% variance reduction),
Deng et al. arXiv 2312.02935 (augmentation view, ratio/percentile metrics), Zhang et al. arXiv 2509.13944
and 2606.18750 (control variates vs regression adjustment, ByteDance), Johari/Pekelis/Walsh arXiv
1512.04922 (always-valid p-values), Kharitonov et al. (sequential early stopping; up to 66% duration
reduction), Yang/Ramdas/Jamieson/Wainwright NeurIPS 2017 (online FDR, LORD, doubly-sequential
framework). The multiple-comparisons hole was present in every prior ADR in this chain and was found by
research, not by review. Numbering: 0007 remains reserved._
