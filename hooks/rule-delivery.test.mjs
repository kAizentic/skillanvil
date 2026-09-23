#!/usr/bin/env node
// Two-branch fixture suite for rule-delivery.mjs.
//
// The silent branch matters most here: this hook must never fire on an unrelated write, or it
// becomes the distracting-document problem it exists to avoid (ADR 0014: -25% accuracy from a
// single semantically-adjacent, task-irrelevant document).
//
//   node rule-delivery.test.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = path.join(import.meta.dirname, "rule-delivery.mjs");
let session = 0;

// Every run gets its own temp dir for the hook's once-per-session state. Without this the suite
// passed exactly once: the hook persists "already delivered" under os.tmpdir(), keyed by the
// session ids below (s1, s2, ...), so every later run found them delivered and went silent.
// Measured 2026-09-23: 8 passed / 10 failed on a used machine, 18 / 0 on fresh temp.
const ISOLATED_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rule-delivery-test-"));
const HOOK_ENV = { ...process.env, TEMP: ISOLATED_TMP, TMP: ISOLATED_TMP, TMPDIR: ISOLATED_TMP };
process.on("exit", () => fs.rmSync(ISOLATED_TMP, { recursive: true, force: true }));

function run(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: HOOK_ENV,
  });
  let ctx = "";
  try {
    ctx = JSON.parse(r.stdout || "{}")?.hookSpecificOutput?.additionalContext || "";
  } catch {
    ctx = "";
  }
  return { ctx, exit: r.status, blocked: /permissionDecision|"decision"/.test(r.stdout || "") };
}

function write(fp, sid) {
  return run({ hook_event_name: "PreToolUse", tool_name: "Write",
               tool_input: { file_path: fp }, session_id: sid || "s" + ++session });
}
function prompt(text, sid) {
  return run({ hook_event_name: "UserPromptSubmit", prompt: text,
               session_id: sid || "s" + ++session });
}

const cases = [
  // ---- MUST FIRE -------------------------------------------------------------------
  ["html write -> narrow-width", () => write("C:/out/report.html"), (r) => /narrow-width/.test(r.ctx)],
  ["htm write  -> narrow-width", () => write("C:/out/a.htm"), (r) => /narrow-width/.test(r.ctx)],
  ["ps1 write  -> ascii/BOM", () => write("C:/s/run.ps1"), (r) => /ascii-output-and-bom/.test(r.ctx)],
  ["mjs write  -> ascii/BOM", () => write("C:/s/x.mjs"), (r) => /ascii-output-and-bom/.test(r.ctx)],
  ["css write  -> reveal", () => write("C:/s/a.css"), (r) => /reveal-means-wipe/.test(r.ctx)],
  ["tsx write  -> reveal", () => write("C:/app/Hero.tsx"), (r) => /reveal-means-wipe/.test(r.ctx)],
  ["prompt 'reveal' -> reveal", () => prompt("make the section reveal on scroll"),
    (r) => /reveal-means-wipe/.test(r.ctx)],
  ["prompt 'revealing' -> reveal", () => prompt("I want it revealing gradually"),
    (r) => /reveal-means-wipe/.test(r.ctx)],
  ["forward+back slashes both match", () => write("C:\\out\\deep\\page.html"),
    (r) => /narrow-width/.test(r.ctx)],

  // ---- MUST STAY SILENT ------------------------------------------------------------
  ["md write fires nothing", () => write("C:/vault/knowledge/note.md"), (r) => r.ctx === ""],
  ["json write fires nothing", () => write("C:/s/data.json"), (r) => r.ctx === ""],
  ["html-ish name, wrong ext", () => write("C:/s/htmlnotes.txt"), (r) => r.ctx === ""],
  ["prompt without the word", () => prompt("build me a landing page"), (r) => r.ctx === ""],
  ["unrelated event", () => run({ hook_event_name: "Stop", session_id: "sx" }), (r) => r.ctx === ""],
  ["no file_path", () => run({ hook_event_name: "PreToolUse", tool_name: "Write",
                               tool_input: {}, session_id: "sy" }), (r) => r.ctx === ""],
  ["malformed stdin", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
    return { ctx: r.stdout || "", exit: r.status, blocked: false };
  }, (r) => r.ctx === ""],

  // ---- ONCE PER SESSION -------------------------------------------------------------
  ["same rule twice in one session -> second is silent", () => {
    const sid = "dedupe-session";
    const first = write("C:/out/a.html", sid);
    const second = write("C:/out/b.html", sid);
    return { ctx: second.ctx, exit: second.exit, blocked: second.blocked, first: first.ctx };
  }, (r) => /narrow-width/.test(r.first) && r.ctx === ""],

  // ---- NEVER BLOCKS -----------------------------------------------------------------
  ["delivery never emits a decision", () => write("C:/out/x.html"), (r) => r.blocked === false],
];

let pass = 0, fail = 0;
for (const [name, fn, check] of cases) {
  const got = fn();
  const ok = check(got) && got.exit === 0;
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + "  exit=" + got.exit + " ctx=" + JSON.stringify((got.ctx || "").slice(0, 80))); }
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
