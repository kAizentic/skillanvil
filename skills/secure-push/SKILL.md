---
id: secure-push
name: secure-push
provenance: authored
slug: secure-push
description: Scan-gated commit and push, strictness matched to who can read the remote. Private remote - credentials block, personal content is fine. Public remote - no baseline, PII, a private deny-list (name, clients, local paths) and vault pointers block, history is scanned, wording checked for disclosure. Use when the user says "secure push", "safe push", "commit and push", "push this repo", or is about to push any repo. Never creates repos, flips visibility, or picks what goes public - publishing is separate.
version: 2.1.0
category: Automation
status: active
hitl_gate: grill
unattended: forbidden
unattended_note: "Pushes commits. The human IS the control - a scan verdict that nobody reads before a push is not a gate. The mechanical half (credential-scan.mjs, private tier) already runs unattended at commit time; the push itself does not."
tags: [git, security, secrets, push, safety, disclosure, confidentiality]
inputs:
  - a git repo (cwd or a given path) ready to commit and push
outputs:
  - a committed + pushed repo, OR a blocked push with a redacted findings report
tools: [Bash, Read]
triggers:
  - secure push
  - safe push / commit and push
  - push this repo / push to <remote>
dependencies: []
composes_with: [softdev-workflows, review, tdd]
owner: the operator
last_updated: 2026-09-23
---

# Secure Push — a push gate matched to the remote's audience

Push a repo only after proving nothing reaches the remote that its **audience** shouldn't read.
Origin: the Claude Code `/insights` report (2026-06/07) flagged repeated secret-to-env-var cleanup
and an incident where a live GitHub PAT was pasted inline. This skill makes the gate fire every
time instead of relying on memory.

**v2.0 (2026-09-23) split two jobs that v1 did together.** v1 also *published*: it created public
repos, added README/.gitignore hygiene, and flipped visibility. That is a different decision
("should this exist in public at all, and what of it?"), with a different owner, so it left this
skill. What stayed is the gate, now **two-tier**, because the right strictness depends on who can
read the remote:

| | **Private tier** | **Public tier** |
|---|---|---|
| When | remote not readable by a stranger | remote readable by a stranger, or visibility can't be determined |
| Credentials | hard block, **ratcheted** (baselined doc placeholders pass) | hard block, **no baseline**: every match blocks until the text changes |
| PII / names / meeting content | allowed: a private backup of your system is supposed to hold them | **hard block** |
| Private deny-list (your name, clients, local setup) | off | **hard block** (narrow `allowPaths` for intentional ones, e.g. `LICENSE`) |
| Structural leaks (wikilinks, private folder names, real home paths, emails) | off | **hard block** |
| History | not rescanned: every commit was already scanned when it was made | scanned in full on the **first push to that remote**, and whenever history was rewritten |
| Disclosure wording | off | read and judged, never presented as a scan result |

## Rules

**MUST:**
- Decide the tier by **measuring**, not assuming: `node scripts/detect-tier.mjs --repo <path>`.
  It asks as an anonymous stranger (`gh repo view` answers as the owner, the wrong identity for
  this question). An undeterminable answer is **public**.
- Run `scripts/credential-scan.mjs` for that tier on tracked content **before** committing.
- **Block** on any hard finding. Do not commit or push while one is present.
- Print only **redacted** matches (the scanner already does: path + prefix + last 4 chars).
- Confirm remote and branch with the user before the **first** push to a remote.
- Re-scan after remediation and after commit, before declaring done.
- On a **public** remote, check every artifact the push *names* (branch, commit message, PR
  title/body, test names) against [Disclosure hygiene](#disclosure-hygiene-public-tier).

**MUST NEVER:**
- Push while the scan for the remote's tier is red, or exited 2. **Exit 2 means "could not
  measure", which is never "clean".**
- Echo, log, or place a full token/key value in chat, a commit message, or a file.
- Force-push, or push to a remote the user did not confirm.
- **Create a repository, change a repository's visibility, or decide what content should be
  public.** Those are publishing decisions. If the user asks for one, say it is out of scope here.
  If a private remote is about to go public, the public tier with `--history` must pass first,
  and whoever makes it public runs that gate.
- Accept a public-tier finding with `--update-baseline`. The public tier has no baseline (the
  scanner refuses, exit 2). A public match gets fixed in the text.
- Track the filled deny-list in any repo. secure-push itself is published in the public slice,
  so a deny-list tracked beside it would publish the names it exists to keep out.
- On a public remote, let a branch name, commit message, PR title, test description, or code
  comment **name the vulnerability class being fixed**, or name a **client or customer**.
- Run git through **sandbox bash** on the cloud-synced vault. Git there must run natively.

## Workflow

1. **Establish state and tier.** `git status`, `git remote -v`, current branch. Confirm this is
   the repo and remote the user intends. Then
   `node scripts/detect-tier.mjs --repo <path> [--remote <name>]`. Say the tier and its reason out
   loud (for example, `tier=public ... anonymous GET 200`).
2. **Scan the tree for that tier.**
   - Private: `node scripts/credential-scan.mjs --repo <path>`
   - Public: `node scripts/credential-scan.mjs --repo <path> --tier public`, plus `--history` if
     this is the first push to the remote or history was rewritten.
   - Exit 0 clean · 1 blocked · **2 could not run** (no git, bad rule file, public tier with no
     deny-list). Treat 2 as blocked, and fix what it names.
3. **Gate.** Findings: STOP. Report each as the scanner prints it, and recommend the fix:
   - credential → env var + `.env.example` (placeholder keys only) + `.gitignore`, and
     `git rm --cached` any tracked secret file;
   - private-tier false positive → read it, then `--update-baseline` (that asserts a human read it);
   - public-tier name, pointer or path → rewrite the text (keep the engineering explanation, drop
     the pointer), or add a narrow `allowPaths` entry to the deny-list if it is intentional;
   - **history-only hit** → a new commit cannot fix it. It needs a history rewrite **in a fresh
     clone** (never `filter-repo` on a live working copy), plus rotating the credential. Flag it to
     the user and do not push.
4. **Disclosure check (public tier only).** Read the branch name, the pending commit message(s),
   and any test names added against [Disclosure hygiene](#disclosure-hygiene-public-tier) *before*
   committing. Renaming a branch after it is pushed does not un-disclose it.
5. **Commit.** Stage, commit with a clear message (never containing a secret).
6. **Patch notes: one short entry in the repo's own `CHANGELOG.md`, every push.**
   - `node scripts/patch-notes.mjs raw --repo <path>` lists what is about to go (commits in
     `<remote>/<branch>..HEAD` plus files grouped by folder).
   - Write **2–5 bullets for that repo's reader**, not a list of commit subjects. Group by effect
     ("Added / Changed / Fixed"), one line each, and say what the thing now does. Forty nightly
     `chore(generated)` commits become one line or none.
     - *Private tier:* plain and complete. The reader is you, later, asking "what changed that week?"
     - *Public tier:* same [disclosure](#disclosure-hygiene-public-tier) rules as a commit message.
       Describe behaviour, never the threat, never a client. **Never mention what was left out or
       why.** The deny-list and structural patterns scan the CHANGELOG like any other file.
   - `node scripts/patch-notes.mjs write --repo <path> --notes <file>` prepends a dated entry tagged
     with the exact range (`abc123..def456`). It refuses empty notes and refuses a range that
     already has an entry, so a retried push can't log twice.
   - Commit it (`docs: patch notes <date>`), then re-run step 2's scan. The notes are new text.
7. **Push** to the confirmed remote and branch.
8. **Verify and report.** Re-run step 2's scan on the committed tree, then confirm the remote
   actually moved (`git rev-parse HEAD` == `git rev-parse <remote>/<branch>` after a fetch). Report:
   tier and why, the patch-notes entry, what was pushed, the scan result, and for the public tier, the disclosure check as
   **read and judged**.

## Rule files (one home each)

All in `scripts/`. **Do not restate patterns in this file.** A second copy is the mirror drift
this system lints for.

| File | Tracked? | What |
|---|---|---|
| `credential-patterns.json` | yes | the credential patterns + tracked-secret-file globs (both tiers) |
| `credential-baseline.json` | yes | private-tier ratchet: hashes of human-reviewed matches, never the text |
| `public-patterns.json` | yes (ships in the slice) | generic structural leaks: wikilinks, private folder names, real home paths, emails |
| `public-denylist.example.json` | yes (ships) | the template for your private deny-list |
| **your deny-list** | **never** | your name, handles, clients, collaborators, private setup. Found at `--denylist`, `$SECURE_PUSH_DENYLIST`, `<vault>/private/secure-push/public-denylist.json`, or `~/.secure-push/public-denylist.json` |
| `detect-tier.mjs` | yes | anonymous visibility probe → tier |
| `patch-notes.mjs` | yes | `raw` (what is about to be pushed) and `write` (dated, range-tagged CHANGELOG entry); `patch-notes.test.mjs` |
| `credential-scan.test.mjs` | yes | `node credential-scan.test.mjs`, including the negative-class cases (must stay silent on a benign repo) |

The scanner blocks known **shapes**. It never makes a push "safe", and a clean public-tier scan
says nothing about whether the content gives away methodology. That is a publishing judgment, and
it is not made here.

## Disclosure hygiene (public tier)

Everything above protects the secret **value** and your **identity**. This protects the
**wording**. A repo can pass every scan here and still tell an attacker exactly where to look.
Attackers watch open-source repos for branch names, commit messages, PR titles, test descriptions,
and ticket URLs.

**The rule: describe what the code now does, never the threat it prevents.**

| Surface | Discloses (avoid) | Neutral (use) |
|---|---|---|
| Branch | `fix-ssrf-vulnerability`, `n-1234-fix-ddos` | `n-1234-improve-request-handling` |
| Commit | `fix: prevent denial of service` | `fix: add payload size validation` |
| PR title | `patch auth bypass` | `tighten session validation` |
| Test name | `'should prevent SQL injection'` | `'should sanitize query parameters'` |
| Comment | *describing the attack scenario* | *describing the invariant being enforced* |
| Ticket link | a URL slug like `.../N8N-1234/fix-ssrf-vulnerability` | the bare ticket ID |

Note the branch trap specifically: issue trackers **auto-suggest a branch name from the ticket
title**, so a security ticket hands you a disclosing branch name by default. Rename it before the
first push.

**Customer confidentiality.** Never name a client or customer in a public-facing artifact: not
every client has agreed to be named, and naming them can reveal details about their setup. Describe
the case neutrally (*"a client with a large multi-site deployment"*), and use generic placeholders
(`Acme Corp`, `client-a`) in tests, fixtures, and sample data. The deny-list catches the names you
listed. It cannot catch a description that identifies a client without naming them. That part is
read.

**This check is judgement, not a regex. Say so rather than faking a gate.** "Does this wording
disclose the vector?" cannot be grepped; it is read. So surface candidates to the user and let them
decide rather than hard-blocking, and never report "disclosure-clean" as if a scanner produced it.
A useful first pass is `git log --oneline` for the commits being pushed plus test names.

**Timing matters more than tidiness.** If a disclosing name is already pushed, renaming does not
retract it: the old ref may be cached, forked, or in someone's clone. Treat it as a disclosure
event, flag it, and let the user decide whether the fix needs releasing first.

*Source: *eval n8n repo* §2 (mined from `n8n-io/n8n` `AGENTS.md`, 2026-08-19). Tiering,
deny-list and structural patterns: 2026-09-23, closing the "grep-backed in secure-push itself, not
yet built" gap recorded in *skill ip boundary*.*

## Cost Class

**Lightweight.** Two zero-dependency Node scripts plus JSON rule files. The tree scan is
O(tracked files). `--history` is O(unique blobs in history): one `rev-list` plus one batched
`cat-file`. The only network call is detect-tier's single anonymous GET.
