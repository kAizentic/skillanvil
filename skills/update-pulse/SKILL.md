---
name: update-pulse
provenance: authored
description: Upstream-drift watch for the skills this vault vendors. Compares every pinned source in agent-os/Skills/_vendored.json against its GitHub HEAD, maps the changed upstream files onto the skills actually vendored here, and drops one inbox clip per drifted source with a deterministic RAISE / AUTO-STAGE verdict. On approval it stages a reviewable local-vs-upstream diff in .scratch/ and re-applies nothing by itself. Use when the user says "update pulse", "check for skill updates", "are my vendored skills stale", "what's changed upstream", "is anything I depend on out of date", or wants dependency drift triaged. The dependency-side counterpart to blogwatcher (which watches publications, not the code this vault runs).
version: 1.0.0
category: Automation
type: automation
tags: [dependencies, vendored, drift, hygiene, upstream]
status: active
tools: [Read, Bash, Grep]
hitl_gate: confirm
unattended: restricted
unattended_note: >-
  Unattended runs perform DETECTION ONLY — compare against HEAD, classify, write clips.
  Staging (--stage) and applying an update are withheld: both are human-initiated, and
  applying is never done by this skill at all. The pin file is read, never written.
inputs:
  - agent-os/Skills/_vendored.json (the authoritative pin file — read-only)
outputs:
  - one inbox clip per drifted source, carrying a RAISE / AUTO-STAGE verdict
  - on request, a staged local-vs-upstream diff under .scratch/update-pulse/
triggers:
  - update pulse
  - check for skill updates
  - are my vendored skills stale
  - what's changed upstream
dependencies: []
composes_with: [skill-portfolio-review, skill-pipeline-sync, distill, wiki-lint]
owner: the operator
filed: 2026-09-18
last_updated: 2026-09-18
---

# update-pulse

`blogwatcher` watches things that get *published*. This watches the code this vault actually
*runs* — the 37 vendored skills whose upstreams move without telling anyone. Before this existed,
the only record of upstream state was a hand-edited note in `_vendored.json`, and the only time
drift was ever measured was one manual session on 2026-08-20 that found the Anthropic set 9
commits / 115 files stale, on the one skill whose entire job is not to be stale.

It is the **inbound-flow** half of dependency hygiene. `skill-portfolio-review` is the
standing-stock half, and the two are deliberately not merged — see *Why this isn't part of
skill-portfolio-review* below.

## When to use

- Ad hoc, when you want to know whether anything you vendor has moved.
- On its weekly schedule (`Second Brain - Update Pulse`), which writes clips for the next sweep.
- Before any public release, where shipping a stale vendored skill is an IP and a
  correctness problem at once.

## When NOT to use

- To watch a *competitor's* releases — that's `intel-scan`'s Friday `competitors` thread.
- To watch the Claude Code CLI itself — already covered twice, by `blogwatcher` row 13 and
  `ai-pulse` step 2a. Adding it here would be a third redundant channel.
- To decide whether a skill is any good. This measures *distance from upstream*, nothing else.

## What it checks

`scripts/update_pulse.py` — stdlib only, no model in the loop, no network beyond the GitHub
compare API.

For each watched source it calls `GET /repos/<owner>/<repo>/compare/<pin>...HEAD` and derives:

| Field | Meaning |
|---|---|
| `ahead_by` | commits upstream has that the pin doesn't |
| `files_changed` | files in the diff |
| `affected` | vendored skills whose `upstream_path` the diff actually touches |
| `local_divergence` | whether an affected skill carries recorded local work an overlay would destroy |
| `new_upstream_skills` | upstream `*/SKILL.md` dirs absent from the manifest and not in `deliberately_not_vendored` |
| `governed_key_hits` | patch hunks touching `hitl_gate` / `tools:` / `composes_with` / `dependencies` / `triggers` / `description` / `name` / `provenance` |

**The pin file is the state.** There is no separate watermark to drift out of sync with it:
`sources.<key>.commit` *is* the watermark, so a re-sync that updates the pin silences the finding
automatically, and a re-sync that forgets to update the pin keeps re-raising until it's fixed.

## The verdict rule — deterministic, never a judgment

A model deciding which updates are "worth" surfacing would control the gate's own scope. That is
the door ADR 0012 decision 4 closes (*"chosen by deterministic rotation, never by model
judgment"*) and ADR 0017 decision 3 restates. So the classifier is four predicates and nothing
else, in `classify_source()`:

| Predicate | Verdict |
|---|---|
| `ahead_by == 0` | `CURRENT` |
| any affected skill has `local_divergence` | **`RAISE`** — merge hazard by construction |
| upstream added a skill not in the manifest | **`RAISE`** — adopt/decline is a portfolio decision, not an update |
| diff touches a governed frontmatter key | **`RAISE`** — a portfolio invariant may move |
| body-only, no divergence, no new skills | `AUTO-STAGE` |

`RAISE` means a human reads it. `AUTO-STAGE` means the diff can be prepared without asking, but
**applying is still a human act** — nothing in this skill writes to the skill tree, ever.

The `new_upstream_skills` predicate is the one a plain SHA counter cannot express, and it fires in
practice: the first live run found `skills/knap` in `kepano/obsidian-skills` and six new skill dirs
in `ui-ux-pro-max-skill`.

## Excluded sources

Exclusions are **named in code** (`EXCLUSIONS` in the script) and **printed on every run**, so an
exclusion can never decay into a silent gap.

- **`example-frozen-source`** — frozen deliberately. Upstream didn't edit these skills, it *decomposed*
  them into router shims; most of those vendored here are now short `disable-model-invocation` stubs
  upstream. Overlaying would replace working skills with non-invocable stubs pointing at skills this
  vault doesn't have. This source is deliberately not re-synced, and a drift counter says nothing
  useful about that. The manifest's own `why_frozen` field is the authority.

## Workflow

1. **Detect.** `py scripts/update_pulse.py` (add `--no-clips` to look without writing, `--json` for
   machine output). Exit code = number of drifted sources.
2. **Read the clip.** One per drifted source, in `inbox/`, carrying the verdict, the affected
   skills table, and the recorded divergence flags.
3. **Stage (human-initiated).** `py scripts/update_pulse.py --stage <source>` shallow-clones
   upstream at HEAD and writes a `local -> upstream` diff per skill into
   `.scratch/update-pulse/<source>-<stamp>/`, plus a `*.DIVERGENCE.md` for every skill carrying
   recorded local work. **Staging never writes to `inbox/`** — the sweep would try to distill the
   diffs as captures and then delete them by inventory.
4. **Decide, by hand.** Apply what you want; re-apply every recorded divergence.
5. **Update the pin.** Set `sources.<key>.commit` to the new HEAD and `resynced` to today in
   `_vendored.json`. This is what closes the finding.
6. **Recompile and verify.** `sync my skills` (`skill-pipeline-sync`), which already runs
   `portfolio_check.py` as a non-fatal stage. **A re-sync that increases the portfolio_check
   category count is a failed integration** — treat the count as a ratchet, the same way
   `wikilint_gate.py` treats HARD wiki-lint categories.

## HITL gate

`hitl_gate: confirm` — detection is free, but staging and applying both need you. The skill
proposes and prepares; it never overlays, never edits a vendored skill, and never writes the pin.

`unattended: restricted` — the weekly routine runs step 1 only.

## Why this isn't part of skill-portfolio-review

Two reasons, both structural rather than stylistic:

1. **Different halves of the same discipline.** `skill-portfolio-review` is described in its own
   frontmatter as *"the wiki-lint analogue for skills"* — standing-stock hygiene over the
   portfolio's internal structure. This is inbound flow. The vault keeps that split sharp everywhere
   else (`wiki-lint` vs `distill`), and `wiki-lint` does not poll `distill`.
2. **A reviewer that runs later is not a gate.** Per
   *gate enforced in the writer*, the check belongs with the thing doing the writing.
   `portfolio_check.py` already runs inside `compile-skills.mjs`, which every re-sync must pass
   through anyway — so the integration check fires *by construction* at step 6, with no new wiring
   and no dependency on a weekly reviewer happening to run.

The relationship is therefore **update-pulse detects -> human decides -> pipeline-sync verifies**,
not *portfolio-review polls update-pulse*.

## Cost

**Cost Class: Light.** Four GitHub API calls per run (unauthenticated is fine at weekly cadence;
set `GITHUB_TOKEN` to raise the limit). No model tokens in the detection path at all.

## Composes with

- `skill-pipeline-sync` — recompiles after a re-sync and runs the portfolio check that verifies it.
- `skill-portfolio-review` — the standing-stock counterpart; consumes the *result* of an
  integration, never the feed.
- `distill` — picks the clips out of `inbox/` on the next sweep.
- `wiki-lint` — the same standing-stock/inbound-flow split, on the vault side.
