#!/usr/bin/env python3
"""Clean a YouTube/yt-dlp subtitle file (.vtt or .srt) into readable prose.

YouTube auto-captions use a rolling window: each cue repeats the previous
line then appends new words, and every word carries an inline
<00:00:..><c>..</c> timestamp tag. Raw, that's unreadable and ~3x token bloat.
This collapses it to clean text suitable for `wisdom` / `capture` / the inbox.

Algorithm: strip headers + cue timing/index lines, remove inline angle-bracket
tags, drop blank and (optionally) bracketed sound-effect lines, then dedup
*consecutive* identical lines — which is exactly what the rolling window
produces (A / A B / B C / C D  ->  A B C D).

Stdlib only. Usage:
    python clean_transcript.py input.en.vtt              # prose to stdout
    python clean_transcript.py input.srt -o out.txt      # to a file
    python clean_transcript.py input.vtt --lines         # one line per cue
    python clean_transcript.py input.vtt --keep-effects  # keep [Music] etc.
    cat input.vtt | python clean_transcript.py -         # from stdin
"""
import argparse
import re
import sys

TAG_RE = re.compile(r"<[^>]+>")          # <00:00:19.039>, <c>, </c>, <i> ...
TIMING_RE = re.compile(r"-->")           # cue timing line
INDEX_RE = re.compile(r"^\d+$")          # SRT cue index line
EFFECT_RE = re.compile(r"^\[[^\]]*\]$")  # standalone [Music], [Applause], ...
HEADER_RE = re.compile(r"^(WEBVTT|Kind:|Language:|NOTE\b|STYLE\b|::cue)", re.I)


def clean(text, keep_effects=False, one_per_line=False):
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if HEADER_RE.match(line) or TIMING_RE.search(line) or INDEX_RE.match(line):
            continue
        line = TAG_RE.sub("", line).strip()
        line = re.sub(r"\s+", " ", line)
        if not line:
            continue
        if EFFECT_RE.match(line) and not keep_effects:
            continue
        if out and out[-1] == line:   # collapse the rolling-window repeat
            continue
        out.append(line)
    if one_per_line:
        return "\n".join(out)
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser(description="Clean a .vtt/.srt subtitle file into prose.")
    ap.add_argument("input", help="subtitle file path, or '-' for stdin")
    ap.add_argument("-o", "--output", help="write to file instead of stdout")
    ap.add_argument("--lines", action="store_true", help="one line per cue instead of joined prose")
    ap.add_argument("--keep-effects", action="store_true", help="keep [Music]/[Applause]-style lines")
    args = ap.parse_args()

    if args.input == "-":
        data = sys.stdin.read()
    else:
        with open(args.input, encoding="utf-8") as f:
            data = f.read()

    result = clean(data, keep_effects=args.keep_effects, one_per_line=args.lines)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result + "\n")
    else:
        sys.stdout.write(result + "\n")


if __name__ == "__main__":
    main()
