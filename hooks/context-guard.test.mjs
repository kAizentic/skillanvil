#!/usr/bin/env node
// Fixture suite for context-guard.mjs.
//
// The bug this suite exists for: 639 of 640 recorded sessions fired the "uncalibrated" notice
// and only 2 ever produced a real tier warning. The guard was ~100% false positive because its
// anti-false-positive gate computed pct against the very 200k seed that observedMax had already
// disproven. A fresh vault session opens at ~140k tokens = 70% of that disproven seed, so the
// gate opened on turn 1 of every new session.
//
// Rule of thumb for the cases below: a fresh session must be SILENT, and a genuinely loaded
// session must still speak. Silencing everything would "fix" the complaint and destroy the tool.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "context-guard.mjs");

let root;
function freshRoot() {
  root = mkdtempSync(path.join(tmpdir(), "ctxguard-"));
  return root;
}

function transcript(tokens) {
  const f = path.join(root, "t.jsonl");
  writeFileSync(
    f,
    JSON.stringify({ message: { model: "claude-opus-5", usage: { input_tokens: tokens } } }) + "\n"
  );
  return f;
}

function seedCal(cal) {
  const dir = path.join(root, "state");
  mkdirSync(dir, { recursive: true });
  if (cal) writeFileSync(path.join(dir, "_calibration.json"), JSON.stringify(cal));
  return dir;
}

// returns the systemMessage string, or null when the hook stayed silent
function run({ tokens, cal, env = {}, session = "s1" }) {
  const stateDir = seedCal(cal);
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: session, transcript_path: transcript(tokens) }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CONTEXT_GUARD_STATE: stateDir,
      CLAUDE_CONTEXT_WINDOW: "",
      CLAUDE_DUMBZONE_TIERS: "",
      ...env,
    },
  });
  if (r.status !== 0) return { crashed: true, code: r.status, err: (r.stderr || "").slice(0, 200) };
  const out = (r.stdout || "").trim();
  if (!out) return { msg: null };
  try {
    return { msg: JSON.parse(out).systemMessage };
  } catch {
    return { malformed: out };
  }
}

let pass = 0,
  fail = 0;
function check(label, got, want) {
  const ok = want(got);
  if (ok) {
    pass++;
    console.log("  PASS  " + label);
  } else {
    fail++;
    console.log("  FAIL  " + label + "  got " + JSON.stringify(got).slice(0, 180));
  }
}
const silent = (r) => !r.crashed && !r.malformed && r.msg === null;
const says = (re) => (r) => !r.crashed && !r.malformed && typeof r.msg === "string" && re.test(r.msg);

// The observed reality on this machine: 851k seen, auto-compaction has never fired in 1061
// transcripts, so learnedCeiling is absent and can never be set from an auto-compact.
const REAL = { observedMax: 850942 };

console.log("\ncontext-guard fixtures\n");

freshRoot();
check(
  "REGRESSION: fresh vault session (140k) with a disproven 200k seed is silent",
  run({ tokens: 139705, cal: REAL }),
  silent
);

freshRoot();
check(
  "REGRESSION: same session two turns later (142.5k) is still silent",
  run({ tokens: 142550, cal: REAL }),
  silent
);

freshRoot();
check(
  "a genuinely loaded session (650k vs 851k observed floor) still warns",
  run({ tokens: 650000, cal: REAL }),
  says(/Context 76%/)
);

freshRoot();
check(
  "...and marks that ceiling as an observed estimate, not a fact",
  run({ tokens: 650000, cal: REAL }),
  says(/observed/i)
);

freshRoot();
check(
  "critical tier still reaches 90% of the observed floor",
  run({ tokens: 800000, cal: REAL }),
  says(/CRITICAL/)
);

freshRoot();
check(
  "env pin wins and silences the seed entirely",
  run({ tokens: 139705, cal: REAL, env: { CLAUDE_CONTEXT_WINDOW: "1000000" } }),
  silent
);

freshRoot();
check(
  "env pin still warns when genuinely loaded, with no caveat",
  run({ tokens: 750000, cal: REAL, env: { CLAUDE_CONTEXT_WINDOW: "1000000" } }),
  (r) => says(/Context 75%/)(r) && !/uncalibrated|observed/i.test(r.msg)
);

freshRoot();
check(
  "a learned auto-compact ceiling is trusted and uncaveated",
  run({ tokens: 300000, cal: { learnedCeiling: 400000, observedMax: 400000 } }),
  (r) => says(/Context 75%/)(r) && !/uncalibrated|observed/i.test(r.msg)
);

freshRoot();
check(
  "true uncalibrated case (no evidence the seed is wrong) still warns with the 200k caveat",
  run({ tokens: 150000, cal: { observedMax: 150000 } }),
  says(/uncalibrated/)
);

freshRoot();
check(
  "the honesty notice survives for the narrow band it was built for",
  run({ tokens: 150000, cal: { observedMax: 198000 } }),
  says(/paused to avoid false alarms/)
);

freshRoot();
check("no transcript usage yet -> silent, never a crash", run({ tokens: 0, cal: REAL }), silent);

// tier dedupe: same session must not re-announce the same tier
freshRoot();
{
  const stateDir = seedCal(REAL);
  const f = transcript(650000);
  const call = () =>
    spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ session_id: "dedupe", transcript_path: f }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CONTEXT_GUARD_STATE: stateDir, CLAUDE_CONTEXT_WINDOW: "" },
    });
  const first = (call().stdout || "").trim();
  const second = (call().stdout || "").trim();
  check(
    "a tier announces once per session, not every turn",
    { msg: second, first: first.slice(0, 60) },
    (r) => first.length > 0 && r.msg === ""
  );
}

try {
  rmSync(root, { recursive: true, force: true });
} catch {}
console.log("\n  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
