#!/usr/bin/env node
// =============================================================================
// patch-notes — one short, dated CHANGELOG.md entry per push, in the repo itself
// -----------------------------------------------------------------------------
// Two halves, split on purpose:
//   raw    prints what is about to be pushed (commits in <remote>/<branch>..HEAD
//          and the files they touch, grouped by top-level folder). Raw material
//          for a person or model to write 2-5 bullets from. A list of commit
//          subjects is not patch notes: 41 nightly "chore(generated)" commits say
//          nothing a reader needs.
//   write  prepends those bullets to CHANGELOG.md under a dated heading that
//          records the exact range. Refuses empty notes, and refuses a range that
//          already has an entry, so a retried push cannot double-log.
// The notes are committed with the push, so on a PUBLIC remote they are scanned
// by the public tier and read for disclosure like any other text.
//
// USAGE
//   node patch-notes.mjs raw   --repo <path> [--remote origin] [--branch <b>]
//   node patch-notes.mjs write --repo <path> --notes <file> [--remote origin] [--branch <b>]
// EXIT  0 ok - 1 refused (empty notes, duplicate range, nothing to push) - 2 could not run
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0];
const argVal = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
const REPO = argVal('--repo') || process.cwd();
const REMOTE = argVal('--remote') || 'origin';

const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function cannotRun(why) { console.error(`patch-notes: CANNOT RUN - ${why}`); process.exit(2); }

let branch;
try { branch = argVal('--branch') || git('rev-parse', '--abbrev-ref', 'HEAD'); } catch (e) { cannotRun(`not a git repo: ${REPO}`); }
const upstream = `${REMOTE}/${branch}`;
let base;
try { base = git('rev-parse', '--verify', '--quiet', upstream); } catch { base = null; }
// First push to this remote/branch: the whole history is "what is being pushed".
const range = base ? `${upstream}..HEAD` : 'HEAD';
const head = git('rev-parse', '--short', 'HEAD');
const from = base ? git('rev-parse', '--short', upstream) : 'root';

const commits = git('log', '--no-merges', '--format=%h %s', range).split('\n').filter(Boolean);

if (cmd === 'raw') {
  if (!commits.length) { console.log(`patch-notes: nothing to push (${range})`); process.exit(1); }
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';   // git's fixed id for an empty tree
  const files = git('diff', '--name-only', base ? upstream : EMPTY_TREE, 'HEAD').split('\n').filter(Boolean);
  const groups = files.reduce((m, f) => { const k = f.includes('/') ? f.split('/')[0] + '/' : '(root)'; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`range ${from}..${head} on ${upstream}: ${commits.length} commit(s), ${files.length} file(s)\n`);
  console.log('files by folder:');
  for (const [k, n] of Object.entries(groups).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log('\ncommits (newest first):');
  for (const c of commits.slice(0, 60)) console.log(`  ${c}`);
  if (commits.length > 60) console.log(`  ... ${commits.length - 60} more`);
  process.exit(0);
}

if (cmd === 'write') {
  const notesFile = argVal('--notes');
  if (!notesFile || !fs.existsSync(notesFile)) cannotRun('write needs --notes <file>');
  const notes = fs.readFileSync(notesFile, 'utf8').replace(/\r\n/g, '\n').trim();
  if (!notes) { console.error('patch-notes: refused - empty notes'); process.exit(1); }
  if (!commits.length) { console.error(`patch-notes: refused - nothing to push (${range})`); process.exit(1); }
  const cl = path.join(REPO, 'CHANGELOG.md');
  const existing = fs.existsSync(cl) ? fs.readFileSync(cl, 'utf8').replace(/\r\n/g, '\n') : '# Changelog\n';
  const tag = `${from}..${head}`;
  if (existing.includes(`\`${tag}\``)) { console.error(`patch-notes: refused - ${tag} already has an entry`); process.exit(1); }
  const date = new Date().toISOString().slice(0, 10);
  const section = `## ${date} \`${tag}\`\n\n${notes}\n`;
  // Insert under the H1 if there is one, so the newest entry is always first.
  const m = /^# .*\n+/.exec(existing);
  const out = m
    ? existing.slice(0, m[0].length).replace(/\n+$/, '\n\n') + section + '\n' + existing.slice(m[0].length)
    : section + '\n' + existing;
  fs.writeFileSync(cl, out.replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n'));
  console.log(`patch-notes: wrote ${tag} to ${cl}`);
  process.exit(0);
}

cannotRun(`unknown command "${cmd}" (raw|write)`);
