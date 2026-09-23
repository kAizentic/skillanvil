# 0018 — The chassis is one module, not six

- Status: **accepted — NOT YET IMPLEMENTED.** Decisions 1 and 2 have not been carried out; see the
  implementation-status note below, which also records one of this ADR's own measurements as
  falsified and its named open item as now green.
- Date: 2026-08-21
- Scope: `agent-os/lint-engine/` and the five standing-stock reviews.

> **IMPLEMENTATION STATUS — measured 2026-09-21, one month after acceptance.** This ADR is a live
> intention, not a cancelled one (unlike 0012–0017, which were priced out). But nothing has been
> built against it, and the tree has since moved in a way that changes one of its premises. Status
> corrected because `accepted` alone reads as *done* in a directory of accepted decisions.
>
> - **Decision 1 — not done.** `wiki_lint.py` and `portfolio_check.py` were to "both migrate onto"
>   `portfolio_lint.frontmatter`. Neither file contains the string `portfolio_lint` — **0
>   occurrences each**.
> - **Decision 2 — not done.** `fs`, `wikilink`, `finding`, `ack` and `report` were to retire. All
>   five are still on disk in `portfolio_lint/`, unchanged since 2026-07-20/07-27. No commit has
>   touched `agent-os/lint-engine/` since `a12b3729`, the commit that added this ADR.
> - **Decision 2's census is now FALSIFIED, and this is the load-bearing correction.** The
>   retirement rested on those surfaces having "one caller or zero" — the ADR states that
>   `portfolio_lint.report` and `finding` "have zero callers" and that "the reachable ceiling is two
>   callers." A third caller exists and is live:
>   `skill-portfolio-review/scripts/skill_usage_collect.py:395` does
>   `from portfolio_lint import Finding, Result, AckLedger, HARD, SOFT, fs, frontmatter, report`
>   — **five of the five surfaces marked for retirement, as a hard dependency** (the script refuses
>   to run if `lint-engine` is missing). That file appears nowhere in this ADR's five-instance
>   table. **Re-run the census before acting on decision 2**; retiring those modules today would
>   break a working collector that feeds `knowledge/feeds/skill-usage.md`.
> - **The named open item is now GREEN, and was never recorded as such.** This ADR asked that
>   `tests/test_equivalence.py` be "confirmed, not assumed" to exit 0 once its corpus was standing
>   stock only. Run 2026-09-21: **exit 0 — "No regressions. Engine is behaviour-compatible with both
>   legacy scripts."** The precondition decision 1 was gated on is therefore satisfied; only the
>   migration itself is outstanding.
- Supersedes the framing in `lint-engine/README.md` ("five instances share a chassis"),
  corrected in the same change.

## Context

`portfolio_lint` was factored out of working copies after the fifth standing-stock review existed —
correct sequencing, per the *generalize after the fifth instance, not by guessing the abstraction up
front* note. Its README describes six modules (`fs`, `frontmatter`, `wikilink`, `finding`, `ack`,
`report`, 514 lines) shared by five instances.

An architecture review on 2026-08-21 measured that description against the tree. Three claims in it
do not survive.

### 1. Three of the five instances cannot import it

The chassis is Python. The instances are not all Python:

| Instance | Implementation | Can import the chassis? |
|---|---|---|
| `wiki-lint` | `wiki_lint.py`, 650 lines | yes |
| `skill-portfolio-review` | `portfolio_check.py`, 554 lines | yes |
| `routine-health` | `routine-health.ps1`, 768 lines | **no — PowerShell** |
| `design-system-review` | `design-system-lint.mjs`, 508 lines | **no — JavaScript** |
| `feed-synthesis` | *no deterministic check exists* | **no — no code** |

The reachable ceiling is two callers, and it is a property of the language split, not of adoption
effort. No amount of widening the chassis changes it.

### 2. The duplication it was built to remove is 6 lines

The stated purpose is duplication reduction (confirmed 2026-08-21). Under that purpose, volume is the
right metric. Measured across the only two instances that could ever import it:

| Surface | Status |
|---|---|
| `read` | duplicated, 6 lines each, identical |
| `frontmatter` (as `frontmatter` / `split_fm`+`parse_fm`) | duplicated, ~45 lines total, **and the two implementations disagree** |
| `main` | same name, 366 vs 226 lines of *different* checks — not duplication |
| `all_md`, `strip_code`, `resolve_path`, `clean_target`, `rel`, `is_quarantined`, `days_since` | **`wiki_lint` only — one caller** |

104 lines of chassis serve exactly one adapter. One adapter is a hypothetical seam; two are a real
one. Absorbing ~200 lines into 514 is **net negative on the goal the chassis exists to serve.**

### 3. The language-agnostic seam already exists, and is live

`vault_health.py` already aggregates checks across process boundaries:

```python
def run_json(script, vault):
    out = subprocess.run([sys.executable, script, "--vault", vault, "--json"], ...)
    return json.loads(out.stdout or "{}")
wiki = run_json("wiki_lint.py", vault)
coup = run_json("page_skill_coupling_advisory.py", vault)
```

Two adapters, in production, importing nothing. **That is the real seam**, and it is reachable by
PowerShell and JavaScript instances at zero architectural cost — every check script already accepts
`--json`. `portfolio_lint.report` and `finding` have zero callers, and the contract works without
them.

## Decision

1. **`portfolio_lint.frontmatter` is the chassis.** It is the only surface where the same concept is
   implemented twice *and* the two implementations diverge — the divergence being the actual harm
   duplication causes, and the source of the two measured live defects (below). `wiki_lint.py` and
   `portfolio_check.py` both migrate onto it.
2. **`fs`, `wikilink`, `finding`, `ack`, `report` retire.** One caller or zero. Their logic stays in
   `wiki_lint.py`, where it already works and is already the exclusive user.
3. **The instance contract is the JSON emitted under `--json`, not a Python import.** Any language can
   satisfy it. This is a description of what already happens, promoted to a rule.
4. **Full adoption (all six modules, both instances) is rejected** and should not be re-proposed
   without new measurement. It is the option the README implies and the numbers contradict.

## Consequences

- The two live defects fixed are exactly two: *clock agnostic animation rig* and
  *yt faceless niches 2025 2026*, where `source:` is a block list, the naive parser returns
  `''`, and `wiki_lint`'s external-anchor check therefore reads a present field as missing.
- **The 417 "IMPROVED" cases in the differential test are not a benefit.** 414 are `tags` and 216
  `keywords` — fields no live check reads. Recorded here because the raw count is persuasive and
  wrong, and the next reader will find it before they find this line.
- **A previously-identified defect dissolves rather than being fixed.** `portfolio_lint.fs.all_md` is
  a bare `rglob("*.md")` and lacks the `GENERATED_DIRS = (".cache", "node_modules", ".git")` exclusion
  that `wiki_lint.all_md` carries — a 436-vs-248-file gap, 43% corpus inflation, on a corpus feeding
  universally-quantified checks. Under decision 2 there is no second walker to keep in sync, so the
  exclusion stays where it already works. **If `fs` is ever revived, this must be ported first** —
  `wiki_lint`'s own comment measured the harm (25 blocking findings that were really 7 defects plus 18
  snapshot echoes) and its docstring flags the `empty-set-passes-every-check` exposure.
- The differential test (`tests/test_equivalence.py`) currently exits 1 on a single regression, on a
  file inside `knowledge/.cache/`. That verdict is an artefact of the missing exclusion above, not
  evidence against the parser: the "lost keys" are prose bullets the *legacy* parser hallucinated as
  frontmatter. Once the test's corpus is standing stock only, it should exit 0 — **and that should be
  confirmed, not assumed**, before decision 1 is called done.
- `feed-synthesis` is listed as an instance of a deterministic-check family while having no
  deterministic check. Left open, named here so it stops reading as an oversight.

## Amendment, 2026-09-22 — decision 2 has a caller the census missed

**Status: DECIDED 2026-09-22 — the operator chose option 1c. See the resolution at the end of this file.**

This ADR's census says the reachable ceiling is two callers (`wiki_lint.py`, `portfolio_check.py`)
and that `fs`, `wikilink`, `finding`, `ack` and `report` have "one caller or zero." Re-measured
independently on 2026-09-22 during an architecture review:

- `wiki_lint.py` and `portfolio_check.py` still import the chassis **0 times each** — decision 1 is
  unimplemented, a month on. That part of the ADR holds exactly as written.
- But there is a **third caller the ADR does not name**:
  `agent-os/Skills/Automation/skill-portfolio-review/scripts/skill_usage_collect.py:499` does
  `from portfolio_lint import Finding, Result, AckLedger, HARD, SOFT, fs, frontmatter, report`.
  It is a hard dependency — the script refuses to run without it — and it imports **five of the six
  modules decision 2 retires**, not `frontmatter` alone.
  (The only other repo-wide hit, `graphify/scripts/query_layer_check.py:60,74,83`, is the literal
  string `"portfolio_lint chassis"` in a graph-query test fixture. Not an import.)

**So executing decision 2 as written would break the chassis's only real adapter.** That is a
correction to a *fact* the decision rests on, not a re-litigation of its reasoning — and this ADR's
own decision 4 sets "new measurement" as the condition for reopening.

**What does not change.** The conclusion that this is a hypothetical seam still holds, and if
anything holds harder: delete `lint-engine/` today and complexity reappears in exactly **N=1**
caller. By this ADR's own rule — one adapter is a hypothetical seam, two are a real one — the seam
has not been earned. The disagreement is only about *which* modules have a caller.

**The fork, for the operator:**

1. **Scope the chassis to its real caller.** Keep what `skill_usage_collect.py` actually imports,
   inline or drop the rest. Honest about current usage; leaves `frontmatter` still un-adopted by the
   two instances decision 1 names, so the divergence that produced the two live defects stays open.
2. **Treat `skill_usage_collect.py` as the reference adapter and migrate a second real consumer.**
   Makes the seam real by this ADR's own test, at the cost of migration work the last month suggests
   does not happen on its own.

**Do not execute decision 2 in its current form either way** — it was written against a caller count
of zero for five modules, and that count is wrong.

**Related, still true and still unfixed.** `portfolio_lint.fs.all_md` remains a bare `rglob` with no
`GENERATED_DIRS` exclusion, exactly as the Consequences section warns. The same defect was found live
on 2026-09-22 in `wiki-lint/scripts/cluster_audit.py`, which this ADR did not examine because it
looked only at the chassis and not at wiki-lint's own siblings. There it was not merely inflation:
`knowledge/.cache/mutation-snapshots/` holds 204 full copies of real wiki pages, so every page had an
inbound link from a non-router page and `router_only` collapsed to **0** — the cluster audit had been
reporting nothing at all, which reads identically to "no reorganization candidates"
(*empty set passes every check*). Fixed the same day by importing `wiki_lint`'s walk;
the chassis copy is still unported.

## Alternatives rejected

- **Full adoption.** Rejected on measurement — see decision 4.
- **Contract-only (nothing imports the chassis; fix the two defects directly in `wiki_lint.py`).**
  Close call, and defensible. Rejected because the two parsers would remain free to re-diverge, which
  is the failure mode that produced the defects in the first place.
- **Delete `portfolio_lint` entirely.** Rejected for the same reason: it would leave two divergent
  frontmatter parsers with nothing holding them together.
- **Port the chassis to PowerShell and JavaScript.** Not seriously considered. It would triple the
  surface to eliminate 6 lines of duplication, and the JSON contract already solves the problem the
  port would be attempting.


## Resolution, 2026-09-22 — option 1c, executed

The operator ruled on the fork: **scope it to the real caller by deleting the chassis framing
entirely**, rather than migrating a second consumer (1b) or keeping a half-used package (1a).

**What was done.**
- `agent-os/lint-engine/` is gone. `portfolio_lint` now lives at
  `Skills/Automation/skill-portfolio-review/scripts/portfolio_lint/`, beside the one production
  script that ever imported it, and its docstring names it that script's support code.
- `wikilink.py` deleted — 0 production callers. `wiki_lint.py` carries its own resolver, already
  fixed for non-.md targets and covered by its own `tests/test_nonmd_link_targets.py`. The
  engine's copy was the unfixed fork.
- **The bootstrap disappeared, which was the point.** `skill_usage_collect.py` used to
  reimplement `fs.find_vault_root` inline — same ancestor walk, same predicate — ten lines
  before `from portfolio_lint import fs`, because it had to find the vault in order to find the
  chassis. That was the sharpest evidence the seam was not earned, and a sibling package makes it
  unrepresentable. The fail-closed GUARD it contained is kept: an unresolved root still refuses
  with exit 2 rather than scanning nothing and reporting clean.

**Two defects fixed rather than carried forward or deleted with it.**
- `fs.all_md` was a bare `rglob` with no `GENERATED_DIRS` exclusion, for a month, while
  `wiki_lint.py:293` — the script it was generalized FROM — already had one. Measured on the real
  vault: **520 -> 309 files** under `knowledge`, i.e. 211 `.cache/mutation-snapshots/` copies were
  being counted. The Consequences section warned about exactly this; the same defect had already
  inverted `cluster_audit.py`'s `router_only` to 0. The fixed walker now agrees file-for-file with
  `wiki_lint`'s own walk, which is an independent implementation.
- `test_equivalence.py` was a pure differential — every branch `if old == new` — so a defect
  present in both implementations was invisible by construction. That is not hypothetical: the
  `.html`-resolution bug shipped THROUGH a green "0 regressions" run. It gained an **oracle half**:
  9 cases with hand-authored expected values, each stated in both polarities. One of them failed on
  first run and the CODE was right (`tags:` with no inline value seeds a block list, which is the
  precise divergence the module existed to fix); the case was sharpened rather than weakened, and
  that is recorded in the file, because editing expectations until they match turns an oracle back
  into a differential.

**What this decision explicitly accepts.** `wiki_lint.py` and `portfolio_check.py` still have two
frontmatter parsers of unequal strength, so vault pages are schema-checked more loosely than skills
are. That divergence was the whole reason for the extraction and it remains open. 1c trades it for
not maintaining an unearned seam; `test_equivalence.py` is what keeps it measured instead of
invisible. If it ever produces a real regression, that is the signal to revisit 1b.

**Decision 3 is separately corrected** — see CONTEXT.md, "Instance contract". Its premise that
"every check script already accepts `--json`" was true of 3 of 5 at promotion, not 5 of 5.
