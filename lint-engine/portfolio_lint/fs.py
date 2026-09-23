"""Filesystem + root-discovery primitives shared by every standing-stock review.

Generalized from the working copies in wiki-lint/scripts/wiki_lint.py and
skill-portfolio-review/scripts/portfolio_check.py. Where the two diverged, the
HARDENED version wins — see find_vault_root() for why that matters.
"""
from __future__ import annotations

from pathlib import Path


def read(p: Path) -> str:
    """Read a text file, tolerating a BOM and undecodable bytes.

    Byte-identical in both legacy scripts; the BOM tolerance is load-bearing on
    Windows (same BOM/codepage class as the graphify run frictions).
    """
    try:
        return p.read_text(encoding="utf-8-sig")
    except Exception:
        return p.read_text(encoding="utf-8", errors="replace")


# Generated trees are never standing stock (CONTEXT.md). Byte-identical to
# wiki_lint.py:293, which is the point -- this module existed for a month with a bare rglob
# while the script it was generalized FROM already carried the exclusion.
GENERATED_DIRS = (".cache", "node_modules", ".git")


def all_md(root: Path, exclude: tuple[str, ...] = GENERATED_DIRS) -> list[Path]:
    """Every .md under root, skipping generated trees.

    THE EXCLUSION IS NOT COSMETIC. `knowledge/.cache/mutation-snapshots/` holds full copies of
    real wiki pages, written by the distill sweep. Measured 2026-09-22: 512 .md under knowledge,
    **203 of them snapshots** -- 40% of the corpus is duplicates of the other 60%, carrying
    identical wikilinks and identical frontmatter.

    Without this, the same defect that hit `cluster_audit.py` applies here: there every page
    had an inbound link from a snapshot, so `router_only` collapsed to 0 and the audit had been
    silently reporting nothing (after the fix: router_only=31, clusters=6). It is not merely
    inflation -- a derived check can INVERT to zero.

    `pass exclude=()` to walk everything deliberately; the default is the safe direction.
    """
    if not exclude:
        return [p for p in root.rglob("*.md") if p.is_file()]
    return [p for p in root.rglob("*.md")
            if p.is_file() and not any(part in exclude for part in p.parts)]


def rel(p: Path, base: Path) -> str:
    """Vault-relative posix path for stable reporting across OSes."""
    try:
        return str(p.relative_to(base)).replace("\\", "/")
    except ValueError:
        return str(p)


def find_vault_root() -> Path | None:
    """Locate the Second Brain vault root by its unambiguous markers.

    Anchors on cwd FIRST (the documented run location and the compile pipeline's
    cwd), then this file's ancestors.

    Returns None when not found. Callers needing vault-only artifacts MUST treat
    None as a resolution FAILURE, never a clean result — a fixed parents[N] walk
    from a flattened runtime copy lands in the user's home directory and silently
    reports a false 'clean' (0 units scanned). That is the exact
    fail-closed-guard-silent-degradation shape: the check still runs, still exits
    0, and has lost all its discrimination.

    Carried over verbatim in behaviour from portfolio_check.py, which earned this
    docstring the hard way.
    """
    def looks_like_vault(d: Path) -> bool:
        return (d / "agent-os" / "Skills").is_dir() and (d / "knowledge").is_dir()

    for start in (Path.cwd(), Path(__file__).resolve().parent):
        cur = start.resolve()
        for anc in (cur, *cur.parents):
            if looks_like_vault(anc):
                return anc
    return None


def require_vault_root(explicit: str | None = None) -> Path:
    """find_vault_root() with the fail-closed contract enforced.

    Use this instead of find_vault_root() unless you genuinely handle None. It
    raises rather than letting a scan proceed against the wrong tree.
    """
    if explicit:
        p = Path(explicit).resolve()
        if not p.is_dir():
            raise SystemExit(f"vault root does not exist: {p}")
        return p
    root = find_vault_root()
    if root is None:
        raise SystemExit(
            "could not resolve the vault root (looked for 'agent-os/Skills' + "
            "'knowledge' from cwd and this file's ancestors). Pass --vault "
            "explicitly. Refusing to scan: an unresolved root reports a false clean."
        )
    return root


def default_skills_root() -> Path:
    """Nearest ancestor named 'Skills'/'skills'.

    Works from both the category-nested vault source
    (.../Skills/<Category>/<skill>/scripts) and the flattened runtime
    (~/.claude/skills/<skill>/scripts). Replaces a fixed parents[3] walk that
    overshot on the shallower runtime layout and scanned the whole home tree.
    """
    here = Path(__file__).resolve()
    for anc in here.parents:
        if anc.name.lower() == "skills":
            return anc
    return here.parents[2]
