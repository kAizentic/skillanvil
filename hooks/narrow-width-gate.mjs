#!/usr/bin/env node
// narrow-width-gate — the enforcement half of the "verify HTML deliverables at ~400px
// before shipping" rule (global CLAUDE.md, landed 2026-07-17).
//
// WHY A HOOK AND NOT ANOTHER BULLET
// The rule-retirement audit records 4 violations of this rule against 754 triggering
// events, which puts it in the FAILING bucket: the prose exists and the problem
// persists. The here-string precedent says a violated rule wants an INSTRUMENT, not a
// restatement — a hook that fires is a stronger instrument than a 37th CLAUDE.md line
// competing for attention with 36 others.
//
// TWO MODES (one file, wired at two events — same shape as context-guard.mjs):
//   record : PostToolUse on Write|Edit. Notes .html files touched this session.
//   (none) : Stop. If any noted file has no matching measurement receipt, nudge once.
//
// The receipt is written by library/scripts/html-narrow-check.mjs and keyed by the
// file's CONTENT hash, so editing a page after checking it invalidates the receipt.
// A receipt is only written when the check actually ran — a broken checker must not
// silence the gate the same way a clean page does.
//
// This NUDGES, it does not block the write. You cannot measure a page before writing
// it, so the only honest gate point is the end of the turn, when it would ship.
// Deliberately biased to false negatives: a gate that cries wolf on every scratch file
// is how a real one goes unread.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const STATE_DIR = path.join(os.tmpdir(), 'claude-narrow-gate');
const RECEIPT_DIR = path.join(os.tmpdir(), 'claude-narrow-check');

// Build output, dependencies, and scratch space are not deliverables. The operator's own
// scratchpad is excluded too: a throwaway probe page is not something he ships.
const IGNORE = /(node_modules|[\\/]\.next[\\/]|[\\/]dist[\\/]|[\\/]build[\\/]|[\\/]out[\\/]|[\\/]coverage[\\/]|[\\/]\.git[\\/]|[\\/]\.cache[\\/]|[\\/]vendor[\\/]|[\\/]scratchpad[\\/]|[\\/]Temp[\\/])/i;

function readStdin() {
  // strip a UTF-8 BOM: PowerShell 5.1 pipes add one, and it breaks JSON.parse
  try { return fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; }
}

function sessionFile(id) { return path.join(STATE_DIR, id + '.json'); }

function record(payload) {
  const id = payload.session_id;
  if (!id) return;
  const input = payload.tool_input || {};
  const fp = String(input.file_path || input.path || '');
  if (!/\.html?$/i.test(fp) || IGNORE.test(fp)) return;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const f = sessionFile(id);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first write */ }
  const abs = path.resolve(fp);
  if (!list.includes(abs)) list.push(abs);
  fs.writeFileSync(f, JSON.stringify(list), 'utf8');
}

function checkAtStop(payload) {
  if (payload.stop_hook_active) return;            // we caused this turn — stay quiet
  const id = payload.session_id;
  if (!id) return;
  const f = sessionFile(id);
  const latch = path.join(STATE_DIR, id + '.nudged');
  if (!fs.existsSync(f) || fs.existsSync(latch)) return;

  let list = [];
  try { list = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }

  // Two distinct misses, and collapsing them would hide the worse one: shipping
  // something never measured, and shipping something measured and found broken.
  const unchecked = [];
  const overflowing = [];
  for (const abs of list) {
    let buf;
    try { buf = fs.readFileSync(abs); } catch { continue; }   // deleted or moved
    if (!buf.length) continue;
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const rp = path.join(RECEIPT_DIR, hash + '.json');
    if (!fs.existsSync(rp)) { unchecked.push(abs); continue; }
    try {
      const receipt = JSON.parse(fs.readFileSync(rp, 'utf8'));
      if (receipt.clean === false) overflowing.push(abs);
    } catch { unchecked.push(abs); }                          // unreadable receipt = no receipt
  }
  if (!unchecked.length && !overflowing.length) return;

  fs.writeFileSync(latch, new Date().toISOString());          // once per session

  const fmt = (arr) => {
    const shown = arr.slice(0, 5);
    const more = arr.length - shown.length;
    const lines = shown.map((p) => '- ' + p);
    if (more > 0) lines.push('- ...and ' + more + ' more (not listed, same status)');
    return lines.join('\n');
  };

  const parts = ['[narrow-width gate - fires once per session]'];
  if (unchecked.length) {
    parts.push('HTML written this session with NO 400px measurement on record:\n' + fmt(unchecked));
  }
  if (overflowing.length) {
    parts.push('HTML measured this session that OVERFLOWS at 400px and has not been fixed since:\n' +
      fmt(overflowing));
  }
  parts.push(
    'the operator reads HTML in a narrow pane, and "it does not fit the screen" has come ' +
    'back 4 times. Measure before you call it done:\n' +
    '  node "<VAULT_ROOT>/library/scripts/html-narrow-check.mjs" <file> [--widths 400,768]\n' +
    'Exit 0 clean, 1 overflow (it prints the offending elements), 2 the check itself ' +
    'failed, 3 nothing to check. Fix any hard overflow with a real breakpoint, not by ' +
    'adding overflow-x:hidden - the checker reports that as the cheat it is.\n' +
    'If a file above is genuinely not a deliverable (a fixture, a scratch probe, a ' +
    'fragment), or the overflow is deliberate and you have said so to the operator, state ' +
    'that in one line and move on. Do not silently re-run the check to clear the nudge.');

  console.log(JSON.stringify({ decision: 'block', reason: parts.join('\n') }));
}

try {
  const payload = JSON.parse(readStdin() || '{}');
  if (process.argv[2] === 'record') record(payload);
  else checkAtStop(payload);
} catch { /* a gate must never break the session it guards */ }
process.exit(0);
