# 0006 — The Bounded Pairwise-Refinement Loop pattern

- Status: accepted
- Date: 2026-07-02

## Context
`brand-to-site` needed to iterate a build toward state-of-the-art quality without degrading it
(ADR-0002 there). The fix it landed on is not site-specific — it's a general shape for **any LLM
loop that refines toward a *subjective* quality target**. A deep-research pass (UI-Bench, WebDevJudge,
Self-Refine/RefineCoder/ReVeal, the Awwwards evaluation system) produced a set of findings that recur
across domains, so record them once as a named pattern rather than re-deriving them in the next
critique skill (same motivation as [ADR-0002](0002-pull-orchestrator-pipeline-pattern.md)).

## Decision
Name the **Bounded Pairwise-Refinement Loop** as a first-class pattern for self-improvement loops that
optimize a **subjective** quality (design, prose, a report's persuasiveness) — i.e. loops with **no
objective oracle**. A loop that claims this pattern holds all of:

1. **Pairwise over absolute.** Judge the artifact by *comparison to a known-good anchor* (a category
   exemplar, a prior best, a reference), not an absolute self-score. Comparative judgment aligns with
   model capability far better than absolute calibration (UI-Bench pairwise+TrueSkill; WebDevJudge
   pairwise > single-answer grading by ~8pts).
2. **Ground every fix.** Each refinement targets a *grounded* signal — a named rubric dimension, a
   deterministic check (a linter, a11y/perf gate, a test that isn't the oracle), or a specific
   exemplar gap. **Never** free-form "make it better": ungrounded feedback gives the loop an
   inconsistent target, prevents convergence, and invites reward-hacking.
3. **Bounded (~3).** Cap iterations at about three. Quality saturates ~3 feedback loops and the 4th
   consistently *degrades* (over-refinement, correlated errors → "hallucinated corrections").
   Feedback *quality* beats iteration *count*.
4. **Best-so-far / regression-guarded.** Keep the highest-judged version; never ship one the judge
   rates below a prior. This is what makes "more iterations" safe.
5. **A real stopping criterion.** Stop on *beat/match the anchor*, OR *no improvement over the prior*,
   OR *the cap* — not "looks done."
6. **Debias + ensemble the judge.** Position-swap (run A/B and B/A, discard order-flips); a small
   odd ensemble, drop the outlier; judge the *artifact* with fresh eyes, not the generator's own
   rationale (self-preference bias).
7. **Human ratifies the ceiling.** The judge is a *signal, not ground truth* (best design/web judges
   ≈70% agreement vs ≈85% human). The loop gates **iteration**, never **shipping**: a still-short
   result is surfaced to a human (interactive) or flagged for review (autonomous) — the model never
   self-declares "state of the art." (Dovetails with [ADR-0005](0005-unified-site-orchestrator-and-afk-mode.md)'s
   human-judgment-before-shipping principle.)

## Scope — when NOT to use it
This is for **subjective-quality loops lacking an oracle**. When an *objective oracle exists*, use the
oracle instead of a pairwise judge:
- `tdd` (red-green-refactor) and `diagnose` (reproduce → fix → regression test) are **oracle-backed** —
  a passing test is ground truth; don't bolt a pairwise judge onto them.
- Use this pattern where "correct" is a matter of taste/quality with no test: design (`brand-to-site`),
  a research report's synthesis (`deep-research`), long-form writing/critique.

The two families compose: an oracle-backed loop can *contain* a pairwise-refinement sub-loop for the
subjective parts (e.g. code passes tests **and** reads well), but the oracle governs correctness.

## Instances & candidate adopters
- **`brand-to-site`** (reference instance) — Step 4.5 SOTA-benchmark loop (its ADR-0002): pairwise vs
  a category award exemplar, cap-3, best-so-far, human-ratified ceiling.
- **`deep-research`** (instance, 2026-07-02) — Stage 5 synthesis refinement: pairwise vs a
  prior-best + an exemplar report, grounded checks (schema/coverage/corroboration/contradiction),
  cap-3, best-so-far; its **existing Stage-6 human gate is invariant 7**. Shows the pattern on a
  non-visual subjective quality (analytical sharpness) with an anti-gaming guard (no invented findings).
- **Candidate adopters** (subjective-quality, no oracle): `site-synth` original design head, any
  future content/long-form-writing critique skill. Adopt by instantiating the seven invariants — a
  pointer, not a rewrite.

## Considered options
- **Leave it inside `brand-to-site`.** Rejected: the next subjective-quality loop would re-derive it
  (and likely re-make the absolute-self-score / unbounded-refine mistakes the research warns against).
- **Make it a runnable shared module.** Rejected for the same reason as ADR-0002: these are *pulled*
  doctrines, not a runtime; the reusable thing is the invariants. A template, not a base class.

## Consequences
- A new subjective-quality loop starts from these seven invariants instead of an absolute self-score
  and an arbitrary iteration count.
- It's a review checklist: a refinement loop that self-scores absolutely, refines unboundedly, ships
  below a prior best, or lets the judge declare victory is violating the pattern.
- Trade-off: naming risks over-fitting. Mitigation (as ADR-0002): it's `accepted` describing observed
  instances, superseded—not contorted—if a loop genuinely needs a different shape. The explicit
  oracle-vs-subjective scope keeps it from being force-fit onto `tdd`/`diagnose`.

---
_Provenance: extracted 2026-07-02 from `brand-to-site` ADR-0002, itself the product of a deep-research
pass on LLM design-judging + iterative refinement (UI-Bench, WebDevJudge, Self-Refine/RefineCoder,
Awwwards). Raw findings: `inbox/2026-07-02-research-llm-design-judging-and-iterate-loops.md`._
