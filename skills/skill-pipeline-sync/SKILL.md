---
id: skill-pipeline-sync
name: Skill Pipeline Sync
provenance: authored
slug: skill-pipeline-sync
description: Compile the Obsidian vault's authoritative skill specs into runtime artifacts under ~/.claude/skills. Use when the user says "sync my skills", "compile my skills", "rebuild the skills", "regenerate ~/.claude/skills from the vault", or after editing any skill spec in "agent-os/Skills". Validates, compiles idempotently, and regenerates the relationship graph and the skills glossary.
version: 1.0.1
category: Automation
status: active
hitl_gate: grill
unattended: restricted
unattended_note: "`compile` (and the validate/graph/glossary stages of `all`) runs unattended — local, idempotent, and validate-gated, so a broken spec simply doesn't compile. `cowork --push` is WITHHELD from the on-change watcher: it is a git commit to a remote, and stays on the nightly Skills-to-Cowork task where it is the only outward-facing step."
tags: [pipeline, skills, compiler, vault, automation]
inputs:
  - skill specs under "agent-os/Skills/<Category>/<id>/SKILL.md"
outputs:
  - runtime skills in ~/.claude/skills/<slug>/ (SKILL.md, metadata.json, examples/, templates/)
  - validation-report.md
  - Skill Relationships.md
  - ~/.claude/skills/GLOSSARY.md (human-facing catalogue; curated prose preserved)
  - (optional) mirrored skills in the Cowork marketplace plugin (via `cowork`)
tools: [Bash, Read, cli:node]
triggers:
  - sync my skills
  - compile my skills
  - rebuild the skills
dependencies: []
composes_with:
  - skill-builder
  - capture
aliases:
  - skill compile
  - skill sync
owner: the operator
last_updated: 2026-08-19
---

# Skill Pipeline Sync

> Turns the vault (source of truth) into executable skills, safely and idempotently.

## Purpose
The vault is authoritative; `~/.claude/skills` is generated. This skill runs the
compiler so edits to a spec become a live skill without hand-editing the runtime.

## When to use
- Right after creating or editing any skill under `agent-os/Skills/`.
- When `~/.claude/skills` looks stale or out of sync with the vault.

## When NOT to use
- To *author* a new skill from raw material — that's ``skill-builder``. Run this
  *after* the spec exists.

## Inputs
- Skill specs: `agent-os/Skills/<Category>/<id>/SKILL.md` with valid frontmatter.

## Outputs
- `~/.claude/skills/<slug>/` (SKILL.md + metadata.json + assets)
- `agent-os/Skills/validation-report.md`
- `agent-os/Skill Relationships.md`
- `~/.claude/skills/GLOSSARY.md` — human-facing catalogue of every runtime skill
- `~/.claude/skills/.vault-root` — the vault's absolute path, so a compiled skill can
  find its own **source** (see below)

## Source resolution (`.vault-root`)
The runtime is generated and is **not a git repo**, so a script inside a compiled skill
can't answer "where do I edit this?" or "has my source been committed?" on its own.
`compile` stamps the missing half:

```
sourceDir = join(read("~/.claude/skills/.vault-root"), "agent-os", metadata.source)
```

`metadata.json` already carries the vault-**relative** `source` (e.g.
`Skills/Coding/site-harvest`); `.vault-root` supplies the root. Idempotent — rewritten
only when the vault actually moves.

**Why a root dotfile and not an absolute path per `metadata.json`:** `cowork` mirrors every
skill **directory** into a marketplace git repo, so a per-skill absolute path would publish
the local vault layout (username included) once per skill. `runtimeSkillNames()` filters
`isDirectory()`, so a root-level dotfile is excluded from that mirror by construction.
One file, no leak. (Added 2026-07-16, after site-harvest's Stop hook was found asking git
about the *runtime* dir — a query that always threw, so its success branch was dead code.)

## Glossary (`glossary`)
`all` ends by regenerating `~/.claude/skills/GLOSSARY.md` — a Purpose / Function /
Value catalogue of **every runtime skill** (vault-compiled + hand-made + vendored),
read from the freshly-synced runtime dir so it reflects what's actually invokable.

```bash
node "agent-os/compiler/compile-skills.mjs" glossary   # regenerate the glossary alone
```

- **Curation is preserved.** Hand-written Purpose/Function/Value prose in the
  existing glossary is parsed out and re-emitted verbatim. The stage only maintains
  the *roster*: skills that disappear are dropped; skills newly present in the
  runtime are appended under **"Recently added — uncategorized"** as
  description-seeded stubs to enrich and file. It never fabricates prose.
- The **Appendix** (built-in / plugin skills that don't live under `~/.claude/skills`)
  is passed through untouched — edit it by hand.
- Idempotent (same-day re-runs are byte-identical). Runs in `all` and `watch`.

## Required context
- Node.js on PATH. The compiler is zero-dependency.

## Workflow
1. From the vault root, run the full pipeline:
   ```bash
   node "agent-os/compiler/compile-skills.mjs" all
   ```
2. If validation reports errors, fix the offending spec and re-run — compile is
   skipped while errors exist.
3. For a no-write preview: append `--dry-run`.
4. For hands-off syncing, `watch` now runs **as a registered task** — see below.

## On-change compile (`Second Brain - Skill Watch`)
As of 2026-07-28 `compile-skills.mjs watch` runs continuously as an AtLogon Windows
task (`compiler/watch-skills.vbs` → `watch-skills.cmd`), so **editing a spec publishes
it within seconds — no hand-run needed.** This exists because usage telemetry showed
this skill was the portfolio's #1 purely-manual workflow (18 interactive runs, zero
scheduled, spread across the whole day): the pipeline was already automated nightly by
*Skills to Cowork*, so every one of those runs was the operator buying **latency**, not
automation.

What the watcher does and doesn't do (ADR 0010, `unattended: restricted`):

| Stage | On the watcher | Why |
|---|---|---|
| `validate` → `compile` → `graph` → `glossary` | ✅ | Local, idempotent, and validate **gates** compile — a broken spec doesn't publish, it just logs the error. |
| `cowork --push` | ❌ **withheld** | A git commit to a remote. Outward-facing steps don't belong on a file-save trigger; it stays on the nightly task. |

- Log: `~/.claude/skill-watch-run.log` (truncated each logon).
- **Healthy = a live `node … watch` process**, not task `State = Running` — the VBS shim
  returns immediately. `routine-health.ps1` probes the process and inverts the verdict, so
  a *stopped* watcher raises RISK. Without that inversion a dead watcher and a healthy one
  look identical, and spec edits would silently stop publishing.
- Still safe to run this skill by hand — compile is idempotent, so a manual run over an
  already-watched tree is a no-op.

## Cowork marketplace sync (`cowork`)
The vault → `~/.claude/skills` pipeline only feeds **Claude Code**. Cowork loads
skills from installed **plugins** (a marketplace = a git repo), never from
`~/.claude/skills`. The `cowork` target closes that gap: it mirrors the compiled
runtime skills into a plugin's `skills/` dir inside the marketplace repo.

```bash
node "agent-os/compiler/compile-skills.mjs" cowork          # mirror files only
node "agent-os/compiler/compile-skills.mjs" cowork --push   # mirror + git commit & push
```

- **Target** comes from `agent-os/compiler/cowork-sync.json`
  (`marketplace_dir`, `plugin`, optional `git_user`/`git_email`), overridable by the
  `COWORK_MARKETPLACE_DIR` env var. It no-ops with a hint if unset, and refuses any
  dir that is not a real marketplace repo (`.claude-plugin/marketplace.json`).
- **Full pipeline → Cowork** (the routine): `… all` then `… cowork --push`. After a
  push, click **Update** on the marketplace in Cowork (Customize → Plugins).
- Mirrors **every** runtime skill (pipeline- and hand-made), skipping dotfiles.

**Automate it** — a Windows Scheduled Task alongside the other routines, e.g.:
```powershell
schtasks /Create /TN "Second Brain - Skills to Cowork" /SC DAILY /ST 05:15 /TR ^
  "node \"<VAULT_ROOT>\agent-os\compiler\compile-skills.mjs\" all && node \"...\compile-skills.mjs\" cowork --push"
```
Register only **after** the marketplace repo has a private remote (else the push
step warns and no-ops).

## Examples
See `examples/run-log.md` for an annotated successful run.

## Failure modes
- "Duplicate slug" → two skills resolve to the same runtime folder; set a unique
  `id`/`slug`.
- Hand-made runtime skills are never deleted — only pipeline-generated ones (those
  carrying `generated_by: vault-skill-pipeline`) are cleaned up.

## Optimization opportunities
- Add a pre-commit git hook that runs `validate` to keep main always-compilable.

## Dependencies
- None.

## Related skills
- `skill-builder` — authors the spec this skill compiles.
- `capture` — log pipeline learnings back into the vault.
