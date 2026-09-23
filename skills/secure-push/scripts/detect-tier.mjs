#!/usr/bin/env node
// =============================================================================
// detect-tier — which secure-push tier does a push to this remote need?
// -----------------------------------------------------------------------------
// Asks as a STRANGER: an anonymous GET on the GitHub repo URL. `gh repo view`
// answers as the owner, which is exactly the wrong identity for "can someone
// else read this?" (lesson from framer-package's source-exposure gate).
//
//   200                -> public
//   404                -> private (or not created yet; either way no stranger reads it)
//   anything else      -> public, FAIL-CLOSED: an unknown answer takes the stricter tier
//   non-GitHub remote  -> public, FAIL-CLOSED, same reason
//
// Deliberately NOT a publish check. Going public is a separate decision made by a
// separate skill; secure-push only matches its gate to what the remote is NOW. A
// private repo that will later be made public must pass the public tier (with
// --history) at that moment, run by whatever does the publishing.
//
// USAGE   node detect-tier.mjs [--repo <path>] [--remote origin] [--json]
// OUTPUT  tier=<public|private> remote=<url> reason=<...>   (ASCII, one line)
// EXIT    0 tier decided (including fail-closed public) - 2 no such remote / not a repo
// =============================================================================

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const argVal = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
const REPO = argVal('--repo') || process.cwd();
const REMOTE = argVal('--remote') || 'origin';
const JSON_OUT = argv.includes('--json');

let url;
try {
  url = execFileSync('git', ['-C', REPO, 'remote', 'get-url', REMOTE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  console.error(`detect-tier: no remote "${REMOTE}" in ${REPO} - cannot choose a tier`);
  process.exit(2);
}

const gh = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
let status = null;
let fetchErr = null;
if (gh) {
  try {
    const res = await fetch(`https://github.com/${gh[1]}/${gh[2]}`, { redirect: 'follow' });
    status = res.status;
    await res.body?.cancel();
  } catch (e) {
    fetchErr = e.message;
  }
}

function decide() {
  if (!gh) return ['public', 'non-GitHub remote, visibility unverifiable -> fail-closed to public'];
  if (status === null) return ['public', `anonymous GET failed (${fetchErr}) -> fail-closed to public`];
  if (status === 200) return ['public', 'anonymous GET 200 - a stranger can read it'];
  if (status === 404) return ['private', 'anonymous GET 404 - not readable by a stranger'];
  return ['public', `anonymous GET ${status} -> fail-closed to public`];
}

const [tier, reason] = decide();
if (JSON_OUT) console.log(JSON.stringify({ tier, remote: url, reason }));
else console.log(`tier=${tier} remote=${url} reason=${reason}`);
// No process.exit() here: calling it right after a fetch trips a libuv assertion
// on Windows (UV_HANDLE_CLOSING, measured 2026-09-23 on Node 24) while the socket
// is still closing. Let the process end on its own.
process.exitCode = 0;
