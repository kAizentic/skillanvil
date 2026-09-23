# 0017 — The redundancy cluster as the unit of ablation

- Status: **DEFERRED — NEVER BUILT** (see the note below). Accepted 2026-08-15, priced out the same
  week. Last ADR in the chain; nothing amends it.
- Date: 2026-08-15
- Amends: [0012](./0012-shadow-ablation-and-the-sealed-audit.md) (the ablation unit),
  [0015](./0015-error-rates-variance-reduction-and-sequential-allocation.md) (FDR population),
  [0016](./0016-task-replay-ambient-fingerprint-and-the-capped-queue.md) decision 3 (queue sizing).

> **DEFERRED — NEVER BUILT.** This ADR is the last link in the 0011–0017 measurement-apparatus
> chain, which was priced out on 2026-08-15 and never implemented — on two independent grounds:
> **cost** (50–70M tokens plus months, against a decision that is reversible by design) and
> **unit of analysis**, which is the refutation this very ADR was written to answer. Status
> corrected 2026-09-21; it read `accepted` for five weeks while the kill lived only in
> `knowledge/concepts/`. Full deferral note and the re-open condition:
> **[0012](./0012-shadow-ablation-and-the-sealed-audit.md)**. Reasoning:
> *price the measurement before building it* ·
> *attribution fails under redundancy*.
>
> **Two caveats specific to this ADR, because it is the one people will want to reuse:**
> - Its clustering rule DID ship, as `library/scripts/redundancy_clusters.py` (2026-08-19) —
>   *"the one artifact salvaged from the killed ablation build,"* per its own docstring. It is a
>   standalone redundancy **report** with no scoring mode, and nothing in the vault calls it.
> - Decision 4's **masking-validation** trick — the move that makes the clustering resolution a
>   *derived* parameter rather than a tuned knob, and the most attractive idea in the chain — is a
>   **proposal that was never run.** No within-cluster masking has ever been observed here, so
>   treat "derived parameter" as a design argument, not a result.

## Context

### Ablation assigns zero influence to redundant items — by theorem, not by defect

Every ADR in this chain took the **page** as the unit. Under collinearity that unit is refuted.
Remove page A and page B covers it → A scores inert. Remove B and A covers it → B scores inert.
**Both are demoted, and the information they jointly carried is lost.** This is *correlation bias*:
collinear features "being assigned a SHAP importance score of zero" is documented as common, and the
mechanism is that a model relies on one arbitrary representative of a redundant group.

It cannot be engineered away:

- **The Attribution Impossibility** (arXiv 2605.21492, formally verified in Lean 4, 305 theorems):
  under collinearity, **faithfulness, stability and completeness are mutually incompatible**. In a
  survey of 77 datasets **68% exhibit attribution instability**. Conditional SHAP does not escape it
  when features have equal causal effects.
- **Knockoff correction fails exactly where needed**: `corr(X, X̃) = 0` only while
  `corr(X₁,X₂) ≤ 0.5`, rising linearly above it (arXiv 2402.03447) — *"no free lunch when it comes to
  high feature correlation."*
- **Leave-one-out is the least robust summary in its class** (spectral norm `√(d+1)`; Banzhaf attains
  `1/2^(d/2−1)`).

**This vault is built for the failing condition.** `CLAUDE.md` names dense wiki-linking as a design
goal, and the corpus complies. The instrument as previously specified would have preferentially
deleted whatever the architecture is designed to produce.

### Naive clustering fails, measurably

Connected components over a permissive edge rule (mutual link **OR** ≥2 shared keywords) yields a
**giant component of 33 of 88 pages — 37% of the corpus** — spanning `m365-copilot-purview-labeling`,
`cloud-sync-cold-read-io-tax`, `codification-ladder` and `vault-differential-value`. Linked, but not
remotely redundant. Transitive closure over a dense small-world graph produces a blob.

A conjunctive rule shatters it into coherent groups:

| edge rule | clusters | singletons | largest |
|---|---:|---:|---:|
| mutual-link **OR** kw ≥ 2 | 41 | 32 | **33** |
| **mutual-link AND kw ≥ 1** | **72** | **69** | **8** |
| mutual-link AND kw ≥ 2 | 79 | 75 | 5 |

The multi-page clusters under the conjunctive rule are semantically real: an **epistemics/verification**
group (`proxy-signal-collapses-the-two-states`, `empty-set-passes-every-check`,
`fail-closed-guard-silent-degradation`, `generator-evaluator-loop-discipline`, …), a
**positioning/market** group, and a **monetization/distribution** group. **Only ~19 pages (22%) sit in
genuine redundancy clusters**; the rest are legitimately their own unit.

## Decision

1. **The unit of ablation is the redundancy cluster, not the page.** Ablate the group; score the group.

2. **Within-cluster members are not ranked against each other, ever.** The impossibility says
   stability under collinearity is bought by surrendering within-group completeness. Reporting ties is
   therefore the *correct* output, not a limitation to be engineered around. **Choosing which member of
   an inert cluster survives is a human decision** — it is precisely the arbitrary choice a machine
   must not automate, and cluster-level units make automating it structurally impossible rather than
   merely forbidden.

3. **Clustering is deterministic and structural: mutual wikilink AND ≥1 shared frontmatter keyword.**
   No model judgment anywhere in the clustering step — that would reopen the self-authored-scope-control
   door closed in 0012 decision 4. Connected components over a permissive rule is rejected on
   measurement (the 33-page blob).

4. **The clustering resolution is validated by the phenomenon it exists to correct, not chosen by
   taste.** A clustering is correct to the extent that **within-cluster masking is actually observed**:
   members individually inert, the cluster jointly influential. Resolution is therefore *calibrated by
   the first ablation sweep*, not fixed in advance. This makes the free parameter **derived** rather
   than set — and it means a clustering that shows no masking is evidence the rule is too coarse or
   the pages were never redundant, both of which are findings.

5. **FDR is budgeted over clusters, not pages** (amends 0015 decision 1). ~72 hypotheses rather than
   89 — a modest reduction, because 69 clusters are singletons. The α-wealth benefit is real but small;
   the correctness benefit is the point.

6. **The auto-demoted path must be sampled.** A fraction of automatic demotions is reviewed even
   though they cleared the strict threshold. Without it *"the error rate on the majority of your traffic
   is unmeasured, and the routing thresholds are unfalsifiable"* — the same defect as a behavioural
   verdict without a control arm (0014 decision 3), one layer up. **An unsampled auto-path is an
   unfalsifiable one.**

7. **Queue capacity is Little's Law, and batching is the primary lever.**
   `queue_fraction < reviewers × 3600 / (volume × seconds_per_review)`, with **reviewers = 1**.
   `seconds_per_review` is set by the interface, and halving it is worth exactly as much as doubling
   reviewers. **Cluster-level verdicts batch by construction** — one decision covers the members — which
   is the single largest available reduction. Sizing must also respect that at 80% utilisation waiting
   time is already several times service time, so N is set well below the stability bound, not at it.

## Considered options

- **Page as the unit** (0012–0016). Refuted by the impossibility result and by the vault's own
  dense-linking design goal.
- **Page-level with Dash / ensemble averaging.** Rejected: buys stability at ensemble cost and still
  yields within-group ties — it pays to arrive at decision 2's concession anyway.
- **Cluster for verdicts, page-level ranking as advisory.** Rejected: an unstable-by-theorem number
  displayed beside a stable one will get used.
- **Connected components on a permissive edge rule.** Rejected on measurement (33-page component).
- **Model-judged or embedding-based clustering.** Rejected: self-authored scope control (0012 §4),
  and embedding similarity cannot separate redundancy from contradiction (0012's MemStrata finding).
- **Fixing the clustering resolution up front.** Rejected: it would be the second parameter in this
  design set by taste. Decision 4 derives it instead.

## Consequences

- **A cluster verdict cannot say which member earned its place.** For ~19 pages the instrument will
  return "this group is inert" and hand the choice to a human. That is the theorem being respected, but
  it means the most redundant fifth of the corpus is the least automatable — the opposite of the
  intuition that redundancy is the easy case.
- **Clustering must be recomputed as the corpus changes**, and a page moving between clusters
  invalidates its accumulated evidence. Cluster identity therefore needs a content hash, and evidence
  must be keyed to it — otherwise a re-clustering silently mixes measurements from different units.
- **Decision 4 is circular until the first sweep.** The clustering is validated by masking, which is
  measured by ablation, which needs a clustering. Bootstrap: start at `mutual AND kw≥1`, measure, adjust
  once. Recorded so the circularity is chosen rather than discovered.
- **Fixture additions:**

  | State | Expected |
  |---|---|
  | Cluster spans >25% of the corpus | **refused** — blob, not a cluster; tighten the rule |
  | Within-cluster masking never observed across a sweep | `resolution_suspect` — the rule is too coarse or the pages were not redundant |
  | Per-page ranking requested inside a cluster | **refused** — unstable by theorem (decision 2) |
  | Cluster membership changed since evidence was recorded | evidence **invalidated**, not migrated |
  | Auto-demotion sample rate = 0 | **refused** — the strict threshold becomes unfalsifiable |
  | Queue sized at or above the Little's Law stability bound | **refused** — sizing must sit below it |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, round seven) following a `web-research` pass on the
deepest unattacked assumption in the stack — that influence decomposes page-by-page. Sources: arXiv
2605.21492 (Attribution Impossibility, Lean-verified), arXiv 2402.03447 (variable importance under
correlation; knockoff breakdown theorem), Statistical Science 39(4) (Shapley vs LOCO; "correcting for
correlation is a Faustian bargain"), NeurIPS 2023 (robustness of removal-based attributions; LOO is
least robust), shap#1120 (correlation bias in practice), Multigrid review-queue pattern (Little's Law;
batching as the `seconds_per_review` lever; sample the auto-approved path), tianpan.co HITL SLA
analysis. Measurements this session: 88 concept pages, 57 mutual-link edges; permissive rule → 41
clusters with a 33-page giant component; conjunctive rule → 72 clusters, largest 8, 69 singletons;
~19 pages (22%) in genuine redundancy clusters. Numbering: 0007 remains reserved._
