# portfolio_lint — the standing-stock review chassis

> **Resolved 2026-09-22 (ADR 0018, option 1c): this is no longer a chassis.** A re-measured census
> found a third caller the ADR had missed, a usage collector that imports five of the six modules
> the ADR had marked for retirement. So the plan below ("`frontmatter` is the chassis, the rest
> retire") was reversed. The package is now the support library of that one production script, and
> it lives beside it in the source tree; this directory keeps the published copy. `wikilink` was
> deleted (zero production callers, and it was the unfixed fork of a resolver that is fixed
> elsewhere). `fs.all_md` now excludes generated trees; without that, 40% of the walked corpus
> was cached duplicates and a derived check inverted to zero. Everything below is kept as the
> record of how the decision was reached. Read [ADR 0018](../docs/adr/0018-the-chassis-is-one-module-not-six.md)
> for the resolution.

Five reviews in this vault are the same architecture with different nouns — but
they are **not** all the same language, which bounds what a shared package can be:

| Instance | Standing stock | Cadence | Implementation | Can import this? |
|---|---|---|---|---|
| `wiki-lint` | vault pages | nightly (sweep tail) | `wiki_lint.py` (650) | yes |
| `skill-portfolio-review` | skills | monthly | `portfolio_check.py` (554) | yes |
| `routine-health` | scheduled tasks | daily 10am | `routine-health.ps1` (768) | **no — PowerShell** |
| `design-system-review` | parts-bin triangle | nightly + monthly | `design-system-lint.mjs` (508) | **no — JavaScript** |
| `feed-synthesis` | feed corpus + ledgers | weekly | *none exists* | **no — no code** |

Each was hand-rolled. This package was factored **from working copies** (per the
standing-stock-portfolio-review-pattern note: generalize after the fifth instance,
not by guessing the abstraction up front) — sound sequencing, but it produced a
package whose reachable ceiling is **two callers**, a property of the language
split that no amount of adoption effort changes.

> **Corrected 2026-08-21 (ADR 0018).** An earlier version of this file said "this
> package is the chassis they share," across all five. That was never achievable.
> The real cross-instance seam is the **instance contract** — the JSON emitted under
> `--json` — which `vault_health.py` already consumes over a subprocess boundary,
> from two adapters, importing nothing. Any language satisfies it.

## What the chassis owns

| Module | Responsibility | Planned 2026-08-21 | Resolved 2026-09-22 |
|---|---|---|---|
| `frontmatter` | one parser — scalars, inline lists, block lists, comments, quotes | kept — the chassis | **kept** |
| `fs` | read (BOM-tolerant) · walk · vault-relative paths · **fail-closed root discovery** | retire | **kept**, walker now excludes generated trees |
| `wikilink` | extraction (code-stripped) · resolution with the no-basename-fallback-for-slashed-paths rule | retire | **deleted** (unfixed fork, 0 production callers) |
| `finding` | `Finding` / `Result` · hard-vs-soft severity · the categories-fired exit code | retire — "zero callers" | **kept** (the census missed a caller) |
| `ack` | the settled-judgment ledger, **as data**, with stale-ACK detection | retire — "zero callers" | **kept** |
| `report` | the JSON contract `vault_health.py` already consumes, as a superset | retire | **kept** |

## What it deliberately does not own

The checks, the smell heuristics, and the routing target. That's the actual
domain knowledge, and it belongs in each review. An engine that tried to own
"what counts as an orphan" would need a config language per instance and would
be harder to read than the five copies it replaced.

## The instance contract

An instance provides:

1. **Units** — what the standing stock is, and how to enumerate it.
2. **Checks** — functions that take the enumerated units and yield `Finding`s.
   Set `severity=HARD` only for referential integrity (something points at
   nothing). Everything judgment-shaped is `SOFT`.
3. **An ACK file** — `acks.json` next to the instance.
4. **A route target** — the builder skill named in `Finding.route_to`.
5. **Smell heuristics** — prose, in the SKILL.md. Not code.

```python
from portfolio_lint import Finding, Result, AckLedger, HARD, SOFT, fs, report

def run(vault):
    result = Result(instance="my-review")
    units = enumerate_units(vault)
    result.scanned = len(units)
    for u in units:
        if is_dangling(u):
            result.add(Finding(category="dangling_ref", subject=u.id,
                               message="declared dependency does not exist",
                               severity=HARD, route_to="skill-builder"))
    ledger = AckLedger.load(vault / ".../acks.json")
    seen = {f.key() for f in result.findings}
    ledger.apply(result)
    report.emit_json(result, stale_acks=ledger.stale(seen))
    return result.exit_code()
```

## Two rules that are not negotiable

**Fail closed on root discovery.** Use `fs.require_vault_root()`, not
`find_vault_root()`, unless you genuinely handle `None`. An unresolved root makes
a check scan the wrong tree, find nothing, and exit 0 — a clean bill of health
from a review that examined nothing. That is the
`fail-closed-guard-silent-degradation` shape, and `portfolio_check.py`'s
docstring records it happening for real.

**The JSON report is a superset, never a replacement.** `vault_health.py` reads
flat `{category: [items]}` keys by name. `report.emit_json` keeps those keys and
adds the structured `findings` array alongside. A cutover that breaks the
nightly scorecard is not a cutover anyone will accept.

## Adoption status — narrowed to one module (ADR 0018)

**Measured 2026-08-21, the duplication this package exists to remove is 6 lines.**
Across the only two instances that could ever import it:

| Surface | Status |
|---|---|
| `read` | duplicated, 6 lines each, identical |
| `frontmatter` (as `frontmatter` / `split_fm`+`parse_fm`) | duplicated, ~45 lines, **and the two disagree** |
| `main` | same name, 366 vs 226 lines of *different* checks — not duplication |
| `all_md`, `strip_code`, `resolve_path`, `clean_target`, `rel`, `is_quarantined`, `days_since` | **`wiki_lint` only — one caller** |

104 lines of this package serve exactly one adapter. One adapter is a hypothetical
seam; two are a real one. Absorbing ~200 lines into 514 is net negative on the goal.

**The decision:** `frontmatter` is the chassis — the only surface where one concept
has two implementations *and* they diverge, which is the harm duplication actually
causes. `fs`, `wikilink`, `finding`, `ack` and `report` retire; their logic stays in
`wiki_lint.py`, their exclusive user. Full adoption is rejected and should not be
re-proposed without new measurement.

`tests/test_equivalence.py` diffs engine against the live scripts across the vault.
Run it before and after any change here; exit code = regression count. Current:

```
frontmatter   improved=417  regression=1
```

⚠️ **Read that verdict carefully — it is not what it looks like.** The single
regression is on a file inside `knowledge/.cache/`, and the "lost keys" are prose
bullets the *legacy* parser hallucinated as frontmatter; the engine is correct and
scores as a loss. The cause is that `fs.all_md` is a bare `rglob("*.md")` while
`wiki_lint.all_md` excludes `GENERATED_DIRS` — 436 files vs 248, **43% corpus
inflation.** Under the decision above `fs` retires, so there is no second walker to
keep in sync; **if `fs` is ever revived, port that exclusion first.**

⚠️ **And the 417 is not a benefit.** 414 are `tags`, 216 `keywords` — fields no live
check reads. The real defects fixed are **two**: *clock agnostic animation rig*
and *yt faceless niches 2025 2026*, where `source:` is a block list, the
naive parser returns `''`, and the external-anchor check reads a present field as
missing. The raw counts are persuasive and misleading; this note exists because the
next reader will meet them first.

Porting an instance is a change to load-bearing code (`wiki-lint` runs nightly and
backs a pre-commit hook; the compiler invokes two of `skill-portfolio-review`'s
scripts as pipeline stages), so it goes through the grill gate the pattern already
mandates — one instance at a time, differential test green each time.

## Two real bugs the differential test found

Both were invisible to eyeball review and are fixed in the engine. Neither is
fixed in the legacy scripts, which still carry them.

**1. Frontmatter keys with spaces were silently dropped.** The hardened parser's
`^([A-Za-z0-9_]+):` was safe only for `SKILL.md`, where keys are identifiers. The
vault's feed **state** files use `last run:`, `last checked:`, `last reconciled:`.
Any check reading those keys off `knowledge/feeds/intent-scout.md` would have found
nothing and reported clean — and "when did this feeder last run" is exactly the
staleness question a feeder-liveness check exists to ask. Widened to
`[A-Za-z0-9_][A-Za-z0-9_ -]*`.

**2. Hyphenated keys were dropped from skill specs.** The same regex silently
ignored `disable-model-invocation` on `grill-me`, `zoom-out`, and
`setup-matt-pocock-skills`. `portfolio_check.py` has never been able to see that
field, so no check could ever assert anything about it.

Both share a shape worth naming: **a parser that drops what it doesn't recognize
makes every downstream check look clean.** The check still runs, still exits 0,
and has quietly lost its discrimination.
