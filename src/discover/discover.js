// Works out a harness run (src/model.ts) from any harness's files, without knowing the harness.
//
// In order of preference:
//   1. a run file the harness wrote itself (schemaVersion 1 + phases + agents + position)
//   2. a state file that describes itself: JSON with arrays of stages/steps, phases, agents or
//      roles, stories/tickets/issues, gates, epics
//   3. the files themselves:
//      agents    markdown agent definitions (front matter name/description), in agents/ folders
//                or named *.agent.md / *_agent.md; numbered names give the order
//      progress  output folders (output, outputs, *_output, *-output, checkpoints, reports,
//                artifacts, results), one unit per subfolder, matched to agents by number, by
//                shared words, or by the agent definition naming the folder; a unit's status
//                comes from a status field (JSON or front matter), a Status/Verdict/Decision
//                row, timestamped run folders and a latest.json pointer, else from its files
//      phases    "Phase A — Understand"-style headings in the overview docs, assigned by the
//                agents each section names; else one phase
//      items     ISSUE-001-style ids repeated across outputs, or ticket lists (TOML) whose
//                entries have a title, with statuses from files that reference them
import { parse as parseToml } from "smol-toml";
import {
  TIMESTAMP_DIR, basename, cleanInline, dirname, documentStatus, extname, firstHeading, firstSentence, frontMatter,
  humanize, isSkippedPath, leadingNumber, mapStatus, slug, statsOf, stem, timeOf, timestampOf, tokens,
} from "./text.js";

const READ_LIMIT = 2_000_000; // bytes; larger files are listed but not read
const STATE_LIMIT = 8_000_000;
const MAX_READS = 800;
const OUT_ROOT = /^[._]?(?:.*[-_])?(?:output|outputs|out|artifacts?|artefacts?|checkpoints|reports|results|deliverables)$/i;
const ISSUE_ID = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?![A-Za-z0-9])/g;
const isMd = (p) => /\.(md|markdown)$/i.test(p);
const isJson = (p) => extname(p) === ".json";
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const depth = (p) => p.split("/").length - 1;
const latest = (times) => times.filter(Boolean).sort().at(-1);

/**
 * @param {{ kind: string, label: string, name: string, truncated?: boolean,
 *           list(): Promise<{ path: string, size?: number, mtime?: string }[]>,
 *           read(path: string): Promise<string> }} source
 * @param {{ now?: Date, traits?: { label: string, value: string }[] }} [opts]
 * @returns {Promise<import("../model").HarnessRun>}
 */
export async function discoverRun(source, opts = {}) {
  const now = opts.now ?? new Date();
  const files = (await source.list()).filter((f) => !isSkippedPath(f.path));
  const ctx = makeContext(source, files);
  const discovery = { source: source.label, readAt: now.toISOString() };
  const notes = [];
  if (source.truncated) notes.push("GitHub returned a truncated file list (very large repo); point the link at the harness's folder.");

  const runFile = await findRunFile(ctx);
  if (runFile) {
    const run = { ...runFile.run, discovery: { ...discovery, method: "run-file", file: runFile.path, notes } };
    if (opts.traits?.length) run.harness = { ...run.harness, traits: [...(run.harness.traits ?? []), ...opts.traits] };
    return run;
  }

  const fileAgents = await findAgents(ctx);
  const state = await findStateFile(ctx);
  const built = state ? buildFromState(state, fileAgents) : await buildFromFiles(ctx, fileAgents, now);
  notes.push(...built.notes);

  const readme = files.find((f) => /^readme\.(md|markdown)$/i.test(f.path));
  const title = built.harnessName ?? (readme && firstHeading(frontMatter((await ctx.read(readme.path)) ?? "").body));
  const short = title && title.length > 60 ? title.split(/\s+[—–:|]\s+|\s+-\s+/)[0] : title;
  const name = short && short.length <= 80 ? short : humanize(source.name);
  const stepCount = built.phases.reduce((n, p) => n + p.steps.length, 0);
  const run = {
    schemaVersion: 1,
    harness: {
      id: slug(name),
      name,
      ...(built.tagline && { tagline: built.tagline }),
      traits: [
        { label: "Read from", value: { github: "GitHub", "browser-folder": "Folder (this browser)", "browser-files": "Files (this browser)" }[source.kind] ?? "Local folder" },
        { label: "Found", value: `${built.agents.length} agent${built.agents.length === 1 ? "" : "s"} · ${stepCount} stage${stepCount === 1 ? "" : "s"}` },
        ...(opts.traits ?? []),
      ],
      ...(built.workItemLabel && { workItemLabel: built.workItemLabel }),
      ...(built.epics?.length && { epicLabel: built.epicLabel ?? "Epics" }),
    },
    project: { name: built.projectName ?? humanize(source.name), path: source.label },
    importedAt: now.toISOString(),
    phases: built.phases,
    agents: built.agents.map(({ id, name, role, description, icon, model, usage }) => ({ id, name, role, ...(description && { description }), ...(icon && { icon }), ...(model && { model }), ...(usage && { usage }) })),
    position: built.position,
    ...(built.epics?.length && { epics: built.epics }),
    ...(built.workItems?.length && { workItems: built.workItems }),
    ...(built.artifacts?.length && { artifacts: built.artifacts }),
    ...(built.timeline?.length && { timeline: built.timeline }),
    ...(built.metrics?.length && { metrics: built.metrics }),
    ...(built.missing?.length && { missing: built.missing }),
    discovery: { ...discovery, method: state ? "state-file" : "files", ...(state && { file: state.path }), notes },
  };
  return sanitize(run);
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function makeContext(source, files) {
  const sizes = new Map(files.map((f) => [f.path, f.size]));
  const cache = new Map();
  let reads = 0;
  const read = (path, limit = READ_LIMIT) => {
    if (cache.has(path)) return cache.get(path);
    const size = sizes.get(path);
    if ((size !== undefined && size > limit) || reads >= MAX_READS) return Promise.resolve(undefined);
    reads++;
    const p = source.read(path).then((t) => t.replace(/^﻿/, "")).catch(() => undefined);
    cache.set(path, p);
    return p;
  };
  const readJson = async (path, limit) => {
    const t = await read(path, limit);
    if (t === undefined) return undefined;
    try {
      return JSON.parse(t);
    } catch {
      return undefined;
    }
  };
  const dirs = new Set();
  for (const f of files) for (let d = dirname(f.path); d; d = dirname(d)) dirs.add(d);
  // output folders: the top-most folders named like output, *_output, checkpoints, reports, …
  const outputRoots = [...dirs]
    .filter((d) => OUT_ROOT.test(basename(d)) && !d.split("/").some((s) => /^(skills|agents?|src|test|tests)$/i.test(s)))
    .sort((a, b) => depth(a) - depth(b))
    .filter((d, i, all) => !all.slice(0, i).some((r) => d.startsWith(`${r}/`)));
  return { source, files, sizes, read, readJson, dirs, outputRoots, mtime: new Map(files.filter((f) => f.mtime).map((f) => [f.path, f.mtime])) };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

const isRun = (d) => d && d.schemaVersion === 1 && Array.isArray(d.phases) && Array.isArray(d.agents) && d.position && d.harness;

async function findRunFile(ctx) {
  const json = ctx.files.filter((f) => isJson(f.path));
  const named = json.filter((f) => /(^|[-_.])(harness[-_.]?)?run([-_.]|\.json$)|harness/i.test(basename(f.path)));
  const shallow = json.filter((f) => depth(f.path) <= 1 && !named.includes(f));
  for (const f of [...named, ...shallow].slice(0, 15)) {
    const doc = await ctx.readJson(f.path, STATE_LIMIT);
    if (isRun(doc)) return { path: f.path, run: doc };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------

async function findAgents(ctx) {
  const notDoc = (p) => !/^(readme|agents|claude|changelog|contributing|license|security|code_of_conduct)$/i.test(stem(p));
  const inAgentsDir = (p) => dirname(p).split("/").some((s) => /^agents?$/i.test(s));
  const named = (p) => /(^|[._-])agents?([._-]|\.(md|markdown)$)/i.test(basename(p));
  let cands = ctx.files.filter((f) => isMd(f.path) && notDoc(f.path) && (inAgentsDir(f.path) || named(f.path)) && !inOutputRoot(ctx, f.path));
  const outsideSkills = cands.filter((f) => !/(^|\/)skills\//i.test(f.path));
  if (outsideSkills.length) cands = outsideSkills;
  cands = cands.slice(0, 120);

  const parsed = (await pool(cands, 8, async (f) => {
    const text = await ctx.read(f.path, 512_000);
    if (text === undefined) return undefined;
    const { data, body } = frontMatter(text);
    return { path: f.path, data, body, text, defined: typeof data.name === "string" || typeof data.description === "string" };
  })).filter(Boolean);

  let pool_ = parsed.filter((a) => a.defined);
  if (!pool_.length) pool_ = parsed.filter((a) => inAgentsDir(a.path));
  if (!pool_.length) return [];

  // Several tools may each hold a copy of the roster (.claude/agents, .github/agents): the folder
  // with the most definitions leads, and the others only add agents it does not have.
  const byDir = new Map();
  for (const a of pool_) byDir.set(dirname(a.path), [...(byDir.get(dirname(a.path)) ?? []), a]);
  const dirs = [...byDir.keys()].sort((x, y) => byDir.get(y).length - byDir.get(x).length || depth(x) - depth(y));
  const keyOf = (a) => `${leadingNumber(basename(a.path)) ?? ""}:${tokens(String(a.data.name ?? stem(a.path)))[0] ?? slug(stem(a.path))}`;
  const seen = new Set(byDir.get(dirs[0]).map(keyOf));
  const chosen = [...byDir.get(dirs[0])];
  for (const d of dirs.slice(1)) for (const a of byDir.get(d)) if (!seen.has(keyOf(a))) { seen.add(keyOf(a)); chosen.push(a); }

  const ids = new Set();
  const agents = chosen.map((a) => {
    const rawName = str(a.data.name) ?? stem(a.path);
    const n = leadingNumber(basename(a.path)) ?? leadingNumber(rawName);
    let id = slug(rawName);
    while (ids.has(id)) id = `${id}-2`;
    ids.add(id);
    const desc = str(a.data.description) ?? firstParagraph(a.body);
    return {
      id,
      name: humanize(rawName),
      role: str(a.data.role) ?? firstSentence(desc, 90) ?? "Agent",
      description: firstSentence(desc, 320),
      model: str(a.data.model),
      ...(n !== undefined && { icon: String(n) }),
      n,
      file: a.path,
      stemName: stem(a.path),
      rawName,
      text: a.text,
      phase: str(a.data.phase),
      optional: /\boptional\b/i.test(String(a.data.description ?? "").split(/[.!?](\s|$)/)[0]) || /^(true|yes)$/i.test(String(a.data.optional ?? "")),
      tokens: new Set([...tokens(rawName), ...tokens(stem(a.path))]),
    };
  });
  return agents.sort((x, y) => (x.n ?? 1e9) - (y.n ?? 1e9) || (x.file < y.file ? -1 : x.file > y.file ? 1 : 0));
}

function firstParagraph(body) {
  for (const block of (body ?? "").split(/\n\s*\n/)) {
    const t = block.trim();
    if (t && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith("```")) return cleanInline(t.replace(/\s+/g, " "));
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Self-describing state files
// ---------------------------------------------------------------------------------------------

const KEYS = {
  phases: /^(phases?|lifecycle)$/i,
  steps: /^(stages?|steps?|tasks?|jobs?|pipeline|workflow)$/i,
  agents: /^(agents?|agentRoles|agent_roles|roles|personas|workers)$/i,
  items: /^(stories|tickets|issues|items|workItems|work_items|requirements|todos|backlog|workUnits|work_units|features)$/i,
  epics: /^(epics|initiatives|themes)$/i,
  gates: /^(gates|checks|qualityGates|quality_gates)$/i,
  events: /^(timeline|events|history|activity)$/i,
};
const objArray = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x));
const idOf = (o) => str(o.id ?? o.key ?? o.slug ?? o.role ?? o.name);
const labelOf = (o) => str(o.label ?? o.title ?? o.name ?? o.displayName ?? o.key ?? o.id ?? o.role);
function statusOf(o) {
  for (const k of ["status", "state", "result", "outcome"]) if (typeof o[k] === "string") return o[k];
  for (const v of Object.values(o)) if (v && typeof v === "object" && !Array.isArray(v) && typeof v.status === "string") return v.status;
  return undefined;
}

function stateArrays(doc) {
  const found = {};
  const scan = (obj, deep) => {
    for (const [k, v] of Object.entries(obj)) {
      for (const [cat, re] of Object.entries(KEYS)) if (!found[cat] && re.test(k) && objArray(v)) found[cat] = { key: k, list: v };
      if (deep && v && typeof v === "object" && !Array.isArray(v)) scan(v, false);
    }
  };
  if (doc && typeof doc === "object" && !Array.isArray(doc)) scan(doc, true);
  if (found.steps && found.steps.list.filter(labelOf).length < 2) delete found.steps;
  return found;
}

async function findStateFile(ctx) {
  const score = (p) => (/(state|status|progress|dashboard|pipeline|harness|workflow|tracker|board)/i.test(basename(p)) ? 2 : /(run|manifest|data|plan)/i.test(basename(p)) ? 1 : 0);
  const cands = ctx.files
    .filter((f) => isJson(f.path) && score(f.path) > 0 && !f.path.split("/").some((s) => TIMESTAMP_DIR.test(s)) && !/(^|\/)(package(-lock)?|tsconfig|composer)\.json$/i.test(f.path))
    .sort((a, b) => score(b.path) - score(a.path) || depth(a.path) - depth(b.path))
    .slice(0, 40);
  let best;
  for (const f of cands) {
    const doc = await ctx.readJson(f.path, STATE_LIMIT);
    const arrays = stateArrays(doc);
    if (!arrays.steps) continue;
    const s = 3 + ["phases", "agents", "items", "gates", "epics"].filter((k) => arrays[k]).length;
    if (!best || s > best.score) best = { path: f.path, doc, arrays, score: s };
  }
  return best && best.score >= 4 ? best : undefined;
}

function buildFromState(state, fileAgents) {
  const { doc, arrays } = state;
  const notes = [`Read the harness's own state file ${state.path}.`];
  const uniq = (set, id) => { let k = id; while (set.has(k)) k = `${k}-2`; set.add(k); return k; };

  // agents (roles) — the state file's own, else the definitions found in the files
  const agentIdOf = new Map();
  const agentIds = new Set();
  const agents = arrays.agents
    ? arrays.agents.list.filter((o) => labelOf(o)).map((o) => {
        const id = uniq(agentIds, slug(idOf(o) ?? labelOf(o)));
        agentIdOf.set(idOf(o), id);
        const desc = str(o.description ?? o.summary ?? o.purpose);
        const usage = { runs: num(o.runs ?? o.runCount), tokens: num(o.tokens ?? o.tokenCount), costUsd: num(o.costUsd ?? o.cost) };
        return {
          id, name: labelOf(o),
          role: firstSentence(desc, 90) ?? (str(o.tier) ? `${str(o.tier)} tier` : "Agent"),
          description: firstSentence(desc, 320), model: str(o.model),
          raw: o,
          ...(Object.values(usage).some((v) => v !== undefined) && { usage }),
        };
      })
    : fileAgents.map((a) => { agentIdOf.set(a.rawName, a.id); return a; });

  // steps
  const stepIds = new Set();
  const order = (o, i) => num(o.ordinal ?? o.order ?? o.index ?? o.position ?? o.seq) ?? i;
  const rawSteps = arrays.steps.list.map((o, i) => ({ o, i })).filter(({ o }) => labelOf(o)).sort((a, b) => order(a.o, a.i) - order(b.o, b.i));
  const stepOf = new Map();
  const steps = rawSteps.map(({ o }) => {
    const key = uniq(stepIds, slug(idOf(o) ?? labelOf(o)));
    const raw = statusOf(o);
    const linked = new Set();
    for (const v of Object.values(o)) if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && agentIdOf.has(x)) linked.add(agentIdOf.get(x));
    for (const a of agents) for (const v of Object.values(a.raw ?? {})) if (Array.isArray(v) && v.includes(idOf(o))) linked.add(a.id);
    const step = {
      key, label: labelOf(o), agentIds: [...linked],
      status: mapStatus(raw), ...(raw && mapStatus(raw) !== raw && { rawStatus: raw }), provenance: raw ? "observed" : "inferred",
      ...(str(o.description ?? o.work ?? o.summary) && { description: str(o.description ?? o.work ?? o.summary) }),
      ...(str(o.output) && { output: str(o.output) }),
      ...(str(o.note) && { note: str(o.note) }),
      gates: [],
    };
    stepOf.set(idOf(o), step);
    return { step, o };
  });

  // gates attach to the step they name
  for (const g of arrays.gates?.list ?? []) {
    const target = Object.values(g).map((v) => (typeof v === "string" ? stepOf.get(v) : undefined)).find(Boolean);
    if (!target || !labelOf(g)) continue;
    const raw = statusOf(g);
    target.gates.push({ label: labelOf(g), status: mapStatus(raw), detail: [raw, str(g.result !== raw ? g.result : undefined) ?? str(g.threshold)].filter(Boolean).join(" · ") || undefined });
  }

  // phases: the file's own, else a phase field on each step, else one phase
  let phases;
  if (arrays.phases) {
    const assigned = new Set();
    phases = arrays.phases.list.filter(labelOf).map((p) => {
      const pid = idOf(p);
      const listed = Object.values(p).find((v) => Array.isArray(v) && v.some((x) => typeof x === "string" && stepOf.has(x)));
      const members = steps.filter(({ o, step }) => !assigned.has(step) && ((listed ?? []).includes(idOf(o)) || [o.phase, o.phaseKey, o.phaseId].includes(pid)));
      members.forEach(({ step }) => assigned.add(step));
      return { key: slug(pid ?? labelOf(p)), label: labelOf(p), ...(str(p.summary ?? p.description) && { summary: str(p.summary ?? p.description) }), steps: members.map(({ step }) => step) };
    });
    const rest = steps.filter(({ step }) => !assigned.has(step)).map(({ step }) => step);
    if (rest.length) phases.push({ key: "other", label: "Other", steps: rest });
    if (phases.some((p) => p.steps.length)) phases = phases.filter((p) => p.steps.length);
  } else if (steps.some(({ o }) => str(o.phase))) {
    phases = [];
    for (const { o, step } of steps) {
      const label = str(o.phase) ?? "Other";
      let p = phases.find((x) => x.label === label);
      if (!p) phases.push((p = { key: slug(label), label, steps: [] }));
      p.steps.push(step);
    }
  } else phases = [{ key: "pipeline", label: "Pipeline", steps: steps.map(({ step }) => step) }];

  // work items and epics
  const itemIds = new Set();
  const epicIdOf = new Map();
  const epics = (arrays.epics?.list ?? []).filter(labelOf).map((e) => {
    const id = slug(idOf(e) ?? labelOf(e));
    epicIdOf.set(idOf(e), id);
    return { id, title: labelOf(e), ...(str(e.outcome ?? e.summary ?? e.description) && { summary: str(e.outcome ?? e.summary ?? e.description) }) };
  });
  const workItems = (arrays.items?.list ?? []).filter(labelOf).map((o) => {
    const raw = statusOf(o);
    const ac = Array.isArray(o.acceptanceCriteria ?? o.acceptance_criteria) ? (o.acceptanceCriteria ?? o.acceptance_criteria) : [];
    const deps = Array.isArray(o.dependsOn ?? o.depends_on ?? o.after) ? (o.dependsOn ?? o.depends_on ?? o.after) : [];
    return {
      id: uniq(itemIds, str(idOf(o)) ?? slug(labelOf(o))),
      title: labelOf(o) ?? str(idOf(o)),
      status: mapStatus(raw),
      ...(raw && { rawStatus: raw }),
      ...(epicIdOf.has(str(o.epicId ?? o.epic)) && { epicId: epicIdOf.get(str(o.epicId ?? o.epic)) }),
      ...(str(o.group ?? o.context ?? o.service ?? o.wave) && { group: str(o.group ?? o.context ?? o.service ?? o.wave) }),
      ...(str(o.type) && { type: str(o.type) }),
      ...(str(o.narrative ?? o.description ?? o.summary ?? o.story) && { description: str(o.narrative ?? o.description ?? o.summary ?? o.story) }),
      ...(ac.length && { acceptanceCriteria: ac.map((c, i) => (typeof c === "string" ? { id: String(i + 1), text: c } : { id: str(c.id) ?? String(i + 1), text: str(c.text ?? c.criterion ?? c.description ?? c.then) })) }),
      ...(deps.length && { dependsOn: deps.map(String) }),
    };
  });

  const timeline = (arrays.events?.list ?? [])
    .map((e) => ({ at: timeOf(e), summary: str(e.summary ?? e.message ?? e.title ?? e.event ?? e.text), level: { error: "error", failed: "error", warning: "warning", success: "success" }[String(e.level ?? e.severity ?? e.status ?? "").toLowerCase()] ?? "info" }))
    .filter((e) => e.at && e.summary);

  // position: a field naming the current step, else the first step not done
  let current;
  const lookIn = (obj) => { for (const v of Object.values(obj ?? {})) { if (typeof v === "string" && stepOf.has(v)) return stepOf.get(v); } };
  for (const [k, v] of Object.entries(doc)) if (/^(state|status|position|progress|current)/i.test(k) && v && typeof v === "object") current ??= lookIn(v);
  const flat = phases.flatMap((p) => p.steps);
  const position = positionFor(phases, flat, current, latest([...timeline.map((t) => t.at), timeOf(doc), timeOf(doc.meta)]));

  const meta = Object.entries(doc).find(([k, v]) => /^(meta|info|about|harness|project)$/i.test(k) && v && typeof v === "object")?.[1] ?? {};
  return {
    notes,
    harnessName: str(meta.harnessName ?? meta.harness ?? meta.title ?? meta.name),
    tagline: str(meta.harnessTagline ?? meta.tagline),
    projectName: str(meta.workspace ?? meta.project ?? meta.repoSlug),
    phases,
    agents: agents.map(({ raw, ...a }) => a),
    position,
    epics,
    workItems,
    workItemLabel: arrays.items ? humanize(arrays.items.key) : undefined,
    timeline,
    metrics: [{ group: "Discovery", label: "State file", value: state.path }],
    missing: [],
  };
}

// ---------------------------------------------------------------------------------------------
// The files themselves: agents + output units
// ---------------------------------------------------------------------------------------------

const inOutputRoot = (ctx, path) => ctx.outputRoots.some((r) => path.startsWith(`${r}/`));

function findUnits(ctx) {
  const roots = ctx.outputRoots;
  const childDirs = (d) => [...ctx.dirs].filter((x) => dirname(x) === d);
  const directFiles = (d) => ctx.files.filter((f) => dirname(f.path) === d);
  const units = [];
  for (const root of roots) {
    let base = root;
    for (let i = 0; i < 2; i++) {
      const kids = childDirs(base).filter((k) => !TIMESTAMP_DIR.test(basename(k)));
      if (kids.length === 1 && directFiles(base).length <= 3 && childDirs(kids[0]).some((k) => !TIMESTAMP_DIR.test(basename(k)))) base = kids[0];
      else break;
    }
    const kids = childDirs(base).filter((k) => !TIMESTAMP_DIR.test(basename(k)));
    for (const k of kids) units.push(makeUnit(ctx, k, false, root));
    const loose = directFiles(base);
    if (!kids.length)
      for (const f of loose) if (!/^(readme|index|latest|current|\.gitkeep|\.gitignore)/i.test(basename(f.path))) units.push(makeUnit(ctx, f.path, true, root));
    if (!kids.length && !loose.length && childDirs(base).length) units.push(makeUnit(ctx, base, false, root)); // only run folders
  }
  return units;
}

function makeUnit(ctx, path, isFile, root) {
  const name = basename(path);
  const files = isFile ? ctx.files.filter((f) => f.path === path) : ctx.files.filter((f) => f.path.startsWith(`${path}/`));
  const runDirs = isFile ? [] : [...new Set(files.map((f) => f.path.slice(path.length + 1).split("/")[0]).filter((s, _, a) => TIMESTAMP_DIR.test(s) && files.some((f) => f.path.startsWith(`${path}/${s}/`))))].sort();
  return {
    key: slug(path), name, path, isFile, root,
    label: humanize(isFile ? stem(name) : name),
    n: leadingNumber(name),
    tokens: new Set(tokens(isFile ? stem(name) : name)),
    files,
    runDirs,
  };
}

/** Reads one unit: which run is current, its status, gates, stats and times. */
async function evaluateUnit(ctx, unit) {
  // the current run: a latest/current pointer at the unit root, else the newest run folder
  let currentRun = unit.runDirs.at(-1);
  if (unit.runDirs.length) {
    for (const f of unit.files.filter((f) => dirname(f.path) === unit.path && /^(latest|current|head)/i.test(basename(f.path)))) {
      const doc = isJson(f.path) ? await ctx.readJson(f.path, 64_000) : undefined;
      const text = doc ? JSON.stringify(doc) : (await ctx.read(f.path, 4_000)) ?? "";
      const named = unit.runDirs.filter((r) => text.includes(r)).at(-1);
      if (named) { currentRun = named; break; }
    }
  }
  const inRun = (p, r) => p.startsWith(`${unit.path}/${r}/`);
  const current = unit.files.filter((f) => !unit.runDirs.some((r) => inRun(f.path, r)) || (currentRun && inRun(f.path, currentRun)));
  const runRoot = currentRun ? `${unit.path}/${currentRun}` : unit.path;

  // a run-level status: small JSON at the run (or unit) root with a status field
  const metaFiles = current.filter((f) => isJson(f.path) && [runRoot, unit.path].includes(dirname(f.path)) && /(meta|status|state|result|manifest|summary|report|run)/i.test(basename(f.path)));
  let unitRaw, unitAt;
  for (const f of metaFiles) {
    const doc = await ctx.readJson(f.path, 512_000);
    const raw = doc && typeof doc === "object" ? str(doc.status ?? doc.state ?? doc.result ?? doc.outcome) : undefined;
    unitAt ??= timeOf(doc);
    if (raw) { unitRaw = raw; unitAt = timeOf(doc) ?? unitAt; break; }
  }

  // the main artifact's numbers
  const mainJson = current.filter((f) => isJson(f.path) && dirname(f.path) === (unit.isFile ? dirname(unit.path) : runRoot) && !metaFiles.includes(f) && !/^(latest|current)/i.test(basename(f.path)))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))[0] ?? (unit.isFile && isJson(unit.path) ? current[0] : undefined);
  const mainDoc = mainJson ? await ctx.readJson(mainJson.path) : undefined;
  unitAt ??= timeOf(mainDoc) ?? timeOf(mainDoc?.meta);
  const stats = statsOf(mainDoc);

  // documents that state their own status
  const docs = current.filter((f) => isMd(f.path) && (f.size ?? 0) <= 256_000).slice(0, 60);
  const items = (await pool(docs, 8, async (f) => {
    const text = await ctx.read(f.path, 256_000);
    if (text === undefined) return undefined;
    const st = documentStatus(text);
    return { path: f.path, raw: st?.raw, status: st ? mapStatus(st.raw) : undefined, title: firstHeading(frontMatter(text).body), fm: frontMatter(text).data };
  })).filter(Boolean);
  const withStatus = items.filter((i) => i.raw);
  const own = withStatus.length === 1 ? withStatus[0] : withStatus.find((i) => slug(stem(i.path)) === slug(unit.name));
  if (!unitRaw && own && (withStatus.length === 1 || own)) { unitRaw = own.raw; }

  let status, rawStatus, provenance;
  const gates = [];
  if (unitRaw) {
    status = mapStatus(unitRaw);
    rawStatus = unitRaw;
    provenance = "observed";
  } else if (withStatus.length) {
    const counts = new Map();
    for (const i of withStatus) counts.set(i.raw, (counts.get(i.raw) ?? 0) + 1);
    status = withStatus.some((i) => i.status === "active" || i.status === "pending") ? "active" : "done";
    rawStatus = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, n]) => `${n} ${w}`).join(" · ");
    provenance = "derived";
  } else if (current.length) {
    status = "done";
    rawStatus = "output present";
    provenance = "inferred";
  } else {
    status = "pending";
    provenance = "derived";
  }
  for (const i of withStatus.filter((i) => i !== own).slice(0, 40))
    gates.push({ label: humanize(stem(i.path)), status: i.status, detail: i.raw });
  if (withStatus.length - (own ? 1 : 0) > 40) gates.push({ label: `${withStatus.length - 41} more`, status: "unknown", detail: "not listed" });

  // run history
  const runs = await pool(unit.runDirs.slice(-30), 6, async (r) => {
    const meta = unit.files.find((f) => dirname(f.path) === `${unit.path}/${r}` && isJson(f.path) && /(meta|status|state|run)/i.test(basename(f.path)));
    const doc = meta ? await ctx.readJson(meta.path, 256_000) : undefined;
    const raw = doc ? str(doc.status ?? doc.state ?? doc.result) : undefined;
    const counts = doc ? Object.values(doc).find((v) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).some((x) => typeof x === "number")) : undefined;
    return { name: r, at: timeOf(doc) ?? timestampOf(r), raw, status: raw ? mapStatus(raw) : undefined, counts, current: r === currentRun };
  });
  const mtimes = current.map((f) => ctx.mtime.get(f.path)).filter(Boolean);
  return {
    status, rawStatus, provenance, gates, stats, runs, items, currentRun,
    files: current,
    at: unitAt ?? runs.find((r) => r.current)?.at ?? latest(mtimes),
  };
}

function matchUnits(agents, units) {
  const owner = new Map(); // unit → agent
  for (const u of units) {
    if (u.n === undefined) continue;
    const a = agents.find((x) => x.n === u.n);
    if (a) owner.set(u, a);
  }
  for (const u of units.filter((x) => !owner.has(x))) {
    let best, bestScore = 0;
    for (const a of agents) {
      const score = [...u.tokens].filter((t) => a.tokens.has(t)).length;
      if (score > bestScore) { best = a; bestScore = score; }
    }
    if (best) owner.set(u, best);
  }
  const has = (a) => [...owner.values()].includes(a);
  for (const u of units.filter((x) => !owner.has(x))) {
    const re = new RegExp(`(^|[^\\w-])${u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`, "i");
    const mentions = agents.filter((a) => re.test(a.text));
    const pick = mentions.find((a) => !has(a)) ?? (mentions.length === 1 ? mentions[0] : undefined);
    if (pick) owner.set(u, pick);
  }
  return owner;
}

async function buildFromFiles(ctx, agents, now) {
  const notes = [];
  const missing = [];
  const units = findUnits(ctx);
  const owner = matchUnits(agents, units);

  // steps: one per agent (with the units it produced), plus units no agent claims
  let plan = agents.map((a) => ({ key: a.id, label: a.name, agentIds: [a.id], agent: a, units: units.filter((u) => owner.get(u) === a), n: a.n }));
  const loose = units.filter((u) => !owner.has(u));
  for (const u of loose) {
    const entry = { key: `out-${u.key}`, label: u.label, agentIds: [], units: [u], n: u.n };
    const at = u.n === undefined ? -1 : plan.findIndex((p) => p.n !== undefined && p.n > u.n);
    if (at === -1) plan.push(entry);
    else plan.splice(at, 0, entry);
  }
  if (!agents.length && plan.length) plan.sort((a, b) => (a.n ?? 1e9) - (b.n ?? 1e9) || a.label.localeCompare(b.label));
  if (!plan.length) {
    // nothing produced yet and no agents: numbered scripts name the stages
    const scripts = ctx.files
      .filter((f) => depth(f.path) <= 3 && /^\d{1,3}[a-z]?[_-][^/]+\.(py|sh|ps1|js|mjs|ts|rb|go|ipynb)$/i.test(basename(f.path)))
      .sort((a, b) => (leadingNumber(basename(a.path)) ?? 0) - (leadingNumber(basename(b.path)) ?? 0));
    plan = scripts.map((f) => ({ key: slug(stem(f.path)), label: humanize(basename(f.path)), agentIds: [], units: [], n: leadingNumber(basename(f.path)), script: f.path }));
    if (scripts.length) notes.push("Stages named after numbered scripts; no agent definitions or output folders were found.");
  }
  if (!agents.length) missing.push({ what: "Agent definitions", needs: "markdown files with name/description front matter in an agents/ folder, or named *.agent.md" });
  if (!units.length) missing.push({ what: "Progress", needs: "an output folder (output/, *_output/, checkpoints/, reports/, artifacts/) with one subfolder per stage" });

  const evals = new Map();
  await pool(units, 4, async (u) => evals.set(u, await evaluateUnit(ctx, u)));

  const artifacts = [];
  const timeline = [];
  const metrics = [];
  const steps = plan.map((p) => {
    const ev = p.units.map((u) => evals.get(u));
    const sts = ev.map((e) => e.status);
    const status = !ev.length ? "pending"
      : sts.includes("blocked") ? "blocked"
      : sts.every((s) => s === "done" || s === "skipped") ? "done"
      : sts.some((s) => s !== "pending") ? "active" : "pending";
    const at = latest(ev.map((e) => e.at));
    const runs = ev.flatMap((e) => e.runs);
    const step = {
      key: p.key, label: p.label, agentIds: p.agentIds, status,
      ...(p.agent?.optional && { optional: true }),
      ...(ev.length === 1 && ev[0].rawStatus ? { rawStatus: ev[0].rawStatus } : !ev.length && p.agent ? { rawStatus: "no output yet" } : {}),
      provenance: ev.find((e) => e.provenance === "observed") ? "observed" : ev.length ? ev[0].provenance : "derived",
      ...(p.agent?.description && { description: p.agent.description }),
      ...(p.units.length ? { output: p.units.map((u) => u.path).join(", ") } : p.script ? { output: p.script } : {}),
      ...(status === "done" && at && { finishedAt: at }),
      ...(runs.length > 1 && { note: `${runs.length} runs on record${ev.find((e) => e.currentRun) ? `; showing ${ev.find((e) => e.currentRun).currentRun}` : ""}.` }),
      gates: ev.flatMap((e) => e.gates),
    };
    for (const e of ev) {
      for (const f of e.files.slice(0, 25)) artifacts.push({ label: f.path.split("/").slice(-2).join("/"), path: f.path, stepKey: p.key });
      for (const r of e.runs) if (r.at) timeline.push({ at: r.at, summary: `${p.label}: run ${r.name}${r.raw ? ` ${r.raw}` : ""}`, level: r.status === "blocked" ? "error" : r.current ? "success" : "info", ...(p.agentIds[0] && { agentId: p.agentIds[0] }), stepKey: p.key });
      if (!e.runs.length && e.at) timeline.push({ at: e.at, summary: `${p.label}: ${e.rawStatus ?? "output"}${e.files.length ? ` (${e.files.length} file${e.files.length === 1 ? "" : "s"})` : ""}`, level: e.status === "blocked" ? "error" : e.status === "done" ? "success" : "info", ...(p.agentIds[0] && { agentId: p.agentIds[0] }), stepKey: p.key });
      for (const [label, value] of e.stats.slice(0, 20)) metrics.push({ group: p.label, label, value });
    }
    return { step, plan: p, ev };
  });

  // agents sharing an order number are alternatives for one stage: once one has output, the
  // others are not waiting to run
  for (const s of steps) {
    if (s.ev.length || s.plan.n === undefined || !s.plan.agent) continue;
    const sibling = steps.find((o) => o !== s && o.plan.n === s.plan.n && o.plan.agent && o.ev.length);
    if (sibling) Object.assign(s.step, { status: "skipped", rawStatus: `same stage as ${sibling.step.label}, which has output`, optional: true });
  }
  const phases = await assignPhases(ctx, agents, steps, units);
  for (const ph of phases) for (const s of ph.steps) for (const t of timeline) if (t.stepKey === s.key) t.phaseKey = ph.key;
  const flat = phases.flatMap((p) => p.steps);
  const workItems = [...(await issueItems(steps)), ...(await listItems(ctx, steps))];
  const epics = [...new Map(workItems.filter((w) => w.epicId).map((w) => [w.epicId, { id: w.epicId, title: w.group ?? w.epicId }])).values()];

  metrics.unshift(
    { group: "Discovery", label: "Files scanned", value: ctx.files.length },
    { group: "Discovery", label: "Agents found", value: agents.length },
    { group: "Discovery", label: "Output folders", value: units.length },
  );
  return {
    notes,
    phases,
    agents,
    position: positionFor(phases, flat, undefined, latest(timeline.map((t) => t.at)), now),
    epics: epics.length > 1 ? epics : [],
    workItems: epics.length > 1 ? workItems : workItems.map(({ epicId, ...w }) => w),
    workItemLabel: workItems.length ? workItems[0].label : undefined,
    artifacts: artifacts.slice(0, 400),
    timeline: timeline.sort((a, b) => a.at.localeCompare(b.at)).slice(-400),
    metrics,
    missing,
  };
}

/** Phases from "Phase X — Name" headings in the overview docs, else an agent's `phase`, else one. */
async function assignPhases(ctx, agents, steps, units) {
  const all = steps.map((s) => s.step);
  const fromField = agents.some((a) => a.phase);
  if (fromField) {
    const phases = [];
    for (const { step, plan } of steps) {
      const label = plan.agent?.phase ?? phases.at(-1)?.label ?? "Pipeline";
      let p = phases.find((x) => x.label === label);
      if (!p) phases.push((p = { key: slug(label), label, steps: [] }));
      p.steps.push(step);
    }
    return phases;
  }
  const docs = ctx.files
    .filter((f) => isMd(f.path) && depth(f.path) <= 2 && !/(^|\/)(skills|agents?)\//i.test(f.path) && !inOutputRoot(ctx, f.path)
      && /^(readme|claude|overview|pipeline|workflow|architecture|process|phases?|contract)|pipeline|contract|workflow|phases?/i.test(stem(f.path)))
    .sort((a, b) => depth(a.path) - depth(b.path))
    .slice(0, 12);
  for (const f of docs) {
    const text = (await ctx.read(f.path, 1_000_000)) ?? "";
    const lines = frontMatter(text).body.split("\n");
    const heads = [];
    lines.forEach((line, i) => {
      const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (h) heads.push({ level: h[1].length, text: cleanInline(h[2]), line: i });
    });
    const phaseHeads = heads.filter((h) => /^(phase|stage)\s+([A-Z]|\d{1,2})\b/i.test(h.text));
    if (phaseHeads.length < 2) continue;
    const sections = phaseHeads.map((h) => {
      const end = heads.find((x) => x.line > h.line && x.level <= h.level)?.line ?? lines.length;
      const m = h.text.match(/^(phase|stage)\s+([A-Z]|\d{1,2})\b\s*[—–:·.-]*\s*(.*)$/i);
      return { key: slug(`${m[1]}-${m[2]}`), label: m[3] ? m[3].trim() : `${m[1]} ${m[2]}`, text: lines.slice(h.line, end).join("\n").toLowerCase(), steps: [] };
    });
    const needles = (s) => [s.plan.agent?.stemName, s.plan.agent?.rawName, ...s.plan.units.map((u) => u.name)].filter((x) => x && x.length >= 4).map((x) => x.toLowerCase());
    let assigned = 0;
    let prev = sections[0];
    for (const s of steps) {
      const hit = sections.find((sec) => needles(s).some((n) => sec.text.includes(n)));
      if (hit) assigned++;
      (hit ?? prev).steps.push(s.step);
      prev = hit ?? prev;
    }
    if (assigned >= Math.ceil(steps.length / 2) && sections.filter((x) => x.steps.length).length >= 2)
      return sections.filter((x) => x.steps.length).map(({ text, ...p }) => p);
  }
  const label = agents.length ? "Pipeline" : units.length ? humanize(basename(units[0].root)) : "Harness";
  return [{ key: slug(label), label, steps: all }];
}

/** Work items from ISSUE-001-style ids that recur across the stages' outputs. */
async function issueItems(steps) {
  const seen = new Map(); // id → [{ stepIndex, item }]
  steps.forEach((s, i) => {
    for (const e of s.ev) for (const f of e.files) for (const m of basename(f.path).matchAll(ISSUE_ID)) {
      const item = e.items.find((x) => x.path === f.path);
      seen.set(m[1], [...(seen.get(m[1]) ?? []), { i, f, item }]);
    }
  });
  const multi = [...seen].filter(([, hits]) => new Set(hits.map((h) => h.i)).size >= 2);
  if (multi.length < 2) return [];
  const lastIndex = steps.length - 1;
  return multi.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([id, hits]) => {
    hits.sort((a, b) => a.i - b.i);
    const last = hits.at(-1);
    const gates = hits.filter((h) => h.item?.raw).map((h) => ({ label: `${steps[h.i].step.label} · ${humanize(stem(h.f.path).replace(id, "")) || "report"}`, status: h.item.status, detail: h.item.raw }));
    const blocked = gates.some((g) => g.status === "blocked");
    const status = blocked ? "blocked" : last.i === lastIndex && (!last.item?.status || last.item.status === "done") ? "done" : "active";
    const title = hits.map((h) => h.item?.title).find(Boolean);
    const prefix = id.split("-")[0];
    return {
      id, title: title && !title.includes(id) ? `${id} · ${title}` : title ?? id, status,
      rawStatus: last.item?.raw ?? `at ${steps[last.i].step.label.toLowerCase()}`,
      ...(steps[last.i].step.agentIds[0] && { agentId: steps[last.i].step.agentIds[0] }),
      type: prefix.toLowerCase(),
      verified: status === "done",
      gates,
      label: `${humanize(prefix.toLowerCase())}s`,
    };
  });
}

/** Work items from ticket lists (TOML or JSON arrays of entries with a title) in the outputs. */
async function listItems(ctx, steps) {
  const out = [];
  for (const s of steps) for (const e of s.ev) {
    for (const f of e.files.filter((x) => /\.(toml|json)$/i.test(x.path) && (x.size ?? 0) <= 256_000 && /(ticket|stor|issue|task|backlog|item|todo)/i.test(basename(x.path)))) {
      let doc;
      try {
        const text = await ctx.read(f.path, 256_000);
        doc = text === undefined ? undefined : extname(f.path) === ".toml" ? parseToml(text) : JSON.parse(text);
      } catch {
        continue;
      }
      const list = doc && (Array.isArray(doc) ? doc : Object.values(doc).find((v) => objArray(v) && v.some((x) => x.title)));
      if (!objArray(list)) continue;
      const dir = dirname(f.path);
      const group = humanize(basename(dir));
      const epicId = slug(dir);
      const docs = e.items.filter((i) => dirname(i.path) === dir);
      for (const [k, o] of list.entries()) {
        if (!str(o.title)) continue;
        const rawId = str(o.id ?? o.key) ?? String(k + 1);
        const ref = docs.find((d) => Object.values(d.fm).some((v) => str(v) === rawId) && d.raw);
        const deps = ([o.after, o.depends_on, o.dependsOn, o.blocked_by].find(Array.isArray) ?? []).map(str).filter(Boolean);
        out.push({
          id: `${epicId}#${rawId}`, title: str(o.title), status: ref ? ref.status : "pending", rawStatus: ref?.raw ?? "no status file",
          epicId, group, ...(str(o.type) && { type: str(o.type) }),
          ...(str(o.description ?? o.summary) && { description: str(o.description ?? o.summary) }),
          ...(deps.length && { dependsOn: deps.map((d) => `${epicId}#${d}`) }),
          ...(s.step.agentIds[0] && { agentId: s.step.agentIds[0] }),
          label: "Work items",
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Position and clean-up
// ---------------------------------------------------------------------------------------------

function positionFor(phases, flat, current, since, now = new Date()) {
  const phaseOf = (s) => phases.find((p) => p.steps.includes(s));
  const at = (s, state, summary) => ({ state, phaseKey: phaseOf(s).key, stepKey: s.key, ...(s.agentIds[0] && { agentId: s.agentIds[0] }), summary, ...(since && { since }) });
  if (!flat.length) return { state: "unknown", summary: "No stages found in these files." };
  const required = flat.filter((s) => !s.optional);
  const done = required.filter((s) => s.status === "done" || s.status === "skipped");
  if (current) {
    if (done.length === required.length) return at(current, "finished", `Every stage is done (${done.length} of ${required.length}).`);
    return at(current, current.status === "active" ? "running" : current.status === "blocked" ? "blocked" : "paused", `Current stage: ${current.label}${current.rawStatus ? ` (${current.rawStatus})` : ""}.`);
  }
  const blocked = flat.find((s) => s.status === "blocked");
  if (blocked) return at(blocked, "blocked", `${blocked.label} is blocked${blocked.rawStatus ? ` (${blocked.rawStatus})` : ""}.`);
  const active = flat.find((s) => s.status === "active");
  const recent = since && now.getTime() - Date.parse(since) < 15 * 60_000;
  if (active) return at(active, recent ? "running" : "paused", `${active.label} is in progress${active.rawStatus ? ` (${active.rawStatus})` : ""}.`);
  const failed = flat.flatMap((s) => s.gates ?? []).filter((g) => g.status === "blocked").length;
  if (done.length === required.length) return at(flat.at(-1), "finished", `Every stage has output (${done.length} of ${required.length})${failed ? `; ${failed} gate${failed === 1 ? "" : "s"} failed` : ""}.`);
  const next = required.find((s) => s.status !== "done" && s.status !== "skipped");
  if (!done.length) return at(next, "not_started", `No stage has output yet. First: ${next.label}.`);
  return at(next, "paused", `${done.length} of ${required.length} stages have output. Next: ${next.label}.`);
}

/** Keeps the run valid however the files looked: unique keys, references that exist. */
function sanitize(run) {
  const agentIds = new Set(run.agents.map((a) => a.id));
  const seen = new Set();
  for (const p of run.phases) {
    let k = p.key;
    while (seen.has(`phase:${k}`)) k = `${k}-2`;
    seen.add(`phase:${k}`);
    p.key = k;
    const steps = new Set();
    for (const s of p.steps) {
      let sk = s.key;
      while (steps.has(sk)) sk = `${sk}-2`;
      steps.add(sk);
      s.key = sk;
      s.agentIds = s.agentIds.filter((id) => agentIds.has(id));
      if (!s.gates?.length) delete s.gates;
    }
  }
  const items = new Set((run.workItems ?? []).map((w) => w.id));
  for (const w of run.workItems ?? []) {
    delete w.label;
    if (w.agentId && !agentIds.has(w.agentId)) delete w.agentId;
    if (w.dependsOn) w.dependsOn = w.dependsOn.filter((d) => items.has(d));
  }
  if (run.position.agentId && !agentIds.has(run.position.agentId)) delete run.position.agentId;
  if (!run.phases.length) run.phases = [{ key: "harness", label: "Harness", steps: [] }];
  return run;
}
