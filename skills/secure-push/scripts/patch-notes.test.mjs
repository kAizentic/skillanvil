#!/usr/bin/env node
// Tests for patch-notes.mjs. Run: node patch-notes.test.mjs
// Uses a local bare repo as the "remote" - no network.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, 'patch-notes.mjs');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' - ' + detail : ''}`); }
};
const run = (...args) => {
  try { return { code: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', stdio: 'pipe' }) }; }
  catch (e) { return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') }; }
};

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pnotes-'));
const remote = path.join(base, 'remote.git'), dir = path.join(base, 'work');
execFileSync('git', ['init', '-q', '--bare', remote]);
execFileSync('git', ['init', '-q', '-b', 'main', dir]);
const g = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't');
g('remote', 'add', 'origin', remote);
fs.writeFileSync(path.join(dir, 'a.txt'), '1\n'); g('add', '-A'); g('commit', '-qm', 'first');
g('push', '-q', 'origin', 'main');

console.log('patch-notes tests\n');

// NEGATIVE CLASS: nothing to push -> refused, and nothing written
ok('raw with nothing to push exits 1', run('raw', '--repo', dir).code === 1);
const notes = path.join(base, 'n.md');
fs.writeFileSync(notes, '- Added a thing.\n');
ok('write with nothing to push exits 1', run('write', '--repo', dir, '--notes', notes).code === 1);
ok('...and wrote no CHANGELOG', !fs.existsSync(path.join(dir, 'CHANGELOG.md')));

// two unpushed commits
fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src/b.js'), 'x\n'); g('add', '-A'); g('commit', '-qm', 'add b');
fs.writeFileSync(path.join(dir, 'a.txt'), '2\n'); g('add', '-A'); g('commit', '-qm', 'change a');
const r = run('raw', '--repo', dir);
ok('raw lists the unpushed commits', r.code === 0 && /2 commit\(s\)/.test(r.out) && r.out.includes('add b'), r.out);
ok('raw groups files by folder', /src\//.test(r.out) && /\(root\)/.test(r.out), r.out);

ok('write refuses empty notes', (fs.writeFileSync(path.join(base, 'e.md'), '  \n'), run('write', '--repo', dir, '--notes', path.join(base, 'e.md')).code === 1));
const w = run('write', '--repo', dir, '--notes', notes);
ok('write succeeds', w.code === 0, w.out);
const cl = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
ok('CHANGELOG gets an H1 and a dated, range-tagged entry', /^# Changelog\n\n## \d{4}-\d{2}-\d{2} `[0-9a-f]+\.\.[0-9a-f]+`\n\n- Added a thing\./.test(cl), cl);
ok('a second write for the same range is refused', run('write', '--repo', dir, '--notes', notes).code === 1);

// newest entry goes first
g('add', '-A'); g('commit', '-qm', 'docs: patch notes'); g('push', '-q', 'origin', 'main');
fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n'); g('add', '-A'); g('commit', '-qm', 'add c');
fs.writeFileSync(notes, '- Added c.\n');
run('write', '--repo', dir, '--notes', notes);
const cl2 = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
ok('the newest entry is written above the older one', cl2.indexOf('Added c.') < cl2.indexOf('Added a thing.'), cl2);

fs.rmSync(base, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
