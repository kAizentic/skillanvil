#!/usr/bin/env node
// build-resource-map.mjs — compile the skill×resource topology FROM DATA.
//
// Source of truth:
//   • authored skills  → the `tools:` field in each Skills/**/SKILL.md frontmatter
//   • vendored skills  → compiler/resource-sidecar.json (their frontmatter is immutable)
//
// Emits:
//   • agent-os/resource-map.json          (skill → resource lanes, the data)
//   • agent-os/resource-topology.html     (the interactive map, template + injected data)
//
// Zero dependencies (matches compile-skills.mjs). Run:
//   node "agent-os/compiler/build-resource-map.mjs"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AI = path.resolve(__dirname, '..');
const SKILLS = path.join(AI, 'Skills');
const CATS = ['Research', 'Coding', 'Writing', 'Analysis', 'Automation'];

// ---- resource lanes (ordered; the matrix columns) -------------------------
const LANES = [
  ['exa', 'Web · Exa'], ['obsidian', 'Obsidian'], ['graphify', 'Graphify'],
  ['granola', 'Granola'], ['slack', 'Slack'], ['ahrefs', 'Ahrefs'],
  ['notion', 'Notion'], ['github', 'GitHub'], ['playwright', 'Browser'],
  ['nanobanana', 'Nanobanana'], ['netlify', 'Netlify'], ['magic', 'Magic'],
  ['google', 'Google'], ['cli', 'Local CLI'],
];
const LANE_IDS = new Set(LANES.map((l) => l[0]));

// map a raw tool token → a resource lane id (or null = not an external resource)
function toLane(tok) {
  if (tok.startsWith('cli:')) return 'cli';
  if (tok === 'WebSearch' || tok === 'WebFetch') return 'exa';
  const m = tok.match(/^mcp__(.+)$/);
  if (!m) return null; // built-in tool (Read/Edit/Bash/…)
  const s = m[1].toLowerCase();
  if (s.startsWith('exa') || s.startsWith('workspace')) return 'exa';
  if (s.startsWith('obsidian')) return 'obsidian';
  if (s.startsWith('graphify')) return 'graphify';
  if (s.startsWith('github')) return 'github';
  if (s.startsWith('playwright') || s.includes('chrome')) return 'playwright';
  if (s.startsWith('nanobanana')) return 'nanobanana';
  if (s.startsWith('magic')) return 'magic';
  if (s.includes('granola')) return 'granola';
  if (s.includes('slack')) return 'slack';
  if (s.includes('ahrefs')) return 'ahrefs';
  if (s.includes('notion')) return 'notion';
  if (s.includes('netlify')) return 'netlify';
  if (s.includes('google') || s.includes('gmail')) return 'google';
  return null;
}

// ---- workflow clusters (grouping is editorial; membership is data-driven) --
const CLUSTER_OF = {
  'web-research': 'Sensing / Research', 'intel-scan': 'Sensing / Research',
  'blogwatcher': 'Sensing / Research', 'intent-scout': 'Sensing / Research',
  'decision-scout': 'Sensing / Research', 'deep-research': 'Sensing / Research',
  'apply-insights': 'Sensing / Research', 'graincrawl': 'Sensing / Research',
  'notcrawl': 'Sensing / Research', 'granola-to-design-concept': 'Sensing / Research',
  'transcript-pull': 'Sensing / Research', 'defuddle': 'Sensing / Research',
  'meeting-sync': 'Meetings', 'meeting-debrief': 'Meetings', 'grill-with-docs': 'Meetings',
  'distill': 'Vault ops', 'capture': 'Vault ops', 'project-digest': 'Vault ops',
  'wiki-lint': 'Vault ops', 'obsidian-cli': 'Vault ops', 'obsidian-bases': 'Vault ops',
  'obsidian-markdown': 'Vault ops', 'secure-push': 'Vault ops',
  'graphify': 'Knowledge graph', 'wisdom': 'Knowledge graph',
  'skill-pipeline-sync': 'Skill self-maintenance', 'skill-portfolio-review': 'Skill self-maintenance',
  'skill-builder': 'Skill self-maintenance', 'setup-matt-pocock-skills': 'Skill self-maintenance',
  'site-synth': 'Brand / Site build', 'site-harvest': 'Brand / Site build',
  'brand-teardown': 'Brand / Site build', 'brand-guide': 'Brand / Site build',
  'motion-forensics': 'Brand / Site build', 'webapp-testing': 'Brand / Site build',
  'web-artifacts-builder': 'Brand / Site build', 'remotion-video': 'Brand / Site build',
  'og-and-seo': 'Brand / Site build', 'site-cms': 'Brand / Site build', 'diagnose': 'Brand / Site build',
  'softdev-workflows': 'Dev / build tooling', 'claude-api': 'Dev / build tooling',
  'mcp-builder': 'Dev / build tooling',
  'doc-coauthoring': 'Writing / docs', 'json-canvas': 'Writing / docs',
  'client-intake-form': 'Writing / docs', 'consulting-proposal-template': 'Writing / docs',
  'slack-gif-creator': 'Writing / docs',
};
const CLUSTER_ORDER = ['Sensing / Research', 'Meetings', 'Vault ops', 'Knowledge graph',
  'Skill self-maintenance', 'Brand / Site build', 'Dev / build tooling', 'Writing / docs'];

// ---- minimal frontmatter tools parser -------------------------------------
function readTools(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const m = raw.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { tools: [], meta: {} };
  const lines = m[1].split(/\r?\n/);
  const meta = {};
  let tools = [];
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    if (['id', 'name', 'status', 'category', 'version'].includes(kv[1])) meta[kv[1]] = kv[2].trim();
    if (kv[1] === 'tools') {
      const v = kv[2].trim();
      if (v.startsWith('[') && v.endsWith(']')) {
        tools = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      } else if (v === '') {
        for (let j = i + 1; j < lines.length; j++) {
          const li = lines[j].match(/^\s*-\s+(.*)$/);
          if (!li) break;
          tools.push(li[1].trim());
        }
      }
    }
  }
  return { tools, meta };
}

// ---- gather all skills -----------------------------------------------------
const vendored = new Set(Object.keys(
  JSON.parse(fs.readFileSync(path.join(SKILLS, '_vendored.json'), 'utf8')).skills));
const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'resource-sidecar.json'), 'utf8')).tools;

const skills = {}; // id -> {tools, status, vendored}
let total = 0;
for (const cat of CATS) {
  const dir = path.join(SKILLS, cat);
  if (!fs.existsSync(dir)) continue;
  for (const id of fs.readdirSync(dir)) {
    const file = path.join(dir, id, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    total++;
    const { tools, meta } = readTools(file);
    const isVend = vendored.has(id);
    const effTools = isVend ? (sidecar[id] || tools) : tools;
    skills[id] = { tools: effTools, status: meta.status || '', vendored: isVend, category: cat };
  }
}

// ---- normalize to lanes, build matrix -------------------------------------
const laneCount = Object.fromEntries(LANES.map((l) => [l[0], 0]));
const rows = {}; // id -> [laneIds]
for (const [id, s] of Object.entries(skills)) {
  const lanes = [...new Set(s.tools.map(toLane).filter((x) => x && LANE_IDS.has(x)))];
  if (lanes.length) { rows[id] = lanes; lanes.forEach((l) => laneCount[l]++); }
}

// group resource-drawing rows into clusters
const clusters = [];
const placed = new Set();
for (const cname of CLUSTER_ORDER) {
  const members = [];
  for (const [id, lanes] of Object.entries(rows)) {
    if (CLUSTER_OF[id] === cname) { members.push([id, lanes]); placed.add(id); }
  }
  members.sort((a, b) => a[0].localeCompare(b[0]));
  if (members.length) clusters.push([cname, members]);
}
// any resource-drawing skill missing from CLUSTER_OF → "Other" (keeps the map honest)
const orphanRows = Object.entries(rows).filter(([id]) => !placed.has(id)).sort();
if (orphanRows.length) clusters.push(['Other', orphanRows]);

const resourceDrawing = Object.keys(rows).length;
const data = {
  generated: new Date().toISOString(),
  totals: { skills: total, resourceDrawing, pureCompute: total - resourceDrawing, lanes: LANES.length },
  lanes: LANES,
  laneCount,
  clusters,
};

const dryRun = process.argv.includes('--dry-run');

if (!dryRun) fs.writeFileSync(path.join(AI, 'resource-map.json'), JSON.stringify(data, null, 2));

// ---- render HTML from template --------------------------------------------
const tplPath = path.join(__dirname, 'resource-topology.template.html');
const pfx = dryRun ? '[dry-run] would write' : 'wrote';
if (fs.existsSync(tplPath)) {
  if (!dryRun) {
    const tpl = fs.readFileSync(tplPath, 'utf8');
    const html = tpl.replace('/*__RESOURCE_DATA__*/', JSON.stringify(data));
    fs.writeFileSync(path.join(AI, 'resource-topology.html'), html);
  }
  console.log(`${pfx} resource-map.json + resource-topology.html`);
} else {
  console.log(`${pfx} resource-map.json (no template found — HTML skipped)`);
}

// ---- console summary -------------------------------------------------------
console.log(`\nskills: ${total} · resource-drawing: ${resourceDrawing} · pure-compute: ${total - resourceDrawing}`);
console.log('lane usage:');
for (const [id, label] of LANES) console.log(`  ${label.padEnd(12)} ${laneCount[id]}`);
if (orphanRows.length) console.log(`\n⚠ resource-drawing but unclustered: ${orphanRows.map((r) => r[0]).join(', ')}`);
