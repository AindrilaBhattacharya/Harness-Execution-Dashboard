// Tests for the discovery engine, on small made-up harnesses written to a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverRun } from "../src/discover/discover.js";
import { githubSource, parseGitHubUrl } from "../src/discover/github.js";
import { documentStatus, mapStatus } from "../src/discover/text.js";
import { validateRun } from "../src/discover/validate.js";
import { parseArgs } from "./import.mjs";
import { localSource } from "./sources.mjs";

/** Writes { "a/b.md": "text" } under a fresh temp folder and returns its path. */
function project(files) {
  const root = mkdtempSync(join(tmpdir(), "harness-"));
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof text === "string" ? text : JSON.stringify(text));
  }
  return root;
}
const agent = (name, description, extra = "") => `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n# ${name}\n`;
const read = async (files) => {
  const root = project(files);
  try {
    const run = await discoverRun(localSource(root), { now: new Date("2026-10-01T12:00:00Z") });
    assert.deepEqual(validateRun(run), [], "the run validates");
    return run;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const steps = (run) => run.phases.flatMap((p) => p.steps);

test("agents, numbered output folders, statuses, ids and phases from the overview", async () => {
  const run = await read({
    "README.md": "# Acme Fixer\n\n## Phase A — Understand\n\n`01_collector` writes `01-collect/`.\n\n## Phase B — Repair\n\n`02_mender` then `03_checker`.\n",
    ".github/agents/01_collector.agent.md": agent("01_collector", "First agent in the pipeline. Gathers every reported defect."),
    ".github/agents/02_mender.agent.md": agent("02_mender", "Writes the smallest fix."),
    ".github/agents/03_checker.agent.md": agent("03_checker", "Checks each fix."),
    "docs/agent_output/01-collect/report_BUG-1.md": "## Null deref in parser\n",
    "docs/agent_output/01-collect/report_BUG-2.md": "## Off-by-one in pager\n",
    "docs/agent_output/02-mend/fix_BUG-1.md": "| | |\n|--|--|\n| **Status** | Approved |\n",
    "docs/agent_output/02-mend/fix_BUG-2.md": "| | |\n|--|--|\n| **Status** | Proposed |\n",
  });
  assert.equal(run.discovery.method, "files");
  assert.equal(run.harness.name, "Acme Fixer");
  assert.deepEqual(run.agents.map((a) => a.name), ["Collector", "Mender", "Checker"]);
  assert.equal(run.agents[0].role, "Gathers every reported defect.");
  assert.deepEqual(run.phases.map((p) => [p.label, p.steps.map((s) => s.label)]), [["Understand", ["Collector"]], ["Repair", ["Mender", "Checker"]]]);
  const [collect, mend, check] = steps(run);
  assert.equal(collect.status, "done");
  assert.equal(mend.status, "active");
  assert.equal(mend.rawStatus, "1 Approved · 1 Proposed");
  assert.deepEqual(mend.gates.map((g) => g.status).sort(), ["done", "pending"]);
  assert.equal(check.status, "pending");
  assert.equal(run.position.stepKey, mend.key);
  assert.deepEqual(run.workItems.map((w) => [w.id, w.status]), [["BUG-1", "active"], ["BUG-2", "active"]]);
  assert.equal(run.workItems[0].title, "BUG-1 · Null deref in parser");
  assert.equal(run.harness.workItemLabel, "Bugs");
});

test("named output folders with timestamped runs, a latest pointer and run status", async () => {
  const run = await read({
    ".claude/agents/1_intake.md": agent("1_intake", "Reads the sources."),
    ".claude/agents/1_intake_alt.md": agent("1_intake_alt", "Another way to read the sources."),
    ".claude/agents/2_summary.md": agent("2_summary", "Writes the summary into final_report."),
    ".claude/agents/3_index.md": agent("3_index", "Optional agent. Builds a search index."),
    "output/intake/2026-09-01T10.00.00.000Z/run_meta.json": { status: "failed", generated_at: "2026-09-01T10:00:00Z" },
    "output/intake/2026-09-02T10.00.00.000Z/run_meta.json": { status: "success", generated_at: "2026-09-02T10:00:00Z", stats_summary: { files: 7 } },
    "output/intake/2026-09-02T10.00.00.000Z/intake.json": { stats: { files_read: 7, errors: 0 } },
    "output/intake/latest.json": { path: "2026-09-02T10.00.00.000Z/intake.json" },
    "output/final_report/2026-09-03T08.00.00.000Z/run_meta.json": { status: "success" },
  });
  const [intake, alt, summary, index] = steps(run);
  assert.equal(intake.status, "done");
  assert.equal(intake.rawStatus, "success");
  assert.equal(intake.provenance, "observed");
  assert.match(intake.note, /2 runs on record; showing 2026-09-02/);
  assert.equal(alt.status, "skipped");
  assert.equal(summary.status, "done", "matched to final_report because its definition names it");
  assert.equal(index.status, "pending");
  assert.equal(index.optional, true);
  assert.equal(run.position.state, "finished");
  assert.deepEqual(run.metrics.filter((m) => m.group === "Intake").map((m) => [m.label, m.value]), [["files read", 7], ["errors", 0]]);
  assert.equal(run.timeline.filter((t) => t.stepKey === intake.key).length, 2);
  assert.equal(run.timeline.find((t) => t.summary.includes("failed")).level, "error");
});

test("no agents: output subfolders are the stages, documents state their status, ticket lists are work items", async () => {
  const run = await read({
    "_plan-output/initiative/brief-x/brief-x.md": "---\nstatus: final\n---\n# Brief\n",
    "_plan-output/initiative/design-x/design-x.md": "---\nstatus: draft\n---\n# Design\n",
    "_plan-output/initiative/epic-a/tickets.toml": "[[entry]]\nid = 1\ntitle = \"First\"\n\n[[entry]]\nid = 2\ntitle = \"Second\"\nafter = [1]\n",
    "_plan-output/initiative/epic-a/first-plan.md": "---\nticket: 1\nstatus: done\n---\n",
    "_plan-output/initiative/epic-b/tickets.toml": "[[entry]]\nid = 1\ntitle = \"Third\"\n",
  });
  assert.deepEqual(steps(run).map((s) => [s.label, s.status]), [["Brief x", "done"], ["Design x", "active"], ["Epic a", "done"], ["Epic b", "done"]]);
  assert.equal(run.phases[0].label, "Plan output");
  assert.deepEqual(run.workItems.map((w) => [w.title, w.status, w.dependsOn ?? []]), [["First", "done", []], ["Second", "pending", [run.workItems[0].id]], ["Third", "pending", []]]);
  assert.equal(run.epics.length, 2);
  assert.ok(run.missing.some((m) => m.what === "Agent definitions"));
});

test("a self-describing state file gives phases, steps, agents, gates and stories", async () => {
  const run = await read({
    "web/public/data/pipeline-state.json": {
      meta: { harnessName: "Acme Migrator", workspace: "billing" },
      phases: [{ key: "u", label: "Understand", stageKeys: ["parse"] }, { key: "b", label: "Build", stageKeys: ["gen", "test"] }],
      stages: [
        { key: "parse", label: "Parse", status: "passed", roles: ["reader"] },
        { key: "gen", label: "Generate", status: "running", roles: ["writer"] },
        { key: "test", label: "Test", status: "pending" },
      ],
      gates: [{ key: "g1", stageKey: "gen", label: "Compiles", status: "open" }],
      agentRoles: [{ role: "reader", label: "Reader", model: "m-1", runs: 3 }, { role: "writer", label: "Writer", description: "Writes code. Carefully." }],
      stories: [{ id: "S-1", title: "Pay a bill", status: "done", acceptanceCriteria: ["Paid"] }],
      state: { currentStage: "gen" },
    },
  });
  assert.equal(run.discovery.method, "state-file");
  assert.equal(run.harness.name, "Acme Migrator");
  assert.equal(run.project.name, "billing");
  assert.deepEqual(run.phases.map((p) => [p.label, p.steps.map((s) => `${s.label}:${s.status}`)]), [["Understand", ["Parse:done"]], ["Build", ["Generate:active", "Test:pending"]]]);
  assert.deepEqual(steps(run)[1].agentIds, ["writer"]);
  assert.deepEqual(steps(run)[1].gates, [{ label: "Compiles", status: "pending", detail: "open" }]);
  assert.equal(run.agents[1].role, "Writes code.");
  assert.equal(run.agents[0].usage.runs, 3);
  assert.equal(run.position.stepKey, "gen");
  assert.equal(run.position.state, "running");
  assert.equal(run.workItems[0].acceptanceCriteria[0].text, "Paid");
  assert.equal(run.harness.workItemLabel, "Stories");
});

test("a run file the harness wrote is used as it is", async () => {
  const written = {
    schemaVersion: 1, harness: { id: "x", name: "Written" }, project: { name: "p" }, importedAt: "2026-01-01T00:00:00Z",
    phases: [{ key: "a", label: "A", steps: [{ key: "s", label: "S", agentIds: [], status: "done" }] }], agents: [], position: { state: "finished" },
  };
  const run = await read({ "harness-run.json": written, "agents/x.agent.md": agent("x", "y") });
  assert.equal(run.discovery.method, "run-file");
  assert.equal(run.harness.name, "Written");
  assert.equal(run.discovery.file, "harness-run.json");
});

test("an empty folder still gives a valid run that says what is missing", async () => {
  const run = await read({ "notes.txt": "hello" });
  assert.equal(run.position.state, "unknown");
  assert.deepEqual(run.missing.map((m) => m.what), ["Agent definitions", "Progress"]);
});

test("status words map to the dashboard's six statuses", () => {
  const cases = { success: "done", passed: "done", Approved: "done", final: "done", NO_BYPASS_FOUND: "done", BEHAVIOR_PRESERVED: "done", draft: "active",
    "in-progress": "active", Proposed: "pending", open: "pending", failed: "blocked", STILL_VULNERABLE: "blocked", "Compile Failed": "blocked", dropped: "skipped", INCONCLUSIVE: "unknown" };
  for (const [w, s] of Object.entries(cases)) assert.equal(mapStatus(w), s, w);
  assert.deepEqual(documentStatus("| **Verdict** | `NO_BYPASS_FOUND` |"), { raw: "NO_BYPASS_FOUND", from: "table" });
  assert.deepEqual(documentStatus("---\nstatus: in-review\n---\n"), { raw: "in-review", from: "front matter" });
});

test("GitHub links: repo, folder at a branch, file", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/org/harness"), { owner: "org", repo: "harness", kind: null, rest: [] });
  assert.deepEqual(parseGitHubUrl("github.com/org/harness.git"), { owner: "org", repo: "harness", kind: null, rest: [] });
  assert.deepEqual(parseGitHubUrl("https://github.com/org/harness/tree/main/output/"), { owner: "org", repo: "harness", kind: "tree", rest: ["main", "output"] });
  assert.equal(parseGitHubUrl("https://gitlab.com/org/harness"), null);
});

test("a GitHub folder is read through the tree and raw files, re-validated with its ETag", async () => {
  const calls = [];
  const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", etag: '"t1"' }, ...init });
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (/\/git\/trees\/feature\?/.test(url)) return new Response("", { status: 404 });
    if (url.includes("/git/trees/feature/x?")) {
      if (init.headers?.["If-None-Match"] === '"t1"') return new Response(null, { status: 304 });
      return json({ tree: [
        { type: "blob", path: "pipe/agents/01_alpha.md", size: 40, sha: "a1" },
        { type: "blob", path: "pipe/output/alpha/run_meta.json", size: 20, sha: "b1" },
        { type: "blob", path: "other/readme.md", size: 5, sha: "c1" },
      ] });
    }
    if (url.endsWith("/pipe/agents/01_alpha.md")) return new Response(agent("01_alpha", "Does alpha."));
    if (url.endsWith("/pipe/output/alpha/run_meta.json")) return new Response(JSON.stringify({ status: "success" }));
    return new Response("", { status: 404 });
  };
  const src = githubSource("https://github.com/org/repo/tree/feature/x/pipe", { fetch });
  const run = await discoverRun(src);
  assert.equal(src.label, "github.com/org/repo/tree/feature/x/pipe");
  assert.deepEqual(steps(run).map((s) => [s.label, s.status]), [["Alpha", "done"]]);
  assert.ok(calls.some((u) => u.startsWith("https://raw.githubusercontent.com/org/repo/feature/x/pipe/agents/01_alpha.md")));
  const before = calls.length;
  await discoverRun(src);
  assert.equal(calls.length, before + 1, "unchanged tree: one conditional request, files from cache");
});

test("command line arguments", () => {
  assert.deepEqual(parseArgs(["--from", "x", "--trait", "Source=A"]), { traits: [{ label: "Source", value: "A" }], from: "x" });
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(["--from", "x", "--as", "y"]), /Unknown/);
});
