#!/usr/bin/env node
// =============================================================================
// credential-scan — ratcheted credential scan over git-tracked (or staged) files
// -----------------------------------------------------------------------------
// Single-file, zero-dependency Node (ESM). The MECHANICAL half of `secure-push`,
// extracted so it can run unattended at commit time — where a secret actually
// enters history. The JUDGMENT half of secure-push (disclosure wording, client
// naming, "is this OK to publish") is NOT here and is not automatable; see
// secure-push/SKILL.md. This script must never be described as making a push
// "safe" — it blocks known credential SHAPES, nothing more.
//
// WHY A RATCHET (and not a plain scan)
//   Measured 2026-09-20: a plain scan over the tracked tree flags 5 files, all
//   false positives — including secure-push/SKILL.md itself, because it documents
//   the patterns. An unattended blocking scan without a baseline would block the
//   nightly commit forever, on its own definitions. So: a baseline holds today's
//   ACCEPTED matches, and only NET-NEW matches block. Same shape as
//   wiki-lint's wikilint_gate.py.
//
// SIGNATURE DESIGN
//   sig = <path>::<patternName>::<sha256(match)[0..12]>
//   Deliberately EXCLUDES the line number. wikilint_gate.py:121 records the
//   hazard: a signature carrying a self-drifting field lets a baselined issue
//   erase itself by worsening (the line moves -> new signature -> re-fires or,
//   worse, silently rebaselines). Hashing the match means no secret material is
//   ever written to the baseline file.
//
// TIERS (added 2026-09-23, secure-push 2.0)
//   private (default) — the ratchet above. Credentials block; PII does not: a
//     private backup of the whole system is SUPPOSED to hold names and meetings.
//     This is the mode the nightly sweep and routine-health already call, and
//     its behaviour is unchanged.
//   public — for a push that strangers can read. Three things tighten:
//     1. NO BASELINE. An accepted false positive in the private vault is not
//        accepted in a public repo; every match blocks until the text changes.
//     2. soft -> hard. PII blocks instead of asking.
//     3. Two extra rule sets: public-patterns.json (generic structural leaks —
//        wikilinks, vault folder names, Windows user paths; tracked and shipped)
//        and a PRIVATE deny-list (your name, email, clients, local paths). The
//        deny-list lives outside every repo on purpose: secure-push itself is
//        published in the public slice, so a deny-list tracked beside this
//        script would publish the very names it exists to keep out.
//   --history scans every blob reachable from any ref, not just the tree: a
//   secret deleted from HEAD is still public if the old commit is.
//
// EXIT CODES
//   0  clean, or only baselined/soft findings
//   1  net-new HARD finding(s) — the caller must not commit
//   2  the scan could not run (no git, bad pattern file, unreadable baseline,
//      public tier with no deny-list) -> FAIL CLOSED. "could not measure" is
//      never reported as "clean".
//
// USAGE
//   node credential-scan.mjs                 # gate over tracked files
//   node credential-scan.mjs --staged        # gate over staged files only
//   node credential-scan.mjs --report        # list findings, always exit 0
//   node credential-scan.mjs --update-baseline
//   node credential-scan.mjs --repo <path> --tier public --history
//   node credential-scan.mjs --tier public --denylist <file>
// =============================================================================

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PATTERNS_FILE = path.join(HERE, 'credential-patterns.json');
const BASELINE_FILE = path.join(HERE, 'credential-baseline.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const MODE_REPORT = has('--report');
const MODE_UPDATE = has('--update-baseline');
const STAGED_ONLY = has('--staged');
const HISTORY = has('--history');
const argVal = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
const TIER = argVal('--tier') || 'private';
const PUBLIC = TIER === 'public';
// --vault is the original name; --repo reads better now that the target is often not the vault.
const REPO = argVal('--repo') || argVal('--vault') || path.resolve(HERE, '..', '..', '..', '..', '..');
const PUBLIC_PATTERNS_FILE = path.join(HERE, 'public-patterns.json');

// ---- fail-closed helper -----------------------------------------------------
function cannotRun(why) {
  // Per instrument-asserts-its-own-measurement-conditions: refuse, name the
  // condition, and never fall through to a zero that reads as "clean".
  console.error(`credential-scan: CANNOT RUN — ${why}`);
  console.error('credential-scan: exiting 2 (fail closed). This is NOT a clean result.');
  process.exit(2);
}

function git(args) {
  return execFileSync('git', ['-C', REPO, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

// ---- load config ------------------------------------------------------------
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(PATTERNS_FILE, 'utf8'));
} catch (e) {
  cannotRun(`pattern file unreadable (${PATTERNS_FILE}): ${e.message}`);
}
if (!Array.isArray(cfg?.patterns) || !cfg.patterns.length) {
  cannotRun('pattern file has no patterns[] — refusing to report a tree clean against an empty ruleset');
}

const compiled = [];
for (const p of cfg.patterns) {
  try {
    compiled.push({ ...p, rx: new RegExp(p.re, 'g' + (p.flags || '')) });
  } catch (e) {
    cannotRun(`pattern "${p.name}" does not compile: ${e.message}`);
  }
}
if (!['private', 'public'].includes(TIER)) cannotRun(`unknown --tier "${TIER}" (expected private|public)`);
if (PUBLIC && MODE_UPDATE) {
  cannotRun('the public tier has no baseline to update - a public match is fixed in the text, never accepted');
}

// ---- public tier: structural patterns + private deny-list ------------------
function loadRuleFile(file, label) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    cannotRun(`${label} unreadable (${file}): ${e.message}`);
  }
  if (!Array.isArray(doc?.patterns) || !doc.patterns.length) {
    cannotRun(`${label} has no patterns[] - refusing to call a public push clean against an empty ruleset`);
  }
  for (const p of doc.patterns) {
    try {
      compiled.push({ ...p, severity: 'hard', rx: new RegExp(p.re, 'g' + (p.flags || '')) });
    } catch (e) {
      cannotRun(`${label} pattern "${p.name}" does not compile: ${e.message}`);
    }
  }
}

function findDenylist() {
  const explicit = argVal('--denylist') || process.env.SECURE_PUSH_DENYLIST;
  if (explicit) {
    if (!fs.existsSync(explicit)) cannotRun(`deny-list not found at ${explicit}`);
    return explicit;
  }
  // Run from the generated runtime copy, HERE-relative paths miss the vault; the compiler's
  // .vault-root stamp (~/.claude/skills/.vault-root) finds it from there.
  const stamp = path.resolve(HERE, '..', '..', '.vault-root');
  const stamped = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : null;
  const candidates = [
    // source tree: <vault>/agent-os/Skills/Automation/secure-push/scripts -> <vault>/private
    path.resolve(HERE, '..', '..', '..', '..', '..', 'private', 'secure-push', 'public-denylist.json'),
    ...(stamped ? [path.join(stamped, 'private', 'secure-push', 'public-denylist.json')] : []),
    path.join(os.homedir(), '.secure-push', 'public-denylist.json'),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

let denylistFile = null;
if (PUBLIC) {
  for (const p of compiled) p.severity = 'hard';          // PII stops asking and starts blocking
  loadRuleFile(PUBLIC_PATTERNS_FILE, 'public-patterns.json');
  denylistFile = findDenylist();
  if (!denylistFile) {
    cannotRun('public tier needs your private deny-list (names, clients, local paths) and none was found. ' +
      'Pass --denylist <file> or set SECURE_PUSH_DENYLIST; see public-denylist.example.json.');
  }
  loadRuleFile(denylistFile, 'deny-list');
}

// Suffix match, not equality: the same rule files sit at a different path inside
// the published slice (skills/secure-push/...), and must be skipped there too.
const skipPaths = (cfg.skipPathsContaining?.values || []).map((s) => s.replace(/\\/g, '/'));
const isSkipped = (norm) => skipPaths.some((s) => norm === s || norm.endsWith('/' + s));
const pathAllowed = (p, norm) => (p.allowPaths || []).some((a) => norm === a || norm.endsWith('/' + a));
const blockGlobs = cfg.trackedFileBlocklist?.globs || [];

// ---- baseline ---------------------------------------------------------------
// The public tier deliberately loads none: see TIERS in the header.
let baseline = new Set();
if (!PUBLIC && fs.existsSync(BASELINE_FILE)) {
  try {
    const b = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    baseline = new Set(b.accepted || []);
  } catch (e) {
    cannotRun(`baseline unreadable (${BASELINE_FILE}): ${e.message}`);
  }
}

// ---- file list --------------------------------------------------------------
let files;
try {
  const out = STAGED_ONLY
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files']);
  files = out.split('\n').map((s) => s.trim()).filter(Boolean);
} catch (e) {
  cannotRun(`git file listing failed: ${e.message}`);
}

// ---- glob check for env leakage --------------------------------------------
function globMatches(file, glob) {
  const base = file.split('/').pop();
  const rx = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return rx.test(base);
}

// ---- scan -------------------------------------------------------------------
const findings = [];

function checkName(norm, where) {
  for (const g of blockGlobs) {
    if (globMatches(norm, g)) {
      findings.push({ path: norm, where, pattern: 'tracked-secret-file', severity: 'hard', shown: `tracked file matches ${g}`, sig: `${norm}::tracked-secret-file::${g}` });
    }
  }
}

function scanText(norm, text, where) {
  for (const p of compiled) {
    if (pathAllowed(p, norm)) continue;
    p.rx.lastIndex = 0;
    let m;
    while ((m = p.rx.exec(text)) !== null) {
      const match = m[0];
      const hash = crypto.createHash('sha256').update(match).digest('hex').slice(0, 12);
      const shown = match.length <= 12
        ? `${match} (no secret body — prefix only)`
        : `${match.slice(0, 10)}…${match.slice(-4)}`;
      findings.push({ path: norm, where, pattern: p.name, severity: p.severity || 'hard', shown, sig: `${norm}::${p.name}::${hash}` });
      if (!p.rx.global) break;
    }
  }
}

for (const rel of files) {
  const norm = rel.replace(/\\/g, '/');
  if (isSkipped(norm)) continue;
  checkName(norm, 'tree');

  const abs = path.join(REPO, rel);
  let buf;
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 8 * 1024 * 1024) continue;   // skip huge/non-files
    buf = fs.readFileSync(abs);
  } catch { continue; }                                        // deleted/unreadable: not a finding
  if (buf.includes(0)) continue;                               // binary
  scanText(norm, buf.toString('utf8'), 'tree');
}

// ---- history: every blob reachable from any ref ------------------------------
// One `rev-list --objects` for blob->path, one `cat-file --batch` for contents.
// A path seen at several versions is scanned at every version; the signature is
// path-scoped, so a match that is ALSO in the tree de-duplicates to one finding.
let historyBlobs = 0;
if (HISTORY) {
  let listing;
  try {
    listing = git(['rev-list', '--objects', '--all']);
  } catch (e) {
    cannotRun(`git rev-list failed: ${e.message}`);
  }
  const pathOf = new Map();
  for (const line of listing.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) pathOf.set(line.slice(0, sp), line.slice(sp + 1).trim());
  }
  let checks;
  try {
    checks = execFileSync('git', ['-C', REPO, 'cat-file', '--batch-check'], {
      input: [...pathOf.keys()].join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    cannotRun(`git cat-file --batch-check failed: ${e.message}`);
  }
  const blobs = [];
  for (const line of checks.split('\n')) {
    const [sha, type, size] = line.split(' ');
    if (type !== 'blob' || Number(size) > 8 * 1024 * 1024) continue;
    const norm = pathOf.get(sha).replace(/\\/g, '/');
    if (isSkipped(norm)) continue;
    checkName(norm, 'history');
    blobs.push(sha);
  }
  if (blobs.length) {
    let raw;
    try {
      raw = execFileSync('git', ['-C', REPO, 'cat-file', '--batch'], {
        input: blobs.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024,
      });
    } catch (e) {
      cannotRun(`git cat-file --batch failed: ${e.message}`);
    }
    let off = 0;
    while (off < raw.length) {
      const nl = raw.indexOf(10, off);
      if (nl < 0) break;
      const [sha, , size] = raw.subarray(off, nl).toString('utf8').split(' ');
      const len = Number(size);
      const body = raw.subarray(nl + 1, nl + 1 + len);
      off = nl + 1 + len + 1;                                  // trailing LF after each object
      historyBlobs++;
      if (body.includes(0)) continue;                           // binary
      scanText(pathOf.get(sha).replace(/\\/g, '/'), body.toString('utf8'), 'history');
    }
    if (historyBlobs !== blobs.length) {
      cannotRun(`history scan read ${historyBlobs} of ${blobs.length} blobs - refusing to report a partial read as clean`);
    }
  }
}

// A match present in the tree AND history is reported once, as 'tree'.
const bySig = new Map();
for (const f of findings) if (!bySig.has(f.sig) || f.where === 'tree') bySig.set(f.sig, f);
const uniq = [...bySig.values()];
const netNew = uniq.filter((f) => f.severity === 'hard' && !baseline.has(f.sig));
const baselined = uniq.filter((f) => baseline.has(f.sig));
const soft = uniq.filter((f) => f.severity !== 'hard' && !baseline.has(f.sig));

// ---- update-baseline --------------------------------------------------------
if (MODE_UPDATE) {
  const accepted = uniq.filter((f) => f.severity === 'hard').map((f) => f.sig).sort();
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({
    _note: 'Ratchet baseline for credential-scan.mjs. Each entry is <path>::<pattern>::<sha256(match)[0..12]> — a hash, never the matched text. Accepting an entry here is a STATEMENT THAT A HUMAN LOOKED AT IT and it is not a live credential. Never run --update-baseline to clear a red gate you have not read.',
    generated: new Date().toISOString(),
    accepted,
  }, null, 2) + '\n');
  console.log(`credential-scan: baseline updated — ${accepted.length} accepted signature(s)`);
  console.log('credential-scan: REMINDER — each accepted entry asserts a human read it and it is benign.');
  process.exit(0);
}

// ---- report -----------------------------------------------------------------
const scope = `${STAGED_ONLY ? 'staged' : 'tracked'}${HISTORY ? ' + history' : ''}, tier ${TIER}`;
if (MODE_REPORT || netNew.length) {
  console.log(`credential-scan: scanned ${files.length} file(s)${HISTORY ? ` + ${historyBlobs} history blob(s)` : ''} (${scope}) with ${compiled.length} pattern(s)`);
  if (PUBLIC) console.log(`credential-scan: public tier - no baseline applied; deny-list ${denylistFile}`);
  if (netNew.length) {
    console.log(`\n  NET-NEW (${netNew.length}) — these block:`);
    for (const f of netNew) console.log(`    ${f.path}  [${f.pattern}]  ${f.shown}${f.where === 'history' ? '  (history only - not in the current tree)' : ''}`);
  }
  if (MODE_REPORT && baselined.length) {
    console.log(`\n  baselined (${baselined.length}) — previously reviewed, not blocking:`);
    for (const f of baselined) console.log(`    ${f.path}  [${f.pattern}]  ${f.shown}`);
  }
  if (MODE_REPORT && soft.length) {
    console.log(`\n  soft (${soft.length}) — needs a human call, never an unattended block:`);
    for (const f of soft) console.log(`    ${f.path}  [${f.pattern}]  ${f.shown}`);
  }
}

if (MODE_REPORT) process.exit(0);

if (netNew.length) {
  console.error(`\ncredential-scan: BLOCKED — ${netNew.length} net-new hard finding(s) in ${scope} files.`);
  if (PUBLIC) {
    console.error('Public tier: fix the text (or add a narrow allowPaths entry to the deny-list for an intentional one, e.g. LICENSE).');
    console.error('A history-only hit cannot be fixed by a commit - it needs history rewrite in a FRESH CLONE, plus rotation if it is a credential.');
  } else {
    console.error('If these are false positives, read each one, then: node credential-scan.mjs --update-baseline');
  }
  process.exit(1);
}

console.log(`credential-scan: clean — 0 net-new hard findings (${baselined.length} baselined, ${scope})`);
process.exit(0);
