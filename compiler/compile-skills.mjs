#!/usr/bin/env node
// =============================================================================
// Vault → ~/.claude/skills compiler
// -----------------------------------------------------------------------------
// Single-file, zero-dependency Node (ESM) tool. Treats the Obsidian vault
// (agent-os/Skills) as the authoritative source and generates runtime skill
// artifacts under ~/.claude/skills.
//
// SAFETY CONTRACT
//   * Only ever writes/removes skills it owns. Ownership is proven two ways:
//       1. metadata.json contains  "generated_by": "vault-skill-pipeline"
//       2. the slug is listed in the manifest (.vault-pipeline-manifest.json)
//     Hand-authored skills already in ~/.claude/skills are never touched.
//   * Idempotent: re-running produces the same tree.
//   * Stale cleanup removes a runtime skill ONLY if it is in the old manifest,
//     absent from the new build, and still carries the generated_by marker.
//
// COMMANDS
//   compile [--dry-run]   Build runtime artifacts (default)
//   validate              Validate sources, write validation-report.md, exit 1 on error
//   graph                 Regenerate "Skill Relationships.md" (mermaid + orphan/dead)
//   glossary [--dry-run]  Regenerate ~/.claude/skills/GLOSSARY.md (roster from the
//                         runtime dir; preserves curated Purpose/Function/Value)
//   resource-map [--dry-run]  Regenerate resource-map.json + resource-topology.html
//                         from each skill's `tools:` frontmatter (+ resource-sidecar.json)
//   all [--dry-run]       validate → compile → graph → glossary → resource-map
//   cowork [--push]       Mirror runtime skills into the Cowork marketplace plugin;
//                         with --push also git commit+push the marketplace repo
//   watch                 Recompile on source change (fs.watch); no plugin needed
//
// USAGE
//   node "agent-os/compiler/compile-skills.mjs" all
// =============================================================================

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Paths -----------------------------------------------------------------
const AI_SYSTEMS_DIR = path.resolve(__dirname, '..');           // .../agent-os
const VAULT_ROOT = path.resolve(AI_SYSTEMS_DIR, '..');          // the vault repo root
const VAULT_SKILLS_DIR = path.join(AI_SYSTEMS_DIR, 'Skills');   // source of truth
// Deterministic routine<->skill coupling check (owned by skill-portfolio-review) —
// run as a non-fatal advisory stage so a rename/retire that orphaned a routine is
// caught at skill-change time. See runRoutineCouplingCheck().
const ROUTINE_COUPLING_SCRIPT = path.join(
  VAULT_SKILLS_DIR, 'Automation', 'skill-portfolio-review', 'scripts',
  'routine_skill_coupling_check.py');
// Deterministic portfolio structural check (also owned by skill-portfolio-review) —
// run as a non-fatal advisory stage on `all` so structural rot (missing gates, stale
// refs, example stubs, …) nudges toward a skill-portfolio-review run instead of
// waiting for someone to remember the monthly cadence. See runPortfolioCheck().
const PORTFOLIO_CHECK_SCRIPT = path.join(
  VAULT_SKILLS_DIR, 'Automation', 'skill-portfolio-review', 'scripts',
  'portfolio_check.py');
// Resource-topology map generator — reads each skill's `tools:` frontmatter (+ the
// vendored sidecar) and re-emits resource-map.json + resource-topology.html. Run as
// the final `all` stage so the map stays truthful on every sync. Single source: the
// standalone script; we shell out to it rather than duplicate the logic here.
const RESOURCE_MAP_SCRIPT = path.join(__dirname, 'build-resource-map.mjs');
const PUBLISH_INTEGRITY_SCRIPT = path.join(__dirname, 'check-publish-integrity.mjs');
const RUNTIME_DIR =
  process.env.CLAUDE_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');
// Atomic-publish scratch space. This MUST live outside RUNTIME_DIR: Claude Code's
// own skill loader scans ~/.claude/skills and does NOT ignore dot-prefixed dirs, so
// a staging dir placed in there is surfaced to the model as a real, loadable skill
// for the duration of the rebuild. Sibling of RUNTIME_DIR keeps rename() on one
// volume, which is what makes the swap atomic.
const STAGING_ROOT = path.join(path.dirname(RUNTIME_DIR), '.skill-staging');
const MANIFEST_PATH = path.join(RUNTIME_DIR, '.vault-pipeline-manifest.json');
// Example-backlog manifest — machine-readable form of the validator's "no examples"
// warnings. The skill-run Stop hook (~/.claude/hooks/example-backlog-nudge.mjs) reads
// this to nudge ONLY for skills that don't have a real-run example yet; the moment an
// example lands in the vault source and compiles, the skill drops out and goes silent.
// Examples are written to the SOURCE dir recorded here, never the runtime copy
// (2026-07-12 convention: examples come only from real runs — see the
// example-backlog-convention memory / skill-portfolio-review CHANGELOG).
const EXAMPLE_BACKLOG_PATH = path.join(RUNTIME_DIR, '.example-backlog.json');
const RELATIONSHIPS_PATH = path.join(AI_SYSTEMS_DIR, 'Skill Relationships.md');
const GLOSSARY_PATH = path.join(RUNTIME_DIR, 'GLOSSARY.md');
const VALIDATION_REPORT_PATH = path.join(VAULT_SKILLS_DIR, 'validation-report.md');
const COWORK_CONFIG_PATH = path.join(__dirname, 'cowork-sync.json');

const GENERATED_MARKER = 'vault-skill-pipeline';
const VALID_CATEGORIES = ['Research', 'Coding', 'Writing', 'Analysis', 'Automation'];
const VALID_STATUS = ['draft', 'experimental', 'active', 'deprecated'];
const SKIP_DIRS = new Set(['Templates', 'node_modules']);

// Fields that are list-typed in the schema.
const LIST_FIELDS = new Set([
  'tags', 'triggers', 'inputs', 'outputs', 'tools',
  'dependencies', 'composes_with', 'aliases',
]);

// =============================================================================
// Minimal YAML-frontmatter parser (supports the documented schema subset:
// `key: scalar`, inline `[a, b]` lists, and block `-` lists). Dependency-free
// on purpose so the pipeline stays reproducible from a bare Node install.
// =============================================================================
function parseFrontmatter(raw, sourceLabel) {
  const errors = [];
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return { data: {}, body: raw, errors: ['No YAML frontmatter block found.'] };
  }
  const [, fmText, body] = m;
  const data = {};
  const lines = fmText.split(/\r?\n/);
  let currentListKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    // Block-list item: "  - value"
    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem) {
      if (!currentListKey) {
        errors.push(`Line ${i + 1}: list item with no parent key in ${sourceLabel}.`);
        continue;
      }
      data[currentListKey].push(stripScalar(listItem[1]));
      continue;
    }

    // "key: value"  or  "key:"  (keys may contain hyphens, e.g. Claude Code's
    // `disable-model-invocation` / `allowed-tools`).
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      errors.push(`Line ${i + 1}: cannot parse "${line.trim()}" in ${sourceLabel}.`);
      continue;
    }
    const key = kv[1];
    let value = kv[2].trim();
    currentListKey = null;

    if (value === '') {
      // Either an empty scalar or the header of a block list.
      if (LIST_FIELDS.has(key)) {
        data[key] = [];
        currentListKey = key;
      } else {
        data[key] = null;
      }
      continue;
    }

    // Block scalar: `key: |`, `|-`, `>`, `>-` with indented continuation lines.
    if (/^[|>][+-]?$/.test(value)) {
      const folded = value[0] === '>';
      const block = [];
      let blockIndent = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const bl = lines[j];
        if (bl.trim() === '') { block.push(''); continue; }
        const indent = bl.match(/^(\s+)/);
        if (!indent) break; // dedented → next key, block ends
        if (blockIndent === null) blockIndent = indent[1].length;
        block.push(bl.slice(blockIndent));
      }
      while (block.length && block[block.length - 1] === '') block.pop();
      data[key] = folded ? block.join(' ') : block.join('\n');
      i = j - 1;
      continue;
    }

    // Inline list: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((s) => stripScalar(s.trim()));
      continue;
    }

    const scalar = stripScalar(value);
    data[key] = LIST_FIELDS.has(key) ? [scalar] : scalar;
  }

  return { data, body: body || '', errors };
}

function stripScalar(s) {
  let v = s.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

// =============================================================================
// Discovery
// =============================================================================
// Reads every SKILL.md. Directory metadata (readdir/stat/exists) is cheap even on
// a cloud-sync root; file CONTENT is not — on this vault's cloud-sync folder each cold open
// costs ~2s, so 81 serial reads = ~157s before any command could even dispatch.
// The reads are therefore issued concurrently: measured 157s -> ~39s (~4x). The
// walk stays synchronous because it is already sub-20ms.
async function discoverSkills() {
  const skills = [];
  if (!fs.existsSync(VAULT_SKILLS_DIR)) return skills;

  const targets = [];
  for (const category of fs.readdirSync(VAULT_SKILLS_DIR)) {
    if (SKIP_DIRS.has(category) || category.startsWith('_') || category.startsWith('.')) continue;
    const catDir = path.join(VAULT_SKILLS_DIR, category);
    if (!fs.statSync(catDir).isDirectory()) continue;

    for (const skillId of fs.readdirSync(catDir)) {
      const skillDir = path.join(catDir, skillId);
      if (!fs.statSync(skillDir).isDirectory()) continue;
      const skillFile = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      targets.push({ category, skillId, skillDir, skillFile });
    }
  }

  const raws = await Promise.all(
    targets.map((t) => fsp.readFile(t.skillFile, 'utf8').then((r) => r, () => null))
  );

  for (let i = 0; i < targets.length; i++) {
    const raw = raws[i];
    if (raw === null) continue; // unreadable SKILL.md — treated as absent, as before
    const { category, skillId, skillDir } = targets[i];
    const { data, body, errors } = parseFrontmatter(raw, `${category}/${skillId}/SKILL.md`);
    skills.push({
      category,
      skillId,
      skillDir,
      slug: (data.slug || data.id || skillId).toString(),
      data,
      body,
      parseErrors: errors,
    });
  }
  return skills;
}

// =============================================================================
// Validation
// =============================================================================
// Vendored skills are kept verbatim from upstream and intentionally carry a
// minimal frontmatter (name + description). Their slugs are recorded in
// _vendored.json; for those we suppress the "missing recommended field" and
// "no examples" warnings (the compiler still applies defaults) so the report
// surfaces only real, actionable signal on authored skills.
function loadVendoredSlugs() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(VAULT_SKILLS_DIR, '_vendored.json'), 'utf8'));
    return new Set(Object.keys(j.skills || {}));
  } catch {
    return new Set();
  }
}

function validate(skills) {
  const vendored = loadVendoredSlugs();
  const issues = []; // {level: 'error'|'warn', skill, msg}
  const add = (level, skill, msg) => issues.push({ level, skill, msg });

  const ids = new Map();   // id -> [skill]
  const slugs = new Map(); // slug -> [skill]

  for (const s of skills) {
    const label = `${s.category}/${s.skillId}`;
    const isVendored = vendored.has(s.slug);
    for (const e of s.parseErrors) add('error', label, `Invalid YAML: ${e}`);

    // Required metadata — only what the runtime genuinely needs.
    for (const req of ['name', 'description']) {
      if (!s.data[req]) add('error', label, `Missing required field: ${req}`);
    }
    // Recommended — compiler applies defaults (version 0.0.0, status active,
    // category from folder), so these are warnings. Vendored skills carry a
    // deliberately minimal frontmatter, so skip these for them.
    if (!isVendored) {
      for (const rec of ['version', 'category', 'status']) {
        if (!s.data[rec]) add('warn', label, `Missing recommended field: ${rec} (default applied)`);
      }
    }
    if (s.data.category && !VALID_CATEGORIES.includes(s.data.category)) {
      add('warn', label, `category "${s.data.category}" not in ${VALID_CATEGORIES.join('|')}`);
    }
    if (s.data.status && !VALID_STATUS.includes(s.data.status)) {
      add('warn', label, `status "${s.data.status}" not in ${VALID_STATUS.join('|')}`);
    }
    if (s.data.version && !/^\d+\.\d+\.\d+$/.test(String(s.data.version))) {
      add('warn', label, `version "${s.data.version}" is not semver (x.y.z)`);
    }
    if (s.data.description && String(s.data.description).length < 40) {
      add('warn', label, 'description is short; trigger-rich descriptions retrieve better');
    }

    // Unquoted " #" in a frontmatter scalar silently truncates in any
    // comment-stripping loader — Claude Code's runtime loader included. Found
    // 2026-08-06: distill's description shipped for weeks loading as
    // "...dragged-in docs, Slack" because the unquoted ` #brain-inbox` opened a
    // YAML comment. THIS parser keeps the whole line, so the defect is invisible
    // to every other check here — the raw text has to be scanned. Error, not
    // warn: a truncated description is a shipped defect. Fix by rephrasing
    // (drop the #); quoting only protects strict parsers, and the runtime
    // loader is not one. `C#`-style values (no space before #) stay legal.
    try {
      const rawFm = (fs.readFileSync(path.join(s.skillDir, 'SKILL.md'), 'utf8')
        .match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || '';
      for (const line of rawFm.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const val = (t.match(/^[A-Za-z0-9_-]+:\s*(.*)$/) || t.match(/^-\s+(.*)$/) || [])[1];
        if (val && !/^["'|>]/.test(val) && /\s#/.test(val)) {
          add('error', label,
            `frontmatter scalar contains an unquoted " #" — comment-stripping loaders silently drop everything after it: "${t.slice(0, 80)}..."`);
        }
      }
    } catch { /* unreadable SKILL.md surfaces via parseErrors above */ }

    // Examples present? (folder with at least one file) — not expected on vendored.
    const exDir = path.join(s.skillDir, 'examples');
    const hasExamples = fs.existsSync(exDir) && fs.readdirSync(exDir).some((f) => !f.startsWith('.'));
    if (!hasExamples && !isVendored) add('warn', label, 'no examples/ — add at least one worked example');

    const id = (s.data.id || s.skillId).toString();
    (ids.get(id) || ids.set(id, []).get(id)).push(label);
    (slugs.get(s.slug) || slugs.set(s.slug, []).get(s.slug)).push(label);
  }

  // Duplicate ids / slugs
  for (const [id, members] of ids) {
    if (members.length > 1) add('error', members.join(', '), `Duplicate id "${id}"`);
  }
  for (const [slug, members] of slugs) {
    if (members.length > 1) add('error', members.join(', '), `Duplicate slug "${slug}"`);
  }

  // Dependency resolution + circular references
  const byId = new Map(skills.map((s) => [(s.data.id || s.skillId).toString(), s]));
  for (const s of skills) {
    const label = `${s.category}/${s.skillId}`;
    for (const dep of s.data.dependencies || []) {
      if (!byId.has(dep)) add('error', label, `Broken dependency: "${dep}" not found`);
    }
  }
  for (const cyc of findCycles(skills, byId)) {
    add('error', cyc.join(' → '), `Circular dependency: ${cyc.join(' → ')}`);
  }

  return issues;
}

function findCycles(skills, byId) {
  const cycles = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];

  function dfs(id) {
    color.set(id, GRAY);
    stack.push(id);
    const s = byId.get(id);
    for (const dep of (s && s.data.dependencies) || []) {
      if (!byId.has(dep)) continue;
      const c = color.get(dep) || WHITE;
      if (c === WHITE) dfs(dep);
      else if (c === GRAY) {
        const idx = stack.indexOf(dep);
        cycles.push([...stack.slice(idx), dep]);
      }
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const s of skills) {
    const id = (s.data.id || s.skillId).toString();
    if ((color.get(id) || WHITE) === WHITE) dfs(id);
  }
  // De-dup cycles by their set signature
  const seen = new Set();
  return cycles.filter((c) => {
    const sig = [...c].sort().join('|');
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

function writeValidationReport(skills, issues, { dryRun } = {}) {
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const now = new Date().toISOString();
  let md = `# Skill Validation Report\n\n`;
  md += `_Generated ${now} • ${skills.length} skills • ${errors.length} errors • ${warns.length} warnings_\n\n`;
  md += `> Auto-generated by \`compile-skills.mjs validate\`. Do not edit by hand.\n\n`;

  md += `## Errors\n\n`;
  md += errors.length
    ? errors.map((i) => `- ❌ **${i.skill}** — ${i.msg}`).join('\n') + '\n'
    : '_None._\n';
  md += `\n## Warnings\n\n`;
  md += warns.length
    ? warns.map((i) => `- ⚠️ **${i.skill}** — ${i.msg}`).join('\n') + '\n'
    : '_None._\n';

  md += `\n## Skills scanned\n\n`;
  md += '| Skill | Category | Version | Status |\n|---|---|---|---|\n';
  for (const s of skills) {
    md += `| ${s.data.name || s.skillId} | ${s.category} | ${s.data.version || '–'} | ${s.data.status || '–'} |\n`;
  }
  if (!dryRun) fs.writeFileSync(VALIDATION_REPORT_PATH, md);
  return { errors, warns };
}

// =============================================================================
// Compile
// =============================================================================
function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return { version: 1, generated: {} };
  }
}

// A runtime skill dir is "ours" only if its metadata.json carries the marker.
function isPipelineOwned(dir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
    return meta.generated_by === GENERATED_MARKER;
  } catch {
    return false;
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    // SKIP_DIRS (node_modules, Templates) was previously only applied to category
    // names in discoverSkills, never here — so a vendored harness's node_modules
    // (site-harvest ships 3,881 files) was mirrored verbatim into the runtime on
    // every compile. On a cloud-sync root each cold read costs ~2s, which
    // turned one skill into hours and stalled the whole pipeline.
    if (SKIP_DIRS.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
  return true;
}

function buildMetadata(s) {
  const d = s.data;
  const meta = {
    generated_by: GENERATED_MARKER,
    id: (d.id || s.skillId).toString(),
    slug: s.slug,
    name: d.name || s.skillId,
    description: d.description || '',
    version: d.version || '0.0.0',
    category: d.category || s.category,
    status: d.status || 'draft',
    tags: d.tags || [],
    triggers: d.triggers || [],
    inputs: d.inputs || [],
    outputs: d.outputs || [],
    tools: d.tools || [],
    dependencies: d.dependencies || [],
    composes_with: d.composes_with || [],
    supersedes: d.supersedes || null,
    aliases: d.aliases || [],
    owner: d.owner || null,
    last_updated: d.last_updated || null,
    source: path.relative(AI_SYSTEMS_DIR, s.skillDir).replace(/\\/g, '/'),
    compiled_at: new Date().toISOString(),
  };
  // Pass through any extra frontmatter keys (e.g. `license` on vendored skills)
  // so nothing is silently dropped.
  const known = new Set([...Object.keys(meta), 'id', 'slug']);
  for (const k of Object.keys(s.data)) {
    if (!known.has(k)) meta[k] = s.data[k];
  }
  return meta;
}

// Claude Code reads `name` + `description` from SKILL.md frontmatter. We emit a
// clean runtime frontmatter and keep the full schema in metadata.json.
// Claude Code reads a few hyphenated frontmatter flags directly off SKILL.md
// beyond name/description; pass these through to the runtime so behavior (e.g.
// user-only invocation) survives compilation.
const RUNTIME_PASSTHROUGH = ['disable-model-invocation', 'allowed-tools'];

// ---- Composition footer ----------------------------------------------------
// `composes_with` / `dependencies` are declared in every vault spec and were, until
// 2026-08-21, dropped entirely at this boundary: the runtime carried name+description
// only, so ~180 declared edges existed in metadata.json (which the model never reads)
// and nowhere the model could see. This appends them to the runtime BODY — not the
// description, which is scarce trigger-surface and must not be diluted.
//
// The reverse edge is the valuable half: a skill that knows who calls it can hand off
// upward. `frontend-design` declares nothing and is composed by four others.
// Deterministic + sorted, so it never churns the idempotency check.
const COMPOSITION_MARKER =
  '<!-- composition: generated by compile-skills.mjs from the vault spec. Edit the spec, not this block. -->';

function buildCompositionIndex(skills) {
  const idOf = (s) => (s.data.id || s.skillId).toString();
  const slugById = new Map();
  for (const s of skills) {
    slugById.set(idOf(s), s.slug);
    slugById.set(s.slug, s.slug);
  }
  const idx = new Map();
  const ensure = (id) =>
    idx.get(id) ||
    idx.set(id, { composes: new Set(), composedBy: new Set(), deps: new Set(), neededBy: new Set() }).get(id);

  for (const s of skills) {
    const id = idOf(s);
    const self = ensure(id);
    for (const c of s.data.composes_with || []) {
      const target = slugById.get(c.toString());
      if (!target || target === s.slug) continue; // dangling edges are validate()'s job
      self.composes.add(target);
      ensure(c.toString()).composedBy.add(s.slug);
    }
    for (const d of s.data.dependencies || []) {
      const target = slugById.get(d.toString());
      if (!target || target === s.slug) continue;
      self.deps.add(target);
      ensure(d.toString()).neededBy.add(s.slug);
    }
  }
  return { idx, idOf };
}

function compositionFooter(s, composition) {
  if (!composition) return '';
  const { idx, idOf } = composition;
  const e = idx.get(idOf(s));
  if (!e) return '';
  const fmt = (set) =>
    [...set].sort().map((n) => `\`${n}\``).join(' · ');
  const lines = [];
  if (e.deps.size) lines.push(`**Depends on:** ${fmt(e.deps)}`);
  if (e.composes.size) lines.push(`**Composes with:** ${fmt(e.composes)}`);
  if (e.composedBy.size) lines.push(`**Used by:** ${fmt(e.composedBy)}`);
  if (e.neededBy.size) lines.push(`**Required by:** ${fmt(e.neededBy)}`);
  if (!lines.length) return '';
  return `\n\n---\n\n${COMPOSITION_MARKER}\n## Composition\n\n${lines.join('  \n')}\n`;
}

function buildRuntimeSkillMd(s, composition) {
  const name = s.data.name || s.skillId;
  const desc = (s.data.description || '').replace(/\n/g, ' ').trim();
  const extra = [];
  for (const k of RUNTIME_PASSTHROUGH) {
    if (s.data[k] !== undefined && s.data[k] !== null) extra.push(`${k}: ${s.data[k]}`);
  }
  const fm = ['---', `name: ${name}`, `description: ${desc}`, ...extra, '---', ''].join('\n');
  const body = s.body.replace(/^\s+/, '').replace(/\s+$/, '');
  return fm + '\n' + body + compositionFooter(s, composition) + '\n';
}

// ---- Idempotency ----------------------------------------------------------
// A rebuild is skipped when it would be byte-identical to what's already on disk
// (ignoring the volatile compiled_at timestamp), so re-runs don't churn
// metadata.json. Conservative by design: any doubt → rebuild, so a real edit is
// never missed. This is what stops a scheduled sync from committing every day.
function readTextSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function metaSansVolatile(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const { compiled_at, ...rest } = meta;
  return rest;
}
// All support files under baseDir (recursive), excluding dotfiles everywhere and
// SKILL.md / metadata.json at the root. Returns Map<relPath, absPath>.
function collectSupportFiles(baseDir) {
  const files = new Map();
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      // Must mirror copyDir's skip set exactly, or the in-sync check walks (and
      // content-compares) thousands of files copyDir will never write — which
      // makes every skill look permanently out of sync and re-copies it forever.
      if (SKIP_DIRS.has(e.name)) continue;
      if (rel === '' && (e.name === 'SKILL.md' || e.name === 'metadata.json')) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs, relPath);
      else files.set(relPath, abs);
    }
  };
  walk(baseDir, '');
  return files;
}
// Content-compares a skill's support files against its runtime copy. Two things
// matter on a cloud-sync root, where a cold content read costs ~2s but stat is free:
//   1. size mismatch is decided from metadata alone — no content read at all;
//   2. the surviving pairs are read concurrently rather than one at a time.
// Serial full-content compare of every pair was the compile's dominant cost.
async function supportFilesInSync(srcDir, outDir) {
  const src = collectSupportFiles(srcDir);
  const out = collectSupportFiles(outDir);
  if (src.size !== out.size) return false;

  const pairs = [];
  for (const [rel, srcAbs] of src) {
    const outAbs = out.get(rel);
    if (!outAbs) return false;
    let sSize, oSize;
    try {
      sSize = fs.statSync(srcAbs).size;
      oSize = fs.statSync(outAbs).size;
    } catch { return false; }
    if (sSize !== oSize) return false; // differs, and it cost us nothing to learn
    pairs.push([srcAbs, outAbs]);
  }

  const results = await Promise.all(
    pairs.map(([a, b]) =>
      Promise.all([fsp.readFile(a), fsp.readFile(b)])
        .then(([x, y]) => x.equals(y))
        .catch(() => false)
    )
  );
  return results.every(Boolean);
}
// True when recompiling this skill would reproduce the current runtime dir exactly
// (apart from compiled_at) — so it can be left untouched.
async function runtimeUpToDate(outDir, skillDir, newSkillMd, newMeta) {
  if (readTextSafe(path.join(outDir, 'SKILL.md')) !== newSkillMd) return false;
  const oldMeta = readJsonSafe(path.join(outDir, 'metadata.json'));
  if (!oldMeta) return false;
  if (JSON.stringify(metaSansVolatile(oldMeta)) !== JSON.stringify(metaSansVolatile(newMeta))) return false;
  return supportFilesInSync(skillDir, outDir);
}

// Stamp the vault root into the runtime so a compiled skill can find its own SOURCE.
//
// Why this exists: `~/.claude/skills` is GENERATED and is not a git repo, so any
// script that wants "has my source been committed / where do I edit this?" cannot
// answer it from the runtime alone. Each metadata.json already carries a
// vault-RELATIVE `source` ("Skills/Coding/site-harvest"); this supplies the missing
// root, so `join(vaultRoot, 'agent-os', meta.source)` is the absolute source dir.
//
// A dotfile at the runtime ROOT, deliberately — NOT an absolute path stamped into
// each metadata.json. The cowork target mirrors every skill DIRECTORY into a
// marketplace git repo, so a per-skill absolute path would publish the local
// vault layout (username and all) 78 times over; `runtimeSkillNames()` filters
// `isDirectory()`, so a root-level dotfile is naturally excluded from that mirror.
// One file, no leak, and it survives the vault moving.
function writeVaultRootStamp({ dryRun } = {}) {
  const stampPath = path.join(RUNTIME_DIR, '.vault-root');
  const body = VAULT_ROOT + '\n';
  let existing = null;
  try { existing = fs.readFileSync(stampPath, 'utf8'); } catch { /* absent */ }
  if (existing === body) return { changed: false, stampPath };
  if (!dryRun) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(stampPath, body);
  }
  return { changed: true, stampPath };
}

async function compile(skills, { dryRun } = {}) {
  // Built once over the whole set — the reverse edges need every spec in hand.
  const composition = buildCompositionIndex(skills);
  const oldManifest = loadManifest();
  const newManifest = { version: 1, generated: {}, compiled_at: new Date().toISOString() };
  const actions = [];
  const collisions = [];
  let rebuilt = 0;
  let unchanged = 0;

  // Debris from a run that died mid-publish.
  if (!dryRun) {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
    fs.mkdirSync(STAGING_ROOT, { recursive: true });
    // Legacy sweep: an earlier revision of this function staged INSIDE RUNTIME_DIR.
    // Those dirs are surfaced to the model as loadable skills, so clear any that a
    // pre-fix run left behind.
    if (fs.existsSync(RUNTIME_DIR)) {
      for (const e of fs.readdirSync(RUNTIME_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        if (!e.name.startsWith('.staging-') && !e.name.startsWith('.retired-')) continue;
        fs.rmSync(path.join(RUNTIME_DIR, e.name), { recursive: true, force: true });
        actions.push(`swept stale publish dir ~/.claude/skills/${e.name}/`);
      }
    }
  }

  // Idempotent: rewritten only when the vault root actually moves.
  const stamp = writeVaultRootStamp({ dryRun });
  if (stamp.changed) actions.push(`${dryRun ? '[dry-run] ' : ''}stamp vault root → ~/.claude/skills/.vault-root`);

  // Set of skill ids/slugs that some OTHER skill declares it supersedes
  // (supersedes lives on the replacing skill, e.g. grill-with-docs -> grill-me).
  const supersededIds = new Set();
  for (const s of skills) {
    const sup = s.data.supersedes;
    if (!sup) continue;
    for (const id of Array.isArray(sup) ? sup : [sup]) {
      if (id) supersededIds.add(String(id).trim());
    }
  }

  for (const s of skills) {
    const outDir = path.join(RUNTIME_DIR, s.slug);
    const label = `${s.category}/${s.skillId}`;

    // Deprecation becomes a real retirement: a `status: deprecated` skill that
    // some other skill supersedes is NOT emitted to the runtime, so it can no
    // longer activate. The source SKILL.md stays as a tombstone; not adding it
    // to newManifest lets stale-cleanup drop any previously-compiled dir.
    // (wiki-lint's source<->compiled mirror check exempts these — intentional,
    // not drift.) A deprecated skill with NO superseder is left alone.
    if (s.data.status === 'deprecated' &&
        (supersededIds.has(s.skillId) || supersededIds.has(s.slug))) {
      actions.push(`retire ${label} → not emitted (deprecated + superseded)`);
      continue;
    }

    // Collision guard: never overwrite a hand-made runtime skill. A dir is "ours"
    // only if its metadata.json carries the generated_by marker.
    const ownedByUs = isPipelineOwned(outDir);
    const dirHasContent =
      fs.existsSync(outDir) && fs.readdirSync(outDir).some((f) => !f.startsWith('.'));
    if (dirHasContent && !ownedByUs) {
      collisions.push({ label, slug: s.slug });
      actions.push(`SKIP ${label} → ~/.claude/skills/${s.slug}/ (hand-made skill present; not overwritten)`);
      continue;
    }

    // Build the would-be outputs, then skip the write if the dir is already in
    // sync (ignoring compiled_at) — no churn, no spurious commit.
    const newSkillMd = buildRuntimeSkillMd(s, composition);
    const newMeta = buildMetadata(s);
    const upToDate = ownedByUs && (await runtimeUpToDate(outDir, s.skillDir, newSkillMd, newMeta));

    actions.push(`${upToDate ? 'unchanged' : 'compile'} ${label} → ~/.claude/skills/${s.slug}/`);
    newManifest.generated[s.slug] = {
      source: path.relative(AI_SYSTEMS_DIR, s.skillDir).replace(/\\/g, '/'),
      version: s.data.version || '0.0.0',
    };
    if (upToDate) { unchanged++; continue; }
    rebuilt++;
    if (dryRun) continue;

    // Atomic publish. The previous implementation wiped outDir and then re-copied
    // its entries in readdir order, so the published dir sat half-populated for
    // however long the copy took — on a cloud-sync source, MINUTES. Hooks are
    // registered in the *global* ~/.claude/settings.json against paths inside
    // these dirs (e.g. site-harvest/scripts/selfimprove-guard.mjs), so every open
    // session broke while any compile ran, not just the one compiling. A
    // half-built dir and a broken one are indistinguishable from the consumer's
    // side, which is what made it read as "the file is missing."
    //
    // Instead: build the whole tree in a staging dir, then swap it in with
    // rename(). Renames are metadata-only and same-parent, so the interval where
    // outDir is anything other than a complete tree is sub-millisecond. The slow
    // part (reading source off the cloud-sync folder) now happens entirely off to the side,
    // where nothing points at it. Staging names are dot-prefixed so the readdir
    // consumers elsewhere in this file skip them if a crash ever leaves one behind.
    const staging = path.join(STAGING_ROOT, `staging-${s.slug}`);
    const retired = path.join(STAGING_ROOT, `retired-${s.slug}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(retired, { recursive: true, force: true });

    try {
      fs.mkdirSync(staging, { recursive: true });
      fs.writeFileSync(path.join(staging, 'SKILL.md'), newSkillMd);
      fs.writeFileSync(
        path.join(staging, 'metadata.json'),
        JSON.stringify(newMeta, null, 2)
      );
      // Mirror every support file/dir (scripts/, reference.md, LICENSE.txt, assets,
      // examples/, templates/, …) verbatim. SKILL.md/metadata.json are managed above.
      for (const entry of fs.readdirSync(s.skillDir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.name === 'SKILL.md' || entry.name === 'metadata.json') continue;
        const src = path.join(s.skillDir, entry.name);
        const dest = path.join(staging, entry.name);
        if (entry.isDirectory()) copyDir(src, dest);
        else fs.copyFileSync(src, dest);
      }

      // ---- the swap: the only part a concurrent reader can observe ----
      // Windows rename() refuses a non-empty existing destination, so the old
      // tree is moved aside first rather than deleted in place.
      const hadOld = fs.existsSync(outDir);
      if (hadOld) fs.renameSync(outDir, retired);
      fs.renameSync(staging, outDir);
      // Deleting the old tree is slow, but it now happens AFTER the new one is
      // already published, so it is off the critical path.
      if (hadOld) fs.rmSync(retired, { recursive: true, force: true });
    } catch (err) {
      // Publish failed: leave whatever is currently live untouched rather than
      // shipping a partial tree. Restore the old one if the swap died mid-way.
      fs.rmSync(staging, { recursive: true, force: true });
      if (fs.existsSync(retired) && !fs.existsSync(outDir)) {
        fs.renameSync(retired, outDir);
      }
      fs.rmSync(retired, { recursive: true, force: true });
      throw err;
    }
  }

  // ---- Safe stale cleanup -------------------------------------------------
  const removed = [];
  for (const slug of Object.keys(oldManifest.generated || {})) {
    if (newManifest.generated[slug]) continue; // still built
    const dir = path.join(RUNTIME_DIR, slug);
    const metaPath = path.join(dir, 'metadata.json');
    if (!fs.existsSync(metaPath)) continue;
    let meta;
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
    if (meta.generated_by !== GENERATED_MARKER) continue; // never touch hand-made skills
    removed.push(slug);
    if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const slug of removed) actions.push(`remove stale ~/.claude/skills/${slug}/`);

  if (!dryRun) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(newManifest, null, 2));
  }
  return { actions, removed, collisions, rebuilt, unchanged, count: Object.keys(newManifest.generated).length };
}

// =============================================================================
// Knowledge graph  → Skill Relationships.md
// =============================================================================
function buildGraph(skills, { dryRun } = {}) {
  const byId = new Map(skills.map((s) => [(s.data.id || s.skillId).toString(), s]));
  const idOf = (s) => (s.data.id || s.skillId).toString();

  // Reverse index for orphan/dead detection
  const referenced = new Set();
  for (const s of skills) {
    for (const dep of s.data.dependencies || []) referenced.add(dep);
    for (const c of s.data.composes_with || []) referenced.add(c);
  }

  let mermaid = 'flowchart LR\n';
  for (const s of skills) {
    const id = idOf(s);
    const safe = id.replace(/[^A-Za-z0-9_]/g, '_');
    mermaid += `  ${safe}["${s.data.name || id}"]\n`;
  }
  for (const s of skills) {
    const from = idOf(s).replace(/[^A-Za-z0-9_]/g, '_');
    for (const dep of s.data.dependencies || []) {
      if (!byId.has(dep)) continue;
      const to = dep.replace(/[^A-Za-z0-9_]/g, '_');
      mermaid += `  ${from} -->|depends on| ${to}\n`;
    }
    for (const c of s.data.composes_with || []) {
      if (!byId.has(c)) continue;
      const to = c.replace(/[^A-Za-z0-9_]/g, '_');
      mermaid += `  ${from} -.->|composes with| ${to}\n`;
    }
  }

  // Orphans: no inbound and no outbound edges. Dead: status deprecated.
  const orphans = skills.filter((s) => {
    const id = idOf(s);
    const out = (s.data.dependencies || []).length + (s.data.composes_with || []).length;
    return out === 0 && !referenced.has(id);
  });
  const dead = skills.filter((s) => s.data.status === 'deprecated');

  const now = new Date().toISOString();
  let md = `# Skill Relationships\n\n`;
  md += `_Auto-generated ${now} by \`compile-skills.mjs graph\`. Edit skills, not this file._\n\n`;
  md += `## Dependency & composition graph\n\n\`\`\`mermaid\n${mermaid}\`\`\`\n\n`;
  md += `**Legend** — solid arrow = hard dependency, dotted = composes-with (soft).\n\n`;

  md += `## By category\n\n`;
  for (const cat of VALID_CATEGORIES) {
    const inCat = skills.filter((s) => (s.data.category || s.category) === cat);
    if (!inCat.length) continue;
    md += `### ${cat}\n`;
    for (const s of inCat) {
      md += `- [[${s.data.name || s.skillId}]] \`${idOf(s)}\` — v${s.data.version || '0.0.0'} · ${s.data.status || 'draft'}\n`;
    }
    md += '\n';
  }

  md += `## Orphaned skills (no dependency links — candidates for composition)\n\n`;
  md += orphans.length ? orphans.map((s) => `- ${s.data.name || s.skillId}`).join('\n') + '\n' : '_None._\n';
  md += `\n## Deprecated / dead skills\n\n`;
  md += dead.length
    ? dead.map((s) => `- ${s.data.name || s.skillId}${s.data.supersedes ? ` → superseded by \`${s.data.supersedes}\`` : ''}`).join('\n') + '\n'
    : '_None._\n';

  if (!dryRun) fs.writeFileSync(RELATIONSHIPS_PATH, md);
  return { orphans: orphans.length, dead: dead.length };
}

// =============================================================================
// Glossary  → ~/.claude/skills/GLOSSARY.md
// -----------------------------------------------------------------------------
// A human-facing catalogue of EVERY runtime skill (vault-compiled + hand-made +
// vendored), read from the freshly-synced runtime dir — not just vault sources —
// so it reflects what is actually invokable. Runs at the end of `all`.
//
// Curation is preserved: the hand-written Purpose/Function/Value prose already in
// GLOSSARY.md is parsed out and re-emitted verbatim. This stage only maintains
// the *roster* — it drops entries whose skill no longer exists and lists any
// newly-present skill (as a description-seeded stub) under "Recently added" for a
// human to enrich and file. The Appendix (built-in/plugin skills not under
// ~/.claude/skills) is passed through verbatim. Never fabricates prose.
// =============================================================================
function runtimeSkillFrontmatter() {
  const out = [];
  if (!fs.existsSync(RUNTIME_DIR)) return out;
  for (const e of fs.readdirSync(RUNTIME_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const sf = path.join(RUNTIME_DIR, e.name, 'SKILL.md');
    if (!fs.existsSync(sf)) continue;
    const { data } = parseFrontmatter(fs.readFileSync(sf, 'utf8'), `${e.name}/SKILL.md`);
    out.push({
      slug: e.name,
      name: data.name || e.name,
      description: String(data.description || '').replace(/\s+/g, ' ').trim(),
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

// Split an existing GLOSSARY.md into ordered category sections (each with its
// entry lines keyed by slug) and a verbatim Appendix tail. Lenient by design so
// the hand-written file round-trips: a section is any `## Heading`; an entry is
// any line beginning `**slug**`; the first heading starting "Appendix" ends the
// parse and everything from it onward is preserved untouched.
function parseExistingGlossary(text) {
  const sections = [];
  let appendix = null;
  if (!text) return { sections, appendix };
  const lines = text.split(/\r?\n/);
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.*)$/);
    if (h) {
      if (/^appendix\b/i.test(h[1].trim())) {
        appendix = lines.slice(i).join('\n').replace(/\s+$/, '');
        break;
      }
      cur = { title: h[1].trim(), entries: [] };
      sections.push(cur);
      continue;
    }
    if (cur) {
      const em = lines[i].match(/^\*\*([^*]+)\*\*/);
      if (em) cur.entries.push({ slug: em[1].trim(), line: lines[i].replace(/\s+$/, '') });
    }
  }
  return { sections, appendix };
}

function glossaryPreface(date, count) {
  return [
    '# Skills Glossary', '',
    'A maintained catalogue of the skills in `~/.claude/skills/`. Each entry gives a',
    'brief **Purpose** (why it exists), **Function** (what it does), and **Value**',
    '(the payoff), grouped by domain.', '',
    `- **Last generated:** ${date} — by \`compile-skills.mjs glossary\`, run inside \`skill-pipeline-sync\`.`,
    `- **Scope:** ${count} skills under \`~/.claude/skills/\` (vault-compiled + hand-made + vendored). Built-in / plugin skills are in the appendix.`,
    '- **Upkeep:** regenerated on every `all` sync. Curated Purpose / Function / Value prose is **preserved** across runs; skills newly present in the runtime appear under "Recently added — uncategorized" as stubs to enrich and file; removed skills drop out automatically.',
    '- **Routine tag:** any skill fired by a scheduled routine ends its entry with `_(routine: Name)_` (see `agent-os/docs/routines.md`). This is hand-curated on the entry line — preserved across syncs; add/remove it when a routine changes.',
    '', '---', '', '',
  ].join('\n');
}

function buildGlossary({ dryRun } = {}) {
  const R = runtimeSkillFrontmatter();
  const bySlug = new Map(R.map((s) => [s.slug, s]));
  const existing = parseExistingGlossary(readTextSafe(GLOSSARY_PATH));
  const handled = new Set();
  let dropped = 0;

  const outSections = [];
  for (const sec of existing.sections) {
    const kept = [];
    for (const e of sec.entries) {
      if (!bySlug.has(e.slug)) { dropped++; continue; }  // skill gone → drop
      if (handled.has(e.slug)) continue;                 // de-dupe
      handled.add(e.slug);
      kept.push(e.line);
    }
    if (kept.length) outSections.push({ title: sec.title, lines: kept });
  }

  const added = R.filter((s) => !handled.has(s.slug));
  if (added.length) {
    outSections.push({
      title: 'Recently added — uncategorized',
      lines: added.map((s) =>
        `**${s.slug}** — ${s.description || '_(no description in frontmatter)_'}  \n` +
        '  _⟨auto-added; edit to add Purpose / Function / Value and file under a section above⟩_'),
    });
  }

  const date = new Date().toISOString().slice(0, 10);
  let md = glossaryPreface(date, handled.size + added.length);
  for (const sec of outSections) md += `## ${sec.title}\n\n${sec.lines.join('\n\n')}\n\n`;
  if (existing.appendix) md += `---\n\n${existing.appendix}\n`;

  if (!dryRun) {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(GLOSSARY_PATH, md);
  }
  return { total: handled.size + added.length, added: added.length, dropped };
}

// =============================================================================
// Cowork marketplace sync  → mirror runtime skills into a plugin's skills/ dir
// -----------------------------------------------------------------------------
// Cowork loads skills only from installed *plugins* (a marketplace = a git repo),
// never from ~/.claude/skills. This target mirrors the compiled runtime skills
// into a plugin's skills/ dir inside the marketplace repo; a push then makes them
// available in Cowork (Customize → Plugins → Update).
//
// Target resolution (first that is set):
//   1. env  COWORK_MARKETPLACE_DIR
//   2. agent-os/compiler/cowork-sync.json →
//        { "marketplace_dir": "...", "plugin": "second-brain",
//          "git_user": "...", "git_email": "..." }
// If neither is set, the command no-ops with a hint (never fails the pipeline).
// Safety: refuses unless the target is a real marketplace repo (has
// .claude-plugin/marketplace.json), and only ever wipes <plugin>/skills.
// =============================================================================
function loadCoworkConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(COWORK_CONFIG_PATH, 'utf8')); } catch { /* optional */ }
  const marketplaceDir = process.env.COWORK_MARKETPLACE_DIR || cfg.marketplace_dir;
  if (!marketplaceDir) return null;
  return {
    marketplaceDir,
    plugin: cfg.plugin || 'second-brain',
    gitUser: cfg.git_user || null,
    gitEmail: cfg.git_email || null,
  };
}

// Every runtime skill (both pipeline- and hand-made) so the plugin mirrors what
// is actually usable in Claude Code today.
function runtimeSkillNames() {
  if (!fs.existsSync(RUNTIME_DIR)) return [];
  return fs.readdirSync(RUNTIME_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .filter((e) => fs.existsSync(path.join(RUNTIME_DIR, e.name, 'SKILL.md')))
    .map((e) => e.name);
}

function syncCowork({ push, dryRun }) {
  const cfg = loadCoworkConfig();
  if (!cfg) {
    return { ok: false, msg: 'no Cowork target (set env COWORK_MARKETPLACE_DIR or agent-os/compiler/cowork-sync.json) — skipped.' };
  }
  // Safety: only touch a directory that is actually our marketplace repo.
  if (!fs.existsSync(path.join(cfg.marketplaceDir, '.claude-plugin', 'marketplace.json'))) {
    return { ok: false, msg: `target "${cfg.marketplaceDir}" is not a marketplace repo (no .claude-plugin/marketplace.json) — skipped.` };
  }

  const pluginSkillsDir = path.join(cfg.marketplaceDir, cfg.plugin, 'skills');
  const names = runtimeSkillNames();

  // Clean re-sync: wipe just <plugin>/skills, then copy each runtime skill
  // (copyDir already skips dotfiles, e.g. .vault-pipeline-manifest.json).
  if (!dryRun) {
    fs.rmSync(pluginSkillsDir, { recursive: true, force: true });
    fs.mkdirSync(pluginSkillsDir, { recursive: true });
    for (const name of names) {
      copyDir(path.join(RUNTIME_DIR, name), path.join(pluginSkillsDir, name));
    }
  }

  const res = { ok: true, count: names.length, marketplaceDir: cfg.marketplaceDir, plugin: cfg.plugin };
  if (push && !dryRun) {
    const opt = { cwd: cfg.marketplaceDir, stdio: 'pipe' };
    try {
      execSync('git add -A', opt);
      if (!execSync('git status --porcelain', opt).toString().trim()) {
        res.noChanges = true;
        return res;
      }
      const id = [];
      if (cfg.gitUser) id.push(`-c user.name="${cfg.gitUser}"`);
      if (cfg.gitEmail) id.push(`-c user.email="${cfg.gitEmail}"`);
      const stamp = new Date().toISOString().slice(0, 10);
      execSync(`git ${id.join(' ')} commit -q -m "Sync skills → Cowork (${names.length} skills, ${stamp})"`, opt);
      res.committed = true;
      try { execSync('git push -q', opt); res.pushed = true; }
      catch { res.pushWarn = 'committed, but push failed (no remote / auth?). Add a remote, then push.'; }
    } catch (e) {
      res.gitWarn = `git step failed: ${String(e.message).split('\n')[0]}`;
    }
  }
  return res;
}

// =============================================================================
// Routine ↔ skill coupling — non-fatal advisory stage
// -----------------------------------------------------------------------------
// The vault's scheduled routines invoke skills by name (`… skill`) or trigger
// phrase (`-p "…"`). A rename / retire / tombstone silently orphans that routine
// (it still exits 0, so the routine-health watchdog can't see it). This shells out
// to the deterministic Python check that skill-portfolio-review owns — ONE source of
// truth, derived from the same SKILL.md authority — and surfaces any BROKEN reference
// at skill-change time. REPORT-ONLY: it never aborts the compile or changes the exit
// code; a finding is just printed prominently. Soft-skips if no Python is present.
// =============================================================================
// Asserts the PUBLISHED tree is usable, rather than trusting compile's exit code.
// The failure this exists for stayed invisible for ten days precisely because every
// invoker reported success while the runtime tree was half-built. Report-only: a
// finding must not block a compile, because re-running the compile is the fix.
// --- shared stage runner ------------------------------------------------------
// One parameterised runner replaced three near-identical copies (2026-09-22).
//
// It also retires the discriminator those copies used. Each decided "is this a real
// finding, or did the script itself crash?" with `report.includes(BANNER)` - a substring
// match against a hardcoded header in HUMAN-READABLE stdout. Rename a report header and
// the pipeline silently starts reading its own checks wrong; that is the same fragility
// run-summary.ps1 was written to end on the runner side.
//
// The signal is now `--json` parsing: each of these checks already implements it, and a
// parseable verdict proves the script ran and reached a conclusion. Human output is
// unchanged - the JSON probe runs only on the non-zero path, to classify it.
function probeRanCleanly(bin, script, args) {
  try {
    const out = execSync(`${bin} "${script}" ${args} --json`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    JSON.parse(String(out));
    return true;                                  // exit 0 AND valid JSON
  } catch (e) {
    const s = e && e.stdout ? String(e.stdout) : '';
    try { JSON.parse(s); return true; } catch { return false; }
  }
}

function runCheckStage(log, opts) {
  const { script, args, label, bins, cleanMsg, onClean, onFindings } = opts;
  if (!fs.existsSync(script)) return;             // check not installed
  for (const bin of bins) {
    try {
      const out = execSync(`${bin} "${script}" ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (onClean) onClean(String(out));           // stage renders its own success output
      else if (cleanMsg) log(cleanMsg);
      return;                                     // exit 0 = clean
    } catch (e) {
      if (e && e.code === 'ENOENT') continue;     // interpreter absent -> try next
      const report = e && e.stdout ? String(e.stdout) : '';
      if (!probeRanCleanly(bin, script, args)) {  // the script itself errored, not a finding
        log(`${label}: skipped (check errored: ${String(e && e.message).split('\n')[0]}).`);
        return;
      }
      const n = e && typeof e.status === 'number' ? e.status : '?';
      onFindings(report, n);
      return;
    }
  }
  log(`${label}: skipped (no python interpreter found).`);
}

function runPublishIntegrityCheck(log) {
  runCheckStage(log, {
    script: PUBLISH_INTEGRITY_SCRIPT,
    args: `--vault "${VAULT_ROOT}"`,
    label: 'publish-integrity',
    bins: ['node'],
    cleanMsg: null,
    onClean: (out) => log(out.trim()),            // the script prints its own OK summary
    onFindings: (report) => {
      log('\n\u26a0\ufe0f  publish-integrity: the runtime tree is NOT usable as published.');
      process.stdout.write(report.endsWith('\n') ? report : report + '\n');
    },
  });
}

function runRoutineCouplingCheck(log) {
  runCheckStage(log, {
    script: ROUTINE_COUPLING_SCRIPT,
    args: `--vault "${VAULT_ROOT}"`,
    label: 'routine-coupling',
    bins: ['py', 'python3', 'python'],
    cleanMsg: 'routine-coupling: OK \u2014 every scheduled routine resolves to a live skill.',
    onFindings: (report, n) => {
      log(`\n\u26a0\ufe0f  routine-coupling: ${n} BROKEN routine reference(s) \u2014 a scheduled routine invokes a skill that no longer resolves.`);
      log('    Report-only (compile NOT blocked), but fix before the routine next fires:');
      process.stdout.write(report.endsWith('\n') ? report : report + '\n');
    },
  });
}

function runPortfolioCheck(log) {
  runCheckStage(log, {
    script: PORTFOLIO_CHECK_SCRIPT,
    args: `--skills-root "${VAULT_SKILLS_DIR}"`,
    label: 'portfolio-check',
    bins: ['py', 'python3', 'python'],
    cleanMsg: 'portfolio-check: CLEAN \u2014 no structural issues in the skill portfolio.',
    onFindings: (report, n) => {
      const headers = report.split('\n').filter((l) => l.startsWith('### '));
      log(`\u26a0\ufe0f  portfolio-check: ${n} categor(y/ies) fired \u2014 run skill-portfolio-review ("review my skills") to triage:`);
      for (const h of headers) log(`    ${h.slice(4)}`);
    },
  });
}


// =============================================================================
// Example-backlog manifest — data feed for the skill-run nudge hooks
// -----------------------------------------------------------------------------
// Mirrors the validator's "no examples" logic: active, non-deprecated, non-vendored
// skills whose source examples/ holds no .md. Values are SOURCE dirs (the vault is
// authoritative; a runtime write would be clobbered on the next sync).
// =============================================================================
function writeExampleBacklog(skills, log, { dryRun } = {}) {
  const vendored = loadVendoredSlugs();
  const backlog = {};
  for (const s of skills) {
    if (s.data.status === 'deprecated') continue;
    if (vendored.has(s.slug)) continue;
    const exDir = path.join(s.skillDir, 'examples');
    const hasExample = fs.existsSync(exDir) &&
      fs.readdirSync(exDir).some((f) => f.toLowerCase().endsWith('.md'));
    if (!hasExample) backlog[s.slug] = s.skillDir;
  }
  const n = Object.keys(backlog).length;
  if (!dryRun) {
    fs.writeFileSync(EXAMPLE_BACKLOG_PATH, JSON.stringify(
      { generated: new Date().toISOString(), skills: backlog }, null, 2));
  }
  log(`${dryRun ? '[dry-run] ' : ''}example-backlog: ${n} skill(s) awaiting a real-run example → .example-backlog.json`);
}

// -----------------------------------------------------------------------------
// Resource-topology map — regenerates resource-map.json + resource-topology.html
// -----------------------------------------------------------------------------
// Final `all` stage (after glossary): the skill×resource map compiles from each
// skill's `tools:` frontmatter, so it must be re-derived whenever a skill changes.
// Shells out to build-resource-map.mjs (ONE source of truth for the logic). Uses
// the same node binary running this compiler. Non-fatal: a failure is reported but
// never aborts the pipeline or changes the exit code.
// =============================================================================
// MCP declaration drift — non-fatal advisory stage (`all` only)
// -----------------------------------------------------------------------------
// Every skill spec declares its `tools:`, including `mcp__<server>` entries. Nothing
// ever checked those against the servers actually configured in ~/.claude.json, so a
// renamed or removed server leaves skills silently declaring a tool that cannot exist.
// Measured 2026-08-21: 11 skills declare `mcp__obsidian` and 1 declares `mcp__magic`.
//
// SCOPE LIMIT, stated so a clean run is not over-read: this compares declared against
// CONFIGURED. It cannot see whether a configured server actually connected in any given
// session — that is per-session runtime state no compiler can reach. A server can be
// configured here, pass this check, and still be absent at the tool layer. Treat a
// PASS as "the name resolves", never as "the tool is live".
// =============================================================================
// Managed/account-level MCPs never appear in `.claude.json` mcpServers — claude.ai
// connectors (Granola, Ahrefs, Slack, Notion, Netlify, Google*) are provisioned on the
// account, and claude-in-chrome ships with the browser extension. Treating their absence
// from the local config as drift flagged 30 live declarations on the first run, which is
// how a check becomes noise nobody reads. Only LOCAL stdio servers are checkable here.
const MANAGED_MCP_PATTERNS = [/^claude_ai_/, /^claude-in-chrome$/];

function runMcpDriftCheck(skills, log) {
  const configPaths = [
    path.join(os.homedir(), '.claude.json'),
    path.join(os.homedir(), '.claude', 'settings.json'),
  ];
  const configured = new Set();
  let sawConfig = false;
  for (const p of configPaths) {
    const j = readJsonSafe(p);
    if (!j) continue;
    sawConfig = true;
    for (const k of Object.keys(j.mcpServers || {})) configured.add(k);
    for (const proj of Object.values(j.projects || {})) {
      for (const k of Object.keys((proj && proj.mcpServers) || {})) configured.add(k);
    }
  }
  if (!sawConfig) {
    log('mcp-drift: skipped (no readable Claude config).');
    return;
  }

  // Vendored specs carry immutable upstream frontmatter; their real tools live in the
  // sidecar, so read declarations from the same place the resource map does.
  let sidecar = {};
  const sc = readJsonSafe(path.join(__dirname, 'resource-sidecar.json'));
  if (sc && sc.tools) sidecar = sc.tools;

  const declaredBy = new Map(); // server -> [skill ids]
  for (const s of skills) {
    const id = (s.data.id || s.skillId).toString();
    const tools = sidecar[id] || s.data.tools || [];
    for (const t of tools) {
      const m = String(t).match(/^mcp__([A-Za-z0-9_-]+)/);
      if (!m) continue;
      const server = m[1];
      if (configured.has(server)) continue;
      if (MANAGED_MCP_PATTERNS.some((re) => re.test(server))) continue;
      if (!declaredBy.has(server)) declaredBy.set(server, []);
      declaredBy.get(server).push(id);
    }
  }

  if (!declaredBy.size) {
    log(`mcp-drift: OK — every declared mcp__ server resolves to a configured server (${configured.size} configured). Configured != connected.`);
    return;
  }
  const total = [...declaredBy.values()].reduce((n, a) => n + a.length, 0);
  log(`\n⚠️  mcp-drift: ${declaredBy.size} declared MCP server(s) are NOT configured — ${total} skill declaration(s) affected:`);
  for (const [server, ids] of [...declaredBy.entries()].sort()) {
    const shown = ids.sort().slice(0, 6).join(', ');
    const more = ids.length > 6 ? ` (+${ids.length - 6} more)` : '';
    log(`    mcp__${server} — declared by ${ids.length}: ${shown}${more}`);
  }
  log('    Report-only. Fix = re-add the server, or drop it from those specs\' tools:.');
}

function runResourceMap(log, { dryRun }) {
  if (!fs.existsSync(RESOURCE_MAP_SCRIPT)) return; // generator absent → skip
  try {
    const flag = dryRun ? ' --dry-run' : '';
    const out = execSync(`"${process.execPath}" "${RESOURCE_MAP_SCRIPT}"${flag}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const first = out.split('\n').find((l) => l.trim());
    log(`resource-map: ${first ? first.trim() : 'done'}`);
  } catch (e) {
    log(`resource-map: skipped (generator errored: ${String(e && e.message).split('\n')[0]}).`);
  }
}

// =============================================================================
// CLI
// =============================================================================
const KNOWN_CMDS = ['validate', 'compile', 'graph', 'glossary', 'resource-map', 'all', 'cowork'];

async function main() {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith('-')) || 'compile';
  const dryRun = args.includes('--dry-run');

  if (cmd === 'watch') return runWatch();

  // Reject unknown commands BEFORE discoverSkills(). This check used to sit at the
  // very bottom of main(), so a typo still paid the full skill-discovery read cost
  // (~2m39s on this vault) just to print a usage line.
  if (!KNOWN_CMDS.includes(cmd)) {
    process.stdout.write(`Unknown command "${cmd}". Use: compile | validate | graph | glossary | resource-map | all | cowork | watch\n`);
    process.exit(2);
  }

  const skills = await discoverSkills();
  const log = (m) => process.stdout.write(m + '\n');

  if (cmd === 'validate' || cmd === 'all') {
    const issues = validate(skills);
    const { errors, warns } = writeValidationReport(skills, issues, { dryRun });
    log(`validate: ${skills.length} skills · ${errors.length} errors · ${warns.length} warnings`);
    for (const e of errors) log(`  ❌ ${e.skill} — ${e.msg}`);
    if (errors.length && cmd === 'validate') process.exit(1);
    if (errors.length && cmd === 'all') {
      log('Aborting compile due to validation errors.');
      process.exit(1);
    }
  }

  if (cmd === 'compile' || cmd === 'all') {
    const res = await compile(skills, { dryRun });
    log(`${dryRun ? '[dry-run] ' : ''}compile: ${res.rebuilt} rebuilt, ${res.unchanged} unchanged${res.collisions.length ? `, ${res.collisions.length} skipped (collision)` : ''} → ${RUNTIME_DIR}`);
    for (const a of res.actions) if (!a.startsWith('unchanged')) log(`  • ${a}`);
    if (res.collisions.length) {
      log(`  ⚠️ ${res.collisions.length} skill(s) skipped to protect hand-made runtime copies. Resolve by renaming the source slug or deleting the hand-made copy.`);
    }
    // Did this compile (rename/retire/tombstone) orphan any scheduled routine?
    runRoutineCouplingCheck(log);
    // Is what we just published actually complete and usable?
    if (!dryRun) runPublishIntegrityCheck(log);
    // Structural portfolio nudge — `all` only, so watch/compile stay quiet
    if (cmd === 'all') runPortfolioCheck(log);
    if (cmd === 'all') runMcpDriftCheck(skills, log);
    // Refresh the example-backlog manifest the skill-run nudge hooks read
    writeExampleBacklog(skills, log, { dryRun });
  }

  if (cmd === 'graph' || cmd === 'all') {
    const g = buildGraph(skills, { dryRun });
    log(`graph: ${g.orphans} orphan(s), ${g.dead} deprecated → Skill Relationships.md`);
  }

  if (cmd === 'glossary' || cmd === 'all') {
    const gl = buildGlossary({ dryRun });
    log(`${dryRun ? '[dry-run] ' : ''}glossary: ${gl.total} skills${gl.added ? `, ${gl.added} newly added` : ''}${gl.dropped ? `, ${gl.dropped} removed` : ''} → GLOSSARY.md`);
  }

  if (cmd === 'resource-map' || cmd === 'all') {
    runResourceMap(log, { dryRun });
  }

  if (cmd === 'cowork') {
    const r = syncCowork({ push: args.includes('--push'), dryRun });
    if (!r.ok) {
      log(`cowork: ${r.msg}`);
    } else {
      log(`${dryRun ? '[dry-run] ' : ''}cowork: mirrored ${r.count} skills → ${r.plugin}/skills @ ${r.marketplaceDir}`);
      if (r.noChanges) log('  • no changes to commit');
      if (r.committed) log(`  • committed${r.pushed ? ' and pushed' : ''}`);
      if (r.pushWarn) log(`  ⚠️ ${r.pushWarn}`);
      if (r.gitWarn) log(`  ⚠️ ${r.gitWarn}`);
    }
  }

}

function runWatch() {
  let building = false;
  const rebuild = async () => {
    if (building) return; // a rebuild takes seconds on this vault; never overlap them
    building = true;
    try {
      const skills = await discoverSkills();
      const issues = validate(skills);
      const errs = issues.filter((i) => i.level === 'error');
      writeValidationReport(skills, issues, {});
      if (errs.length) {
        process.stdout.write(`watch: ${errs.length} error(s) — skipping compile\n`);
        for (const e of errs) process.stdout.write(`  ❌ ${e.skill} — ${e.msg}\n`);
        return;
      }
      await compile(skills, {});
      buildGraph(skills, {});
      buildGlossary({});
      runRoutineCouplingCheck((m) => process.stdout.write(m + '\n'));
      process.stdout.write(`watch: rebuilt ${skills.length} skills @ ${new Date().toLocaleTimeString()}\n`);
    } catch (err) {
      process.stdout.write(`watch: error — ${err.message}\n`);
    } finally {
      // Must be in `finally`: the validation-error path above returns early, and
      // leaking `building = true` would wedge the watcher silently — it would look
      // alive and never rebuild again.
      building = false;
    }
  };

  // Files this process itself writes into the watched tree. Without this, every
  // rebuild writes validation-report.md back into VAULT_SKILLS_DIR, which fires the
  // watcher, which rebuilds… A stray `watch` ran 102h and burned 8.6h of CPU this way.
  const SELF_WRITES = new Set([path.basename(VALIDATION_REPORT_PATH)]);

  process.stdout.write(`Watching ${VAULT_SKILLS_DIR} … (Ctrl-C to stop)\n`);
  rebuild();
  let timer = null;
  fs.watch(VAULT_SKILLS_DIR, { recursive: true }, (_evt, filename) => {
    if (filename && SELF_WRITES.has(path.basename(filename))) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 250); // debounce bursty saves
  });
}

main().catch((err) => {
  process.stderr.write(`compile-skills: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
