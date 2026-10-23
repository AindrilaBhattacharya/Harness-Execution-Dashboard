// Live connector for the COBOL → Java harness: reads its control-plane API (FastAPI, Postgres +
// Neo4j behind it) and maps the run onto the dashboard's HarnessRun. Read-only: only GETs.
// It runs on the dashboard's server (see vite.config.ts), which sends the browser the result.
//
// Fixed facts (stage labels, phases, agent roles) come from cobol-harness-model.json, taken from
// the harness code (controlplane/stages.py, cost/tiering.py). Everything that changes comes from
// the API: stage rows, gates, the story build map, work units, job status and design outputs.
import model from "./cobol-harness-model.json";
import type { Artifact, Gate, HarnessRun, Metric, Phase, Status, Step, TimelineEvent, TraceThread, WorkItem } from "../model";

// ---- API shapes (only the fields read here) ----
interface ApiWorkspace { id: string; name: string; repo_slug: string; created_at: string }
interface ApiStage { id: string; stage_key: string; ordinal: number; status: string; updated_at: string }
interface ApiGate { stage_id: string; gate_key: string; status: string; threshold: unknown; result: unknown; updated_at: string }
interface ApiJob { status: string; error?: string | null; started_at?: string | null; finished_at?: string | null; result?: Record<string, unknown> | null }
interface ApiRun { role: string; model: string; status: string; started_at: string; input_tokens: number | null; output_tokens: number | null; total_cost_usd: number | null }
interface ApiStory {
  status: string; changed_files?: string[]; ac_covered?: string[]; rationale?: string;
  quality_gate?: { passed: boolean | null; score: number; failures?: string[] | null; warnings?: string[] | null };
}
interface ApiPlanItem { story_id: string; bounded_context: string; service_name: string; acceptance_criteria_ids: string[]; cobol_refs: string[]; depends_on: string[] }
interface ApiWorkUnit { stage: string; unit_type: string; unit_key: string; status: string; attempt: number; model: string; cost_usd: number; started_at: string | null; finished_at: string | null; error_cause: string | null; token_usage?: { input?: number; output?: number } | null }
interface ApiWorkUnits { total: number; counts: Record<string, number>; units: ApiWorkUnit[] }
interface ApiArtifact { kind: string; version: number; object_uri: string; created_at: string }

const STAGE: Record<string, Status> = { passed: "done", running: "active", pending: "pending", failed: "blocked", blocked: "blocked", incomplete: "blocked", waived: "skipped" };
const GATE: Record<string, Status> = { passed: "done", open: "pending", failed: "blocked", waived: "skipped" };
// codegen ACCEPTED_STORY_STATUSES: the build moves on past these.
const ACCEPTED = new Set(["passed", "generated-unverified", "skipped"]);
const STORY: Record<string, Status> = { passed: "done", "generated-unverified": "done", skipped: "done", running: "active", failed: "blocked", blocked: "blocked", deferred: "blocked", pending: "pending" };
// Stages whose work runs as a background job the API reports on.
const JOBS: Record<string, string> = { blueprint: "blueprint", backlog: "backlog", domain: "domain-design", design: "technical-design", build: "build", verify: "verify/status" };
const JOB_STATUS: Record<string, Status> = { running: "active", done: "done", failed: "blocked", incomplete: "blocked", partial: "blocked" };
// Role names the harness writes on agent runs and work-unit stages → its tiering roles.
const RUN_ROLE: Record<string, string> = { brd: "brd", backlog: "story", "story-codegen": "codegen", "domain-design": "design", "technical-design": "design", build: "codegen", "verify-repair": "repair" };
const UNIT_STAGE: Record<string, string> = { "domain-design": "domain", "technical-design": "design" };

const opt = <T,>(p: Promise<T>) => p.catch(() => undefined);

/** Scalar fields of a gate's JSON result, e.g. "weighted 4.1 · accuracy 3". */
function summarise(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object") return String(v);
  const parts = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => typeof x === "number" || typeof x === "string" || typeof x === "boolean")
    .slice(0, 4)
    .map(([k, x]) => `${k.replace(/_/g, " ")} ${typeof x === "number" ? +x.toFixed(3) : x}`);
  return parts.join(" · ") || undefined;
}

const titleOf = (id: string) => {
  const m = id.match(/^US-(N?FR)-(\d+)$/);
  return m ? `${m[1] === "FR" ? "Functional" : "Non-functional"} requirement ${m[2]}` : id;
};
const isTest = (f: string) => /Test\.java$/.test(f);

let artifactCache: { at: number; list: ApiArtifact[] } | undefined;

/**
 * @param api the harness API root, e.g. http://127.0.0.1:8005/api
 * @param workspaceId the workspace to show; the first one when not given
 */
export async function loadLiveRun(api: string, workspaceId?: string): Promise<HarnessRun> {
  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${api}${path}`, { cache: "no-store" });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) throw new Error(`${api}${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  const workspaces = await get<ApiWorkspace[]>("/workspaces");
  const ws = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  if (!ws) throw new Error("The harness has no workspace yet. Create one: POST /api/workspaces");
  const base = `/workspaces/${ws.id}`;

  // The artifact list is large (every version of every record); refresh it once a minute.
  const artifactsDue = !artifactCache || Date.now() - artifactCache.at > 60_000;
  const [stages, gates, runs, units, stories, plan, budget, artifactRows, ...jobs] = await Promise.all([
    get<ApiStage[]>(`${base}/stages`),
    get<ApiGate[]>(`${base}/gates`),
    opt(get<ApiRun[]>(`${base}/runs`)),
    opt(get<ApiWorkUnits>(`${base}/work-units`)),
    opt(get<{ stories: Record<string, ApiStory>; job?: ApiJob }>(`${base}/build/stories`)),
    opt(get<{ version: number; items: ApiPlanItem[] }>(`${base}/build/story-plan`)),
    opt(get<{ cap_usd: number; spent_usd: number }>(`${base}/budget`)),
    artifactsDue ? opt(get<ApiArtifact[]>(`${base}/artifacts`)) : Promise.resolve(artifactCache!.list),
    ...Object.values(JOBS).map((p) => opt(get<ApiJob>(`${base}/${p}`))),
  ]);
  if (artifactsDue && artifactRows) artifactCache = { at: Date.now(), list: artifactRows };
  const job = Object.fromEntries(Object.keys(JOBS).map((k, i) => [k, jobs[i]])) as Record<string, ApiJob | undefined>;
  // Builds run story by story as their own job, reported with the story map.
  if (stories?.job && stories.job.status !== "idle") job.build = stories.job;

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const row = new Map(stages.map((s) => [s.stage_key, s]));
  const storyMap = stories?.stories ?? {};
  const planItems = plan?.items ?? [];
  const roleIds = new Set(model.agentRoles.map((r) => r.role));
  const builders = (model.stages.find((s) => s.key === "build")?.roles ?? []).filter((r) => roleIds.has(r));

  // ---- steps ----
  const gatesOf = (key: string): Gate[] =>
    gates
      .filter((g) => stageById.get(g.stage_id)?.stage_key === key)
      .map((g) => ({ label: g.gate_key.replace(/_/g, " "), status: GATE[g.status] ?? "unknown", detail: summarise(g.result) }));

  const stageStep = (s: (typeof model.stages)[number]): Step => {
    const r = row.get(s.key);
    const j = JOBS[s.key] ? job[s.key] : undefined;
    // A job the harness ran since it started is the latest word on its stage: the stage row is only
    // ever set to "passed", so a failed job would otherwise read as passed. No job (idle) → the row.
    let status: Status = r ? STAGE[r.status] ?? "unknown" : "unknown";
    let raw = r?.status;
    if (j && JOB_STATUS[j.status]) [status, raw] = [JOB_STATUS[j.status], j.status === "done" ? r?.status ?? "done" : j.status];
    return {
      key: s.key,
      label: s.label,
      description: s.work,
      agentIds: s.roles.filter((x) => roleIds.has(x)),
      status,
      rawStatus: raw,
      provenance: "observed",
      ...(raw === "incomplete" && { note: "ran, but its quality gate did not pass" }),
      ...(j?.error && { note: j.error }),
      output: s.output,
      optional: s.key === "explore" || undefined,
      ...(j?.started_at && { startedAt: j.started_at }),
      ...(j?.finished_at && { finishedAt: j.finished_at }),
      gates: gatesOf(s.key),
    };
  };

  // Stories are the Build stage's work items, not steps: the harness has no stage per story.
  const ordered = [...planItems.map((p) => p.story_id), ...Object.keys(storyMap).filter((id) => !planItems.some((p) => p.story_id === id))];

  const phases: Phase[] = model.phases.map((p) => ({
    key: p.key,
    label: p.label,
    summary: p.summary,
    steps: p.stageKeys.map((k) => model.stages.find((s) => s.key === k)!).map(stageStep),
  }));
  const steps = phases.flatMap((p) => p.steps.map((s) => ({ phase: p, step: s })));

  // ---- where the run is: a running job, else the first stage that has not passed ----
  const running = steps.find(({ step }) => step.status === "active");
  const nowStory = Object.entries(storyMap).find(([, s]) => s.status === "running")?.[0];
  const firstOpen = steps.find(({ step }) => !step.optional && step.status !== "done");
  const position: HarnessRun["position"] = running
    ? {
        state: "running",
        phaseKey: running.phase.key,
        stepKey: running.step.key,
        ...(running.step.agentIds.length === 1 && { agentId: running.step.agentIds[0] }),
        ...(nowStory && { workItemId: nowStory }),
        summary: `${running.step.label} is running in the harness${nowStory ? `, on ${nowStory}` : ""}.`,
        ...(running.step.startedAt && { since: running.step.startedAt }),
      }
    : firstOpen
      ? { state: "paused", phaseKey: firstOpen.phase.key, stepKey: firstOpen.step.key, summary: `Nothing is running. First stage not passed: ${firstOpen.step.label} (${firstOpen.step.rawStatus ?? firstOpen.step.status}).` }
      : { state: "finished", summary: "Every stage has passed." };

  // ---- work items, traceability ----
  const workItems: WorkItem[] = ordered.map((id) => {
    const st = storyMap[id];
    const p = planItems.find((x) => x.story_id === id);
    const q = st?.quality_gate;
    return {
      id,
      title: titleOf(id),
      status: st ? STORY[st.status] ?? "unknown" : "pending",
      rawStatus: st?.status ?? "not built",
      group: p?.bounded_context || undefined,
      ...(builders[0] && { agentId: builders[0] }),
      verified: st?.status === "passed",
      // Coverage is known once the story was built: ac_covered lists the criteria its tests cite.
      ...(p?.acceptance_criteria_ids.length && { acceptanceCriteria: p.acceptance_criteria_ids.map((ac) => ({ id: ac, ...(st?.ac_covered && { covered: st.ac_covered.includes(ac) }) })) }),
      ...(p?.depends_on.length && { dependsOn: p.depends_on }),
      ...(q && {
        gates: [{
          label: "Story quality gate",
          status: q.passed === null ? "unknown" : q.passed ? "done" : "blocked",
          detail: [...(q.failures ?? []), ...(q.warnings ?? [])].join("; ") || `score ${Math.round(q.score * 100)}%`,
        }],
      }),
      ...(st?.rationale && { note: st.rationale }),
    };
  });
  const traceability: TraceThread[] = planItems.map((p) => {
    const st = storyMap[p.story_id];
    const files = st?.changed_files ?? [];
    const state: TraceThread["state"] = !st
      ? "broken"
      : p.cobol_refs.length === 0
        ? "no_evidence"
        : ACCEPTED.has(st.status) && files.some((f) => !isTest(f)) && files.some(isTest)
          ? "complete"
          : "in_progress";
    return { id: p.story_id.replace(/^US-/, ""), title: titleOf(p.story_id), state };
  });

  // ---- artifacts: the latest version of each output ----
  const latest = new Map<string, ApiArtifact>();
  for (const a of artifactCache?.list ?? []) if ((latest.get(a.kind)?.version ?? -1) < a.version) latest.set(a.kind, a);
  const designs: [string, string, ApiJob | undefined][] = [["BRD", "blueprint", job.blueprint], ["Backlog", "backlog", job.backlog], ["Domain design", "domain", job.domain], ["Technical design", "design", job.design]];
  const artifacts: Artifact[] = [
    ...designs.filter(([, , j]) => j?.result?.version).map(([label, stepKey, j]) => ({ label: `${label} v${j!.result!.version}`, stepKey })),
    ...(plan ? [{ label: `Story plan v${plan.version}`, stepKey: "plan" }] : []),
    ...[...latest.values()].filter((a) => a.kind !== "brd").map((a) => ({ label: `${a.kind.replace(/_/g, " ")} v${a.version}`, path: a.object_uri, stepKey: "build" })),
  ];

  // ---- timeline: work units and agent runs, the harness's own records ----
  const roleOf = (r: string) => (roleIds.has(RUN_ROLE[r] ?? r) ? RUN_ROLE[r] ?? r : undefined);
  const stageOf = (s: string) => UNIT_STAGE[s] ?? s;
  const phaseOf = (k: string) => model.stages.find((s) => s.key === k)?.phase;
  const timeline: TimelineEvent[] = [
    ...(units?.units ?? []).map((u) => ({
      at: u.finished_at ?? u.started_at ?? ws.created_at,
      summary: `${u.unit_type} ${u.unit_key}: ${u.status}${u.attempt > 1 ? ` (attempt ${u.attempt})` : ""}${u.error_cause ? ` — ${u.error_cause}` : ""}`,
      level: (u.status === "failed" ? "error" : u.status === "deferred" ? "warning" : u.status === "succeeded" ? "success" : "info") as TimelineEvent["level"],
      ...(roleOf(u.stage) && { agentId: roleOf(u.stage) }),
      ...(phaseOf(stageOf(u.stage)) && { phaseKey: phaseOf(stageOf(u.stage)), stepKey: stageOf(u.stage) }),
    })),
    ...(runs ?? []).map((r) => ({
      at: r.started_at,
      summary: `${r.role} run started on ${r.model}`,
      level: "info" as const,
      ...(roleOf(r.role) && { agentId: roleOf(r.role) }),
    })),
  ];

  // ---- agents: roles from the harness, usage from its runs ----
  const usage = new Map<string, { runs: number; tokens: number; costUsd: number }>();
  for (const r of runs ?? []) {
    const id = roleOf(r.role);
    if (!id) continue;
    const u = usage.get(id) ?? { runs: 0, tokens: 0, costUsd: 0 };
    usage.set(id, { runs: u.runs + 1, tokens: u.tokens + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), costUsd: u.costUsd + (r.total_cost_usd ?? 0) });
  }

  // ---- harness-specific numbers ----
  const r = (j?: ApiJob) => (j?.result ?? {}) as Record<string, unknown>;
  const count = (st: string) => Object.values(storyMap).filter((s) => s.status === st).length;
  const tokens = (units?.units ?? []).reduce((n, u) => n + (u.token_usage?.input ?? 0) + (u.token_usage?.output ?? 0), 0);
  const metrics: Metric[] = [
    { group: "Design outputs", label: "BRD", value: job.blueprint?.result ? `v${r(job.blueprint).version} · rated ${r(job.blueprint).rating}` : "not generated" },
    { group: "Design outputs", label: "Backlog", value: job.backlog?.result ? `v${r(job.backlog).version} · ${r(job.backlog).epics} epics · ${r(job.backlog).stories} stories` : "not generated" },
    { group: "Design outputs", label: "BRD logic coverage", value: typeof r(job.backlog).coverage_ratio === "number" ? `${((r(job.backlog).coverage_ratio as number) * 100).toFixed(1)}%` : "—", tone: (r(job.backlog).coverage_ratio as number) < 0.5 ? "bad" : undefined },
    { group: "Design outputs", label: "Domain design", value: job.domain?.result ? `v${r(job.domain).version} · ${job.domain.status}` : "not generated", tone: job.domain?.status === "incomplete" ? "bad" : undefined },
    { group: "Design outputs", label: "Bounded contexts", value: Array.isArray(r(job.domain).contexts) ? (r(job.domain).contexts as unknown[]).length : "—" },
    { group: "Design outputs", label: "Technical design", value: job.design?.result ? `v${r(job.design).version} · ${r(job.design).services} services · ${job.design.status}` : "not generated", tone: job.design?.status === "incomplete" ? "bad" : undefined },
    ...["passed", "generated-unverified", "running", "failed", "deferred", "pending"].filter(count).map((st) => ({
      group: "Build: stories by status", label: st, value: count(st), ...(st === "passed" && { tone: "good" as const }), ...((st === "failed" || st === "deferred") && { tone: "bad" as const }),
    })),
    ...Object.entries(units?.counts ?? {}).map(([st, n]) => ({ group: "Work units", label: st, value: n, ...(st === "failed" && { tone: "bad" as const }) })),
    { group: "Work units", label: "Tokens", value: tokens.toLocaleString("en-US") },
    ...(budget ? [{ group: "Budget", label: "Recorded spend", value: `$${budget.spent_usd.toFixed(2)} / $${budget.cap_usd.toFixed(2)}`, hint: "the harness does not record spend yet" }] : []),
  ];

  const staleUnits = (units?.units ?? []).filter((u) => u.status === "running").length;
  const staleRuns = (runs ?? []).filter((x) => x.status === "running").length;
  return {
    schemaVersion: 1,
    harness: {
      id: "cobol-java",
      name: model.harnessName,
      tagline: model.harnessTagline,
      traits: [{ label: "Method", value: "Graph-first harness lifecycle" }, { label: "Source", value: "COBOL" }, { label: "Target", value: "Java / Spring Boot" }],
      workItemLabel: "Stories",
    },
    project: { name: ws.name, path: ws.repo_slug },
    importedAt: new Date().toISOString(),
    live: { api, workspace: ws.id, refreshedAt: new Date().toISOString() },
    phases,
    agents: model.agentRoles.map((a) => ({
      id: a.role,
      name: a.label,
      role: `${a.tier[0].toUpperCase()}${a.tier.slice(1)} tier`,
      description: a.description,
      model: a.model,
      ...(usage.has(a.role) && { usage: usage.get(a.role) }),
    })),
    position,
    workItems,
    progressWeights: { steps: model.weights.stageWeight, workItems: model.weights.storyWeight },
    artifacts,
    traceability,
    timeline,
    metrics,
    missing: [
      { what: "Approvals", needs: "an API endpoint to read them (the harness only has POST /gates/{id}/approval)" },
      { what: "Agent-run completion", needs: `the harness to close agent runs; ${staleRuns} still read "running"` },
      ...(staleUnits ? [{ what: "Work-unit completion", needs: `the harness to close interrupted work units; ${staleUnits} still read "running"` }] : []),
      { what: "Spend", needs: "the harness to record run usage in its budget (record_run_usage has no callers)" },
      { what: "Epics, story titles and story text", needs: "a JSON endpoint for the backlog (it is only served as HTML; GET /backlog gives counts)" },
      { what: "Gates for parse, graph, code and equivalence", needs: "the pipeline to write them; only their stage rows are recorded" },
    ],
  };
}
