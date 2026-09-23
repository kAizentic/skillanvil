#!/usr/bin/env node
// Stop hook — once per session, offer to commit AUTHORED work and/or push a
// lagging branch. Offer only: the hook never runs git itself, and the write
// stays human-gated.
//
// WHY THIS EXISTS (measured 2026-09-20)
//   The vault was 251 commits ahead of origin/main with the last push 32 days
//   earlier, while `sweep-commit` had been committing nightly the whole time.
//   The commit half was mechanised; the push half was left to human discipline,
//   and nothing was WATCHING the lag — so it drifted silently for a month.
//   the cloud-sync folder is the only other off-machine copy and CLAUDE.md records that it has
//   silently reverted edits twice, so uncommitted work here is at risk from a
//   measured failure mode, not a theoretical one.
//
// WHAT IT DOES NOT DO
//   It does not commit, stage, or push. It does not decide that work is
//   "finished". It surfaces two facts and lets the operator choose.
//
// NOISE CONTROL — the reason this keys on the `code` concern group
//   Routines write to knowledge/, sources/, output/, inbox/ and
//   agent-os/telemetry/ constantly, and `sweep-commit` already lands those
//   nightly. Nudging on that churn would fire every session and be ignored
//   within a week. So the dirty-tree trigger looks ONLY at the paths the sweep
//   calls `code` — agent-os/ + library/ minus telemetry — plus the repo-root
//   contract files. Those are the ones an interactive session actually authors
//   and the ones a routine will not commit for you promptly.
//
// Guards: stop_hook_active short-circuit (a continuation we caused can never
// re-trigger us), a per-session latch, and every failure path exits 0 silently —
// a broken nudge must never block the operator's session.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PUSH_LAG_COMMITS = 20;     // offer a push at/above this many unpushed commits
const PUSH_LAG_DAYS = 7;         // ...or this long since the last push, whichever first

// Paths an interactive session authors. Mirrors run-inbox-sweep.ps1's `code` +
// `config` concern groups. Deliberately EXCLUDES routine-written trees.
const AUTHORED = [/^agent-os\//, /^library\//, /^\.githooks\//, /^CLAUDE\.md$/, /^\.mcp\.json$/, /^\.gitignore$/];
const NOT_AUTHORED = [/^agent-os\/telemetry\//];

function readStdin() {
  // strip a UTF-8 BOM: PowerShell 5.1 pipes add one and it breaks JSON.parse
  try { return fs.readFileSync(0, 'utf8').replace(/^﻿/, ''); } catch { return ''; }
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

try {
  const payload = JSON.parse(readStdin() || '{}');
  if (payload.stop_hook_active) process.exit(0);
  const sessionId = payload?.session_id;
  const cwd = payload?.cwd || process.cwd();
  if (!sessionId) process.exit(0);

  // Per-session latch — at most one nudge per session.
  const latchDir = path.join(os.tmpdir(), 'claude-commit-nudge');
  const latch = path.join(latchDir, `${sessionId}.nudged`);
  if (fs.existsSync(latch)) process.exit(0);

  // Must be inside a git work tree, or there is nothing to say.
  let root;
  try { root = git(cwd, ['rev-parse', '--show-toplevel']); } catch { process.exit(0); }
  if (!root) process.exit(0);

  // --- signal 1: authored work sitting uncommitted ---------------------------
  let authored = [];
  try {
    // `-z` (NUL-separated) is load-bearing, not a style choice: plain --porcelain
    // QUOTES any path containing a space, so every path under "agent-os/" came
    // back as `?? "agent-os/…"` and a /^agent-os\//  test silently matched
    // nothing. `-uall` is equally load-bearing: without it git collapses an
    // untracked directory into a single entry, so four new files in one new
    // folder reported as one. Both bugs under-report, which is the one direction
    // a nudge must never fail in.
    const raw = git(root, ['status', '--porcelain', '-z', '-uall']).split('\0').filter(Boolean);
    const paths = [];
    for (let i = 0; i < raw.length; i++) {
      const entry = raw[i];
      const status = entry.slice(0, 2);
      paths.push(entry.slice(3).replace(/\\/g, '/'));
      // A rename/copy emits the ORIGINAL path as the next NUL field — consume it
      // so it is not parsed as a status entry of its own.
      if (status[0] === 'R' || status[0] === 'C') i++;
    }
    authored = paths.filter((p) => AUTHORED.some((rx) => rx.test(p)) && !NOT_AUTHORED.some((rx) => rx.test(p)));
  } catch { /* leave empty */ }

  // --- signal 2: push lag ----------------------------------------------------
  let ahead = 0, daysSincePush = null, upstream = null;
  try {
    upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    ahead = parseInt(git(root, ['rev-list', '--count', '@{u}..HEAD']) || '0', 10);
    const ts = parseInt(git(root, ['log', '-1', '--format=%ct', '@{u}']) || '0', 10);
    if (ts) daysSincePush = Math.floor((Date.now() / 1000 - ts) / 86400);
  } catch { /* no upstream configured — skip this signal */ }

  const pushLagging = upstream && (ahead >= PUSH_LAG_COMMITS || (daysSincePush !== null && daysSincePush >= PUSH_LAG_DAYS));
  if (!authored.length && !pushLagging) process.exit(0);

  fs.mkdirSync(latchDir, { recursive: true });
  fs.writeFileSync(latch, new Date().toISOString());

  const parts = [];
  if (authored.length) {
    const shown = authored.slice(0, 8).map((p) => `  - ${p}`).join('\n');
    const more = authored.length > 8 ? `\n  …and ${authored.length - 8} more` : '';
    parts.push(
      `${authored.length} authored file(s) are uncommitted (skills, scripts, ADRs, repo config —\n` +
      `routine-written trees are deliberately excluded here):\n${shown}${more}`);
  }
  if (pushLagging) {
    const age = daysSincePush !== null ? `, last push ${daysSincePush}d ago` : '';
    parts.push(`The branch is ${ahead} commit(s) ahead of ${upstream}${age}. The only other off-machine copy is the cloud-sync folder, which has silently reverted files before.`);
  }

  console.log(JSON.stringify({
    decision: 'block',
    reason:
      `[commit-nudge — fires at most once per session]\n\n${parts.join('\n\n')}\n\n` +
      `OFFER the operator, in plain text, to commit and/or push — do not run git yourself and do not ` +
      `treat silence as consent. Keep it to one or two lines; if the work is clearly mid-flight, ` +
      `say you're skipping the offer and why, in one line. For a push, route through secure-push ` +
      `(the credential scan is the mechanical half; the disclosure-wording judgment is his). ` +
      `Never use the AskUserQuestion card for this.`,
  }));
  process.exit(0);
} catch { process.exit(0); }
