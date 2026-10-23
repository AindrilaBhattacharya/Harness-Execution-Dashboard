// BMAD Method (v7): reads a project's BMAD output and returns a harness run.
//
// Sources, all in the BMAD-METHOD repo:
//   agents          skills/bmad-agent-*/customize.toml (name, title, icon) and SKILL.md description
//   phases, steps   skills/bmod-method/help/help.md: analysis, planning, implementation, validation,
//                   "not a mandatory sequence"; brief/prfaq → spec → (prd, ux, architecture) → ticket
//                   → build → review → retrospective
//   config          _bmad/config.toml, then _bmad/custom/config.toml, then config.user.toml: [core]
//                   project_name, output_folder (default {project-root}/_bmad-output), active_initiative
//   documents       {output}/{initiative}/<type>-<slug>/<type>-<slug>.md, frontmatter status draft | final
//   tickets         tools/ticket-tree-rules.md, skills/bmad-ticket/scripts/tickets.py: tickets.toml
//                   ([[epic]] / [[entry]]), plans `*-plan.md` with `ticket:` and `status:`
//
// BMAD records no "current agent" or "current step", so the position is worked out from
// these files and says so.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { parse as parseToml } from "smol-toml";

export const AGENTS = [
  { id: "analyst", name: "Mary", role: "Business Analyst", icon: "📊", description: "Business analyst for market research, competitive analysis, and requirements." },
  { id: "pm", name: "John", role: "Product Manager", icon: "📋", description: "Product manager for PRD creation and requirements discovery." },
  { id: "ux-designer", name: "Sally", role: "UX Designer", icon: "🎨", description: "UX designer and UI specialist." },
  { id: "architect", name: "Winston", role: "System Architect", icon: "🏗️", description: "System architect and technical design leader." },
  { id: "dev", name: "Amelia", role: "Senior Software Engineer", icon: "💻", description: "Senior software engineer who implements stories and code changes." },
];

// Steps that hold a document: the folder prefix it writes and the agent whose menu runs it.
// Optional: help.md lists them as alternatives or as folded back into the spec.
const DOC = (key, label, prefix, agentIds, optional = false) => ({ key, label, prefix, agentIds, optional });
const PHASES = [
  { key: "analysis", label: "Analysis", summary: "Explore the idea before committing: research, a brief or a PRFAQ.", steps: [
    DOC("brainstorming", "Brainstorming", "brainstorm-", ["analyst"], true),
    DOC("research", "Research", "research-", ["analyst"], true),
    DOC("brief", "Product brief", "brief-", ["analyst"]),
    DOC("prfaq", "PRFAQ", "prfaq-", ["analyst"], true),
  ] },
  { key: "planning", label: "Planning", summary: "Distil what to build into a spec, with a PRD, UX and architecture as needed, then break it into tickets.", steps: [
    DOC("spec", "Spec", "spec-", []),
    DOC("prd", "PRD", "prd-", ["pm"], true),
    DOC("ux", "UX design", "ux-", ["ux-designer"], true),
    DOC("architecture", "Architecture", "architecture-", ["architect"], true),
    { key: "tickets", label: "Tickets", agentIds: ["pm", "architect", "dev"], output: "tickets.toml" },
  ] },
  { key: "implementation", label: "Implementation", summary: "Build each ticket in order; correct course when plans change.", steps: [
    { key: "build", label: "Build tickets", agentIds: ["dev"], output: "ticket plans" },
    DOC("correct-course", "Correct course", "change-", ["pm"], true),
  ] },
  { key: "validation", label: "Validation", summary: "Review what was built, test it end to end, and close each epic with a retrospective.", steps: [
    { key: "code-review", label: "Code review", agentIds: ["dev"] },
    DOC("walkthrough", "Walkthrough", "walkthrough-", [], true),
    DOC("qa", "QA end-to-end tests", "test-summary-", ["dev"], true),
    { key: "retrospective", label: "Retrospective", agentIds: ["dev"] },
  ] },
];

// Plan status (tickets.py STATUSES) → dashboard status.
const TICKET_STATUS = {
  "": "pending", draft: "pending", "ready-for-dev": "pending",
  "in-progress": "active", "in-review": "active", built: "active",
  done: "done", blocked: "blocked", dropped: "skipped",
};

export class BmadError extends Error {}

export function isBmadProject(root) {
  return existsSync(join(root, "_bmad")) || existsSync(join(root, "_bmad-output"));
}

/** `key: value` pairs from a Markdown file's front matter; nested YAML is not needed here. */
export function frontmatter(text) {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^["']/.test(v)) v = v.slice(1, v.indexOf(v[0], 1));
    else v = v.replace(/\s+#.*$/, "").trim();
    out[kv[1]] = v;
  }
  return out;
}

const readToml = (path) => {
  try {
    return parseToml(readFileSync(path, "utf8"));
  } catch (e) {
    throw new BmadError(`${path}: not valid TOML (${e.message.split("\n")[0]})`);
  }
};

const mtime = (path) => statSync(path).mtime.toISOString();
const newest = (dir) => {
  const files = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => join(dir, d.name));
  return files.length ? files.map(mtime).sort().at(-1) : mtime(dir);
};
const dirs = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : []);

/** [core] settings, later files winning (help: customization.md). */
function readConfig(root) {
  const core = {};
  for (const f of ["_bmad/config.toml", "_bmad/custom/config.toml", "_bmad/custom/config.user.toml"]) {
    const p = join(root, f);
    if (existsSync(p)) Object.assign(core, readToml(p).core ?? {});
  }
  if (!Object.keys(core).length && existsSync(join(root, "_bmad", "bmm", "config.yaml")))
    throw new BmadError(`${join(root, "_bmad", "bmm", "config.yaml")}: this is a BMAD v6 project; run \`bmad migrate method\` to move it to the v7 layout, then import again`);
  return core;
}

/**
 * @param root project root (the folder holding _bmad/ or _bmad-output/)
 * @param opts.traits extra harness traits, e.g. [{label:"Source", value:"PL/SQL"}]
 */
export function readBmadProject(root, opts = {}) {
  const core = readConfig(root);
  const output = (core.output_folder ?? "{project-root}/_bmad-output").replace("{project-root}", root);
  if (!existsSync(output)) throw new BmadError(`${output}: BMAD output folder not found (core.output_folder in _bmad/config.toml)`);
  const missing = [{ what: "Which agent is active right now", needs: "nothing BMAD records; the position is worked out from the output files" }];

  // Work lives in the active initiative; with none set, in the only initiative there is, else the output folder.
  const initiatives = dirs(output).filter((d) => d.startsWith("initiative-"));
  const initiative = core.active_initiative || (initiatives.length === 1 ? initiatives[0] : undefined);
  const base = initiative ? join(output, initiative) : output;
  if (initiative && !existsSync(base)) throw new BmadError(`${base}: active_initiative "${initiative}" has no folder`);
  const rel = (p) => relative(root, p).split(sep).join("/");
  const name = core.project_name && !core.project_name.includes("{") ? core.project_name : basename(root);

  const timeline = [];
  const at = {}; // step key -> newest file time, for the position
  const artifacts = [];

  // ---- documents ----
  const docStep = (s, phaseKey) => {
    const folders = dirs(base).filter((d) => d.startsWith(s.prefix));
    if (!folders.length) return { status: "pending" };
    const states = folders.map((f) => {
      const dir = join(base, f);
      artifacts.push({ label: `${s.label}: ${f}`, path: rel(dir), stepKey: s.key });
      const doc = join(dir, `${f}.md`);
      const memlog = join(dir, ".memlog.md");
      const fm = existsSync(doc) ? frontmatter(readFileSync(doc, "utf8")) : {};
      const log = existsSync(memlog) ? frontmatter(readFileSync(memlog, "utf8")) : {};
      const state = fm.status === "final" || log.status === "complete" ? "done" : fm.status === "draft" ? "active" : "unknown";
      const when = newest(dir);
      at[s.key] = [at[s.key], when].filter(Boolean).sort().at(-1);
      timeline.push({ at: when, summary: `${s.label} ${f}: ${fm.status ?? log.status ?? "written"}`, level: state === "done" ? "success" : "info", ...(s.agentIds[0] && { agentId: s.agentIds[0] }), phaseKey, stepKey: s.key });
      return { state, raw: fm.status ?? log.status };
    });
    const st = states.map((x) => x.state);
    const status = st.includes("active") ? "active" : st.every((x) => x === "done") ? "done" : "unknown";
    return {
      status,
      rawStatus: [...new Set(states.map((x) => x.raw ?? "written"))].join(", "),
      provenance: status === "unknown" ? "derived" : "observed",
      ...(status === "unknown" && { note: "Output exists; its finished status is not recorded." }),
      output: folders.map((f) => rel(join(base, f))).join(", "),
    };
  };

  // ---- ticket tree ----
  const treeFile = join(base, "tickets.toml");
  const tree = existsSync(treeFile) ? readToml(treeFile) : undefined;
  const groups = tree
    ? tree.epic?.length
      ? tree.epic.map((e) => ({ epic: e, dir: join(base, e.slug) }))
      : [{ epic: { id: 0, slug: basename(base), title: "Tickets" }, dir: base, flat: true }]
    : [];
  const items = [];
  const reviewed = new Set();
  const retros = [];
  for (const g of groups) {
    const entriesFile = join(g.dir, "tickets.toml");
    const entries = g.flat ? tree.entry ?? [] : existsSync(entriesFile) ? readToml(entriesFile).entry ?? [] : [];
    const epicDoc = join(g.dir, `${basename(g.dir)}.md`);
    const epicStatus = !g.flat && existsSync(epicDoc) ? frontmatter(readFileSync(epicDoc, "utf8")).status : undefined;
    const files = existsSync(g.dir) ? readdirSync(g.dir) : [];
    const leafId = Object.fromEntries(
      files.filter((f) => /^(story|spike|bug)-.+\.md$/.test(f) && !f.endsWith("-plan.md")).map((f) => [f.slice(0, -3), frontmatter(readFileSync(join(g.dir, f), "utf8")).id]),
    );
    const plans = {};
    for (const f of files.filter((f) => f.endsWith("-plan.md"))) {
      const text = readFileSync(join(g.dir, f), "utf8");
      const fm = frontmatter(text);
      const id = /^\d+$/.test(fm.ticket ?? "") ? fm.ticket : leafId[fm.ticket];
      if (id !== undefined) plans[String(id)] = { fm, file: join(g.dir, f), reviewed: /^## Code Review/m.test(text) };
    }
    for (const e of entries) {
      const plan = plans[String(e.id)];
      const raw = plan?.fm.status ?? "";
      const id = g.flat ? String(e.id) : `${g.epic.id}.${e.id}`;
      const status = TICKET_STATUS[raw] ?? "blocked";
      items.push({
        id,
        title: e.title,
        status,
        rawStatus: plan ? raw || "backlog" : "planned",
        ...(g.flat ? { group: g.epic.title } : { epicId: String(g.epic.id) }),
        agentId: "dev",
        type: e.type,
        // `after` names a ticket of the same epic by number, anything else by its full id or slug.
        ...(e.after?.length && { dependsOn: e.after.map((a) => (typeof a === "number" && !g.flat ? `${g.epic.id}.${a}` : String(a))) }),
        when: plan && mtime(plan.file),
        reason: plan?.fm.blocked_reason,
      });
      if (plan?.reviewed) reviewed.add(id);
      if (plan) timeline.push({ at: mtime(plan.file), summary: `${id} ${e.title}: ${raw || "planned"}${plan.fm.blocked_reason ? ` (${plan.fm.blocked_reason})` : ""}`, level: status === "blocked" ? "error" : status === "done" ? "success" : "info", agentId: "dev", phaseKey: "implementation", stepKey: "build" });
    }
    const retro = join(g.dir, `${basename(g.dir)}-retrospective.md`);
    if (!g.flat && existsSync(retro)) {
      const verdict = frontmatter(readFileSync(retro, "utf8")).verdict ?? "written";
      retros.push({ epic: g.epic.title, verdict });
      timeline.push({ at: mtime(retro), summary: `Retrospective for ${g.epic.title}: ${verdict}`, level: verdict === "rejected" ? "warning" : "success", agentId: "dev", phaseKey: "validation", stepKey: "retrospective" });
    }
    g.status = epicStatus;
  }
  const live = items.filter((w) => w.status !== "skipped");
  const count = (pred) => live.filter(pred).length;
  const epics = groups.filter((g) => !g.flat);

  // ---- steps ----
  const aggregate = (done, total, activeWhen) =>
    total === 0 ? "pending" : done === total ? "done" : activeWhen ? "active" : "pending";
  const special = {
    tickets: () => (tree ? { status: "done", output: `${rel(treeFile)} · ${epics.length} epics, ${items.length} tickets` } : { status: "pending" }),
    build: () => ({
      status: !live.length ? "pending" : count((w) => w.status === "blocked") ? "blocked" : aggregate(count((w) => w.status === "done"), live.length, count((w) => w.status !== "pending")),
      rawStatus: live.length ? `${count((w) => w.status === "done")}/${live.length} tickets done` : undefined,
    }),
    "code-review": () => {
      const candidates = live.filter((w) => ["in-review", "built", "done"].includes(w.rawStatus));
      return { status: aggregate(candidates.filter((w) => reviewed.has(w.id)).length, live.length, candidates.length), rawStatus: candidates.length ? `${reviewed.size} of ${candidates.length} built tickets reviewed` : undefined };
    },
    retrospective: () => ({ status: aggregate(retros.length, epics.length, retros.length), rawStatus: epics.length ? `${retros.length}/${epics.length} epics` : undefined }),
  };
  const phases = PHASES.map((p) => ({
    key: p.key,
    label: p.label,
    summary: p.summary,
    steps: p.steps.map((s) => {
      const found = s.prefix ? docStep(s, p.key) : special[s.key]();
      return {
        key: s.key,
        label: s.label,
        agentIds: s.agentIds,
        output: s.output,
        ...(s.optional && { optional: true }),
        ...found,
      };
    }),
  }));

  // ---- position: the ticket being built, else the document in draft, else what comes next ----
  const steps = phases.flatMap((p) => p.steps.map((s) => ({ phase: p, step: s })));
  const find = (key) => steps.find((x) => x.step.key === key);
  const latest = (list) => [...list].sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""))[0];
  const blocked = latest(live.filter((w) => w.status === "blocked"));
  const building = latest(live.filter((w) => w.rawStatus === "in-progress"));
  const inReview = latest(live.filter((w) => w.rawStatus === "in-review" || w.rawStatus === "built"));
  const drafting = latest(steps.filter((x) => x.step.status === "active" && !["build", "code-review", "retrospective"].includes(x.step.key)).map((x) => ({ ...x, when: at[x.step.key] })));
  const lastDone = steps.filter((x) => x.step.status === "done" || x.step.status === "unknown").at(-1);
  const next = lastDone && steps.slice(steps.indexOf(lastDone) + 1).find((x) => x.step.status === "pending" && !x.step.optional);
  const ticketAt = (w, stepKey, state, summary) => ({ state, phaseKey: find(stepKey).phase.key, stepKey, agentId: "dev", workItemId: w.id, summary, since: w.when });
  const position = blocked
    ? ticketAt(blocked, "build", "blocked", `${blocked.id} ${blocked.title} is blocked${blocked.reason ? `: ${blocked.reason}` : ""}.`)
    : building
      ? ticketAt(building, "build", "running", `Amelia is building ${building.id} ${building.title}.`)
      : inReview
        ? ticketAt(inReview, "code-review", "running", `${inReview.id} ${inReview.title} is ${inReview.rawStatus}, waiting for code review.`)
        : drafting
          ? { state: "running", phaseKey: drafting.phase.key, stepKey: drafting.step.key, ...(drafting.step.agentIds[0] && { agentId: drafting.step.agentIds[0] }), summary: `${drafting.step.label} is in draft.`, since: drafting.when }
          : !lastDone
            ? { state: "not_started", phaseKey: phases[0].key, stepKey: phases[0].steps.find((s) => !s.optional).key, summary: "No BMAD output yet." }
            : !next
              ? { state: "finished", phaseKey: lastDone.phase.key, stepKey: lastDone.step.key, summary: "Every step has its output." }
              : { state: "paused", phaseKey: next.phase.key, stepKey: next.step.key, ...(next.step.agentIds[0] && { agentId: next.step.agentIds[0] }), summary: `Last recorded: ${lastDone.step.label}. Next: ${next.step.label}.` };

  // ---- BMAD-specific numbers ----
  const byRaw = (raw) => items.filter((w) => w.rawStatus === raw).length;
  const types = [["story", "Stories"], ["spike", "Spikes"], ["bug", "Bugs"]].map(([t, label]) => [label, items.filter((w) => w.type === t).length]).filter(([, n]) => n);
  const metrics = [
    ...(initiative ? [{ group: "Ticket tree", label: "Initiative", value: initiative }] : []),
    { group: "Ticket tree", label: "Epics", value: `${epics.filter((g) => g.status === "done").length} / ${epics.length} done` },
    ...types.map(([label, n]) => ({ group: "Ticket tree", label, value: n })),
    ...["planned", "backlog", "ready-for-dev", "in-progress", "in-review", "built", "done", "blocked", "dropped"]
      .filter((r) => byRaw(r))
      .map((r) => ({ group: "Tickets by plan status", label: r, value: byRaw(r), ...(r === "blocked" && { tone: "bad" }), ...(r === "done" && { tone: "good" }) })),
    ...retros.map((r) => ({ group: "Retrospectives", label: r.epic, value: r.verdict, tone: r.verdict === "rejected" ? "bad" : r.verdict === "accepted" ? "good" : undefined })),
  ];
  if (!tree) missing.push({ what: "Tickets", needs: `${rel(treeFile)}, written by bmad-ticket` });

  return {
    schemaVersion: 1,
    harness: {
      id: "bmad",
      name: "BMAD Method",
      tagline: "Agent-assisted delivery · analysis to validation",
      traits: [{ label: "Method", value: "BMAD v7" }, ...(opts.traits ?? [])],
      workItemLabel: "Tickets",
      epicLabel: "Epics",
    },
    project: { name, path: rel(base) || "." },
    importedAt: new Date().toISOString(),
    phases,
    agents: AGENTS,
    position,
    // An epic's status is its epic document's; without one the dashboard derives it from its tickets.
    epics: epics.map((g) => ({ id: String(g.epic.id), title: g.epic.title, ...(TICKET_STATUS[g.status] && { status: TICKET_STATUS[g.status], rawStatus: g.status }) })),
    // A ticket counts as verified once the user marks it done after review (tickets.py mark).
    workItems: items.map(({ when: _w, reason, ...w }) => ({ ...w, ...(reason && { note: reason }), verified: w.status === "done" })),
    artifacts,
    timeline: timeline.sort((a, b) => a.at.localeCompare(b.at)),
    metrics,
    missing,
  };
}
