// Phases left to right, then every phase with its steps, the agents who own each step, its
// output and gate. The step the run is on is highlighted.
import { ArrowRight, Loader2 } from "lucide-react";
import type { HarnessRun, Step } from "../model";
import { agentById, agentState, AGENT_STATE, display, phaseLabel, phaseProgress, phaseStatus } from "../lib/derive";
import { formatShort } from "../lib/format";
import { AgentAvatar } from "../components/Shell";
import { Badge, Dot, ProgressBar, StatusPill, SubCard } from "../components/ui";

const PROVENANCE_BADGE = { derived: "derived from files", inferred: "inferred" } as const;

export function ExecutionView({ run }: { run: HarnessRun }) {
  return (
    <div className="space-y-4">
      {/* Phase rail */}
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${run.phases.length}, minmax(0, 1fr))` }}>
        {run.phases.map((p, i) => {
          const status = phaseStatus(p);
          const prog = phaseProgress(p);
          const here = run.position.phaseKey === p.key;
          return (
            <li key={p.key} className={`relative rounded-xl border bg-white px-3 py-2.5 ${here ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Phase {i + 1}</span>
                <StatusPill status={status} label={phaseLabel(status)} />
              </div>
              <div className="mt-0.5 truncate text-sm font-bold text-slate-900" title={p.label}>{p.label}</div>
              <ProgressBar value={prog.pct} className="mt-2 h-1.5" />
              <div className="mt-1 text-[11px] text-slate-500">{prog.done}/{prog.total} steps</div>
              {i < run.phases.length - 1 && <ArrowRight className="absolute -right-[14px] top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-slate-300 md:block" />}
            </li>
          );
        })}
      </ol>

      {run.phases.map((p, i) => {
        const status = phaseStatus(p);
        const prog = phaseProgress(p);
        return (
          <SubCard key={p.key} className={run.position.phaseKey === p.key ? "border-blue-200" : ""}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">Phase {i + 1} · {p.label}</h3>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                {prog.done}/{prog.total} steps <StatusPill status={status} label={phaseLabel(status)} />
              </span>
            </div>
            {p.summary && <p className="mt-1 text-xs text-slate-500">{p.summary}</p>}
            <ProgressBar value={prog.pct} className="mt-2 h-1.5" />
            <div className="mt-3 divide-y divide-slate-100">
              {p.steps.map((s) => (
                <StepRow key={s.key} run={run} step={s} current={run.position.phaseKey === p.key && run.position.stepKey === s.key} />
              ))}
            </div>
          </SubCard>
        );
      })}
    </div>
  );
}

function StepRow({ run, step, current }: { run: HarnessRun; step: Step; current: boolean }) {
  const tz = run.timezone ?? "UTC";
  const agents = step.agentIds.map((id) => agentById(run, id)).filter((a) => a !== undefined);
  return (
    <div className={`grid gap-2 py-2.5 text-xs xl:grid-cols-[220px_1fr_240px] xl:items-start ${current ? "-mx-2 rounded-lg bg-blue-50/60 px-2" : ""}`}>
      <div className="flex items-center gap-2">
        {current && run.position.state === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> : <Dot status={display(step.status)} />}
        <span className={`font-semibold text-slate-800 ${step.optional ? "italic" : ""}`}>{step.label}</span>
        {step.optional && <Badge>optional</Badge>}
        {current && <Badge tone="blue">now</Badge>}
      </div>

      <div className="min-w-0 space-y-1">
        {step.description && <div className="text-slate-600">{step.description}</div>}
        <div className="flex flex-wrap items-center gap-1.5">
          {agents.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2 text-[11px] font-semibold text-slate-700">
              <AgentAvatar agent={a} status={AGENT_STATE[agentState(run, a)].status} size="sm" /> {a.name}
              <span className="font-normal text-slate-400">{a.role}</span>
            </span>
          ))}
          {step.output && <span className="text-slate-500"><span className="text-slate-400">out</span> <span className="font-medium text-slate-700">{step.output}</span></span>}
        </div>
        {step.note && <div className="italic text-amber-700">{step.note}</div>}
      </div>

      <div className="space-y-1 xl:text-right">
        <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
          <StatusPill status={display(step.status)} label={step.rawStatus ?? step.status} />
          {step.provenance && step.provenance !== "observed" && <Badge title="Not recorded by the harness">{PROVENANCE_BADGE[step.provenance]}</Badge>}
        </div>
        {(step.gates ?? []).map((g) => (
          <div key={g.label}>
            <div className="flex items-center gap-1.5 xl:justify-end">
              <span className="text-slate-400">Gate</span>
              <span className="font-medium text-slate-700">{g.label}</span>
              <StatusPill status={display(g.status)} label={g.status} />
            </div>
            {g.approval ? (
              <div className={g.approval.decision === "approved" ? "text-emerald-700" : "text-rose-700"}>
                {g.approval.decision === "approved" ? "Approved" : "Rejected"} — {g.approval.role ?? g.approval.by}{g.approval.at && ` (${formatShort(g.approval.at, tz)})`}
              </div>
            ) : (
              g.detail && <div className="text-slate-400">{g.detail}</div>
            )}
          </div>
        ))}
        {(step.startedAt || step.finishedAt) && (
          <div className="text-slate-400">
            {step.startedAt ? `${formatShort(step.startedAt, tz)} → ${step.finishedAt ? formatShort(step.finishedAt, tz) : "…"}` : `finished ${formatShort(step.finishedAt, tz)}`}
          </div>
        )}
      </div>
    </div>
  );
}
