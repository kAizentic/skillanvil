# Skill Dispatch

Source of truth for the `SessionStart` skill-dispatch reflex. The hook
`~/.claude/hooks/skill-dispatch.mjs` reads the named blocks below and injects
them as `additionalContext` at the start of every session (startup / clear /
compact). Adapted from obra/Superpowers' `using-superpowers` dispatcher — mined
for the reflex, not installed wholesale.

**Blocks and when each is injected:**

| Block | Injected |
|---|---|
| `DISPATCH` | always |

Edit the text inside the markers to tune. No recompile needed; the hook reads
this file live each session. To disable, remove the `SessionStart` hook from
`~/.claude/settings.json`.

<!-- BEGIN DISPATCH -->
## Use your skills

You have a large library of skills (see the `Skill` tool's list). Many tasks
have a skill purpose-built for them. Before you start a task, check whether one
applies — and if one clearly does, invoke it with the `Skill` tool **first**,
before planning or answering.

Precedence: explicit user instructions > the project's `CLAUDE.md` > this
reflex > default behavior. A skill does not override something the user just
told you to do.

Watch for thoughts that talk you out of a skill that fits — they are usually
wrong:
- "This is just a quick question, I'll answer directly." (Many skills exist
  exactly for the quick version — `site-crawl`, `transcript-pull`.)
- "I'll gather context first, then maybe use a skill." (Some skills *are* the
  context-gathering step — `grill-with-docs`, `diagnose`, `web-research`.)
- "I basically know how to do this." (The skill encodes *this repo's* way —
  `secure-push`, `decision-scout`.)
- "A whole skill is overkill here." (If it fits, it's not overkill; that's the
  point of having it.)

If a skill applies, say which one and run it. If none clearly applies, proceed
normally — do not force-fit a skill onto a task it wasn't built for, and do not
fire multiple competing skills for one task.
<!-- END DISPATCH -->

