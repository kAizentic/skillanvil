---
# === Identity ===
id: decision-scout
name: Decision Scout
provenance: authored
slug: decision-scout
description: Resolve low-confidence *selection* decisions in a plan — which tool, model, vendor, channel, or approach to pick — by confidence-scoring each candidate and deep-researching only the shaky, high-stakes ones to land the ideal option. Use when the user says "which tool should I use for X", "vet my stack", "de-risk my toolkit", "scout this decision", "what's the ideal X for Y", "are my picks right", or a plan rests on tool/vendor/model choices made without surveying alternatives. Bounded to comparative selection — it does NOT resolve product/preference assumptions (that's grill-with-docs) or verify one external fact (that's grill's web-research rung).
# === Classification ===
version: 0.1.0
category: Analysis
status: draft
tags: [decision, selection, toolkit, vendor-eval, confidence, discovery, orchestrator, planning]
# === Contract ===
inputs:
  - a set of selection decisions, each {decision, assumed_pick?, stakes} — supplied directly, or handed as a batch from the softdev-workflows align stage
  - optional scope hints (recency, must-have constraints, budget/lock-in limits)
outputs:
  - one decision note per resolved decision (chosen option, alternatives considered, decisive-question answer, verdict adopt|park|wire-later, capability-vs-installer split, post-research confidence) under output/decision-scout/<slug>-<date>/
  - an optional distilled *eval *<decision>.md handed to capture for the vault inbox
tools: [Read, Write, WebSearch, WebFetch, mcp__exa]
triggers:
  - which tool should i use for
  - vet my stack
  - de-risk my toolkit
  - scout this decision
  - what's the ideal
  - are my picks right
hitl_gate: none
# === Graph ===
dependencies: []
composes_with:
  - web-research
  - deep-research
  - capture
  - softdev-workflows
  - grill-with-docs
aliases: [toolkit-scout, spec-scout]
# === Provenance ===
owner: the operator
last_updated: 2026-07-05
---

# Decision Scout

> Take a set of *selection* decisions, pass the confident picks through untouched, and
> deep-research only the shaky, high-stakes ones to land the ideal option — turning
> incomplete-context recommendations into confidence-vetted decisions.

## Purpose
Planning is full of "which X should I use" choices made on partial information — a tool
recommended without surveying alternatives, a vendor picked on one blog post, a model chosen
from memory. This skill resolves exactly that class: **comparative selection under low
confidence.** It is the confidence-gated discovery loop the vault has only ever run by hand as
`eval-<tool>.md` notes. Its one job nothing else does: **confidence-score each pick, then spend
research budget only on the low-confidence high-stakes ones**, applying "adopt the capability,
not the installer."

## Scope — the assumption space splits three ways; this owns one
- **Product / preference / scope assumptions** ("what should it do", priorities) → **not here.**
  Research can't answer them; `grill-with-docs` interrogates *you*.
- **A single external fact** ("does X's API still support Y") → **not here.** `grill-with-docs`'s
  external-fact rung already escalates one fact to one `web-research` lookup.
- **Comparative selection** ("field of options → which is ideal") → **this skill.** Toolkit /
  tech selection is mode 1; channel / model / vendor / approach slot into the same contract.

## When to use
- "Which tool/model/vendor should I use for X?", "vet my stack", "de-risk my toolkit".
- A plan or PRD rests on picks made without surveying alternatives (my recommendations included).
- Invoked as an **escalation target from the softdev-workflows *align* stage** — grill batches
  the flagged selection decisions here; verdicts fold back into the PRD.

## When NOT to use
- Resolving what a product should *do*, scope, or priorities → ``grill-with-docs``.
- Verifying one external fact inside a grill → grill's own `web-research` rung.
- A single sourced question with a cited answer → ``web-research`` directly.

## Inputs
- A set of decisions `{decision, assumed_pick?, stakes: build-on | swappable}`. If none is
  given, elicit them (one line each). Optional constraints: budget, lock-in tolerance, recency.

## Outputs
- A resumable run folder `output/decision-scout/<slug>-<YYYY-MM-DD>/` with one
  `decision-<n>.md` per decision (see `references/decision-note-template.md`).
- Optional `eval-<decision>.md` distilled via ``capture`` to the vault inbox.

## Required context
- **Exa MCP** for discovery (via `web-research`); falls back to WebSearch/WebFetch.
- Reuses the confidence rubric from `*confidence flagged capture*`.

## Workflow
1. **Intake decisions** — collect the `{decision, assumed_pick?, stakes}` set. Reject anything
   that's a product/preference or single-fact assumption; route it back to grill (honest boundary).
2. **Confidence-score each** (`confidence-flagged-capture` rubric). `high` = you already run it
   well, corroborated by a second independent origin, or a primary source → **pass through, no
   research spend** (record the rationale). `low` = a single-source claim, an *unsurveyed*
   recommendation, or unknown pricing/limits → mark for research.
3. **Budget to stakes** — order the `low` decisions by stakes. `build-on` legs (things you'd
   build the system atop) get the deepest look; `swappable` picks get a glance.
4. **Escalate per decision to `web-research`** — a bounded survey: field of options → shortlist →
   the decisive question (fit, pricing/limits, API surface, lock-in, hazards). Cap ~2–3 queries
   per decision. For a *genuinely wide-open, high-stakes* category, hand off **sequentially** to
   ``deep-research`` (typed-artifact handoff) — **never embed the heavy loop inside this one.**
5. **Apply doctrine** — "adopt the capability, not the installer"; **never run a candidate's
   installer/doctor on the live machine** (ADR-0001); record honest gaps for anything unresolved.
6. **Verdict per decision** — chosen option, alternatives considered, decisive-question answer,
   verdict (adopt / park / wire-later), capability-vs-installer split, post-research confidence.
7. **Emit** — write the decision notes to the run folder; optionally `capture` a distilled note.
   If invoked from softdev align, return the verdicts as the typed artifact to fold into the PRD.

## Examples
See `examples/toolkit-selection-run.md` — vetting a faceless-video content stack (image-gen,
trend source, video backend, publisher), one pick high-confidence (passed through) and the rest
researched.

## Failure modes
- **Researching a product/preference assumption** (unanswerable by the web) → Guard: step 1
  rejects non-selection decisions and routes them to grill.
- **Embedding `deep-research`** inside the loop → Guard: sequential handoff only (step 4).
- **Verifying everything** (breaks the budget) → Guard: high-confidence picks pass through; only
  `low` + high-stakes get the deep look.
- **Running an installer to "test" a candidate** → Guard: ADR-0001 — never; evaluate from docs.
- **False confidence from one source** → Guard: the rubric requires a second independent origin
  (or primary source) before a pick is marked `high`.

## Optimization opportunities
- Cache per-URL extractions within a run (resume without re-fetch).
- Add a re-scout trigger when a chosen tool's pricing/API materially changes.

## Dependencies
- None hard. `web-research` and `deep-research` are soft (`composes_with`) — degrades to
  WebSearch/WebFetch if Exa is absent, recording the reduced confidence as an honest gap.

## Related skills
- `web-research` — the bounded discovery engine each decision escalates to.
- `deep-research` — sequential escalation for a wide-open, high-stakes category (never embedded).
- `grill-with-docs` — owns product/preference + single-fact assumptions; batches selection
  decisions here from the align stage.
- `softdev-workflows` — the pipeline whose align stage invokes this; verdicts fold into the PRD.
- `capture` — persist a distilled `eval-<decision>.md` to the vault inbox (never write vault pages directly).
