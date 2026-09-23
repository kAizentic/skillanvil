#!/usr/bin/env node
// Tests for credential-scan.mjs. Run: node credential-scan.test.mjs
//
// The NEGATIVE-CLASS cases are the point. A blocking gate is easy to test by
// making it block; the branch that dies unnoticed is the one where it must stay
// SILENT (the selfimprove-guard failure: an always-on guard nobody noticed for
// months because its quiet branch was unreachable). ADR 0019 makes a
// negative-class fixture a requirement for gates of this shape.
//
// These exercise the pattern/ratchet logic in a temp git repo — never the live
// vault, and never the network.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCAN = path.join(HERE, 'credential-scan.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credscan-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 'test@example.invalid');
  g('config', 'user.name', 'test');
  return { dir, g };
}

function runScan(dir, args = []) {
  try {
    const out = execFileSync('node', [SCAN, '--vault', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// A well-formed but obviously fake key. Never a real credential shape with a real body.
const FAKE_PAT = 'ghp_' + 'A'.repeat(36);
const FAKE_AWS = 'AKIA' + 'B'.repeat(16);

console.log('credential-scan tests\n');

// --- 1. POSITIVE: a credential in a tracked file blocks -----------------------
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'leak.md'), `key\n${FAKE_PAT}\n`);
  g('add', '-A'); g('commit', '-qm', 'x');
  const r = runScan(dir);
  ok('detects a github PAT in a tracked file', r.code === 1, `exit ${r.code}`);
  ok('names the offending path', r.out.includes('leak.md'));
  ok('redacts the match (no full secret echoed)', !r.out.includes(FAKE_PAT));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 2. NEGATIVE-CLASS: a benign repo must stay SILENT and exit 0 ------------
// The branch that a blocking-only test can never cover.
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'notes.md'),
    'prose about tokens, secrets and passwords — no credential here.\n' +
    'Even the word api_key on its own should not fire.\n');
  g('add', '-A'); g('commit', '-qm', 'x');
  const r = runScan(dir);
  ok('stays silent on a benign repo', r.code === 0, `exit ${r.code}`);
  ok('reports clean explicitly', /clean/.test(r.out));
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 3. RATCHET: a baselined finding stops blocking; a NEW one still blocks ---
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), `example\n${FAKE_PAT}\n`);
  g('add', '-A'); g('commit', '-qm', 'x');

  ok('blocks before baselining', runScan(dir).code === 1);

  // Baseline it the way the real flow does, then confirm it no longer blocks.
  const baselinePath = path.join(HERE, 'credential-baseline.json');
  const saved = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : null;
  try {
    const sig = `doc.md::github-pat-classic::${crypto.createHash('sha256').update(FAKE_PAT).digest('hex').slice(0, 12)}`;
    fs.writeFileSync(baselinePath, JSON.stringify({ accepted: [sig] }, null, 2));
    ok('a baselined finding no longer blocks', runScan(dir).code === 0);

    // ...and a DIFFERENT credential added afterwards must still block. This is
    // the ratchet's whole purpose: accepting one thing must not accept the next.
    fs.writeFileSync(path.join(dir, 'new.md'), `${FAKE_AWS}\n`);
    g('add', '-A'); g('commit', '-qm', 'y');
    const r = runScan(dir);
    ok('a NET-NEW credential still blocks after baselining', r.code === 1, `exit ${r.code}`);
    ok('the net-new one is the AWS key, not the baselined PAT', r.out.includes('new.md'));
  } finally {
    if (saved !== null) fs.writeFileSync(baselinePath, saved);
    else fs.rmSync(baselinePath, { force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 4. FAIL CLOSED: cannot-measure must exit 2, never 0 ---------------------
{
  const r = runScan(path.join(os.tmpdir(), 'definitely-not-a-git-repo-' + Date.now()));
  ok('exits 2 (not 0) when it cannot run', r.code === 2, `exit ${r.code}`);
  ok('says it is NOT a clean result', /NOT a clean result/.test(r.out));
}

// --- 5. Signature excludes the line number ----------------------------------
// wikilint_gate.py:121 — a signature carrying a self-drifting field lets a
// baselined issue erase itself by worsening. Moving the match must not change
// its signature, so a baselined finding stays baselined when the file grows.
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), `${FAKE_PAT}\n`);
  g('add', '-A'); g('commit', '-qm', 'x');
  const baselinePath = path.join(HERE, 'credential-baseline.json');
  const saved = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : null;
  try {
    const sig = `a.md::github-pat-classic::${crypto.createHash('sha256').update(FAKE_PAT).digest('hex').slice(0, 12)}`;
    fs.writeFileSync(baselinePath, JSON.stringify({ accepted: [sig] }, null, 2));
    ok('baselined at original position', runScan(dir).code === 0);
    // push the match down 20 lines — same content, new line number
    fs.writeFileSync(path.join(dir, 'a.md'), '\n'.repeat(20) + `${FAKE_PAT}\n`);
    g('add', '-A'); g('commit', '-qm', 'moved');
    ok('still baselined after the match moves lines', runScan(dir).code === 0);
  } finally {
    if (saved !== null) fs.writeFileSync(baselinePath, saved);
    else fs.rmSync(baselinePath, { force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================
// PUBLIC TIER (secure-push 2.0). Every case passes an explicit temp deny-list so
// the tests never read the real one and never depend on where they run.
// =============================================================================
function mkDenylist(patterns) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deny-')), 'deny.json');
  fs.writeFileSync(f, JSON.stringify({ patterns }));
  return f;
}
const DENY = mkDenylist([
  { name: 'owner', re: '\\bZebulon\\b', allowPaths: ['LICENSE'] },
  { name: 'client', re: '\\bGlobexCo\\b', flags: 'i' },
]);
const pub = (dir, extra = []) => runScan(dir, ['--tier', 'public', '--denylist', DENY, ...extra]);

// --- 6. NEGATIVE-CLASS, public: an ordinary open-source repo stays silent ----
// Includes the near-misses the structural patterns must NOT fire on: bash [[ ]],
// nested arrays, placeholder home paths, noreply/example addresses, git@ remotes.
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'build.sh'), 'if [[ -f x ]]; then echo ok; fi\n');
  fs.writeFileSync(path.join(dir, 'grid.js'), 'const m = [[1, 2], [3, 4]];\n' +
    'const link = `[[${s.data.name || s.skillId}]]`;  // code that generates links (live false positive, 2026-09-23)\n');
  fs.writeFileSync(path.join(dir, 'README.md'),
    'Install to C:\\Users\\<you>\\tools or /home/user/tools.\n' +
    'Fixture path /Users/x/proj is a single-letter placeholder.\n' +
    'Contact: team@example.com. Remote: git@github.com:acme/tool.git\n' +
    'Co-Authored-By: bot <noreply@anthropic.com>\n');
  g('add', '-A'); g('commit', '-qm', 'x');
  const r = pub(dir);
  ok('public tier stays silent on a benign repo', r.code === 0, `exit ${r.code}\n${r.out}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 7. public: structural leaks block ----------------------------------------
for (const [label, text] of [
  ['a wikilink', 'see [[concepts/some-page]] for why\n'],
  ['a vault folder name', 'written to your-private-folder-a/notes\n'],
  ['a real Windows home path', 'C:\\Users\\zeb\\projects\n'],
  ['a real email address', 'mail zeb.personal@gmail.com\n'],
]) {
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), text);
  g('add', '-A'); g('commit', '-qm', 'x');
  ok(`public tier blocks ${label}`, pub(dir).code === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 8. public: private deny-list terms block, allowPaths exempts ------------
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'Copyright 2026 Zebulon\n');
  g('add', '-A'); g('commit', '-qm', 'x');
  ok('allowPaths lets the owner name sit in LICENSE', pub(dir).code === 0);
  fs.writeFileSync(path.join(dir, 'notes.md'), 'built for globexco last spring\n');
  g('add', '-A'); g('commit', '-qm', 'y');
  const r = pub(dir);
  ok('a client name from the deny-list blocks', r.code === 1 && r.out.includes('notes.md'), `exit ${r.code}`);
  // The same file is fine in the PRIVATE tier: names are not a private-tier concern.
  ok('the private tier ignores deny-list terms', runScan(dir).code === 0);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 9. public: the baseline does NOT apply ------------------------------------
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), `${FAKE_PAT}\n`);
  g('add', '-A'); g('commit', '-qm', 'x');
  const baselinePath = path.join(HERE, 'credential-baseline.json');
  const saved = fs.existsSync(baselinePath) ? fs.readFileSync(baselinePath, 'utf8') : null;
  try {
    const sig = `doc.md::github-pat-classic::${crypto.createHash('sha256').update(FAKE_PAT).digest('hex').slice(0, 12)}`;
    fs.writeFileSync(baselinePath, JSON.stringify({ accepted: [sig] }, null, 2));
    ok('private tier honours the baseline', runScan(dir).code === 0);
    ok('public tier ignores the baseline and blocks', pub(dir).code === 1);
    ok('public tier refuses --update-baseline (exit 2)', pub(dir, ['--update-baseline']).code === 2);
  } finally {
    if (saved !== null) fs.writeFileSync(baselinePath, saved);
    else fs.rmSync(baselinePath, { force: true });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 10. public: no deny-list is a refusal, not a pass ---------------------------
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), 'benign\n');
  g('add', '-A'); g('commit', '-qm', 'x');
  const r = runScan(dir, ['--tier', 'public', '--denylist', path.join(os.tmpdir(), 'no-such-deny-' + Date.now() + '.json')]);
  ok('public tier with a missing deny-list exits 2', r.code === 2, `exit ${r.code}`);
  const empty = mkDenylist([]);
  ok('public tier with an EMPTY deny-list exits 2', runScan(dir, ['--tier', 'public', '--denylist', empty]).code === 2);
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 11. --history: a secret deleted from HEAD still blocks -----------------------
{
  const { dir, g } = mkRepo();
  fs.writeFileSync(path.join(dir, 'api.ts'), `const k = "${FAKE_PAT}";\n`);
  g('add', '-A'); g('commit', '-qm', 'add');
  fs.writeFileSync(path.join(dir, 'api.ts'), 'const k = process.env.K;\n');
  g('add', '-A'); g('commit', '-qm', 'remove');
  ok('tree-only public scan misses the deleted secret', pub(dir).code === 0);
  const r = pub(dir, ['--history']);
  ok('--history finds the secret in an old commit', r.code === 1, `exit ${r.code}`);
  ok('--history labels it history-only', /history only/.test(r.out));
  ok('--history still redacts', !r.out.includes(FAKE_PAT));
  // negative class for history: a clean history stays clean
  const c = mkRepo();
  fs.writeFileSync(path.join(c.dir, 'a.md'), 'one\n'); c.g('add', '-A'); c.g('commit', '-qm', '1');
  fs.writeFileSync(path.join(c.dir, 'a.md'), 'two\n'); c.g('add', '-A'); c.g('commit', '-qm', '2');
  ok('--history stays silent on a clean history', pub(c.dir, ['--history']).code === 0);
  fs.rmSync(c.dir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- 12. detect-tier fails closed without touching the network -----------------
{
  const TIER = path.join(HERE, 'detect-tier.mjs');
  const { dir, g } = mkRepo();
  g('remote', 'add', 'origin', 'https://gitlab.example.invalid/a/b.git');
  const o = execFileSync('node', [TIER, '--repo', dir], { encoding: 'utf8' });
  ok('a non-GitHub remote is treated as public', /tier=public/.test(o), o);
  let code = 0;
  try { execFileSync('node', [TIER, '--repo', dir, '--remote', 'nope'], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  ok('a missing remote exits 2', code === 2, `exit ${code}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
