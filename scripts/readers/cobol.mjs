// COBOL → Java harness: reads the Forward Engineering Dashboard's data file (its
// public/data/dashboard-data.json or sample.json, written by that app's import-codegen.mjs)
// and returns a harness run.
//
// Phases and stages come from the harness's own lifecycle. That dashboard's story phase
// (showsStories) is left out: the harness has no such stage, and its stories are the Build
// stage's work items. The status rules and the traceability check are that dashboard's own
// (its src/lib/metrics.ts).

// Mirrors codegen ACCEPTED_STORY_STATUSES: the build moves on past these.
const ACCEPTED = new Set(["passed", "generated-unverified", "skipped"]);
const STAGE = { passed: "done", running: "active", failed: "blocked", blocked: "blocked", unknown: "unknown", pending: "pending" };
const GATE = { passed: "done", failed: "blocked", open: "pending" };
const SOURCE_LABELS = {
  programs: "COBOL programs", copybooks: "Copybooks", bmsCopybooks: "BMS copybooks", bmsMaps: "BMS screen maps",
  jcl: "JCL members", cicsPrograms: "CICS programs", cobolLines: "COBOL lines",
};

const storyStatus = (s) =>
  ACCEPTED.has(s.codegen.status) ? "done" : s.codegen.status === "running" ? "active" : s.codegen.status === "failed" ? "blocked" : s.codegen.status === "unknown" ? "unknown" : "pending";
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "—");

export function isCobolDashboardData(doc) {
  return !!doc?.meta?.harnessName && Array.isArray(doc.stages) && Array.isArray(doc.stories);
}

/** The Forward Engineering Dashboard's threadState. */
function threadState(t, d) {
  const byId = new Map(d.stories.map((s) => [s.id, s]));
  const epicIds = new Set(d.epics.map((e) => e.id));
  const dangling = t.storyIds.some((id) => !byId.has(id)) || t.epicIds.some((id) => !epicIds.has(id));
  if (dangling || t.storyIds.length === 0) return "broken";
  if (t.cobolRefs.length === 0) return "no_evidence";
  const allAccepted = t.storyIds.every((id) => ACCEPTED.has(byId.get(id).codegen.status));
  return allAccepted && t.javaRefs.length > 0 && t.testRefs.length > 0 ? "complete" : "in_progress";
}

export function fromCobolDashboard(d) {
  const sample = d.meta.dataSource.mode === "sample";
  const stories = [...d.stories].sort((a, b) => a.planOrder - b.planOrder);
  const stageByKey = new Map(d.stages.map((s) => [s.key, s]));
  const roleIds = new Set(d.agentRoles.map((r) => r.role));
  // Stories are built by the Build stage's roles (codegen, repair, advisor).
  const builders = stageByKey.get("build")?.roles.filter((r) => roleIds.has(r)) ?? [];

  const gate = (g) => ({
    label: g.label,
    status: GATE[g.status] ?? "unknown",
    detail: g.result,
    ...(g.approval && { approval: { decision: g.approval.decision, by: g.approval.approverEmail, role: g.approval.approverRole, at: g.approval.decidedAt } }),
  });

  const stageStep = (s) => ({
    key: s.key,
    label: s.label,
    description: s.work,
    agentIds: s.roles.filter((r) => roleIds.has(r)),
    status: STAGE[s.status] ?? "unknown",
    rawStatus: s.status,
    ...(!sample && s.status !== "unknown" && { provenance: s.note?.startsWith("inferred") ? "inferred" : "derived" }),
    note: s.note,
    output: s.output,
    optional: s.optional,
    ...(s.status === "passed" && s.updatedAt && { finishedAt: s.updatedAt }),
    gates: d.gates.filter((g) => g.stageKey === s.key).map(gate),
  });

  const phases = d.phases.filter((p) => !p.showsStories).map((p) => ({
    key: p.key,
    label: p.label,
    summary: p.summary,
    steps: p.stageKeys.map((k) => stageByKey.get(k)).filter(Boolean).map(stageStep),
  }));

  // Position: the current stage, and the story in the build loop when there is one.
  const stage = stageByKey.get(d.state.currentStage);
  const item = stories.find((s) => s.id === d.state.currentStoryId);
  const STATE = { running: "running", blocked: "blocked", failed: "blocked", passed: "finished" };
  const position = {
    state: stage ? STATE[stage.status] ?? "unknown" : "unknown",
    ...(stage && { phaseKey: stage.phase, stepKey: stage.key }),
    ...(item && { workItemId: item.id, summary: `${item.id} ${item.title} is ${item.codegen.status} (attempt ${item.codegen.attempts}).` }),
  };

  // Harness-specific numbers (the Forward Engineering Dashboard's Quality tab and Inputs).
  const acs = stories.flatMap((s) => s.acceptanceCriteria);
  const executed = stories.filter((s) => s.codegen.testStatus === "ok" || s.codegen.testStatus === "tests-failed");
  const budget = d.state.budget;
  const code = d.code?.counts;
  const metrics = [
    { group: "Delivery", label: "Stories accepted", value: `${stories.filter((s) => ACCEPTED.has(s.codegen.status)).length} / ${stories.length}`, hint: "passed, generated-unverified or skipped" },
    { group: "Delivery", label: "Acceptance criteria covered", value: `${acs.filter((a) => a.covered).length} / ${acs.length}`, hint: "cited by a generated test" },
    { group: "Delivery", label: "Story tests passing", value: executed.length ? `${executed.reduce((n, s) => n + s.codegen.tests.passed, 0)} / ${executed.reduce((n, s) => n + s.codegen.tests.total, 0)}` : "not run" },
    { group: "Quality", label: "BRD judge", value: d.quality.brdJudge ? `${d.quality.brdJudge.weighted.toFixed(1)} / 5 (${d.quality.brdJudge.rating})` : "not in output" },
    { group: "Quality", label: "COBOL ↔ Java equivalence", value: d.quality.equivalence.verdict, tone: d.quality.equivalence.verdict === "pass" ? "good" : d.quality.equivalence.verdict === "fail" ? "bad" : undefined },
    { group: "Budget", label: "Spend", value: budget.spentUsd === null ? "not recorded" : `$${budget.spentUsd.toFixed(2)} / $${budget.workspaceCapUsd.toFixed(2)}`, hint: budget.spentUsd === null ? `cap $${budget.workspaceCapUsd.toFixed(2)}` : `${pct(budget.spentUsd, budget.workspaceCapUsd)} of the workspace cap` },
    ...Object.entries(d.inputs.counts).map(([k, v]) => ({ group: "Source: COBOL estate", label: SOURCE_LABELS[k] ?? k, value: v.toLocaleString("en-US") })),
    ...(code
      ? [
          { group: "Target: generated Java", label: "Source files", value: code.mainFiles },
          { group: "Target: generated Java", label: "Test files", value: code.testFiles },
          { group: "Target: generated Java", label: "Files still TODO", value: `${code.filesWithTodo} / ${code.mainFiles}`, tone: code.filesWithTodo ? "bad" : "good" },
          { group: "Target: generated Java", label: "REST endpoints", value: code.endpoints },
          { group: "Target: generated Java", label: "JPA entities", value: code.entities },
        ]
      : []),
  ];

  return {
    schemaVersion: 1,
    harness: {
      id: "cobol-java",
      name: d.meta.harnessName,
      tagline: d.meta.harnessTagline,
      traits: [
        { label: "Method", value: "Graph-first harness lifecycle" },
        { label: "Source", value: "COBOL" },
        { label: "Target", value: "Java / Spring Boot" },
      ],
      workItemLabel: "Stories",
      epicLabel: "Epics",
    },
    project: { name: d.meta.workspace, path: d.meta.dataSource.modulePath ?? d.meta.codePath },
    importedAt: d.meta.dataSource.importedAt ?? d.meta.updatedAt,
    ...(sample && { sample: true }),
    timezone: d.meta.timezone,
    phases,
    agents: d.agentRoles.map((r) => ({
      id: r.role,
      name: r.label,
      role: `${r.tier[0].toUpperCase()}${r.tier.slice(1)} tier`,
      description: r.description,
      model: r.model,
      ...(r.runs !== null && { usage: { runs: r.runs, tokens: r.tokens ?? undefined, costUsd: r.costUsd ?? undefined } }),
    })),
    position,
    epics: d.epics.map((e) => ({ id: e.id, title: e.title, ...(e.outcome && { summary: e.outcome }) })),
    workItems: stories.map((s) => {
      const q = s.codegen.qualityGate;
      return {
        id: s.id,
        title: s.title,
        status: storyStatus(s),
        rawStatus: s.codegen.status,
        ...(d.epics.some((e) => e.id === s.epicId) && { epicId: s.epicId }),
        ...(s.context && { group: s.context }),
        ...(builders[0] && { agentId: builders[0] }),
        verified: s.codegen.status === "passed",
        ...(s.narrative && { description: s.narrative }),
        acceptanceCriteria: s.acceptanceCriteria.map((a) => ({ id: a.id, text: a.statement, covered: a.covered })),
        ...(s.dependsOn?.length && { dependsOn: s.dependsOn }),
        ...(q && { gates: [{ label: "Story quality gate", status: q.passed === null ? "unknown" : q.passed ? "done" : "blocked", detail: [...q.failures, ...q.warnings].join("; ") || undefined }] }),
        ...(s.codegen.rationale && { note: s.codegen.rationale }),
      };
    }),
    progressWeights: { steps: d.weights.stageWeight, workItems: d.weights.storyWeight },
    artifacts: d.artifacts.map((a) => ({ label: a.label, path: a.objectUri, stepKey: a.stageKey })),
    traceability: d.traceability.map((t) => ({ id: t.id, title: t.title, state: threadState(t, d) })),
    timeline: d.timeline.map((e) => ({
      at: e.ts,
      summary: e.summary,
      level: e.level,
      ...(roleIds.has(e.role) && { agentId: e.role }),
      ...(stageByKey.has(e.stage) && { phaseKey: stageByKey.get(e.stage).phase, stepKey: e.stage }),
    })),
    metrics,
    missing: d.meta.dataSource.missing.map((m) => ({ what: m.section, needs: m.needs })),
  };
}
