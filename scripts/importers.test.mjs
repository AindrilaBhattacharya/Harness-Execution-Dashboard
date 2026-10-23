import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { importRun, parseArgs } from "./import.mjs";
import { readBmadProject } from "./readers/bmad.mjs";
import { fromCobolDashboard } from "./readers/cobol.mjs";
import { validateRun } from "./validate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bmadFixture = join(here, "fixtures", "bmad-plsql-pyspark");
const example = join(here, "..", "examples", "harness-run.example.json");
const step = (run, phase, key) => run.phases.find((p) => p.key === phase).steps.find((s) => s.key === key);

test("the example run file is valid", () => {
  assert.deepEqual(validateRun(JSON.parse(readFileSync(example, "utf8"))), []);
});

test("validation names broken references", () => {
  const run = JSON.parse(readFileSync(example, "utf8"));
  run.phases[0].steps[0].agentIds = ["nobody"];
  run.position.stepKey = "no-such-step";
  run.phases[1].steps[0].status = "finished";
  run.workItems[0].epicId = "no-such-epic";
  const errors = validateRun(run);
  assert.ok(errors.some((e) => e.includes('epicId "no-such-epic" is not in epics')));
  assert.ok(errors.some((e) => e.includes('names agent "nobody"')));
  assert.ok(errors.some((e) => e.includes('position.stepKey "no-such-step"')));
  assert.ok(errors.some((e) => e.includes('status "finished"')));
});

test("BMAD: phases, steps and tickets come from the project files", () => {
  const run = readBmadProject(bmadFixture);
  assert.deepEqual(validateRun(run), []);
  assert.deepEqual(run.phases.map((p) => p.key), ["analysis", "planning", "implementation", "validation"]);
  assert.equal(step(run, "analysis", "brief").status, "done");
  assert.equal(step(run, "analysis", "research").status, "unknown"); // exists, no finished status recorded
  assert.equal(step(run, "analysis", "prfaq").status, "pending");
  assert.equal(step(run, "planning", "tickets").status, "done");
  assert.equal(step(run, "implementation", "build").status, "active");
  assert.equal(step(run, "validation", "retrospective").rawStatus, "1/3 epics");
  assert.equal(run.workItems.length, 9);
  assert.deepEqual(
    Object.fromEntries(["1.1", "2.2", "2.3", "3.1"].map((id) => [id, run.workItems.find((w) => w.id === id).rawStatus])),
    { "1.1": "done", "2.2": "in-review", "2.3": "in-progress", "3.1": "planned" },
  );
  assert.equal(run.agents.length, 5);
});

test("BMAD: epics come from the ticket tree, their status from the epic document", () => {
  const run = readBmadProject(bmadFixture);
  assert.deepEqual(run.epics.map((e) => [e.id, e.status]), [["1", "done"], ["2", "active"], ["3", undefined]]);
  const ticket = (id) => run.workItems.find((w) => w.id === id);
  assert.deepEqual([ticket("2.1").epicId, ticket("2.1").dependsOn, ticket("2.4").type], ["2", ["1.2"], "bug"]);
  assert.deepEqual(ticket("2.2").dependsOn, ["2.1"]);
  assert.deepEqual(ticket("3.1").dependsOn, ["epic-ledger-posting"]);
});

test("BMAD: the ticket in progress is where the run is", () => {
  const pos = readBmadProject(bmadFixture).position;
  assert.equal(pos.state, "running");
  assert.equal(pos.phaseKey, "implementation");
  assert.equal(pos.workItemId, "2.3");
  assert.equal(pos.agentId, "dev");
});

test("BMAD: a blocked plan blocks the run, with its reason", () => {
  const root = mkdtempSync(join(tmpdir(), "bmad-"));
  try {
    cpSync(bmadFixture, root, { recursive: true });
    const plan = join(root, "_bmad-output/initiative-ledger-to-pyspark/epic-ledger-posting/story-reconcile-nightly-plan.md");
    writeFileSync(plan, readFileSync(plan, "utf8").replace("status: in-progress", "status: blocked\nblocked_reason: reconciliation tolerance not agreed"));
    const run = readBmadProject(root);
    assert.equal(run.position.state, "blocked");
    assert.match(run.position.summary, /tolerance not agreed/);
    assert.equal(step(run, "implementation", "build").status, "blocked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("BMAD: a v6 project is refused with the migration to run", () => {
  const root = mkdtempSync(join(tmpdir(), "bmad6-"));
  try {
    mkdirSync(join(root, "_bmad", "bmm"), { recursive: true });
    writeFileSync(join(root, "_bmad", "bmm", "config.yaml"), "output_folder: out\n");
    assert.throws(() => readBmadProject(root), /BMAD v6 project.*bmad migrate method/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("COBOL: stages become steps, stories are work items not a phase, the original's rules apply", () => {
  const story = (id, status, extra = {}) => ({ id, epicId: "E1", title: id, planOrder: Number(id.slice(1)), acceptanceCriteria: [], codegen: { status, attempts: 1, tests: { total: 1, passed: 0, failed: 0 }, ...extra } });
  const doc = {
    meta: { harnessName: "COBOL → Java Harness", harnessTagline: "t", workspace: "demo", timezone: "UTC", codePath: "codegen_output/demo", updatedAt: "2026-10-01T00:00:00Z", dataSource: { mode: "codegen_output", modulePath: "codegen_output/demo", real: [], missing: [] } },
    weights: { stageWeight: 0.4, storyWeight: 0.6 },
    phases: [
      { key: "migrate", label: "Migrate", summary: "", stageKeys: ["build"] },
      { key: "implementation", label: "Implementation", summary: "", stageKeys: [], showsStories: true },
    ],
    stages: [{ key: "build", label: "Build", phase: "migrate", ordinal: 0, status: "running", gateKey: "code", mode: "llm", roles: ["codegen"], input: "", work: "", output: "" }],
    gates: [
      { key: "code", stageKey: "build", label: "Code", status: "open", threshold: "", result: "" },
      { key: "story_behavior", stageKey: "build", label: "Behaviour", status: "passed", threshold: "", result: "",
        approval: { decision: "approved", approverEmail: "a@b.c", approverRole: "Lead", riskAccepted: false, rationale: "", decidedAt: "2026-10-01T00:00:00Z" } },
    ],
    agentRoles: [{ role: "codegen", label: "Codegen", tier: "sonnet", model: "m", envVar: "", stages: ["build"], description: "", runs: null, costUsd: null, tokens: null }],
    artifacts: [{ id: "A1", kind: "k", label: "Module", version: 1, stageKey: "build", objectUri: "codegen_output/demo", contentHash: "", createdAt: "", summary: "" }],
    epics: [{ id: "E1", title: "Epic", outcome: "", brdRequirementIds: [], storyIds: ["S1", "S2"] }],
    stories: [
      story("S1", "passed", { qualityGate: { passed: false, score: 0.5, failures: ["no assertions"], warnings: [] } }),
      { ...story("S2", "running"), narrative: "As a teller…", dependsOn: ["S1"], acceptanceCriteria: [{ id: "AC1", statement: "Balances match", covered: false }] },
    ],
    traceability: [
      { id: "R1", kind: "requirement", title: "", cobolRefs: ["P"], epicIds: ["E1"], storyIds: ["S1"], javaRefs: ["J"], testRefs: ["T"] },
      { id: "R2", kind: "requirement", title: "", cobolRefs: [], epicIds: ["E1"], storyIds: ["S9"], javaRefs: [], testRefs: [] },
    ],
    quality: { brdJudge: null, build: { gates: [] }, equivalence: { verdict: "pending", recordsCompared: 0, mismatches: 0, tolerated: 0, tolerances: [] } },
    timeline: [],
    inputs: { outcome: null, sourceRepo: "src", counts: { programs: 3 }, graph: null, config: {} },
    state: { currentStage: "build", currentStoryId: "S2", budget: { workspaceCapUsd: 50, runCapUsd: 5, spentUsd: null, killed: false }, tokens: null, agentRuns: [] },
  };
  const run = fromCobolDashboard(doc);
  assert.deepEqual(validateRun(run), []);
  assert.deepEqual(step(run, "migrate", "build").gates.map((g) => [g.label, g.status, !!g.approval]), [["Code", "pending", false], ["Behaviour", "done", true]]);
  assert.deepEqual(run.phases.map((p) => p.key), ["migrate"]);
  assert.deepEqual(run.workItems.map((w) => [w.id, w.status, w.verified]), [["S1", "done", true], ["S2", "active", false]]);
  assert.deepEqual(run.epics, [{ id: "E1", title: "Epic" }]);
  const [s1, s2] = run.workItems;
  assert.deepEqual([s1.epicId, s1.gates.map((g) => [g.status, g.detail])], ["E1", [["blocked", "no assertions"]]]);
  assert.deepEqual([s2.description, s2.dependsOn, s2.acceptanceCriteria], ["As a teller…", ["S1"], [{ id: "AC1", text: "Balances match", covered: false }]]);
  assert.deepEqual(run.traceability.map((t) => t.state), ["complete", "broken"]);
  assert.deepEqual(run.progressWeights, { steps: 0.4, workItems: 0.6 });
  assert.deepEqual([run.position.state, run.position.phaseKey, run.position.stepKey, run.position.workItemId], ["running", "migrate", "build", "S2"]);
});

test("import: detects the input kind, refuses what it does not know", () => {
  assert.equal(importRun({ from: example, traits: [] }).harness.id, "migration-factory");
  assert.equal(importRun({ from: bmadFixture, traits: [{ label: "Target", value: "PySpark" }] }).harness.traits.at(-1).value, "PySpark");
  assert.throws(() => importRun({ from: here, traits: [] }), /no supported harness output found/);
  assert.throws(() => parseArgs(["--trait", "nolabel"]), /Label=Value/);
});
