// Everything the dashboard works out from a HarnessRun: progress, phase status and what each
// agent is doing. Nothing here knows which harness produced the run.
import type { Agent, Epic, HarnessRun, Phase, Status, Step, WorkItem } from "../model";

/** "unknown" = happened, but its recorded status is not in the input. */
export type DisplayStatus = "completed" | "in_progress" | "pending" | "blocked" | "unknown";

const DISPLAY: Record<Status, DisplayStatus> = {
  done: "completed",
  skipped: "completed",
  active: "in_progress",
  pending: "pending",
  blocked: "blocked",
  unknown: "unknown",
};
export const display = (s: Status) => DISPLAY[s];

const finished = (s: Status) => s === "done" || s === "skipped";

/** Steps that count towards progress: an optional step nobody ran does not hold anything open. */
const counted = (steps: Step[]) => steps.filter((s) => !(s.optional && s.status === "pending"));

export function phaseProgress(phase: Phase): { done: number; total: number; pct: number } {
  const steps = counted(phase.steps);
  const done = steps.filter((s) => finished(s.status)).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

export const phaseStatus = (phase: Phase) => combined(counted(phase.steps).map((s) => s.status));

/** The epic's own status when the harness records one, else its work items' combined. */
export const epicStatus = (epic: Epic, items: WorkItem[]) => (epic.status ? display(epic.status) : combined(items.map((w) => w.status)));

function combined(st: Status[]): DisplayStatus {
  if (st.length > 0 && st.every(finished)) return "completed";
  if (st.includes("blocked")) return "blocked";
  if (st.includes("active")) return "in_progress";
  // Every step is finished or not recorded: say exactly that, not "in progress".
  if (st.length > 0 && st.every((s) => finished(s) || s === "unknown")) return "unknown";
  if (st.some((s) => finished(s) || s === "unknown")) return "in_progress";
  return "pending";
}

/** Pill label for a phase whose steps are partly unrecorded. */
export const phaseLabel = (s: DisplayStatus) => (s === "unknown" ? "partly recorded" : undefined);

/** Steps that are stages, not the per-work-item steps of a build phase. */
export const stageSteps = (run: HarnessRun) => run.phases.flatMap((p) => p.steps.filter((s) => !s.workItemId));

const share = (n: number, d: number) => (d ? n / d : 0);

/** Overall, 0..100: stage steps done and work items verified, weighted as the harness says. */
export function overallProgress(run: HarnessRun): number {
  const stages = stageSteps(run);
  const items = run.workItems ?? [];
  const w = run.progressWeights ?? { steps: 1, workItems: 0 };
  return Math.round(
    (w.steps * share(stages.filter((s) => s.status === "done").length, stages.length) +
      w.workItems * share(items.filter((i) => i.verified).length, items.length)) * 100,
  );
}

/** The top tiles. Undefined = the harness does not record that kind of thing. */
export interface Kpis {
  overall: number;
  stagesDone: number;
  stagesTotal: number;
  gatesPassed: number;
  gatesTotal: number;
  itemsVerified: number;
  itemsDone: number;
  itemsTotal: number;
  artifacts?: number;
  approvals: number;
  lineageLinked?: number;
  lineageTotal?: number;
  brokenLinks?: number;
}

export function computeKpis(run: HarnessRun): Kpis {
  const stages = stageSteps(run);
  const gates = stages.flatMap((s) => s.gates ?? []);
  const items = run.workItems ?? [];
  const threads = run.traceability;
  return {
    overall: overallProgress(run),
    stagesDone: stages.filter((s) => s.status === "done").length,
    stagesTotal: stages.length,
    gatesPassed: gates.filter((g) => g.status === "done").length,
    gatesTotal: gates.length,
    itemsVerified: items.filter((i) => i.verified).length,
    itemsDone: items.filter((i) => i.status === "done").length,
    itemsTotal: items.length,
    artifacts: run.artifacts?.length,
    approvals: gates.filter((g) => g.approval).length,
    ...(threads && {
      lineageLinked: threads.filter((t) => t.state === "complete" || t.state === "in_progress").length,
      lineageTotal: threads.length,
      brokenLinks: threads.filter((t) => t.state === "broken").length,
    }),
  };
}

export function currentPhase(run: HarnessRun): Phase | undefined {
  return run.phases.find((p) => p.key === run.position.phaseKey);
}

export function currentStep(run: HarnessRun): Step | undefined {
  return currentPhase(run)?.steps.find((s) => s.key === run.position.stepKey);
}

export const stepsOf = (run: HarnessRun, agentId: string) =>
  run.phases.flatMap((p) => p.steps.filter((s) => s.agentIds.includes(agentId)).map((step) => ({ phase: p, step })));

export const phasesOf = (run: HarnessRun, agentId: string) =>
  run.phases.filter((p) => p.steps.some((s) => s.agentIds.includes(agentId)));

export type AgentState = "working" | "blocked" | "done" | "between" | "waiting" | "unknown";

export const AGENT_STATE: Record<AgentState, { label: string; status: DisplayStatus }> = {
  working: { label: "working", status: "in_progress" },
  blocked: { label: "blocked", status: "blocked" },
  done: { label: "all steps done", status: "completed" },
  between: { label: "between steps", status: "pending" },
  waiting: { label: "not started", status: "pending" },
  unknown: { label: "not recorded", status: "unknown" },
};

/** What an agent is doing, from the steps it owns and the run's current position. Optional steps nobody ran do not count. */
export function agentState(run: HarnessRun, agent: Agent): AgentState {
  const st = counted(stepsOf(run, agent.id).map(({ step }) => step)).map((s) => s.status);
  const running = run.position.state === "running" || run.position.state === "paused";
  if ((running && run.position.agentId === agent.id) || st.includes("active")) return "working";
  if (st.includes("blocked")) return "blocked";
  if (st.length > 0 && st.every(finished)) return "done";
  if (st.length > 0 && st.every((s) => s === "unknown")) return "unknown";
  if (st.some(finished)) return "between";
  return "waiting";
}

export function agentById(run: HarnessRun, id?: string): Agent | undefined {
  return id ? run.agents.find((a) => a.id === id) : undefined;
}
