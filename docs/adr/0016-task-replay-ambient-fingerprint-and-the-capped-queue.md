# 0016 — Task replay, the ambient fingerprint, and the capped queue

- Status: **DEFERRED — NEVER BUILT** (see the note below). Accepted 2026-08-15, priced out the same
  week. Amended while live: decision 3 by
  [0017](./0017-the-redundancy-cluster-as-the-unit-of-ablation.md).
- Date: 2026-08-15
- Amends: [0015](./0015-error-rates-variance-reduction-and-sequential-allocation.md) decision 2;
  [0014](./0014-shadow-only-promotion-and-the-two-tier-metric.md) decision 6. Respecifies **step 1 of
  the build order**, which every ADR in this chain assumed and none verified.

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
>
> Note for this ADR specifically: its **ambient-fingerprint hook** (decision 1) is the one piece of
> the chain that would have had standalone value as instrumentation, and it does not exist either.

## Context

### Step 1 was never checked, and it is not what five ADRs assumed

Every ADR from 0012 onward closed by saying context-composition logging was cheap, foundational, and
untouched by any research round. **It was never verified.** Inspection of a 1.7 MB transcript:

```
system-reminder blocks : 0
@import / CLAUDE.md    : 0
has systemPrompt       : false
tool_result blocks     : 36     <- explicit Reads ARE recoverable
```

Transcripts record the **message stream** — user turns, assistant turns, tool results — and **not the
ambient layer**. The `@knowledge/index.md` import, CLAUDE.md, system-reminders and the assembled system
prompt exist only at context-assembly time and are never persisted. Two consequences:

1. **The router cannot be ablated.** Its content never enters a loggable channel. Bounded in
   practice: concept pages arrive via `Read` (192 of 200 retrieval touches), so the *unit* of ablation
   is unaffected.
2. **Faithful historical replay is impossible and cannot be backfilled.** The ambient layer drifted
   across 51 `index.md` revisions; replaying a July turn today would run it against a different
   CLAUDE.md than was live. Instrumentation could fix this prospectively, but **the 549 existing
   transcripts can never be made replay-faithful.**

**The paired design already absorbs most of this.** Control and treatment arms execute *together*,
against the *same* ambient layer, so ambient drift is differenced out. The pair must match **each
other**, not history. This reframes the requirement: **the transcript supplies the task; the ambient
layer supplies itself.** The instrument is not replaying history — it is re-running a task under
controlled conditions.

### The review queue degrades self-reinforcingly, not merely riskily

0015 recorded queue depth as a health metric. The measured relationship is worse: **drain rate is a
decreasing function of queue size.**

| Setting | Finding |
|---|---|
| EHR asynchronous alerts (AHRQ) | **61.8%** opened within 24h at inbox ≤42 messages → **28.1%** above 157 (adjusted **OR 0.27** vs bottom quartile) |
| Enterprise SOC (Crogl/Ponemon 2026, n=649) | 4,330 alerts/day, **37% investigated** — *"not low-priority noise that was correctly dismissed… alerts that cleared triage and never got worked"* |
| Radiology fail-safe alerts | **55% abandoned** (39% accepted); 37% abandoned after an educational intervention |

A growing queue is drained less, which grows it further. **A threshold-surfaced queue is unbounded by
construction, and therefore self-destructs.**

## Decision

1. **Step 1 is task replay plus an ambient fingerprint, not context-composition logging.**
   - The transcript supplies the **task**. Paired arms run **together**, now, under the current
     ambient layer. No reconstruction of historical context is attempted.
   - A hook records a cheap **ambient fingerprint** per turn: content hashes of CLAUDE.md,
     `knowledge/index.md`, and loaded skill bodies. Not the content — just enough to **detect** that the
     ambient layer moved between a source task and its replay.
   - **This starts immediately against 549 existing transcripts.** Full ambient logging was rejected:
     weeks of lead time, zero backfill, and pairing makes it unnecessary.

2. **The fingerprint exists to catch task incoherence, not to reconstruct context.** A replayed task
   that references a since-deleted rule or a renamed page is *incoherent with the present ambient
   layer*, and would otherwise be scored as page influence. Fingerprint mismatch marks the pair
   `ambient_drift` and excludes it from the verdict rather than silently contaminating it.

3. **The review queue is size-capped, not threshold-surfaced.** Surface the **top N by evidence
   strength**, where N is calibrated to observed drain capacity — never "whatever clears a loose
   threshold." This keeps the queue in the high-drain regime (≤42-message analogue) by construction
   rather than by discipline. Amends 0015 decision 2: the *asymmetry* stands, but the loose side is
   now bounded by **capacity**, not by **confidence**.

4. **Queue health is measured as a sustained decline in drain rate against baseline**, following the
   alert-fatigue literature's proposed operationalisation, **not** as absolute queue depth. Depth is a
   lagging indicator; a falling drain rate at constant depth is the earlier signal.

5. **0014 decision 6 (freeze external calls during replay) is downgraded from load-bearing to
   defence-in-depth.** Pairing already neutralises ambient and environmental drift by construction,
   because both arms meet the same environment. Freezing external calls still removes noise and is
   retained where cheap, but the design no longer depends on it.

6. **The instrument measures present-tense influence only, and says so.** A page that mattered in July
   and does not now scores as inert, and *"never mattered"* is indistinguishable from *"stopped
   mattering."* Accepted because demotion is the reversible action and the corpus is being audited for
   **current** value — but recorded as the second time this design has traded historical measurement
   for tractability (the first: 0012's rejection of similarity-based supersession).

## Considered options

- **Full ambient-context logging** (resolved CLAUDE.md, index.md, system-reminders, skill bodies per
  turn). Rejected: weeks of lead time, no backfill, and pairing makes historical fidelity unnecessary.
- **Task replay with no fingerprint.** Rejected: no way to notice a task that has become incoherent
  with the present ambient layer; that confound would score as page influence.
- **Abandon replay for live paired sampling.** Rejected in 0012 and again here — it touches live work.
- **Threshold-surfaced queue** (0015 as written). Rejected on measurement: unbounded queues drain at
  28–37%, and the decline is self-reinforcing.
- **Queue depth as the health metric.** Rejected as lagging; drain-rate decline against baseline leads it.

## Consequences

- **Five ADRs rested on an unverified foundational assumption.** It survived because each round
  attacked the newest decision and treated the base of the stack as settled. **The base of a decision
  stack is the least-attacked part of it, and therefore the most likely to be wrong** — a review
  pattern worth carrying beyond this programme.
- **Historical influence is permanently unmeasurable.** Not merely unbuilt: the ambient layer for the
  549 existing transcripts is gone. Any future question of the form *"did this page matter last
  quarter"* has no answer and never will.
- **The fingerprint's exclusion rule can silently shrink the sample.** If ambient drift is frequent,
  many pairs get excluded and coverage quietly falls. The exclusion count must be reported alongside
  coverage — an excluded pair is not a clean pair.
- **N is a judgment, and it is the only number in this design set by taste.** Every other threshold is
  derived from measurement; the queue cap is set by observed drain capacity, which must be measured
  before N is fixed, not guessed and then defended.
- **Fixture additions:**

  | State | Expected |
  |---|---|
  | Ambient fingerprint differs between source task and replay | `ambient_drift` — pair excluded, **counted**, never scored |
  | Fingerprint hook absent for a turn | pair **not eligible** for replay (absence is loud) |
  | Queue at cap with candidates below the line | `queue_capped` — report the count dropped; never render as "nothing further found" |
  | Drain rate declining across N cycles at constant depth | `drain_rate_decay` — escalate ahead of any depth trigger |
  | Router proposed as an ablation unit | **refused** — not recoverable from any log (decision 1) |
  | Replay attempted against a pre-instrumentation transcript | permitted as a **task source**; refused as a **context source** |

---
_Provenance: grilled 2026-08-15 (`grill-with-docs`, round six) following a `web-research` pass against
ADR 0015 and its unresolved items. Measurement this session: direct inspection of a 1.7 MB session
transcript (0 system-reminder blocks, 0 @import content, no system prompt, 36 tool_result blocks).
Sources: AHRQ R21HS023661 (EHR alert opening vs inbox size), Crogl/Ponemon 2026 State of SecOps
(n=649; 4,330 alerts/day, 37% investigated), BMJ Leader radiology fail-safe alert audit (55%/37%
abandoned), Ray-Wilson et al. 2026 systematic review of alert-fatigue measurement (drain-rate decline
against baseline as the operational definition). The falsified assumption — that step 1 was cheap and
already satisfied — appeared in the closing paragraph of five consecutive ADR hand-offs and was never
challenged until it was checked. Numbering: 0007 remains reserved._
