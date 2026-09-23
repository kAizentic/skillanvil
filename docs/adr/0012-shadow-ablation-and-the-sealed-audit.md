# 0012 — Shadow ablation and the sealed audit

- Status: **DEFERRED — NEVER BUILT.** Accepted 2026-08-15, priced out the same week; see the
  deferral note below before treating any decision here as in force. Amended while live by
  [0013](./0013-randomised-promotion-and-the-behavioural-metric.md).
- Date: 2026-08-15
- Supersedes: [0011](./0011-ground-the-corpus-with-oracles-not-holdouts.md)

> **DEFERRAL NOTE — read first. The apparatus specified by 0012–0017 does not exist, and the
> decision not to build it was taken on two independent grounds.** Status corrected 2026-09-21:
> for five weeks these six ADRs all read `accepted`, so read in isolation — which is how an ADR
> directory gets read — they presented as six in-force decisions specifying an instrument nobody
> intended to build. The kill was recorded only in `knowledge/concepts/`, never here.
>
> - **Cost.** The 0011–0017 chain was priced at **50–70M tokens plus months**. A
>   value-of-information check failed on inspection: the decision it would inform (which of ~40
>   pages to demote) is **reversible by design**, and a zero-cost heuristic proposed most of the
>   same set. An EVPI below the cost of the study is a *sufficient* condition to stop.
>   → *price the measurement before building it*
> - **Unit of analysis.** Page-level ablation over a deliberately dense wiki-link graph is
>   **formally refuted for this corpus**, not merely noisy: redundant pages mutually mask, so both
>   score inert and what they jointly carried is lost. This vault is built for the failing
>   condition — `CLAUDE.md` names dense linking as a design *goal*.
>   → *attribution fails under redundancy*
>
> Either check alone would have stopped the build; the second was found at round 7 of 8, having
> been assumed since round 2.
>
> **This is a deferral, not an abandonment, and the distinction is load-bearing** — an unnamed
> deferral is quiet abandonment wearing a deferral's clothes. Re-open when **any** of:
> the six-question scoped review yields genuine candidates *and* its ranking is overturned more
> than occasionally; the corpus passes **~150 concept pages**; or *"did this situation arise?"*
> stops being answerable from memory.
>
> **What shipped instead**, for minutes of work rather than months: `wiki-lint`'s
> `applies_when_missing` gate, addressing *admission* rather than retirement
> (*admission gate beats retirement audit* — "this should have been ADR 0011"). The one
> salvaged artifact is `library/scripts/redundancy_clusters.py`, which runs standalone as a
> redundancy **report** and has no scoring mode; nothing in the vault calls it.

> **0013 amends decisions 2 and 8 and the build order.** It resolves the two items this ADR left open:
> the exposure confound (via randomised *promotion*, after intervention harvesting was measured
> impossible here — 9 removals in 51 router revisions) and replay fidelity (via proxy-model
> validation). It also replaces the assumed logprob-based divergence metric, which the Anthropic API
> does not support, with a behavioural one. Everything else below stands.

> **Decision 5's `none` split was superseded, not implemented — noted 2026-08-20.** `decay_class`
> shipped as **`verifiability:`** (see 0011's note of the same date). Its `contestable` value routes
> taste and prescriptive claims to an adversarial reader without the corpus priors, producing *a
> challenge attached to the page, never a verdict* — so the `aesthetic` exposure this decision was
> written to close is **checked rather than exempted**, which is what this decision wanted and a
> cleaner route to it. **No `articulated`/`aesthetic` split exists, and none should be added:** it
> would reintroduce an exemption category whose justification 0013 §6 already recorded as resting on
> *absence of evidence*, with a silent failure mode. Measured 2026-08-20: **0 pages carry `none`** —
> the exemption class this decision feared is empty in practice.

## Context

ADR 0011 was written earlier the same day, from a five-branch grill conducted **almost entirely
against this vault's own pages**. It rejected the holdout/control-arm design and replaced it with
oracle re-verification. A subsequent research pass against external literature contradicted four of
its decisions. That is not an embarrassment to be smoothed over — it is the mechanism working, and
it is the reason this ADR supersedes rather than amends: **a reader must be able to see that the
control arm was rejected and then reinstated on evidence.** An amended 0011 would hide the reversal,
and the reversal is the most instructive thing in the record.

The irony is load-bearing and worth stating once: **ADR 0011 was a design against self-confirmation,
derived by consulting only the corpus it was meant to audit.** Its central error was produced by
exactly the process it existed to prevent.

### What the research falsified

**1. The "structural gift" — that self-confirmation only bites where an external truth-maker exists,
so taste pages are safe — is wrong.** Aesthetic preference stability is low: grand mean Spearman
ρ = **0.27**, ranking changes of at least 1 rank per item over a 2-week span, reliability falling off
"over the scale of days" (Frontiers in Human Neuroscience, 2017). A field test of bandit recommenders
found reward distributions are not fixed **even within 30 minutes** (Δ = 0.57, 95% CI [0.30, 0.84],
p < 0.001) and — decisively — that *"the recommendations made by these algorithms may influence users'
preferences"* (arXiv 2304.09088). A corpus encoding a preference and applying it every session
**shapes the truth-maker it is measured against.** That is a stronger self-confirming loop than the
external-fact case, not a weaker one.

**Scope limit on this finding, stated so it is not over-applied:** the ρ = 0.27 result concerns
rank-ordering of paintings, faces and landscapes. It does not license the claim that *articulated*
preferences drift on that timescale. See decision 5's split.

**2. Demand (access frequency) is a known-bad estimator of value.** Popularity and quality are
provably not identifiable in general — Theorem 1 gives an **Ω(T) regret lower bound for any ranking
algorithm** in the presence of popularity-biased selection (arXiv 2305.18333). The closed feedback
loop measurably exacerbates the bias (Zhu et al., KDD 2021), and niche, information-rich items
deteriorate fastest — *"feedback dynamics progressively misalign the system with its most valuable
users"* (Zoralioglu & Yalcin, 2026). The prescribed fix is **explicit exploration**, which ADR 0011
deleted. Empirically here: `knowledge/index.md` was **Edited 12 times inside the 9-day measurement
window**, so exposure is non-stationary in the very data 0011 proposed to retire pages on.

**3. "Read ≠ used" has a standard method, and it is ablation.** Post-rationalization is common —
models cited adversarial documents **57%** of the time when a statement was planted in
relevant-but-uncited documents (Wallat et al.). ProvenAI names the **citation-influence gap** with a
worked case in which one cited source showed weak influence while **seven uncited sources demonstrably
shifted the output** (arXiv 2606.26449). ContextCite, SelfCite and ProvenAI all measure influence the
same way: **leave-one-resource-out ablation**.

**4. Self-authored verification fails, and 0011's `decay_class` design was an instance.** When the
verifier co-evolves with the system, *"the cheapest path to passing verification is… selecting easier
test distributions."* Measured: **15 of 35 policies scored below their game's random reference while
self-scoring ≥ 0.70** (SEAL, arXiv 2607.24300). Reliable self-improvement requires a signal the agent
**cannot write, observe, or directly optimize** — four conditions: exogenous audit, audit
confidentiality, single-bit feedback, conservative update. ADR 0011 satisfied one.

Independently, tool-agent evaluation reaches the same structural conclusion from a fourth direction:
*"matched no-feedback fallback should be treated as a first-class control"* (arXiv 2606.21409), which
also documents **value inversion** — persistently misleading feedback makes tool use worse than no
feedback at all.

### Why the holdout comes back

ADR 0011's rejection was correct about *its* holdout and wrong about the design space. It killed a
**session-level holdout with human correction as the outcome** — no interceptable seam, ~0.16 events
per attended session, requiring blinding. The literature runs a **generation-level ablation with
output divergence as the outcome**. Every objection dissolves:

| 0011's objection | Under shadow ablation |
|---|---|
| No seam to suppress the page behind | Nothing is suppressed live; the counterfactual is an offline re-run |
| Underpowered at 0.16 events/session | One datapoint per citation — 3–4 orders denser |
| Blinding has no implementation | No blinding needed; the comparison is mechanical |
| Risk to live work / never unattended | Zero; the live session retains every page |

## Decision

1. **Shadow ablation is the primary instrument.** Context composition is logged per turn; a scheduled
   offline job re-runs selected generations with page *X* removed and scores output divergence. **The
   live session is never deprived of anything.** This is simultaneously the influence measure (fixing
   "read ≠ used") and the exploration signal (fixing the identifiability problem in decision 2).

2. **Demand is demoted from decider to ranking input.** Access frequency may *order* a queue; it may
   **never** by itself justify demotion. ADR 0011 made it the retirement criterion; the impossibility
   result forecloses that. Demand now collapses two states in **both** directions — *consulted-and-used*
   vs *consulted-and-discarded* (recorded in 0011), and *not-read-because-useless* vs
   *not-read-because-unsurfaced* (missed by 0011, and the damaging one, because it argues for deletion).

3. **The audit is sealed: one bit in, evidence out.** The vault receives a single bit —
   `status: contested`. Divergence scores, samples, selection dynamics and thresholds live in a store
   **outside the vault tree, never read into agent context**, inspectable by the operator on demand. This
   satisfies SEAL's *confidentiality* and *single-bit* conditions. A vault-resident score table would
   violate confidentiality **by construction, because the vault is the agent's context** — the audit
   would become part of the corpus it audits.

4. **Selection and metric are exogenous.** Which pages get ablated is chosen by **deterministic
   rotation (hash-ordered), never by model judgment**; the divergence metric is **frozen and
   versioned**, not tunable per run. Together with decision 3 this covers three of SEAL's four
   conditions; conservative update is covered by decision 6.

5. **The `none` class splits, because its two halves have opposite risk profiles.**
   - **`articulated`** — explicitly stated boundaries (`books-hands-off`, `askuserquestion`,
     productized→Cowork). Violation is self-announcing and the operator would notice. **Low drift risk; no
     periodic check required.**
   - **`aesthetic`** — fine-grained taste and voice judgment (what reads as slop, tone, "less
     AI-generated"). Measurably drifty *and* actively shaped by the system's own output. **This is the
     real mode-4 exposure, and ADR 0011 exempted all of it.**

   For `aesthetic`: **ablation and revision-history features rank the queue; batched human
   re-ratification resolves it.** Revealed-preference comparison against accepted outputs is
   **explicitly rejected as a verdict mechanism** — those outputs were generated *with* the page in
   context, so validating the corpus against corpus-shaped behaviour is citogenesis and would produce
   confident agreement forever. It is permitted as a ranking input only.

6. **Authority is unchanged from 0011: auto-demote, human-gated delete.** Demotion is contradiction
   (ADR 0009); deletion is a different act 0009 does not license. Rollback on regression supplies
   SEAL's conservative-update condition.

7. **Retirement conditions, unchanged from 0011:** the demand instrument is **declared permanent
   standing hygiene** (the `wiki-lint` category — the failure is unadmitted permanence, not permanence);
   the oracle/ablation pass **retires on cost inversion**, deliberately not on absorption, because
   `rolling-evidence-decays-toward-deletion` shows that signal decays toward "clean" for measurement
   rather than behavioural reasons.

8. **Sampling is capped per page, not per citation.** ~20 samples per page suffices; the touch
   distribution is severely skewed (one page at 77 touches, 32 pages at 1), so uncapped ablation spends
   almost everything on the head. Measured: **53 ablations/day (~2.2M tokens) uncapped**; a one-time
   backfill of 20 × 89 pages ≈ **1,780 ablations (~73M tokens)**; capped steady state ≈ **200
   ablations/month (~8M tokens)**, covering new and changed pages only.

## Considered options

- **Everything rejected in ADR 0011's options list** (rule-level removal test, rule-level holdout,
  similarity-based staleness, staleness forecasting, draft-anchored auditing, full-auto archive,
  retire-on-absorption) remains rejected on its original evidence. None was touched by this research.
- **Session-level blinded holdout** (0011's leading candidate for three branches). Still rejected: the
  seam and power findings hold. It is the *unit and outcome* that were wrong, not the instinct.
- **Live paired sampling** (run two generations in-session, use one, log both). Rejected: higher
  fidelity, but it touches live work — the one thing explicitly ruled out — and doubles latency on
  sampled turns.
- **Observational demand alone, accepting Tier 2** (0011's shipped position). Rejected: the
  identifiability impossibility result makes it not merely weak but non-identifying, and it argues for
  an irreversible action while doing so.
- **Vault-resident audit results with exogenous selection only.** Rejected: fails confidentiality by
  construction (decision 3).
- **Revealed-preference validation for `aesthetic` pages.** Rejected as a verdict mechanism
  (decision 5) — contaminated by the loop under audit.

## Consequences

- **The residual leak, which no amount of sealing fixes:** a demoted page drops from the router →
  exposure changes → future demand measurement changes. **The audit perturbs what it measures.** This
  is the popularity feedback loop re-entering through the *demotion action* rather than the
  measurement. Mitigating it requires randomised or staged demotion; that is deliberately left open
  here rather than solved badly.
- **`aesthetic` pages need human judgment, and this is a floor greater than zero.** The stated goal was
  to rely on human judgment as little as possible; for the drifty half, the operator is the only oracle that
  exists. An instrument that *looked* fully automatic here would launder July taste into December
  output. The honest frame is the RSI survey's: *the open question is how little external grounding
  suffices, and no one has established the exchange rate.*
- **Cost is front-loaded**: ~73M tokens once, ~8M/month after. If that backfill is not paid, the
  instrument runs on the head of the distribution only — which is the popularity bias it exists to
  correct. **A partial backfill is worse than none and must not be reported as coverage.**
- **Replay fidelity is unvalidated.** Shadow ablation compares against a *replayed* context, not the
  live trajectory. The gap is bounded and measurable on a sample; it has not been measured. Treat any
  divergence score as provisional until it is.
- **Binding-condition fixtures** (per `mechanize-gates-over-prose`), extending 0011's table:

  | State | Expected |
  |---|---|
  | `activity.jsonl` missing or unwritten since last run | `no_activity_evidence` (**not** "0 dead pages") |
  | Ablation backfill < 20 samples for page | `insufficient_samples` — excluded from demotion, counted |
  | Page has no `applies_when` | `unscoped` — excluded from demotion, counted |
  | Low demand **only**, no ablation evidence | **refused** — demand may not demote alone (decision 2) |
  | Low demand **and** low ablation divergence, ≥20 samples | `demotion_candidate` ← the only discriminating row |
  | Page idle, `applies_when` predicate never fired | **silent** (dormant ≠ dead) |
  | `decay_class: aesthetic`, TTL expired | `needs_ratification` — queued for human, never auto-demoted |
  | `decay_class: articulated` | **silent** — no periodic check by design (decision 5) |
  | Oracle contradicts a page claiming `last_verified` | `verified_but_contradicted` |
  | Sealed store unreachable | **fail closed** — no bit written; absence is loud |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, two rounds — five branches against the vault, three
against external research). Round 1 produced ADR 0011; a `web-research` pass across six attack vectors
falsified four of its decisions and this ADR replaces it. Sources: arXiv 2305.18333 (popularity-bias
impossibility), Zhu et al. KDD 2021, Zoralioglu & Yalcin 2026 (feedback-loop misalignment), Frontiers
Hum. Neurosci. 2017 (aesthetic stability), arXiv 2304.09088 (preference non-stationarity), Wallat et al.
(citation faithfulness), arXiv 2606.26449 ProvenAI (citation-influence gap), arXiv 2605.26778
(attribution blind spot), arXiv 2607.24300 SEAL (self-authored verification), arXiv 2606.21409
(value inversion / matched fallback). Measurements this session: 549 transcripts (325 headless / 224
attended); `activity.jsonl` 2554 records over 9 days; 66 of 89 concept pages touched, 23 idle, 32 once;
`index.md` 4 Reads vs 192 concept Reads, 12 Edits in-window; 480 (session, page) pairs → 53
ablations/day. Numbering: 0007 remains reserved for the vault-installer verifier-of-record decision._
