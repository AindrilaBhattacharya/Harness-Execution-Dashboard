// Every agent: who it is, what it is doing now and which phases it works in; then an
// agent × phase matrix showing where each agent's steps sit and where the run is.
import type { Agent, HarnessRun, Status } from "../model";
import { AGENT_STATE, agentState, display, phasesOf, stepsOf } from "../lib/derive";
import { fmtTokens } from "../lib/format";
import { AgentAvatar } from "../components/Shell";
import { Badge, Dot, SectionTitle, StatusPill, SubCard } from "../components/ui";

export function AgentsView({ run }: { run: HarnessRun }) {
  const order: Record<string, number> = { working: 0, blocked: 1, between: 2, waiting: 3, unknown: 4, done: 5 };
  const agents = [...run.agents].sort((a, b) => order[agentState(run, a)] - order[agentState(run, b)]);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => <AgentCard key={a.id} run={run} agent={a} />)}
      </div>
      <SubCard>
        <SectionTitle right={<span className="text-[11px] text-slate-400">steps each agent owns, per phase · the current phase is highlighted</span>}>
          Agents × phases
        </SectionTitle>
        <Matrix run={run} />
      </SubCard>
    </div>
  );
}

function AgentCard({ run, agent }: { run: HarnessRun; agent: Agent }) {
  const state = agentState(run, agent);
  const s = AGENT_STATE[state];
  const steps = stepsOf(run, agent.id);
  const now = steps.find(({ phase, step }) => step.status === "active" || (run.position.agentId === agent.id && run.position.phaseKey === phase.key && run.position.stepKey === step.key));
  const next = steps.find(({ step }) => step.status === "pending" && !step.optional) ?? steps.find(({ step }) => step.status === "pending");
  const done = steps.filter(({ step }) => step.status === "done" || step.status === "skipped").length;
  const u = agent.usage;
  return (
    <SubCard className={state === "working" ? "border-blue-300 ring-2 ring-blue-100" : state === "blocked" ? "border-rose-200" : ""}>
      <div className="flex items-start gap-3">
        <AgentAvatar agent={agent} status={s.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold text-slate-900">{agent.name}</span>
            <StatusPill status={s.status} label={s.label} />
          </div>
          <div className="text-xs text-slate-500">{agent.role}</div>
        </div>
      </div>
      {agent.description && <p className="mt-2 text-xs text-slate-600">{agent.description}</p>}

      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
        {now ? (
          <><span className="text-slate-400">Now </span><b className="text-slate-800">{now.step.label}</b> <span className="text-slate-400">in {now.phase.label}</span></>
        ) : next ? (
          <><span className="text-slate-400">{next.step.optional ? "Optional next " : "Next "}</span><span className="font-semibold text-slate-700">{next.step.label}</span> <span className="text-slate-400">in {next.phase.label}</span></>
        ) : (
          <span className="text-slate-400">
            {!steps.length ? "Owns no steps" : steps.some(({ step }) => step.status === "unknown") ? "Status of its steps not recorded" : "Nothing left to do"}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {phasesOf(run, agent.id).map((p) => <Badge key={p.key} tone={run.position.phaseKey === p.key ? "blue" : "slate"}>{p.label}</Badge>)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>{done}/{steps.length} steps done</span>
        {agent.model && <span className="font-mono">{agent.model}</span>}
        {u?.runs !== undefined && <span>{u.runs} runs</span>}
        {u?.tokens !== undefined && <span>{fmtTokens(u.tokens)} tokens</span>}
        {u?.costUsd !== undefined && <span className="font-semibold text-slate-700">${u.costUsd.toFixed(2)}</span>}
      </div>
    </SubCard>
  );
}

/** Worst-first summary of several step statuses, for one matrix cell. */
function cellStatus(st: Status[]): Status {
  for (const s of ["blocked", "active", "unknown", "pending"] as const) if (st.includes(s)) return s === "pending" && st.some((x) => x === "done" || x === "skipped") ? "active" : s;
  return "done";
}

function Matrix({ run }: { run: HarnessRun }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="py-2 pr-3">Agent</th>
            {run.phases.map((p, i) => (
              <th key={p.key} className={`px-2 py-2 text-center ${run.position.phaseKey === p.key ? "bg-blue-50 text-blue-700" : ""}`}>
                P{i + 1} · {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {run.agents.map((a) => (
            <tr key={a.id}>
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <AgentAvatar agent={a} status={AGENT_STATE[agentState(run, a)].status} size="sm" />
                  <span className="font-semibold text-slate-800">{a.name}</span>
                  <span className="text-slate-400">{a.role}</span>
                </span>
              </td>
              {run.phases.map((p) => {
                const steps = p.steps.filter((s) => s.agentIds.includes(a.id));
                const here = run.position.phaseKey === p.key;
                return (
                  <td key={p.key} className={`px-2 py-2 text-center ${here ? "bg-blue-50/60" : ""}`} title={steps.map((s) => `${s.label}: ${s.rawStatus ?? s.status}`).join("\n")}>
                    {steps.length ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                        <Dot status={display(cellStatus(steps.map((s) => s.status)))} /> {steps.length}
                      </span>
                    ) : (
                      <span className="text-slate-300">·</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
