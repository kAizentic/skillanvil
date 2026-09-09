# skillanvil

A build-and-governance toolchain for agent skills: a compiler that turns a versioned source tree
of agent skills into a runtime, a deterministic lint engine that gates what ships, a set of
enforcement hooks that make rules executable rather than advisory, and the architecture decision
records behind all of it.

> Formerly published as `agent-os`. Renamed 2026-09-09 — the old name claimed an architecture this
> project does not have, and collided with five live products. The reasoning is
> [ADR 0019](docs/adr/0019-the-name-is-not-an-operating-system.md).

This is a **published slice**, not the whole system. It contains the engine and the governance
layer. It deliberately does not contain the knowledge base the system operates on, the skills
that are coupled to it, or vendored third-party skills that aren't mine to redistribute.

## Why this exists

Most "agent skill" setups are a folder of prompts. This one is built like software: a single
source of truth, a compile step, a schema enforced by a validator, tests, and written decision
records for the parts that were hard. The interesting problems turned out not to be prompting
problems — they were build, governance, and measurement problems.

## What's here

| Path | What it is |
|---|---|
| `docs/adr/` | 17 architecture decision records — the reasoning, including what was tried and refuted. |
| `docs/skill-schema.md` | The frontmatter contract every skill is validated against. |
| `docs/routines.md` | How scheduled, unattended agent routines are defined and governed. |
| `compiler/` | Compiles the skill source tree to a runtime; a publish-integrity checker; a resource/MCP topology map builder. |
| `lint-engine/` | `portfolio_lint` — deterministic structural checks over a linked markdown corpus (frontmatter schema, link resolution, orphan detection). |
| `hooks/` | 17 runtime enforcement hooks — pre-tool guards, background-process registration and reaping, context pressure, error reflexes. |
| `skills/` | 8 authored skills, included as worked examples of the schema. |

## The idea the whole thing rests on

**A rule written in prose is a request. A rule enforced by a hook is a constraint.**

The system accumulated written rules faster than it followed them. The fix was to stop writing
rules and start compiling them: every rule that mattered got demoted to prose *or* promoted to an
executable gate. `hooks/herestring-guard.mjs` is the clearest case — a documented rule that was
violated four times as prose, then zero times across 276 subsequent operations once it became a
hook. `hooks/shell-edit-guard.mjs` and `hooks/inbox-glob-delete-guard.mjs` are the same pattern,
each with its own test suite.

The ADRs numbered 0009 and up are mostly about a harder version of the same question: how do you
tell whether a change to an agent system actually improved it? They cover shadow ablation and
sealed audits (0012), randomised promotion with a behavioural metric (0013–0014), variance
reduction and sequential allocation (0015), and why a redundancy cluster — not a single item — is
the correct unit of ablation on a densely linked corpus (0017).

## Running the tests

```bash
node hooks/shell-edit-guard.test.mjs
node hooks/inbox-glob-delete-guard.test.mjs
node hooks/bg-launch-guard.test.mjs
py  lint-engine/tests/test_wikilink_nonmd.py
```

All four are self-contained: the node guards assert against synthetic command strings, and the
lint test builds a corpus in a temporary directory. Exit code 0 is pass.

## What was removed before publishing, and why

Stated plainly so the gaps read as decisions rather than omissions:

- **Vendored skills.** 37 of the 83 skills in the source tree come from upstream repositories
  (including 16 from Anthropic's skills repo under proprietary terms). Not mine to republish.
- **All `examples/` directories.** By convention this system's examples are captured from real
  runs, which means they contain real client and meeting content.
- **Vault-coupled skills.** Skills whose logic is inseparable from the private knowledge base
  they operate on.
- **Telemetry, probes, and run logs.** Real operational data.
- **One ADR and two skills** withheld as commercially sensitive.
- **One test** (`test_equivalence.py`) that differentially compares the lint engine against the
  live corpus. It cannot run without that corpus, so shipping it would have shipped a test that
  can never pass.

Paths and identifiers throughout have been genericized; a private vault root appears as
`<VAULT_ROOT>`.

## License

Source-available, not open source. See [LICENSE](LICENSE). You may read, study, and evaluate
this code. You may not redistribute it or use it commercially without permission.
