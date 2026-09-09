# 0019 — The name is not an operating system

- Status: accepted — renamed to **`skillanvil`** (2026-09-09)
- Date: 2026-09-08; name chosen 2026-09-09
- Scope: the repository name, and the README's opening positioning line.
- Supersedes: the naming implied by the initial publish (2026-09-01), which shipped without a
  pre-flight collision or clarity check.

## Context

This repository was published on 2026-09-01 as `agent-os`, described as "the architecture layer of a
personal agent operating system." The name was chosen before the check that should have preceded it.
Three findings, gathered 2026-09-08, each independently sufficient to change it.

### 1. The README fails the discriminating test for the term it claims

"Agent OS" is in active use for at least nine unrelated things: an LLM-as-kernel metaphor, an academic
research kernel, a memory-virtualization layer, a commercial platform-branding label, an
incumbent-OS agentic feature, an agent that operates a computer, a sandbox/execution runtime shipped
as a library, a cloud AI-native desktop, and a dev-workflow scaffolding system.

The standard discriminator across that taxonomy is: **name the resource this OS schedules,
virtualizes, or isolates.** A real OS schedules CPU, virtualizes memory, isolates processes.

This README's own opening does not name one:

> The architecture layer of a personal agent operating system: a compiler that turns a versioned
> source tree of agent skills into a runtime, a deterministic lint engine that gates what ships, a
> set of enforcement hooks that make rules executable rather than advisory, and the architecture
> decision records behind all of it.

What is managed here is skills, rules, and validation gates. Not computational resources. Under the
taxonomy that places this project in the fourth sense — commercial platform-branding label — which is
precisely the sense that usually names no resource. The name makes a claim the architecture does not
support, and a reader cannot tell which of nine meanings is intended without reading further. That is
a clarity cost paid by every reader, forever, to buy nothing.

### 2. The name is crowded with live products

Measured 2026-09-08 via the GitHub Search API, the npm registry, and the PyPI JSON API:

| Claimant | Evidence |
|---|---|
| Agno | `agno-agi/agno`, 42,103 stars, pushed same day; ships a product branded **AgentOS** ("the FastAPI for agents") |
| Rivet | `rivet-dev/agentos`, 4,611 stars, pushed 2026-09-07, actively maintained |
| Builder Methods | `buildermethods/agent-os`, 5,385 stars, MIT — spec-driven dev workflow |
| AG2 / AutoGen | ships a product branded AgentOS |
| Infobip | ships a product branded AgentOS |

A new entrant collides with Agno's *product brand* before reaching any name-matched repository.

Two details worth recording because they generalise:

- A full-repo grep of `buildermethods/agent-os` finds **zero occurrences of "operating system."** The
  best-known project with this name makes no architectural claim behind it either. The name is doing
  no work there, and would do none here.
- There is prior art on the exact string: Larry T. Chen, *"AgentOS: The Agent-based Distributed
  Operating System for Mobile Networks,"* ACM XRDS, November 1998 — a mobile-agent-code OS from the
  Telescript/Aglets lineage, unrelated to language models.

Legally the position is open: no blocking registered or pending US software-class mark on the bare
string was found, and the one live "AGENT OS" registration is Class 035 (business consultancy). The
problem is not legal. It is that the name means nine things and is already taken by five products.

### 3. The vendors with the strongest claim to the label decline it

- **Anthropic** describes its Agent SDK as a **"harness,"** MCP's maintainers call the protocol a
  **"substrate,"** and an engineering post that explicitly reasons through the OS-virtualization
  analogy still self-labels the product a **"meta-harness."**
- **OpenAI's** official documentation says **"unified agentic platform."** The OS framing is personal
  and conceded to be unbuilt.
- **Google** gets closest, and it is still an analogy rather than a name: **"the Android of the
  agentic era."**
- **Letta**, which originated the term (the 2023 MemGPT paper, *"Towards LLMs as Operating
  Systems"*), has **removed it from live go-to-market copy** entirely.

Meanwhile the actual category leaders in this repo's own niche — `spec-kit` (134,147 stars) and
`BMAD-METHOD` (52,797) — do not use "OS" at all, and dwarf the ones that do by 10–25×.

In this market the OS label correlates with *smaller*, not larger. It reads as marketing, not
architecture. That is the opposite of what this repository is trying to demonstrate.

## Decision

**Rename, and replace the OS claim with an accurate description of what this is.**

The governing principle, and the reason this is not simply a branding preference: architecture
language belongs in the engine room, and outcome language belongs in the storefront. A public
repository containing a compiler and a lint engine **is** the engine room — so engine-room language is
correct here. The error was not using architecture language. It was using *inflated* architecture
language when accurate architecture language was available and stronger.

What this actually is: **a build-and-governance toolchain for agent skills** — a compiler, a
deterministic lint gate, and enforcement hooks.

**Lead with the compiler.** It is the distinctive true claim, it is defensible without qualification,
and it is the least contested part of the name space. Lint-forward names are crowded (`AgentLinter`,
`agentlint`, `agent-config-linter`, `claude-md-lint` all exist).

Candidates, collision-checked 2026-09-08:

| Candidate | Status |
|---|---|
| **`skillanvil`** | **CHOSEN** — npm free, PyPI free, one unrelated 1-star repo |
| `skillyard` | npm free, PyPI free, all three domains unregistered, 7 GitHub matches all functionally unrelated |
| `skill-toolchain` | clean everywhere; descriptive rather than distinctive — zero-risk fallback |
| `skillc`, `skillforge`, `skillsmith`, `skillgate`, `skillkit`, `ratchet` | rejected: live same-purpose projects, several with hundreds to 1,500+ stars |

**`skillanvil` chosen 2026-09-09**, on the metaphor: an anvil is where raw material is forged into a
shaped artifact, which is what a compiler does. The name leads with the compiler — the distinctive
true claim, and the least contested part of the name space — rather than with the lint gate, where
`AgentLinter`, `agentlint`, `agent-config-linter` and `claude-md-lint` already sit.

Availability re-verified live on 2026-09-09 immediately before the rename, not carried over from the
previous day's check:

| Surface | Result |
|---|---|
| npm `skillanvil` | HTTP 404 — free |
| PyPI `skillanvil` | HTTP 404 — free |
| GitHub exact-name search | **1** result: `LioraRndr/SkillAnvil`, 1 star — a desktop tray launcher for managing Claude Code / Codex sessions |

The single GitHub match is name-shell noise under this ADR's own reading discipline: same word,
different job. A tray launcher is not a compiler, a lint gate, or an enforcement layer, so there is
no functional collision.

**`skillanvil.com` is taken** — resolved 2026-09-09 to a live site (HTTP 200,
`https://skillanvil.com/en/home`), apparently an unrelated multilingual product. `skillanvil.dev` and
`skillanvil.io` return no live site. The `.dev` is the intended home. This is an accepted cost, not
an oversight: for a source-available toolchain the repository is the address, and losing a `.com` to
an unrelated product is a brand inconvenience, where losing the package registries to a same-function
project would be disqualifying.

*Recorded because it corrects this ADR's own first draft, which reported the `.com` as "ambiguous,
flagged for manual check" and still ranked the name on that basis.* The domain method — inferring
availability from HTTP response codes — was the weakest link in the check and it produced the one
wrong call. A redirect is a live site.

### `skill-harness` — evaluated 2026-09-09 and rejected

Considered as a replacement once the `.com` finding landed, and rejected on measurement:

| Surface | Result |
|---|---|
| npm `skill-harness` | **200 — taken** |
| PyPI `skill-harness` | **200 — taken** |
| `45ck/skill-harness` | 15 stars — *"Umbrella installer and agent harness for the skill-pack suite across Claude and Codex"* — exact name **and** exact function |
| GitHub name matches | 364, with a dense functional neighbourhood (`skill-eval-harness` 73★, `agentic-harness-patterns-skill` 302★, `cc-harness-skills` 233★) |
| `harness/harness-skills` | 105 stars — the `harness` org is **Harness Inc.** (harness.io), a CI/CD platform, now shipping agent skills |

The last row is the disqualifier: it places the name adjacent to an established company in the same
software class. Worth recording *why* the instinct was good and the name still unusable — **"harness"
is the platform vendor's own word for this layer** (Anthropic's Agent SDK is a "harness"; its
Managed Agents post self-labels a "meta-harness"), which is precisely why it is crowded. **A term is
contested in proportion to how apt it is.** The vendor's vocabulary is the most competitive namespace
available, because everyone building on the platform reaches for it first.

### The rename has two surfaces, and only one of them is settled here

`agent-os` was doing two unrelated jobs in this repository, and conflating them would be a second
naming error on top of the first:

1. **The project's identity** — the README title and description, and this ADR. Renamed to
   `skillanvil`. Settled.
2. **A genericized path segment** — `agent-os/Skills` appears inside the vault-root resolver
   (`lint-engine/portfolio_lint/fs.py`, a literal directory check), the compiler's path joins, the
   skill-dispatch hook, `docs/routines.md`, and six earlier ADRs. Per this repository's own note that
   *"paths and identifiers throughout have been genericized,"* that segment is a stand-in for a
   private source-tree directory — **it is not the project name**, it only happened to match it.

Surface 2 is deliberately left unchanged by this ADR. Renaming it is a behaviour change to the
resolver, not a documentation change, and rewriting the six historical ADRs that reference the path
would falsify decision records that were correct when written. The options, for a later ADR:
replace the literal with a placeholder consistent with the existing `<VAULT_ROOT>` convention;
rename it to match the project; or leave it and document what it refers to.

**Also not decided, and genuinely open:** whether this repository is a read-only reference or an
installable tool. The README currently grants only "read, study, and evaluate," with redistribution
and commercial use restricted. A name that promises something the license forbids would reproduce
this ADR's own error in a new form — `skillanvil` reads like something you can run. If the artifact
stays read-only, the README must say so prominently enough that the name does not overpromise.

## Consequences

- **Done 2026-09-09:** the README title and opening description now read `skillanvil` and
  "a build-and-governance toolchain for agent skills," with a short former-name note pointing here so
  an existing link does not land on an unexplained rename. No other document in this repository
  asserts the OS claim.
- **Still outstanding, outward-facing:** the GitHub repository name and its URL, the repository
  description field, the local working directory, and the git remote. Those change a public address
  and are not done by editing files — they are a separate, deliberate act. Until they happen, the
  repository's identity is inconsistent between its contents and its address.
- The path-segment question (surface 2 above) stays open and is the subject of a later ADR.
- A collision and clarity check becomes a **pre-flight for any public artifact**, not a
  post-publication repair. This ADR exists because that check ran seven days late.

## Method notes and limits

- Star counts, package status, and push dates are point-in-time readings from live APIs on
  2026-09-08.
- Trademark findings rest on secondary sources; USPTO TESS could not be queried directly. Treat "no
  blocking mark found" as suggestive, not conclusive, and run a real mark search before committing to
  a name commercially.
- Domain availability was inferred from HTTP response codes, not WHOIS. A registered-but-unhosted
  domain is indistinguishable from an unregistered one by that method.
