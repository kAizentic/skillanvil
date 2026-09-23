#!/usr/bin/env python3
"""update_pulse.py -- deterministic upstream-drift detector for vendored skills.

Reads the authoritative pin file (agent-os/Skills/_vendored.json), asks GitHub
how far each pinned source has moved, maps the changed upstream files onto the
skills this vault actually vendors, and emits one inbox clip per drifted source.

Design notes (the parts that are load-bearing):

  * The pin file is the state. There is no separate state file to drift out of
    sync with it -- `commit` per source IS the watermark, and a re-sync that
    updates the pin automatically silences the finding.

  * WHAT GETS RAISED IS A DETERMINISTIC PREDICATE, NEVER A JUDGMENT. A model
    deciding which updates are "worth" surfacing would control the gate's own
    scope, which is the door ADR 0012 decision 4 and ADR 0017 decision 3 both
    close. The predicates live in classify_source() and nowhere else.

  * Detection never writes to the skill tree. Staging (--stage) writes only to
    a scratch directory. Applying is a human act.

Usage:
  py update_pulse.py                      # check all watched sources, emit clips
  py update_pulse.py --json               # machine-readable, no clips written
  py update_pulse.py --no-clips           # check only, print a table
  py update_pulse.py --stage <source>     # stage an upstream diff for review
  py update_pulse.py --list               # show watched/excluded sources and exit

Exit code = number of sources carrying drift (0 = everything current).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

API = "https://api.github.com"

# Sources deliberately not watched. A source listed here is EXCLUDED BY NAME and
# the exclusion is reported on every run, so it can never become a silent gap.
EXCLUSIONS = {
    "example-frozen-source": (
        "Frozen deliberately (manifest: 'do not re-sync this source per-skill; "
        "the architectures have diverged and an overlay is destructive'). Upstream "
        "decomposed these skills into router shims; overlaying would replace a "
        "working skill with a non-invocable stub. The source is deliberately not "
        "re-synced -- which a drift counter cannot tell you anything useful about."
    ),
}


# --------------------------------------------------------------------------
# repo / path plumbing
# --------------------------------------------------------------------------

def find_vault_root(start: Path | None = None) -> Path:
    """Walk up until we find the vault (identified by agent-os/Skills)."""
    p = (start or Path(__file__).resolve()).resolve()
    for cand in [p, *p.parents]:
        if (cand / "agent-os" / "Skills" / "_vendored.json").is_file():
            return cand
    raise SystemExit("ERROR: could not locate vault root (no agent-os/Skills/_vendored.json above this script)")


def load_manifest(vault: Path) -> dict:
    path = vault / "agent-os" / "Skills" / "_vendored.json"
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def owner_repo(source_repo: str) -> str:
    """https://github.com/owner/repo -> owner/repo"""
    return source_repo.rstrip("/").split("github.com/", 1)[-1]


# --------------------------------------------------------------------------
# github
# --------------------------------------------------------------------------

def gh_get(path: str) -> dict:
    url = f"{API}/{path.lstrip('/')}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "update-pulse",
    })
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:200]
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network error for {url}: {exc.reason}") from exc


def compare(repo: str, base: str) -> dict:
    return gh_get(f"repos/{repo}/compare/{base}...HEAD")


# --------------------------------------------------------------------------
# the predicates -- the whole point of the script
# --------------------------------------------------------------------------

# Frontmatter keys whose upstream change can break a portfolio invariant. A diff
# touching any of these is always raised, because portfolio_check.py audits them.
GOVERNED_KEYS = (
    "hitl_gate", "tools:", "composes_with", "dependencies",
    "triggers", "description:", "name:", "provenance",
)


def affected_skills(manifest: dict, source_key: str, changed_paths: list[str]) -> list[dict]:
    """Which vendored skills does this upstream diff actually touch?"""
    out = []
    for skill_id, meta in manifest.get("skills", {}).items():
        if not isinstance(meta, dict) or meta.get("source") != source_key:
            continue
        upstream_path = (meta.get("upstream_path") or "").strip("/")
        if not upstream_path:
            continue
        hits = [p for p in changed_paths if p.startswith(upstream_path + "/") or p == upstream_path]
        if hits:
            out.append({
                "skill": skill_id,
                "category": meta.get("category"),
                "upstream_path": upstream_path,
                "files": hits,
                "local_divergence": bool(meta.get("local_divergence")),
                "divergence_note": (meta.get("local_divergence") or "")[:400] or None,
            })
    return sorted(out, key=lambda s: s["skill"])


def new_upstream_skills(manifest: dict, source_key: str, changed_paths: list[str]) -> list[str]:
    """Upstream directories that look like skills but are not in the manifest.

    A new upstream skill is a PORTFOLIO decision (adopt or decline), not an
    update -- so it is always raised, and it is the thing a pure SHA counter
    would miss entirely.
    """
    known = {
        (m.get("upstream_path") or "").strip("/")
        for m in manifest.get("skills", {}).values()
        if isinstance(m, dict) and m.get("source") == source_key
    }
    declined = set()
    src = manifest.get("sources", {}).get(source_key, {})
    if isinstance(src.get("deliberately_not_vendored"), dict):
        declined = set(src["deliberately_not_vendored"].keys())

    candidates = set()
    for p in changed_paths:
        if not p.endswith("/SKILL.md"):
            continue
        d = p[: -len("/SKILL.md")]
        if d in known:
            continue
        if d.rsplit("/", 1)[-1] in declined:
            continue
        candidates.add(d)
    return sorted(candidates)


def classify_source(entry: dict) -> tuple[str, list[str]]:
    """Return (verdict, reasons). Verdict is RAISE or AUTO-STAGE.

    Deterministic by construction. No model judgment, no 'if necessary'.
    """
    reasons: list[str] = []

    if entry["ahead_by"] == 0:
        return "CURRENT", []

    diverged = [s["skill"] for s in entry["affected"] if s["local_divergence"]]
    if diverged:
        reasons.append(
            "merge hazard: local_divergence recorded on " + ", ".join(diverged)
            + " -- an overlay would destroy local work"
        )

    if entry["new_upstream_skills"]:
        reasons.append(
            "new upstream skill(s) not in the manifest: "
            + ", ".join(entry["new_upstream_skills"])
            + " -- adopt/decline is a portfolio decision"
        )

    if entry["governed_key_hits"]:
        reasons.append(
            "diff touches governed frontmatter keys ("
            + ", ".join(sorted(entry["governed_key_hits"]))
            + ") -- portfolio invariants may move"
        )

    if not entry["affected"] and entry["ahead_by"]:
        reasons.append(
            "upstream moved but touched none of the vendored paths -- informational only"
        )
        return "AUTO-STAGE", reasons

    if reasons:
        return "RAISE", reasons

    reasons.append("body-only change on skills with no recorded local divergence")
    return "AUTO-STAGE", reasons


def scan_governed_keys(files: list[dict]) -> set[str]:
    """Look at the patch hunks for changes to keys the portfolio check audits."""
    hits: set[str] = set()
    for f in files:
        patch = f.get("patch") or ""
        for line in patch.splitlines():
            if not line or line[0] not in "+-":
                continue
            if line.startswith(("+++", "---")):
                continue
            stripped = line[1:].lstrip()
            for key in GOVERNED_KEYS:
                if stripped.startswith(key):
                    hits.add(key.rstrip(":"))
    return hits


# --------------------------------------------------------------------------
# check
# --------------------------------------------------------------------------

def check_source(manifest: dict, source_key: str, src: dict) -> dict:
    repo = owner_repo(src["source_repo"])
    pin = src.get("commit", "")
    entry: dict = {
        "source": source_key,
        "repo": repo,
        "pin": pin,
        "pin_imported": src.get("imported"),
        "pin_resynced": src.get("resynced") or src.get("audited", "")[:10] or None,
        "error": None,
    }
    try:
        cmpres = compare(repo, pin)
    except RuntimeError as exc:
        entry.update(ahead_by=None, error=str(exc))
        return entry

    files = cmpres.get("files") or []
    changed = [f["filename"] for f in files]
    commits = cmpres.get("commits") or []

    entry.update(
        ahead_by=cmpres.get("ahead_by", 0),
        files_changed=len(files),
        head_sha=(cmpres.get("commits") or [{}])[-1].get("sha", "")[:12] or None,
        newest_commit=(commits[-1]["commit"]["author"]["date"][:10] if commits else None),
        affected=affected_skills(manifest, source_key, changed),
        new_upstream_skills=new_upstream_skills(manifest, source_key, changed),
        governed_key_hits=sorted(scan_governed_keys(files)),
        html_url=cmpres.get("html_url"),
    )
    verdict, reasons = classify_source(entry)
    entry["verdict"] = verdict
    entry["reasons"] = reasons
    return entry


def run_check(vault: Path, manifest: dict) -> list[dict]:
    results = []
    for key, src in manifest.get("sources", {}).items():
        if key in EXCLUSIONS:
            results.append({
                "source": key,
                "repo": owner_repo(src.get("source_repo", "")),
                "verdict": "EXCLUDED",
                "reasons": [EXCLUSIONS[key]],
                "ahead_by": None,
                "error": None,
            })
            continue
        results.append(check_source(manifest, key, src))
    return results


# --------------------------------------------------------------------------
# clip emission
# --------------------------------------------------------------------------

CLIP_TEMPLATE = """---
type: clip
source: update-pulse
date: {today}
feed: vendored-upstream
upstream_repo: {repo}
source_url: {url}
pinned_commit: {pin}
ahead_by: {ahead}
verdict: {verdict}
fetch_method: deterministic
confidence: high
tags: [inbox, update-pulse, dependencies]
---
# {repo} is {ahead} commits ahead of the vault's pin

**Pin.** `{pin}` (last re-synced {resynced})
**Upstream HEAD.** `{head}` -- newest commit {newest}
**Scope.** {files_changed} files changed upstream; {n_affected} vendored skill(s) affected.

## Verdict: {verdict}

{reasons}

## Affected vendored skills

{affected_table}

## Next

{next_step}

**Source.** {url}
"""


def render_clip(entry: dict) -> str:
    rows = []
    for s in entry.get("affected", []):
        flag = "**LOCAL DIVERGENCE**" if s["local_divergence"] else "clean"
        rows.append(f"| `{s['skill']}` | {s['category']} | {len(s['files'])} | {flag} |")
    table = (
        "| Skill | Category | Files | Local state |\n|---|---|---|---|\n" + "\n".join(rows)
        if rows else "_None -- upstream moved outside the vendored paths._"
    )

    if entry["verdict"] == "RAISE":
        nxt = (
            f"Human decision required. Stage the diff for review:\n\n"
            f"```\npy update_pulse.py --stage {entry['source']}\n```\n\n"
            "Review the staged diff, re-apply any recorded `local_divergence`, then update the "
            "`commit` pin in `agent-os/Skills/_vendored.json` and run `sync my skills`."
        )
    else:
        nxt = (
            f"No merge hazard detected. Stage when convenient:\n\n"
            f"```\npy update_pulse.py --stage {entry['source']}\n```"
        )

    return CLIP_TEMPLATE.format(
        today=date.today().isoformat(),
        repo=entry["repo"],
        url=entry.get("html_url") or f"https://github.com/{entry['repo']}",
        pin=(entry.get("pin") or "")[:12],
        ahead=entry.get("ahead_by"),
        verdict=entry["verdict"],
        resynced=entry.get("pin_resynced") or "never",
        head=entry.get("head_sha") or "?",
        newest=entry.get("newest_commit") or "?",
        files_changed=entry.get("files_changed", 0),
        n_affected=len(entry.get("affected", [])),
        reasons="\n".join(f"- {r}" for r in entry.get("reasons", [])) or "- (none)",
        affected_table=table,
        next_step=nxt,
    )


def write_clips(vault: Path, results: list[dict]) -> list[Path]:
    inbox = vault / "inbox"
    inbox.mkdir(exist_ok=True)
    written = []
    for entry in results:
        if entry.get("verdict") in {"CURRENT", "EXCLUDED"} or entry.get("error"):
            continue
        slug = entry["repo"].replace("/", "-")
        path = inbox / f"{date.today().isoformat()}-update-pulse-{slug}.md"
        path.write_text(render_clip(entry), encoding="utf-8", newline="\n")
        written.append(path)
    return written


# --------------------------------------------------------------------------
# staging (A2) -- prepare a reviewable diff, never touch the skill tree
# --------------------------------------------------------------------------

def stage(vault: Path, manifest: dict, source_key: str) -> int:
    src = manifest.get("sources", {}).get(source_key)
    if not src:
        print(f"ERROR: unknown source '{source_key}'. Try --list.")
        return 2
    if source_key in EXCLUSIONS:
        print(f"REFUSED: '{source_key}' is excluded from update-pulse.")
        print(f"  {EXCLUSIONS[source_key]}")
        return 2

    repo = owner_repo(src["source_repo"])
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    # .scratch/ is gitignored and outside the sweep's reach. Staging must NEVER
    # land in inbox/: the sweep would try to distill the diffs as captures and
    # then delete them by inventory.
    staging = vault / ".scratch" / "update-pulse" / f"{source_key}-{stamp}"
    staging.mkdir(parents=True, exist_ok=True)
    clone = Path(tempfile.mkdtemp(prefix="update-pulse-"))

    try:
        print(f"[1/3] cloning {repo} at HEAD (shallow) ...")
        subprocess.run(
            ["git", "clone", "--depth", "1", f"https://github.com/{repo}.git", str(clone / "up")],
            check=True, capture_output=True, text=True,
        )
        head = subprocess.run(
            ["git", "-C", str(clone / "up"), "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()

        print("[2/3] diffing vendored skill dirs against upstream HEAD ...")
        skills_root = vault / "agent-os" / "Skills"
        n = 0
        for skill_id, meta in manifest.get("skills", {}).items():
            if not isinstance(meta, dict) or meta.get("source") != source_key:
                continue
            up = clone / "up" / (meta.get("upstream_path") or "")
            local = skills_root / (meta.get("category") or "") / skill_id
            if not up.is_dir() or not local.is_dir():
                print(f"      SKIP {skill_id}: upstream_path or local dir missing "
                      f"(up={up.is_dir()} local={local.is_dir()})")
                continue
            proc = subprocess.run(
                ["git", "diff", "--no-index", "--", str(local), str(up)],
                capture_output=True, text=True,
            )
            if proc.stdout.strip():
                (staging / f"{skill_id}.diff").write_text(proc.stdout, encoding="utf-8", newline="\n")
                n += 1
            if meta.get("local_divergence"):
                (staging / f"{skill_id}.DIVERGENCE.md").write_text(
                    f"# {skill_id} -- recorded local divergence\n\n"
                    "RE-APPLY THIS AFTER ANY OVERLAY.\n\n"
                    + str(meta["local_divergence"]) + "\n",
                    encoding="utf-8", newline="\n",
                )

        print("[3/3] writing review README ...")
        (staging / "README.md").write_text(
            f"# Staged upstream diff -- {repo}\n\n"
            f"- Source key: `{source_key}`\n"
            f"- Vault pin: `{src.get('commit','')[:12]}`\n"
            f"- Upstream HEAD: `{head[:12]}`\n"
            f"- Staged: {stamp} UTC\n"
            f"- Diffs written: {n}\n\n"
            "Each `*.diff` is `local -> upstream`. Any `*.DIVERGENCE.md` records local work that an\n"
            "overlay would destroy; re-apply it by hand.\n\n"
            "## To accept\n\n"
            "1. Apply the changes you want, by hand or by overlay.\n"
            "2. Re-apply every recorded divergence.\n"
            f"3. Set `sources.{source_key}.commit` to `{head}` and `resynced` to today\n"
            "   in `agent-os/Skills/_vendored.json`.\n"
            "4. Run `sync my skills` (recompiles and runs portfolio_check).\n"
            "5. Confirm portfolio_check category count did not increase.\n\n"
            "## To decline\n\n"
            "Delete this folder. The pin is unchanged, so the next run re-raises it.\n",
            encoding="utf-8", newline="\n",
        )
        print(f"\nStaged {n} diff(s) -> {staging}")
        print("Nothing in the skill tree was modified.")
        return 0
    except subprocess.CalledProcessError as exc:
        print(f"ERROR: git failed: {exc.stderr[:300] if exc.stderr else exc}")
        return 2
    finally:
        shutil.rmtree(clone, ignore_errors=True)


# --------------------------------------------------------------------------
# reporting
# --------------------------------------------------------------------------

def print_table(results: list[dict]) -> None:
    print(f"update-pulse  --  {date.today().isoformat()}")
    print("=" * 78)
    for e in results:
        if e["verdict"] == "EXCLUDED":
            print(f"  [EXCLUDED]   {e['repo']}")
            print(f"               {e['reasons'][0][:110]}...")
            continue
        if e.get("error"):
            print(f"  [ERROR]      {e['repo']}: {e['error'][:80]}")
            continue
        if e["verdict"] == "CURRENT":
            print(f"  [current]    {e['repo']}  (pin == HEAD)")
            continue
        n_div = sum(1 for s in e["affected"] if s["local_divergence"])
        print(f"  [{e['verdict']:<10}] {e['repo']}")
        print(f"               +{e['ahead_by']} commits, {e['files_changed']} files, "
              f"{len(e['affected'])} vendored skill(s) affected, {n_div} with local divergence")
        for r in e["reasons"]:
            print(f"               - {r[:100]}")
    print("=" * 78)
    drifted = [e for e in results if e.get("ahead_by")]
    raised = [e for e in results if e.get("verdict") == "RAISE"]
    print(f"  {len(drifted)} source(s) with drift, {len(raised)} needing a decision.")


def main() -> int:
    ap = argparse.ArgumentParser(description="Detect upstream drift in vendored skills.")
    ap.add_argument("--json", action="store_true", help="machine-readable output; writes no clips")
    ap.add_argument("--no-clips", action="store_true", help="check and print, but write no clips")
    ap.add_argument("--stage", metavar="SOURCE", help="stage an upstream diff for review")
    ap.add_argument("--list", action="store_true", help="list watched and excluded sources")
    args = ap.parse_args()

    vault = find_vault_root()
    manifest = load_manifest(vault)

    if args.list:
        print("Watched:")
        for k, v in manifest.get("sources", {}).items():
            if k in EXCLUSIONS:
                continue
            print(f"  {k:<28} {owner_repo(v.get('source_repo',''))}  pin={v.get('commit','')[:12]}")
        print("\nExcluded:")
        for k, why in EXCLUSIONS.items():
            print(f"  {k:<28} {why[:90]}...")
        return 0

    if args.stage:
        return stage(vault, manifest, args.stage)

    results = run_check(vault, manifest)

    if args.json:
        print(json.dumps(results, indent=2))
        return sum(1 for e in results if e.get("ahead_by"))

    print_table(results)
    if not args.no_clips:
        written = write_clips(vault, results)
        if written:
            print(f"\n  {len(written)} clip(s) written to inbox/:")
            for p in written:
                print(f"    {p.name}")
        else:
            print("\n  No clips written (nothing drifted).")

    return sum(1 for e in results if e.get("ahead_by"))


if __name__ == "__main__":
    sys.exit(main())
