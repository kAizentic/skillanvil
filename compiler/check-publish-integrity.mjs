#!/usr/bin/env node
/**
 * PUBLISH INTEGRITY CHECK
 *
 * Asserts that the *published* runtime skill tree is actually usable, rather than
 * trusting that the compiler exited 0.
 *
 * Why this exists. On 2026-07-22 an `npm install` put 3,881 files into a skill's
 * source dir. From that moment the compiler could never finish mirroring that
 * skill, and a Stop hook registered in the GLOBAL settings.json pointed at a file
 * inside the half-published tree. Every open Claude Code session broke. It stayed
 * invisible for ten days because every invoker reported success: the logon-spawned
 * watcher ran windowless with nobody reading stdout, the daily Cowork sync reported
 * result=0, and the compiler's own exit code was 0. An exit code says a process
 * ended, not that its output is correct.
 *
 * Three assertions, all cheap (metadata only — no file contents are read, which
 * matters because the vault sits on a cloud-sync root where a cold content read
 * costs ~2s):
 *   1. every hook command path in settings.json resolves on disk
 *   2. every source support file a skill declares is present in its runtime copy
 *   3. no atomic-publish debris was left behind by a crashed run
 *
 * Usage:  node check-publish-integrity.mjs [--vault <path>] [--quiet] [--json]
 * Exit:   0 = clean, 1 = findings, 2 = the check itself could not run.
 *
 * --json makes this an ADR-0018 *instance*: the contract is "the JSON it emits under
 * --json", not a library it imports. Added 2026-09-22 because compile-skills.mjs's
 * probeRanCleanly (landed the same day) distinguishes "real finding" from "the script
 * crashed" by re-running the check with --json and parsing stdout — on the stated premise
 * that "each of these checks already implements it". This one did not, so its findings
 * path dead-ended in "skipped (check errored)" and the "runtime tree is NOT usable as
 * published" branch was unreachable. The regression was invisible on the clean path,
 * which is the path it was verified on.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const BANNER = 'PUBLISH INTEGRITY CHECK';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const vaultArg = args.indexOf('--vault');
const AI_SYSTEMS_DIR = path.resolve(__dirname, '..');
const VAULT_ROOT =
  vaultArg !== -1 && args[vaultArg + 1]
    ? path.resolve(args[vaultArg + 1])
    : path.resolve(AI_SYSTEMS_DIR, '..');

const VAULT_SKILLS_DIR = path.join(AI_SYSTEMS_DIR, 'Skills');
const RUNTIME_DIR =
  process.env.CLAUDE_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');
const STAGING_ROOT = path.join(path.dirname(RUNTIME_DIR), '.skill-staging');

// Must stay in step with compile-skills.mjs — a name skipped there is legitimately
// absent from the runtime and must not be reported as missing here.
const SKIP_DIRS = new Set(['Templates', 'node_modules']);

const SETTINGS_FILES = [
  path.join(os.homedir(), '.claude', 'settings.json'),
  path.join(VAULT_ROOT, '.claude', 'settings.json'),
];

const findings = [];
const add = (kind, msg) => findings.push({ kind, msg });

// ---------------------------------------------------------------------------
// 1. Hook command paths resolve
// ---------------------------------------------------------------------------
// Only absolute paths carrying a script extension are asserted. Anything else
// (bare shell builtins, env-var indirection, inline one-liners) is skipped rather
// than guessed at — a false positive here would train the reader to ignore it.
const SCRIPT_EXT = /\.(mjs|cjs|js|ts|py|ps1|cmd|bat|sh)$/i;

function extractPaths(command) {
  const out = [];
  const quoted = String(command).match(/"([^"]+)"|'([^']+)'/g) || [];
  for (const q of quoted) out.push(q.slice(1, -1));
  for (const tok of String(command).split(/\s+/)) {
    if (/^["']/.test(tok)) continue;
    out.push(tok);
  }
  return out.filter(
    (p) => SCRIPT_EXT.test(p) && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/'))
  );
}

function checkHooks() {
  let checked = 0;
  for (const settingsPath of SETTINGS_FILES) {
    if (!fs.existsSync(settingsPath)) continue;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      add('hook', `${settingsPath} is not valid JSON (${e.message.split('\n')[0]})`);
      continue;
    }
    const label = settingsPath.includes(path.join('.claude', 'settings.json'))
      && settingsPath.startsWith(os.homedir()) ? 'global' : 'project';
    for (const [event, groups] of Object.entries(json.hooks || {})) {
      for (const group of groups || []) {
        for (const hook of group.hooks || []) {
          for (const p of extractPaths(hook.command || '')) {
            checked++;
            if (!fs.existsSync(p)) {
              add(
                'hook',
                `${label} ${event} hook points at a file that does not exist:\n        ${p}`
              );
            }
          }
        }
      }
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 2. Every declared support file is actually published
// ---------------------------------------------------------------------------
function listSupport(baseDir) {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), relPath);
      else if (relPath !== 'SKILL.md' && relPath !== 'metadata.json') out.push(relPath);
    }
  };
  walk(baseDir, '');
  return out;
}

function checkPublished() {
  let checked = 0;
  if (!fs.existsSync(VAULT_SKILLS_DIR)) return checked;

  for (const category of fs.readdirSync(VAULT_SKILLS_DIR)) {
    if (SKIP_DIRS.has(category) || category.startsWith('_') || category.startsWith('.')) continue;
    const catDir = path.join(VAULT_SKILLS_DIR, category);
    let isDir = false;
    try { isDir = fs.statSync(catDir).isDirectory(); } catch { continue; }
    if (!isDir) continue;

    for (const skillId of fs.readdirSync(catDir)) {
      const skillDir = path.join(catDir, skillId);
      try { if (!fs.statSync(skillDir).isDirectory()) continue; } catch { continue; }
      if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;

      // A skill can be legitimately absent from the runtime (deprecated +
      // superseded skills are deliberately "retired → not emitted"). Only skills
      // that ARE published are checked for completeness — otherwise this would
      // report every retired skill as broken, which is how the earlier structural
      // diff in this investigation produced two false "missing skill" findings.
      const outDir = path.join(RUNTIME_DIR, skillId);
      if (!fs.existsSync(outDir)) continue;

      checked++;

      // The two files the compiler writes itself. listSupport() excludes them by
      // design, so without this an published dir missing its SKILL.md — the one
      // file that makes it a skill at all — would pass silently. Found by the
      // check's own negative test, which is the point of running one.
      for (const core of ['SKILL.md', 'metadata.json']) {
        if (!fs.existsSync(path.join(outDir, core))) {
          add('published', `${category}/${skillId}: published dir is missing ${core}`);
        }
      }

      const missing = listSupport(skillDir).filter(
        (rel) => !fs.existsSync(path.join(outDir, rel.split('/').join(path.sep)))
      );
      if (missing.length) {
        const shown = missing.slice(0, 5).map((m) => `          ${m}`).join('\n');
        add(
          'published',
          `${category}/${skillId}: ${missing.length} declared support file(s) absent from ` +
            `~/.claude/skills/${skillId}/\n${shown}` +
            (missing.length > 5 ? `\n          … and ${missing.length - 5} more` : '')
        );
      }
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------
// 3. No atomic-publish debris
// ---------------------------------------------------------------------------
function checkDebris() {
  if (fs.existsSync(RUNTIME_DIR)) {
    for (const e of fs.readdirSync(RUNTIME_DIR, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.staging-') || e.name.startsWith('.retired-')) {
        add(
          'debris',
          `publish debris inside the scanned skills dir: ~/.claude/skills/${e.name}/ ` +
            `(a crashed run left it; it is surfaced to the model as a loadable skill)`
        );
      }
    }
  }
  if (fs.existsSync(STAGING_ROOT)) {
    const left = fs.readdirSync(STAGING_ROOT).filter((n) => !n.startsWith('.'));
    if (left.length) {
      add('debris', `${left.length} stale dir(s) in ${STAGING_ROOT} — a compile died mid-publish`);
    }
  }
}

// ---------------------------------------------------------------------------
const hooksChecked = checkHooks();
const skillsChecked = checkPublished();
checkDebris();

// ---------------------------------------------------------------------------
// 4. The instrument asserts its own measurement conditions (added 2026-09-22)
// ---------------------------------------------------------------------------
// Every assertion above iterates a set and checks each member, so an EMPTY set passes all of
// them vacuously. Measured: with CLAUDE_SKILLS_DIR pointed at an empty directory this script
// printed "OK - 26 hook path(s) resolve, 0 published skill(s) complete, no debris" and exited
// 0. The one instrument whose job is to prove the published tree is usable reported success on
// a tree that did not exist. That is *empty set passes every check*.
//
// It is not an oversight in checkPublished -- `if (!fs.existsSync(outDir)) continue` is
// deliberate and correct, because deprecated skills are legitimately not emitted, and an
// earlier structural diff produced two false "missing skill" findings without it. The defect is
// that the skip has no FLOOR: one absent skill and eighty-three absent skills are the same
// reading. *proxy signal collapses the two states* -- "retired" and "never published"
// share a signal.
//
// So: a count of zero is only trustworthy if something could have been counted. These assert
// the conditions rather than the results, and they cost nothing on a healthy run.
if (!fs.existsSync(RUNTIME_DIR)) {
  add('published', `the runtime skills dir does not exist at all: ${RUNTIME_DIR} ` +
    `- nothing was published, and every completeness check above passed vacuously`);
} else if (skillsChecked === 0) {
  const sourceCount = fs.existsSync(VAULT_SKILLS_DIR)
    ? fs.readdirSync(VAULT_SKILLS_DIR).filter((c) => {
        if (SKIP_DIRS.has(c) || c.startsWith('_') || c.startsWith('.')) return false;
        try { return fs.statSync(path.join(VAULT_SKILLS_DIR, c)).isDirectory(); } catch { return false; }
      }).length
    : 0;
  if (sourceCount > 0) {
    add('published', `0 of the source skills are present in ${RUNTIME_DIR} ` +
      `(${sourceCount} source categor(ies) exist) - the runtime tree is empty or wrong, ` +
      `not merely incomplete`);
  }
}

// Same shape, and the more consequential half: this script exists because a hook path in
// settings.json broke every open session for ten days. If settings.json is absent, unreadable
// or carries no hooks block, checkHooks() iterates nothing and reports clean -- the exact
// condition it was written to detect, rendered invisible.
if (hooksChecked === 0) {
  add('hook', `no hook commands were found in any settings file ` +
    `(${SETTINGS_FILES.filter((f) => fs.existsSync(f)).length} of ${SETTINGS_FILES.length} ` +
    `exist on disk) - this check could not observe the thing it exists to observe`);
}

// The instance contract: a FLAT {category: [msg]} map -- the shape design-system-lint.mjs
// emits and open-findings.mjs iterates, deliberately not a fifth shape. All three keys are
// always present even when empty: open-findings throws on "an object with no categories",
// and a category omitted when empty makes "clean" and "did not run" indistinguishable to a
// consumer that counts keys. Exit code is unchanged from the human path (0 clean / 1
// findings) so --json does not introduce a second exit convention for the same check.
if (args.includes('--json')) {
  const byKind = { hook: [], published: [], debris: [] };
  for (const f of findings) (byKind[f.kind] ||= []).push(f.msg);
  process.stdout.write(JSON.stringify(byKind, null, 2) + '\n');
  process.exit(findings.length ? 1 : 0);
}

if (!findings.length) {
  if (!quiet) {
    process.stdout.write(
      `publish-integrity: OK — ${hooksChecked} hook path(s) resolve, ` +
        `${skillsChecked} published skill(s) complete, no debris.\n`
    );
  }
  process.exit(0);
}

process.stdout.write(`\n${BANNER}\n${'='.repeat(BANNER.length)}\n`);
const order = ['hook', 'published', 'debris'];
const titles = {
  hook: 'BROKEN HOOK TARGET(S) — these break every open session, not just this one',
  published: 'INCOMPLETE PUBLISH — the runtime copy is missing files its source declares',
  debris: 'PUBLISH DEBRIS',
};
for (const kind of order) {
  const group = findings.filter((f) => f.kind === kind);
  if (!group.length) continue;
  process.stdout.write(`\n${titles[kind]} (${group.length})\n`);
  for (const f of group) process.stdout.write(`  • ${f.msg}\n`);
}
process.stdout.write(
  `\nChecked ${hooksChecked} hook path(s) and ${skillsChecked} published skill(s).\n` +
    `Fix by re-running: node "agent-os/compiler/compile-skills.mjs" compile\n`
);
process.exit(1);
