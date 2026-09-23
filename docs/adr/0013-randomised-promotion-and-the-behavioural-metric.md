# 0013 — Randomised promotion, and the behavioural divergence metric

- Status: **DEFERRED — NEVER BUILT** (see the note below). Accepted 2026-08-15, priced out the same
  week. Amended while live: decisions 1–5 by
  [0014](./0014-shadow-only-promotion-and-the-two-tier-metric.md).
- Date: 2026-08-15
- Amends: [0012](./0012-shadow-ablation-and-the-sealed-audit.md) decisions 2 and 8, and its build order.
  0012 otherwise stands.

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

> **0014 moves promotion into the shadow run.** Decision 1's justifying asymmetry — "adding a page
> cannot break anything" — is false for the pages this vault would promote: they are *distracting*
> documents (semantically adjacent, task-irrelevant), the category with a measured −25% penalty per
> document, not *random* ones. 0014 also adds the mandatory control arm this ADR's cost model omitted,
> and narrows the behavioural metric to tool-sequence structure. Read 0014 for decisions 1–5 in force;
> decision 6 (the `articulated` exemption) stands as written.

## Context

ADR 0012 left two items explicitly unresolved — *the audit perturbs what it measures* (a demoted page
leaves the router, changing the exposure that future demand is measured on) and *replay fidelity is
unvalidated*. A research pass against the unbiased-learning-to-rank and context-attribution
literatures, followed by two measurements against this repository, resolved both and surfaced a third
problem that had been invisible.

### The exposure problem is canonical, and its standard fix does not apply here

The confound 0012 recorded — *not-read-because-useless* vs *not-read-because-unsurfaced* — is stated
almost verbatim in the counterfactual-LTR literature: *"it is difficult to attribute the lack of a
click to a lack of examination or a lack of relevance."* The correction is IPS weighting, which needs
exposure propensities. The textbook way to obtain them is **randomised swap interventions**, which
Joachims' group reports *"degrades retrieval performance and user experience"* and is "statistically
rather inefficient."

**Intervention Harvesting** (Agarwal et al., WSDM 2019; Fang et al. 2019) avoids that cost by
exploiting feedback logged under **multiple historic rankers**: pages placed differently by different
ranker versions form interventional sets that control for relevance with no deliberate randomisation.
This vault appeared to have exactly that data — `knowledge/index.md` is version-controlled and edited
constantly.

**Measured, it does not.** Across **51 router revisions (2026-07-01 → 2026-08-15)** the router went
from **48 to 156 links** with **134 additions and 9 removals** — and all 9 removals occurred on a
single day (2026-07-11), consolidating dated `feed-digest` pages into one page. That is a mechanical
merge, not a judgment about value. Even the 2026-08-15 trim, which cut the file's byte size by more
than half, shows **+5 links and −0**: it removed annotation prose, not entries.

**Exposure in this vault has never once decreased.** There are no interventional sets. Harvesting is
foreclosed, and the covariate-shift assumption it depends on is moot because there is nothing to test
it against.

**The finding underneath that is the important one:**

> **Mode 2 destroyed the evidence needed to measure mode 4.** Monotonic accumulation means exposure
> never varied, so exposure propensity is unidentifiable from history. The six failure modes are not
> independent: one of them silently disabled the instrument for another, and did so for six weeks
> before anyone looked.

This is also the first *measured* confirmation that monotonic accumulation is real rather than
asserted — 134 up, 9 down, and the 9 were bookkeeping.

### The metric literature invalidates 0012's assumed method

Every established context-attribution method — ContextCite (NeurIPS 2024), AttriBoT, MIRAGE, and
plain leave-one-out — scores divergence as the **logit-scaled probability of the original response**,
`g(v) = σ⁻¹(p_LM(R | ABLATE(C,v), Q))`. **The Anthropic API does not expose logprobs, so none of them
is directly available.** ContextCite additionally benchmarked semantic similarity as a baseline and
found it consistently *worse* than surrogate attribution — the metric that is trivially available is
the weakest one measured.

ContextCite also recommends against leave-one-out on cost grounds (it "requires an inference pass for
every source"), preferring random ablation vectors at p=½ with a sparse LASSO surrogate, needing
**O(s log n)** ablations — 32 sufficing for 98–256 sources. **That recommendation is regime-specific
and inverts here:** this vault's median session carries **6 pages** in context (max observed 57). LOO
costs 6 ablations to score 6 pages; the surrogate costs ~32 regardless. The crossover is around
**k ≈ 32**, so at k = 6 leave-one-out is roughly **4.4× cheaper** (53/day vs 235/day).

## Decision

1. **Randomised promotion is the exploration arm** (replaces harvesting, and replaces the randomised
   *demotion* 0012 gestured at). Tail pages are deliberately injected into context on a deterministic
   rotation and then ablated, generating the interventional data six weeks of history failed to
   produce.

   **The asymmetry is the whole argument: adding a page to context costs tokens and cannot break
   anything; removing one can degrade live work.** That is why swap interventions are expensive in the
   literature and why demotion was ruled out in this system's first design round. Promotion sidesteps
   the cost that made the standard method unattractive.

2. **Promotion is capped, logged, and disclosed as touching live work.** It is the only element of
   this design that deliberately perturbs a live session, against a standing constraint that holdouts
   never run unattended. It is admitted here rather than buried: **at most one promoted page per
   session, logged to the sealed store, never during an unattended routine.** The injected noise is a
   single possibly-irrelevant page — bounded, and it cannot cause a wrong action the way a *missing*
   page can.

3. **The divergence metric is behavioural, not textual.** Score whether the *actions* changed — files
   edited, tools called, conclusion reached — not whether token probabilities shifted. Rationale: the
   question this system needs answered is *"did the page change what I did,"* and actions are
   observable, discrete, already logged, and cannot be gamed by a judge the agent authored.
   **LLM-as-judge divergence scoring is rejected** on the SEAL grounds ratified in 0012 (self-authored
   verification). Text-level similarity is retained **only** as a tiebreaker where actions are
   identical — which is the case where the page most likely did not matter anyway.

4. **A local proxy model with logprobs validates the behavioural metric on a sample.** AttriBoT
   demonstrates proxy models approximate a larger target's LOO attributions faithfully. This is not
   the primary instrument — it measures the proxy's sensitivity, not this system's — but correlating
   its verdicts against the behavioural metric **converts 0012's unmeasured replay-fidelity caveat
   into a real experiment**.

5. **Ablation method is regime-selected, contra the literature's default:** leave-one-out for
   sessions with **k ≤ 16** pages in context; ContextCite-style random-ablation surrogate (p=½, LASSO)
   for **k > 16**. Amends 0012 decision 8's uniform LOO assumption.

6. **`decay_class: articulated` keeps no periodic check (0012 decision 5, unchanged) — but the basis
   is now recorded honestly as *absence of evidence*.** A search for work measuring drift in
   explicitly-articulated personal rules, as distinct from aesthetic rank-orderings, returned nothing.
   The exemption therefore rests on an untested assumption whose failure would be **silent**, which is
   the exact shape of `fail-closed-guard-silent-degradation`. Flagged, not resolved.

## Considered options

- **Intervention harvesting from router history.** Rejected on measurement: 9 removals in 51
  revisions, all one mechanical merge. No interventional sets exist.
- **Randomised demotion** (the textbook swap intervention). Rejected: it degrades live work, aims the
  intervention at the highest-value pages, and violates the standing constraint that the live session
  is never deprived. Promotion obtains the same identifiability at a fraction of the risk.
- **Accept the tail as unmeasurable**, retiring it on age + zero exposure + batched human review.
  Rejected as the primary path — it concedes exactly the region where monotonic accumulation lives —
  but retained as the fallback for pages that promotion never reaches.
- **LLM-as-judge divergence scoring.** Rejected (decision 3): self-authored verification.
- **Semantic-similarity divergence as primary.** Rejected: benchmarked as the weakest method in
  ContextCite's own comparison.
- **Uniform ContextCite surrogate.** Rejected at this k: ~4.4× more expensive than LOO at a median of
  6 sources. Adopted only above the measured crossover.

## Consequences

- **The instrument now perturbs live sessions, by design and for the first time.** Decision 2 bounds
  it, but the honest statement is that the exploration arm is not free and could not be made free —
  identifiability requires variation, and this system generated none on its own in six weeks.
- **Promotion changes what the demand signal means.** A page read *because it was promoted* is not
  evidence of demand. The sealed store must record promotion provenance per exposure, or the
  exploration arm will contaminate the observational signal it exists to correct — the same
  audit-perturbs-measurement problem, relocated rather than removed. Unlike the demotion version, this
  one is fully solvable by bookkeeping.
- **The tail may still never be reached.** With 23 pages idle in 9 days and one promotion per session
  at ~7 sessions/day, full tail coverage takes weeks. Partial coverage must be reported as partial;
  per 0012, a partial backfill reported as coverage is the failure being corrected.
- **The behavioural metric is coarser than the literature's.** It cannot detect a page that changed
  *reasoning* without changing *actions*. Accepted deliberately: that class is real but the alternative
  metrics available without logprobs are either weaker (similarity) or corrupt (self-authored judge).
- **Fixture additions**, extending 0012's table:

  | State | Expected |
  |---|---|
  | Page exposed **only** via promotion | `exploration_only` — excluded from the demand signal entirely |
  | Promotion attempted during an unattended routine | **refused** — decision 2 |
  | Router revision count unchanged since last run | `no_new_exposure_variation` (not "propensities stable") |
  | Behavioural divergence 0, text divergence > 0 | tiebreaker path; logged, never a demotion on its own |
  | Proxy-validation correlation unavailable | divergence scores marked **provisional**, not withheld |
  | k > 16 in a session | surrogate path; LOO result for that session marked non-comparable |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, round three) following a `web-research` pass on the
two items ADR 0012 left open. Sources: Agarwal/Zaitsev/Joachims et al. WSDM 2019 (intervention
harvesting), Fang/Agarwal/Joachims 2019 (contextual PBM), Joachims et al. 2017 (unbiased LTR / IPS),
Cohen-Wang et al. NeurIPS 2024 (ContextCite), Liu/Kandpal/Raffel (AttriBoT). Measurements this session:
51 revisions of `knowledge/index.md`, 48→156 links, 134 additions / 9 removals (all 2026-07-11, feed-digest
consolidation); 2026-08-15 trim +5/−0 links; median 6 and max 57 pages in context per session; LOO
53/day vs surrogate 235/day at this k. Numbering: 0007 remains reserved for the vault-installer
verifier-of-record decision._
