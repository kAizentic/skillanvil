# Second Brain — Scheduled Routines

> ✅ **Reconciled against `schtasks` ground truth 2026-08-03.** Every row below was read from
> `Get-ScheduledTask` / `Get-ScheduledTaskInfo`, not from memory or a prior version of this doc.
> Trigger times, actions, and last-run results are as the scheduler actually holds them.
> **Re-verify with the command in "How to re-reconcile" before trusting this table after edits.**

## Substrate: it's all local now

**Cowork is empty.** All 20 registered routines are **local Windows Scheduled Tasks**. The three-substrate
split this doc used to describe collapsed over 2026-07-06 → 07-09:

- **Inbox sweep** moved Cowork→Local 2026-07-06 (`bypassPermissions` structurally killed the cleanup-tail permission stall).
- **Blogwatcher + intel-scan** moved Cowork→Local 2026-07-09 once `exa` became a **user-scope** MCP.
- **Meeting sync** moved Cowork→Local 2026-07-10 (the "needs Granola, so must be Cowork" claim was false — Granola MCP is authenticated headless-local).

**Nothing structurally requires Cowork anymore.** A headless local `claude -p` inherits Slack, Granola,
and exa from `~/.claude`. The only property Cowork uniquely had was *surviving a powered-off PC* — and
the standing 10:00–24:00 PC-on scheduling rule already forfeits that.

> ⚠️ **Verify before assuming a routine can't run local:** `claude mcp list`. Slack/Granola/exa show
> ✔ Connected. Notion/M365/Canva showed *Needs authentication* as of 2026-07-06 — those genuinely
> can't run headless until re-authed.

---

## Scheduling rules (standing)

> 🕙 **PC-on window (2026-07-01, standing):** all scheduled routines are timed **10:00–24:00**, the operator's
> PC-on window. A local Windows task literally cannot run while the machine sleeps. Only deviate with an
> explicit, noted reason. Two sanctioned deviations, both self-limiting: **Routine Pre-Notify** (must poll
> every minute to catch pre-run windows; interactive-only, so it simply doesn't tick when logged off) and
> **Skill Watch** (`AtLogon`-scoped).

> ⚠️ **`WakeToRun = False` on all 20 tasks (verified 2026-08-03).** `StartWhenAvailable = True` on most,
> which recovers a *missed* run on next wake — but it fires late and out of chain order, and it does not
> wake the machine. **If the PC sleeps before a slot, that run does not happen on time.** This is the live
> gap; see "Sleep exposure" below.

**Superseded — do not reinstate:** the old "move LLM routines to an early-morning fresh-quota window
(~5:40–6:40am)" principle. It rested on a **falsified diagnosis** — the 8pm sweep deaths were
*permission-gating*, not quota exhaustion (corrected 2026-07-03; the runs were waiting on ungranted tool
prompts and finished the moment they were granted). `bypassPermissions` removed that cause class entirely.
**No routine run log has ever recorded a genuine usage-limit / rate-limit failure** (16 logs scanned
2026-08-03; all apparent hits were filename or content false-positives).

---

## Routine table — verified live state

Legend: **LLM** = draws a `claude -p` agent run (usage-bearing). **Script** = deterministic, no model call.

| Routine | Task name suffix | Trigger (verified) | Kind | Action | Status / notes |
|---|---|---|---|---|---|
| **Project Digest** | `Project Digest` | **Daily 10:20** | LLM | `run-project-digest.ps1` | ✅ healthy (last exit 0). Distills `Desktop\Projects` → *projects*. *(Doc previously said "Mon" — it is **daily**.)* |
| **Routine Health** | `Routine Health` | **Daily 10:00** | Script | `routine-health.ps1 -NotifyInbox` | ✅ the governance watchdog. **Exit code = alert count** (self-exempt from "non-zero = fail"). Audits every `Second Brain - *` task + the sweep tail → `output/routine-health/latest.html`, drops a `inbox` clip on failures. Current: `overall=ALERT alerts=1` (Sweep Evaluator). **Transition ledger added 2026-08-20** (netdata eval): appends TRANSITIONS ONLY to `agent-os/telemetry/routine-health-transitions.jsonl`, which is also the single source of prior state (no companion state file to drift). Non-OK rows now annotate `[new today]` vs `[ongoing Nd]`, and a RISK→OK flip renders a **Recovered** block on the board + console + `latest.md` — deliberately **not** toasted, per the standing "toast on RISK only" policy. `-TransitionLedger <path>` points it at a scratch file for testing. netdata's `delay`/`repeat`/hysteresis machinery was deliberately NOT ported: it exists because netdata samples every ~10s, and at one sample/day nothing flaps. |
| **AI Pulse** | `AI Pulse` | **Daily 10:40 · 14:40** *(2×/day, set 2026-09-18; 18:40 disabled)* | LLM | `run-ai-pulse.ps1` | ✅ healthy. Significance-gated breaking-AI channel; most runs push nothing. ALERT → phone `PushNotification` + runner-fired Windows toast (diffs `output/ai-pulse/alerts.jsonl`) + grill-ready clip. Budget ≤3 pushes/day; state in `knowledge/feeds/ai-pulse.md`. **Cadence test CLOSED 2026-09-18 — settled at 2×/day.** Cut to 1×/day 2026-08-18 for a 7-day test, then left un-scored for a further 25 days. Re-scored over the full 32-day window (`node library/scripts/ai-pulse-cadence-measure.mjs --test 2026-08-18:2026-09-18`): **50% volume retained** (2.19 vs 4.36/day), the instrument's `50-80%` "2x/day is the likely compromise" band. The deciding column was **freshness, not volume** — same-day capture 64%->30%, mean lag 0.90d->1.49d, quiet days 0/28->4/32. (Pre-repair the same script read 48% / 6 quiet days: 3 clips were missing from `sources/ai-pulse/` and it counts alerts and items by FILENAME, so preservation gaps scored as coverage gaps. Guarded now by the sweep tail's `ai-pulse-reconcile` step.) **14:40 re-enabled; 18:40 stays disabled, not deleted.** Paired with a deterministic changelog poll (SKILL.md step 2a) rather than a third run. Re-score after 30 days at 2×. **Restore 3×:** `$t=Get-ScheduledTask -TaskName 'Second Brain - AI Pulse'; $t.Triggers[2].Enabled=$true; Set-ScheduledTask -TaskName 'Second Brain - AI Pulse' -Trigger $t.Triggers` (pre-change task XML backed up to `library/scripts/_task-backups/Second Brain - AI Pulse.2026-09-18-pre-2x-restore.xml`). **Alert follow-through** is tracked in `knowledge/feeds/ai-pulse-alerts.md`, regenerated by the sweep tail's `ai-pulse-reconcile` step. Routine-health is unaffected — `Get-Cadence` reads only the first trigger and allows any daily task 26h. |
| **Update Pulse** | `Update Pulse` | **Weekly Mon 11:20** | Script | `run-update-pulse.ps1` | ✅ **new 2026-09-18.** Upstream-drift watch for the 4 watched vendored sources (`mattpocock-skills` excluded by name — frozen deliberately, overlay is destructive). **Not an LLM routine** — stdlib Python + 4 GitHub compare calls, no model in the loop. **Exit code = number of drifted sources, NOT failure** (same self-exempt convention as routine-health and skill-portfolio-review); the runner always exits 0 and records the detector's code in its log. **DETECTION ONLY unattended** — staging (`--stage`) and applying are human-initiated, the pin file is read never written, and nothing touches the skill tree. State is the `commit` pin in `agent-os/Skills/_vendored.json` itself, so a re-sync that updates the pin silences the finding and one that forgets keeps re-raising. Weekly not daily on measurement (~1 commit/day aggregate drift). Run log: `~/.claude/update-pulse-run.log`. First scheduled fire: Mon 2026-09-21 11:20. |
| **Skill Portfolio Review** | `Skill Portfolio Review` | **Weekly Mon 12:20** *(was 10:40)* | Script | `skill-portfolio-review-monthly.ps1` | ✅ **moved 2026-08-03** off the 10:40 slot it shared with AI Pulse. **Not an LLM routine** — it only runs `portfolio_check.py`; measured runtime **0.3 s**. **Exit code = advisory category count, NOT failure** (0 = clean, N = N categories); same self-exempt convention as routine-health. Last run exit 1 = 1 advisory. ⚠️ **name/cadence mismatch** — script is named `-monthly`, trigger is **weekly (Mon)**; kept to avoid breaking the registered action. **Run log added 2026-08-03** (`~/.claude/skill-portfolio-review-run.log`) — it previously wrote nothing, so the watchdog could not see it. |
| **Rule Retirement** | `Rule Retirement` | **Weekly Mon 12:50** *(was 11:10)* | LLM | `run-rule-retirement.ps1` | ✅ **moved 2026-08-03** to preserve its deliberate "≥30 min after Skill Portfolio Review" placement. **Has never fired on schedule** (`LastRunTime` = 1999, `LastTaskResult` = 267011 / `SCHED_S_TASK_HAS_NOT_RUN`) — not a fault, its `StartBoundary` was set after that day's slot passed. **First scheduled fire: Mon 2026-08-10 12:50.** Has been run by hand. Watch that first run. |
| **Intel Focus** | `Intel Focus` | **Mon–Sat 11:50** (`dow=126`; Saturday added 2026-09-18) | LLM | `run-intel-focus.ps1` | ✅ healthy. The cap-8 fix for the blended nightly scan: locks the lens to ONE thread, scans deep (14-day recency, ~12 cap, second-source on every find). Day→thread map in the runner; threads in `intel-scan/references/focus-threads.md`. **Saturday = `brand-deck` (added 2026-09-18):** a measured audit found the presentation/brand-software market invisible to the whole system — 0 of 15 blogwatch feeds cover it, deck/brand content was 0.2% of blogwatch files in Aug and 0.0% in Sep, and every candidate vendor feed tested (Templafy, Frontify, SlideSpeak, Beautiful.ai, Prezent) 404s or returns HTML rather than RSS — so it is unwatchable by `blogwatcher` and reachable only by query. **Revert:** set the trigger back to `-DaysOfWeek Monday..Friday` (pre-change XML in `library/scripts/_task-backups/Second Brain - Intel Focus.2026-09-18-pre-saturday.xml`). **Shares intel-scan's seen-URL + opportunity ledger by design.** Report → `output/intel-focus/<date>-<thread>.html`. |
| **Inbox Sweep (Midday)** | `Inbox Sweep (Midday)` | **Daily 13:00** | LLM | `run-inbox-sweep.ps1 -DeferIfBusy -SkipTail` | ✅ healthy. Daytime distill-only pass. |
| **Inbox Sweep (Evening)** | `Inbox Sweep (Evening)` | **Daily 19:00** *(was 18:00)* | LLM | `run-inbox-sweep.ps1 -DeferIfBusy -SkipTail` | ✅ **moved 2026-08-03** so it lands *after* the 18:40 AI Pulse and distills that run's clips same-cycle. Under 18:00 the evening pulse's clips waited 3 h 50 m for the 22:30 nightly. Daytime distill-only pass. |
| **Skills to Cowork** | `Skills to Cowork` | **Daily 18:30** | Script | `agent-os/compiler/sync-cowork.cmd` | ✅ healthy. **The one outward-facing step** in the whole system — deliberately kept off the on-change Skill Watch (ADR 0010, `unattended: restricted`). ⚠️ Its original timing rationale ("before the ~8:15pm **Cowork** chain") is **dead** — that chain is local now. The 18:30 slot is now arbitrary; it only needs to be after skill edits settle. |
| **Meeting Sync** | `Meeting Sync` | **Daily 20:00** | LLM | `run-meeting-sync.ps1` | ✅ healthy. Granola → `sources/meetings` (raw) + `knowledge/meetings` (distilled); sensitive → `private/meetings`. Self-contained, no sweep dependency. |
| **Blogwatch** | `Blogwatch` | **Daily 20:15** | LLM | `run-blogwatch.ps1` | ✅ healthy. Evening chain, 1st. Watchlist seeded (9 feeds); prompt **must keep the HTML-report step**. |
| **Intel Scan** | `Intel Scan` | **Daily 21:15** | LLM | `run-intel-scan.ps1` | ✅ healthy. Evening chain, 2nd. Maintains the opportunity ledger `knowledge/feeds/intel-opportunities.md`. |
| **Intent Scout** | `Intent Scout` | **Monthly, 1st, 21:45** | LLM | `run-intent-scout.ps1` | ✅ healthy. Re-cadenced daily→monthly 2026-07-11 (operating-intent is slow-moving). **Quarantines** to `knowledge/feeds/inferred-intent/` — walled from `inbox/`, never auto-graduates. Review on demand via "sweep the quarantine". Keeps the 21:45 slot so its clips still land before the 22:30 sweep. |
| **Trace Divergence** | `Trace Divergence` | **Daily 22:00** | LLM | `run-trace-divergence.ps1` | ✅ healthy (last exit 0). Writes to `sources/trace-divergence/`. |
| **Inbox Sweep** (+ chained tail) | `Inbox Sweep` | **Daily 22:30** | LLM | `run-inbox-sweep.ps1` *(no switches)* | ✅ healthy. **The nightly backstop** — full run, runs the tail. Chains in-script: `wiki-lint → vault-health → reports-to-pdf`, each an isolated child process, best-effort, ordered by the sweep's *actual completion*. |
| ~~**Sweep Evaluator**~~ | — | **now step 2c of the sweep tail** | LLM | `run-sweep-evaluator.ps1` | ✅ **standalone 23:30 task removed 2026-08-03** — chained by the sweep's *actual completion* instead of wall clock. See "Why the evaluator moved" below. Task XML backed up to `library/scripts/_task-backups/`. Still hand-runnable. Uses **opus** by design (a weak evaluator rubber-stamps). Exit 0 clean / 1 defects / 2 failed pass / 3 no new sweep. |
| **CC Insights Snapshot** | `CC Insights Snapshot` | **Monthly, 28th, 10:00** | Script | `run-cc-insights.ps1` | ✅ healthy. *(Doc previously named `snapshot-cc-insights.ps1 -Force` — the registered action is `run-cc-insights.ps1`.)* Sole producer of the cc-insights HTML. **Caveat: the report only refreshes when the operator runs `/insights`** — run it before the 28th for a fresh snapshot. |
| **Routine Pre-Notify** | `Routine Pre-Notify` | **Every minute** (`PT1M` repeat) | Script | `routine-prenotify.vbs` | ✅ healthy. Toast at **T-10min** and **T-60s** before any `Second Brain - *` run. Deduped per task+run in `%LOCALAPPDATA%\SecondBrain\routine-prenotify-state.json` (48h prune). VBS launcher keeps the per-minute tick console-flash-free. *Sanctioned window deviation; interactive-only.* |
| **Skill Watch** | `Skill Watch` | **AtLogon**, then continuous | Script | `agent-os/compiler/watch-skills.vbs` | ✅ healthy. `fs.watch` on `agent-os/Skills`, 250ms debounce → validate → compile → graph → glossary. **Validate GATES compile**, so a half-saved spec never publishes. **Its healthy state is a live node process, not task `State = Running`** — the VBS shim returns immediately, so Routine Health probes the process and inverts the verdict (stopped = RISK). *Sanctioned window deviation.* |

### Retired / removed

| Routine | Disposition |
|---|---|
| **Wiki sweep (creative writing)** | ❌ **fully gone.** Task deleted 2026-07-10; **`run-wiki-sweep-weekly.ps1` no longer exists on disk** (verified 2026-08-03). The operator captures creative-writing style case-by-case now. *(Prior versions of this doc still listed it as "✅ registered" — that was wrong.)* |
| **Reports → PDF** | Standalone task retired 2026-07-10 → **step 3 of the sweep tail**. Script `reports-to-pdf.ps1` unchanged. |
| **Wiki lint** | Standalone task retired 2026-07-10 → **step 1 of the sweep tail**, so it lints the freshly-swept vault same-cycle. |
| **Vault health scorecard** | Standalone task retired 2026-07-10 → **step 2 of the sweep tail** (`vault_health.py --html`). |
| **Open-loops ledger** | **Never scheduled at all — wired into the tail 2026-08-20** as **step 0c** (`open-loops/extract_open_loops.py --out … && classify.py` → `knowledge/feeds/open-loops.md`). It had existed since 2026-07-26 as a well-built three-file ledger that *nothing ran*: **24 days stale**, and scoped to `sources/docs` only, so open loops written onto concept pages were tracked by nothing. Widened to `knowledge/{concepts,summaries,areas}` the same day (**151 capture + 16 wiki loops**). Extraction is mechanical/idempotent; the judgment sidecars (`verdicts.json`, `findings.json`) are hand-curated and never written by the routine. Extract writes atomically via `--out`, and `classify.py` runs **only** on exit 0, so a failed extract leaves the previous ledger intact rather than publishing an empty page over a good one (fail path verified 2026-08-20). |
| **Graphify rebuild** | Never a task — **semi-attended** monthly, run by hand (`/graphify`). Guide → `cowork-routines/graphify-rebuild.md`. |
| **All former Cowork routines** | Superseded by the local ports above. If any still exist in the claude.ai Cowork UI they will **double-run** — Claude Code cannot see or delete them; **the operator must confirm in the UI.** |

---

## Ordering: what actually depends on what

Only two hard orderings exist. Everything else is spacing, not dependency.

1. **Feeders → nightly sweep.** `Blogwatch 20:15 → Intel Scan 21:15 → Inbox Sweep 22:30` (plus Intent Scout 21:45 on the 1st). The feeders write clips into `inbox/`; the sweep distills them **same cycle**. Going fully local eliminated the old cloud sync-lag seam — feeders now write straight into the local vault.
2. **Nightly sweep → Sweep Evaluator.** **No longer a wall-clock ordering** — as of 2026-08-03 the evaluator is *inside* the tail, so it cannot start until the sweep has actually finished. See below.

**Routine Health at 10:00 is a third, softer ordering:** it audits the *completed overnight chain*. Move the chain past 10:00 and the watchdog starts grading a chain that hasn't run yet.

**Not orderings** (despite how the old doc read them): Skills-to-Cowork at 18:30, Project Digest's morning slot, and the "isolate the usage-drawing routine from the evening cluster" note. That last one was substrate reasoning that never held — a Cowork routine and a local `claude -p` bill the **same account**.

### Why the evaluator moved into the tail (2026-08-03)

`run-sweep-evaluator.ps1` was scheduled at 23:30 on the reasoning that it sat "an hour after the
nightly sweep starts (22:30) so the sweep has finished." **That assumption was safe when a sweep took
10 minutes and had quietly stopped being true.** Measured, nightly sweep **plus tail**, from the run log:

| Date | Ends | Duration |
|---|---|---|
| 07-25 | 22:40:01 | 10.0 min |
| 07-26 | 22:38:32 | 8.5 min |
| 07-27 | 22:43:41 | 13.7 min |
| 07-30 | 23:06:58 | **36.9 min** |
| 07-31 | **23:13:39** | **43.6 min** |
| 08-01 | 23:10:36 | **40.6 min** |
| 08-02 | 22:43:15 | 13.2 min |

Three of the last seven nights ran 37–44 min, leaving a **16-minute margin** on the worst night and
trending the wrong way (*cloud-sync cold read io tax*). A sweep crossing 60 minutes would have had
its own in-flight state graded — and the evaluator would have emitted **a number, not an error**, which is
the silent-wrong class this system exists to refuse (*proxy signal collapses the two states*).

**The fix was not a better time — it was removing the clock from the dependency.** Chaining by actual
completion is the same move made on 2026-07-10 for wiki-lint / vault-health / reports-to-pdf
(*unattended routine orchestration*).

Two properties verified before the move, both load-bearing:
- **No commit dependency.** `--manifest` parses `knowledge/inbox-report.md` (written during distillation), *not* git — so running before `Invoke-SweepCommit` is correct. The old header comment claiming it needed the sweep to have "committed" was wrong.
- **Placement before `reports-to-pdf` is required**, because the evaluator writes `output/sweep-evaluator/<date>.html`. Under the 23:30 task that HTML always *missed* its own night's PDF conversion and waited ~24 h — **a second latency bug this move closes.**

Side benefit: the evaluator's artifacts now land in the same run's commit instead of the next night's.

### The three-sweep pattern (concurrency, added 2026-07-17)

`run-inbox-sweep.ps1` is guarded by `sweep-lock.ps1`, so it is **safe to run more than once a day**:

- `-DeferIfBusy` — skips the run when `knowledge` was edited in the last few minutes (a human or another process is mid-write). **Daytime only, never the nightly backstop.**
- `-SkipTail` — distill only; skips the heavy `wiki-lint / vault-health / reports-to-pdf` tail (a nightly concern).
- **Daytime sweeps pass both** (13:00, 18:00). **The 22:30 nightly passes neither** — full run, full tail, and it is the backstop that catches whatever the deferred daytime runs skipped.
- Both paths still commit their own distillations (`Invoke-SweepCommit` runs on `-SkipTail` too; `output` is simply empty).
- Fail-open by design: an empty diff is skipped; a blocked pre-commit wikilint gate is logged and the paths unstaged, leaving the tree as found. It must never hang.

---

## Sleep exposure — the live gap

`WakeToRun = False` on **all 20 tasks**. `StartWhenAvailable = True` on all but Routine
Pre-Notify, and Skill Watch — that recovers a missed run on next wake, but **late and out of chain order**.

Concretely: if the PC sleeps at, say, 21:00, then Intel Scan (21:15), Trace Divergence (22:00), the
nightly Inbox Sweep (22:30) and the Sweep Evaluator (23:30) all miss. On next wake, `StartWhenAvailable`
fires them in scheduler order, not chain order — so the evaluator can grade a sweep that hasn't run, and
the feeders' clips can land *after* the sweep that was supposed to distill them.

**The three-sweep pattern already absorbs most of this for the sweep specifically** — a 13:00 and 18:00
distill-only pass means inbox items get processed even if the whole evening block is lost. What is not
absorbed: blogwatch/intel-scan collection, meeting sync, trace divergence, and the evaluator.

**Options, cheapest first** — not yet decided:
- **`WakeToRun = True`** on the evening chain. Directly addresses sleep; preserves ordering and the
  producer→consumer chain exactly as designed. Requires the machine to be in sleep (not hibernate/off)
  and the power plan to permit wake timers.
- **Move the block earlier** (compress into an earlier evening window). Preserves ordering, shrinks the
  exposed window, costs nothing.
- **Move the block to midday.** Largest change; see the ordering constraints above (Routine Health at
  10:00, and the fact that midday is when the vault is *being edited*, which is exactly what
  `-DeferIfBusy` exists to dodge).

---

## Why the split was load-bearing (historical)

The original three-substrate reasoning: connector routines (`mcp__claude_ai_*`) were thought to be
claude.ai-hosted only, so a Windows task for `sync my meetings` would silently no-op; conversely
project-digest and graphify need the local filesystem Cowork can't see. **Both halves of that were
falsified in July 2026** (see Substrate section). Kept here because the *discipline* still holds:
**match each routine to the substrate that actually has what it needs, and verify rather than assume** —
mismatches are the silent-failure trap this system is designed against.

## Human-review reports → PDF

**`output/reports/`** is the one place to review reports the operator reads (see its `README.md`), organized
one subfolder per type (`intel-scan/`, `blogwatch/`, `deep-research/`, `insights/`, `intel-focus/`).
Routines write **HTML**; the sweep tail's `reports-to-pdf.ps1` step (Chrome headless) converts new ones to
PDF into the matching subfolder. Conversion is local because Chrome only exists on the machine.
Operational logs (`inbox-report.md`, `log.md`) stay markdown in the vault by design.

## The nightly sweep prompt (canonical)

Embedded verbatim in `run-inbox-sweep.ps1`; retained here as the reference copy.

```
Run the Second Brain inbox sweep. Use the `distill` skill — follow its
SKILL.md procedure exactly, do not improvise your own sweep. It handles the
start/end heartbeat in log.md, preserving originals to sources/ BEFORE distilling
(collect-then-distill), triage, distillation with keyword front-matter, dedupe,
cross-linking, updating index.md + log.md, the inbox-report, and emptying inbox.

Scope this run:
- inbox/ files
- Slack #brain-inbox (channel C0BCS9W4BPW), messages newer than the last-processed
  ts in knowledge/log.md
- New Granola meetings (optional — include if you also want meetings pulled nightly)

Connector policy: read-only EXCEPT add a ✅ (white_check_mark) reaction to each
Slack #brain-inbox message you SUCCESSFULLY FILE — the operator confirms intake from the
Slack side. Never react to messages you didn't file or to noise/test messages. Still
advance the log.md ts (the ts is the idempotency source of truth; the ✅ is human
confirmation).

If nothing is new, STILL write a log row / heartbeat as "0 new" — a silent no-op must
never be indistinguishable from a failed run.
```

Skill is `distill` **v1.2.0**: self-reporting heartbeat, collect-then-distill, and the
✅-reaction as the one permitted connector-write.

---

## How to re-reconcile

Run this and diff against the table above. **Never update this doc from memory** — the whole reason it
drifted was rows written from intent rather than from the scheduler.

```powershell
Get-ScheduledTask -TaskName "Second Brain*" | ForEach-Object {
  $t=$_; $ti=Get-ScheduledTaskInfo -TaskName $t.TaskName
  $trigs = foreach ($g in $t.Triggers) {
    $when = if ($g.StartBoundary) { ([datetime]$g.StartBoundary).ToString("HH:mm") } else { "" }
    $kind = $g.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger',''
    "$kind@$when"
  }
  [pscustomobject]@{
    Task = $t.TaskName -replace '^Second Brain - ',''
    Trigger = ($trigs -join "; ")
    Wake = $t.Settings.WakeToRun
    LastRun = $ti.LastRunTime
    Result = $ti.LastTaskResult
    Action = ($t.Actions | ForEach-Object { (Split-Path $_.Execute -Leaf) + " " + $_.Arguments }) -join " | "
  }
} | Format-List
```

Cross-check that every referenced script still exists on disk (`run-wiki-sweep-weekly.ps1` is how this
doc's staleness surfaced — the doc claimed a registered task whose script had been deleted).

### Orphan run logs (no matching task)

Checked 2026-08-03 by diffing `~/.claude/*-run.log` against the task list:

- `reports-to-pdf-run.log` — **expected**, folded into the sweep tail.
- `wiki-sweep-run.log` (last write 07-05) — **expected**, routine retired.
- `sweep-evaluator-run.log` — **expected as of 2026-08-03**, now written from inside the tail.
- `viral-loop-run.log` (last write 07-28) — ❓ **unexplained.** No `Second Brain - Viral Loop` task exists. Either a deleted routine or a manual-only tool. **Open question for the operator.**

---

_Reconciled 2026-08-03 against live `schtasks`; **19 tasks** (was 20 — Sweep Evaluator became a tail step).
Prior version listed ~14 routines against 20 live tasks and carried migration warnings for ports completed
in July. Changes applied this pass: evaluator chained into the tail; Skill Portfolio Review 10:40→Mon 12:20
(+ run log added); Rule Retirement 11:10→Mon 12:50; Inbox Sweep (Evening) 18:00→19:00._
