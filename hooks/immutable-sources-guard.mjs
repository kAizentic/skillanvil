#!/usr/bin/env node
// immutable-sources-guard.mjs — PreToolUse / Write|Edit|NotebookEdit: block an OVERWRITE of an
// existing file under sources/. Creating a NEW source file is always allowed.
//
// The rule this enforces (CLAUDE.md, curator instructions): "sources/ — raw, immutable
// originals (articles, images, docs, voice). Never edit." and "Sources and library are
// untouchable."
//
// WHY A HOOK AND NOT A PERMISSION DENY RULE — measured, 2026-09-20. The obvious implementation
// is `Edit(sources/**)` in permissions.deny. A backtest over 76 days of transcripts
// (1,193 sessions) says that rule would have blocked **156 legitimate writes**: every feeder
// preservation step — blogwatch clips, ai-pulse alerts, loop-waste records, design captures —
// writes a NEW raw original into sources/, as recently as 2026-09-18. A path-matching
// permission rule cannot tell "create a new immutable original" from "overwrite an existing
// one", and an Edit(path) deny also covers Write on that path, so it would stop every sweep
// from preserving anything. The discriminating fact is not in the path; it is on disk:
// does the target already exist? That is an oracle a hook can consult and a permission rule
// cannot. (Same shape as the bg-register probe defect: the compliant path was invisible to
// the matcher, so the matcher scored compliance as failure.)
//
// SCOPE — what this does NOT reach, stated so the ceiling is visible rather than implied:
// it matches the file tools only. A shell redirection (`> sources/x.md`), a `cp` over an
// existing source, or a script that opens the file itself never reaches this gate. Those are
// the second route to the same effect; shell-edit-guard covers redirection onto source files
// generally, and git tracks sources/, so an overwrite is recoverable. This is a correctable
// policy, not a security boundary.
//
// FAIL-OPEN, deliberately. Every other PreToolUse guard here exits 0 on error, and for this
// rule failing CLOSED would be worse than the fault it prevents: a crash would deny every
// preservation write and silently break all four feeders. The damage it guards against is
// recoverable (sources/ is git-tracked); the damage failing closed would cause is a daily
// routine that stops preserving. See *fail closed guard silent degradation*
// for why that trade is stated rather than assumed.
//
// Rationale: *gate enforced in the writer* ("a gate in prose is a request").

import fs from "node:fs";

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => emit(safeConcat(chunks)));
process.stdin.on("error", () => emit(""));

// A path under a sources directory, at any depth, either slash flavour.
const IN_SOURCES = /(^|[\\/])sources[\\/]/i;

function emit(input) {
  try {
    if (!input) return done();

    let fp = "";
    try {
      const data = JSON.parse(input);
      const ti = (data && data.tool_input) || {};
      fp = safeStr(ti.file_path || ti.notebook_path);
    } catch {
      return done(); // not JSON — say nothing rather than guess
    }
    if (!fp || !IN_SOURCES.test(fp)) return done();

    // The whole discriminator: an existing file is an immutable original; a new path is the
    // preservation step doing its job.
    let exists = false;
    try {
      exists = fs.existsSync(fp) && fs.statSync(fp).isFile();
    } catch {
      return done(); // cannot settle it -> do not block (see FAIL-OPEN above)
    }
    if (!exists) return done();

    return done({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Overwrite of an existing file under sources/. Raw originals are IMMUTABLE — the " +
          "vault's curator contract is \"sources/: raw, immutable originals. Never edit.\" " +
          "The whole evaluator/grading layer depends on it: sweep-evaluator grades a distilled " +
          "page against its preserved source, so editing the source makes the distillation " +
          "ungradeable and hides a first-hop misread. Creating a NEW file here is allowed and is " +
          "exactly what the feeders do. If this source is genuinely wrong, preserve a corrected " +
          "copy under a new filename and note the supersession in the distilled page — do not " +
          "rewrite history in place.",
      },
    });
  } catch {
    // never throw — a hook that crashes is worse than one that says nothing
  }
  process.exit(0);
}

function done(payload) {
  try {
    if (payload) process.stdout.write(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  process.exit(0);
}

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function safeConcat(cs) {
  try {
    return Buffer.concat(cs).toString("utf8");
  } catch {
    return "";
  }
}
