# 0014 — Shadow-only promotion, and the two-tier metric

- Status: **DEFERRED — NEVER BUILT** (see the note below). Accepted 2026-08-15, priced out the same
  week. Amended while live: decisions 3 and 5 by
  [0015](./0015-error-rates-variance-reduction-and-sequential-allocation.md).
- Date: 2026-08-15
- Amends: [0013](./0013-randomised-promotion-and-the-behavioural-metric.md) decisions 1–5.
  [0012](./0012-shadow-ablation-and-the-sealed-audit.md) stands except where 0013 already amended it.

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

> **0015 adds multiple-comparisons control, absent from 0011–0014 entirely** — 89 pages are 89
> hypotheses, and at α=0.05 the instrument would have auto-demoted ~4–5 good pages by chance. It also
> makes decision 3's control arm affordable (it doubles as a CUPED covariate, ~50% variance reduction)
> and **retires decision 5**: sequential allocation solves the trajectory-length blind spot rather than
> declaring it.

## Context

A research pass against ADR 0013 falsified the argument carrying its most novel decision, and
surfaced a measurement problem its cost model did not account for.

### Promotion is not free, and the reason is a distinction 0013 missed

0013 decision 1 rested on an asymmetry: *"adding a page to context costs tokens and cannot break
anything; removing one can degrade live work."* The retrieval literature splits added documents into
three kinds, and the asymmetry only holds for one of them:

| Kind | Measured effect |
|---|---|
| **Distracting** — semantically related, not relevant to the task | **−25% accuracy from a single document**, up to −67% (Cuconasu et al., *The Power of Noise*) |
| **Random** — wholly unrelated | **+35%** (same study); but *"dramatically decreases accuracy on all five datasets"* (Yoran et al.) — **contested** |
| A single irrelevant sentence in a reasoning problem | ≤18% of solvable problems stay solved across irrelevant-info variants (Shi et al., ICML 2023) |

**Pages promoted from this vault are topically adjacent to the work by construction — they are
*distracting* documents, not random ones.** They fall in the category with the measured −25% penalty.
The asymmetry that justified live promotion does not exist.

### Behavioural divergence has a noise floor that swamps the signal

Identical inputs already produce different behaviour: ReAct agents yield **2.0–4.2 distinct action
sequences per 10 runs** across three models **including Claude Sonnet 4.5**, with 69% of divergence at
step 2 (Mehta 2026). Temperature 0 does not fix it — across 60,000 trajectories, variance *"never
decreases and sometimes increases"* at temperature 0, with single-run estimates spanning 2.2–6.0
percentage points (arXiv 2602.07150).

0013's cost model assumed one run per ablation. With a paired control arm at K=5, backfill goes from
**~1,780 runs (~73M tokens)** to **~10,400 runs (~426M tokens)**. The multiplier exists *only because
the behavioural metric samples a trajectory rather than measuring a quantity.*

The same literature supplies a sharper metric than 0013 specified. Across 1,140 traces (arXiv
2605.28840): **tool-sequence similarity TSS = 0.87** [0.84, 0.90] and **predicts correctness
(d = 0.81)**; argument consistency = 0.69 and **does not** (r = 0.12, n.s.); and **natural-language
outputs match < 5% of the time even when tool sequences are identical.**

### A local proxy changes the economics

`nvidia-smi` reports **10240 MiB on an RTX 3080** (*local image gen comfyui flux stack*),
enough for a quantised 8B model with logprob access. A ContextCite-style sweep then costs local GPU
time rather than API spend — and **needs no replicates, because a logprob is a measurement, not a
sample.**

## Decision

1. **Promotion moves entirely into the shadow run. It never touches a live session.** The page is
   injected into the offline replay to produce the counterfactual *"what would this turn look like
   **with** page X"*. This obtains the same interventional data the exploration arm needs, at zero
   distraction cost, and **restores the invariant the rest of this architecture already holds** — the
   live session is never altered. 0013 decisions 1 and 2 (caps, logging, the never-unattended
   carve-out) become unnecessary rather than merely bounded, and are withdrawn.

2. **The behavioural metric is tool-sequence structure — not arguments, not prose.** Argument-level
   variance is measured not to predict correctness, and text matches under 5% of the time even when
   behaviour is identical, so both are noise for this purpose. Sharpens 0013 decision 3.

3. **A paired no-ablation control arm is mandatory.** Behavioural divergence is uninterpretable
   without a measured per-turn noise floor, because the floor is 2–4 distinct sequences per 10 runs
   before any intervention. **A behavioural verdict reported without its control arm is not a weak
   result — it is an unfalsifiable one**, and must be refused rather than caveated.

4. **Two-tier metric: the local proxy ranks, the behavioural metric resolves.** The proxy sweeps all
   pages exhaustively and cheaply; behavioural runs only at the extremes it flags (clearly influential,
   clearly inert). Promotes 0013 decision 4 from validation to primary *ranking* instrument.

   **The cross-family transfer assumption is thereby confined to ranking, never to deciding.**
   AttriBoT validated proxy→target attribution *within* the Llama family; Llama-8B → Opus is untested.
   Ranking tolerates a monotone distortion that a verdict would not.

   This is the third instance of one pattern in this design — *demand ranks, ablation resolves*
   (0012 §2); *ablation ranks, human resolves* for `aesthetic` (0012 §5); *proxy ranks, behaviour
   resolves* here. **Cheap-and-exhaustive narrows; expensive-and-faithful decides.**

5. **The trajectory-length blind spot is declared and reported, never screened away.** Screening
   ablations onto behaviourally stable turns would select for short trajectories (3 steps → 90%
   accuracy, high consistency) and against long ones (8+ steps → 43%, high variance) — and long turns
   are where vault pages should matter most. **Coverage is therefore reported by trajectory length**,
   and a sweep that reached only short turns says so explicitly. Stratifying with higher N on long
   turns was rejected: it re-inflates precisely the cost decision 4 saves.

6. **External calls are frozen during replay** (the agrepl record/replay pattern, F = 1.0). This
   cannot make the ablated model call deterministic, but it removes external API state, infrastructure
   headers, and environment noise — three of the four documented divergence sources — from the
   comparison, so the control arm measures model stochasticity alone.

## Considered options

- **Drop promotion entirely**, conceding the tail as unmeasurable. Rejected: shadow promotion costs
  nothing that the ablation harness does not already pay.
- **Live promotion restricted to low-stakes turns.** Rejected: strictly worse than shadow promotion,
  which has no stakes at all.
- **Live promotion with documented mitigations** (an instruction to ignore irrelevant context;
  self-consistency decoding). Rejected: mitigations are partial in the source, self-consistency
  multiplies cost, and shadow promotion makes the whole question moot.
- **Behavioural metric as primary** with the full control arm (0013 as written). Rejected on cost:
  ~426M tokens for backfill versus ~135M under the two-tier design.
- **Proxy-logprob as primary decider.** Rejected: it would make an untested cross-family transfer
  assumption load-bearing for verdicts rather than for ordering.
- **Text-level or argument-level divergence.** Rejected on measurement (decision 2).
- **Screening onto low-variance turns** to reduce N. Rejected (decision 5): it converts a cost problem
  into a silent coverage bias, which is the failure class this whole programme exists to catch.

## Consequences

- **Nothing in this design now touches a live session.** That was true in 0012, briefly false in 0013,
  and is true again. The exploration arm was the only thing that ever required otherwise, and it
  turned out not to.
- **The proxy measures a different system than the one being audited.** Confined to ranking
  (decision 4), but if proxy and behavioural verdicts disagree systematically at the extremes, the
  ranking is untrustworthy and the tier collapses. That disagreement rate is the instrument's own
  health check and must be tracked from the first run.
- **Long-horizon turns will be under-measured.** Declared per decision 5. The risk is that the pages
  most load-bearing for hard work are the least covered — the same head/tail asymmetry as
  monotonic accumulation, in a new place.
- **Fixture additions**, extending 0012 and 0013:

  | State | Expected |
  |---|---|
  | Behavioural verdict without a paired control arm | **refused** — unfalsifiable, not weak (decision 3) |
  | Control arm shows ≥6 unique sequences at baseline | `high_baseline_variance` — page verdict withheld for that turn |
  | Proxy and behavioural disagree at an extreme | `tier_disagreement` — logged; ranking flagged, not silently used |
  | Coverage reported without trajectory-length breakdown | **refused** (decision 5) |
  | Promotion attempted against a live session | **refused** — shadow only (decision 1) |
  | External calls not frozen during replay | divergence attributed to model stochasticity **only if** frozen; else `unattributable` |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, round four) following a `web-research` pass against
ADR 0013's own decisions. Sources: Cuconasu et al. (*The Power of Noise*), Yoran et al. arXiv 2310.01558,
Shi et al. ICML 2023 (GSM-IC), Mehta arXiv 2602.11619 (behavioural consistency, incl. Claude Sonnet 4.5),
arXiv 2605.28840 (structural vs parametric consistency, TSS), arXiv 2602.07150 (randomness in agentic
evals, 60k trajectories), arXiv 2607.16200 (agrepl deterministic replay), Liu/Kandpal/Raffel (AttriBoT).
Local capability confirmed: RTX 3080, 10240 MiB via `nvidia-smi`. The decision this ADR overturns —
live randomised promotion — was one round old; its justifying asymmetry did not survive contact with
the distracting/random distinction. Numbering: 0007 remains reserved._
