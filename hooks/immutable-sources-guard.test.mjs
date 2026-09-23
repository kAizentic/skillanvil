#!/usr/bin/env node
// Two-branch fixture suite for immutable-sources-guard.mjs.
//
// The binding condition from *system trajectory*: a gate must be tested on the
// branch that should stay SILENT, not only the one that should fire. The 2026-09-20 backtest
// is why: a naive `Edit(sources/**)` deny would have blocked 156 legitimate preservation
// writes, so the silent branch is the one carrying all the risk here.
//
//   node immutable-sources-guard.test.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const GUARD = path.join(import.meta.dirname, "immutable-sources-guard.mjs");

// A real temp vault: the guard consults the filesystem, so fixtures must exist on disk.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "immsrc-"));
const sources = path.join(root, "sources", "blogwatch");
fs.mkdirSync(sources, { recursive: true });
const EXISTING = path.join(sources, "2026-09-17-blogwatch-existing.md");
fs.writeFileSync(EXISTING, "raw original\n", "utf8");
const NEW = path.join(sources, "2026-09-20-blogwatch-new.md");
const WIKI = path.join(root, "knowledge", "areas");
fs.mkdirSync(WIKI, { recursive: true });
const WIKI_FILE = path.join(WIKI, "ai.md");
fs.writeFileSync(WIKI_FILE, "distilled page\n", "utf8");
const DIR_IN_SOURCES = sources; // a directory, not a file

function run(toolInput, toolName = "Write") {
  const payload = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
  });
  const r = spawnSync(process.execPath, [GUARD], { input: payload, encoding: "utf8" });
  let denied = false;
  try {
    const out = JSON.parse(r.stdout || "{}");
    denied = out?.hookSpecificOutput?.permissionDecision === "deny";
  } catch {
    denied = false;
  }
  return { denied, exit: r.status, stdout: r.stdout };
}

const cases = [
  // ---- MUST FIRE: overwriting an existing immutable original -------------------------
  ["deny: Write over an existing source", true, () => run({ file_path: EXISTING, content: "x" })],
  ["deny: Edit an existing source", true,
    () => run({ file_path: EXISTING, old_string: "raw", new_string: "y" }, "Edit")],
  ["deny: forward-slash path form", true, () => run({ file_path: EXISTING.replace(/\\/g, "/") })],
  ["deny: NotebookEdit via notebook_path", true,
    () => run({ notebook_path: EXISTING }, "NotebookEdit")],

  // ---- MUST STAY SILENT: the 156-writes-a-quarter compliant path ---------------------
  ["allow: NEW file under sources (the preservation step)", false, () => run({ file_path: NEW, content: "x" })],
  ["allow: a distilled wiki page", false, () => run({ file_path: WIKI_FILE, content: "x" })],
  ["allow: a path merely MENTIONING sources in content", false,
    () => run({ file_path: WIKI_FILE, content: "see sources/blogwatch/x.md" })],
  ["allow: a directory path, not a file", false, () => run({ file_path: DIR_IN_SOURCES, content: "x" })],
  ["allow: sources as a substring of another name", false,
    () => run({ file_path: path.join(root, "sources-archive", "x.md"), content: "x" })],
  ["allow: no file_path at all", false, () => run({ command: "ls sources" })],
  ["allow: malformed payload", false, () => {
    const r = spawnSync(process.execPath, [GUARD], { input: "not json", encoding: "utf8" });
    return { denied: /"deny"/.test(r.stdout || ""), exit: r.status };
  }],
  ["allow: empty stdin", false, () => {
    const r = spawnSync(process.execPath, [GUARD], { input: "", encoding: "utf8" });
    return { denied: /"deny"/.test(r.stdout || ""), exit: r.status };
  }],
];

let pass = 0, fail = 0;
for (const [name, wantDeny, fn] of cases) {
  const got = fn();
  const ok = got.denied === wantDeny && got.exit === 0; // must ALWAYS exit 0
  if (ok) { pass++; console.log("  PASS  " + name); }
  else {
    fail++;
    console.log("  FAIL  " + name + "  (denied=" + got.denied + " want=" + wantDeny + " exit=" + got.exit + ")");
  }
}
fs.rmSync(root, { recursive: true, force: true });
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
