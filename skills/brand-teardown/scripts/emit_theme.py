#!/usr/bin/env python3
"""
Emit an apply-theme theme file from a brand_kit.json.

Every brand-teardown produces a brand_kit.json (the canonical source of truth).
This script distills its *visual* layer (palette + typography) into a theme
markdown file named by the source website, and drops it into the apply-theme
skill's theme library so the brand can later be applied to any artifact via
"use the <website> theme" / "make this look like <brand>".

Writes to the VAULT SOURCE themes dir (durable — the skill compiler mirrors it
forward on every sync) and, if present, the RUNTIME copy under ~/.claude/skills
(so a just-generated theme is usable in the same session before the next sync).
Anything written only to the runtime copy would be wiped on the next compile,
so the source write is the one that matters; the runtime write is a convenience.

Usage:
    python emit_theme.py brand_kit.json
    python emit_theme.py brand_kit.json --themes-dir "/path/to/apply-theme/themes"

Env overrides:
    APPLY_THEME_DIR   absolute path to the apply-theme source themes/ dir
"""
import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

# Default vault source location of the apply-theme theme library (Windows).
DEFAULT_SOURCE_THEMES = Path(
    r"<VAULT_ROOT>"
    r"\agent-os\Skills\Coding\apply-theme\themes"
)
# Runtime (compiled) copy — best-effort convenience write.
RUNTIME_THEMES = Path.home() / ".claude" / "skills" / "apply-theme" / "themes"

ROLE_LABEL = {
    "primary": "Primary",
    "secondary": "Secondary",
    "accent": "Accent",
    "neutral": "Neutral / Text",
}
ROLE_ROLE = {
    "primary": "primary background / brand color",
    "secondary": "secondary surface",
    "accent": "accent for highlights and emphasis",
    "neutral": "text and neutral surfaces",
}
ROLE_ORDER = ["primary", "secondary", "accent", "neutral"]

GENERIC_FONTS = {"serif", "sans-serif", "monospace", "system-ui", "ui-sans-serif",
                 "ui-serif", "ui-monospace", "inherit"}


def domain_slug(domain: str) -> str:
    """stripe.com -> stripe-com ; www.linear.app -> linear-app"""
    d = (domain or "brand").strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = re.sub(r"^www\.", "", d)
    d = d.split("/")[0]
    d = re.sub(r"[^a-z0-9]+", "-", d).strip("-")
    return d or "brand"


def brand_name(domain: str) -> str:
    """stripe.com -> Stripe ; getbootstrap.com -> Getbootstrap"""
    d = re.sub(r"^https?://", "", (domain or "").strip().lower())
    d = re.sub(r"^www\.", "", d).split("/")[0]
    label = d.split(".")[0] if d else "Brand"
    return label[:1].upper() + label[1:] if label else "Brand"


def font_fallback(family: str) -> str:
    fam = (family or "").lower()
    if any(w in fam for w in ("serif", "georgia", "times", "garamond", "lora", "merriweather")):
        return "Georgia"
    if any(w in fam for w in ("mono", "consolas", "courier")):
        return "monospace"
    return "Arial"


def pick_typography(typo):
    heading = body = None
    for t in typo:
        fam = (t.get("family") or "").strip()
        if not fam or fam.lower() in GENERIC_FONTS:
            continue
        usage = (t.get("usage") or "").lower()
        if usage == "heading" and not heading:
            heading = fam
        elif usage == "body" and not body:
            body = fam
    # Fallbacks: reuse whichever we found, else a sane default pairing.
    heading = heading or body or "Inter"
    body = body or heading or "Inter"
    return heading, body


def build_theme_md(kit) -> str:
    tgt = kit.get("target", {})
    domain = tgt.get("domain") or tgt.get("url") or "brand"
    url = tgt.get("url") or domain
    name = brand_name(domain)
    vis = kit.get("visual", {})
    palette = vis.get("palette", []) or []
    typo = vis.get("typography", []) or []

    lines = [f"# {name}", ""]
    lines.append(
        f"Brand-derived theme distilled from a brand-teardown of **{domain}** — "
        f"its own palette and type stack, ready to apply to any artifact."
    )
    lines.append("")

    # Color Palette — ordered by role, deduped by hex.
    lines.append("## Color Palette")
    lines.append("")
    seen = set()
    ordered = sorted(
        palette,
        key=lambda c: ROLE_ORDER.index(c.get("role")) if c.get("role") in ROLE_ORDER else 99,
    )
    wrote_color = False
    for c in ordered:
        hexv = (c.get("hex") or "").strip().lower()
        if not hexv or hexv in seen:
            continue
        seen.add(hexv)
        role = c.get("role") or "accent"
        label = ROLE_LABEL.get(role, role.title())
        desc = ROLE_ROLE.get(role, role)
        conf = c.get("confidence")
        tail = f" *(inferred)*" if conf == "inferred" else ""
        lines.append(f"- **{label}**: `{hexv}` - {desc}{tail}")
        wrote_color = True
    if not wrote_color:
        lines.append("- _No palette extracted — see the source teardown's evidence gaps._")
    lines.append("")

    # Typography
    heading, body = pick_typography(typo)
    lines.append("## Typography")
    lines.append("")
    lines.append(f"- **Headers**: {heading} (with {font_fallback(heading)} fallback)")
    lines.append(f"- **Body Text**: {body} (with {font_fallback(body)} fallback)")
    lines.append("")

    # Best Used For
    lines.append("## Best Used For")
    lines.append("")
    lines.append(
        f"Artifacts that should carry {name}'s look-and-feel — on-brand decks, pages, "
        f"reports, or mockups in a {name}-styled context."
    )
    lines.append("")

    # Provenance
    analyzed = tgt.get("analyzed_at") or str(date.today())
    lines.append(
        f"Source: brand-teardown of [{domain}]({url}) · generated {date.today()} "
        f"(analyzed {analyzed}). Regenerated whenever the teardown is re-run."
    )
    lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("kit", help="path to brand_kit.json")
    ap.add_argument("--themes-dir", default=None,
                    help="override the apply-theme source themes/ dir")
    args = ap.parse_args()

    with open(args.kit, encoding="utf-8") as f:
        kit = json.load(f)

    domain = (kit.get("target", {}) or {}).get("domain") or \
             (kit.get("target", {}) or {}).get("url") or "brand"
    slug = domain_slug(domain)
    md = build_theme_md(kit)

    source_dir = Path(args.themes_dir or os.environ.get("APPLY_THEME_DIR") or DEFAULT_SOURCE_THEMES)
    written = []

    # 1) Vault source (durable) — the write that survives compilation.
    try:
        source_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / f"{slug}.md").write_text(md, encoding="utf-8")
        written.append(str(source_dir / f"{slug}.md"))
    except OSError as e:
        print(f"WARN: could not write source theme ({source_dir}): {e}", file=sys.stderr)

    # 2) Runtime copy (best-effort) — usable this session before the next sync.
    if RUNTIME_THEMES.exists():
        try:
            (RUNTIME_THEMES / f"{slug}.md").write_text(md, encoding="utf-8")
            written.append(str(RUNTIME_THEMES / f"{slug}.md"))
        except OSError as e:
            print(f"WARN: could not write runtime theme: {e}", file=sys.stderr)

    if not written:
        print("ERROR: no theme file written", file=sys.stderr)
        sys.exit(1)
    print(f"emitted theme '{slug}' ({brand_name(domain)}) ->")
    for w in written:
        print(f"  {w}")


if __name__ == "__main__":
    main()
