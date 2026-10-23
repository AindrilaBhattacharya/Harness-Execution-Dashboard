import { useState } from "react";
import type { HarnessRun, TimelineEvent } from "../model";
import { agentById } from "../lib/derive";
import { formatShort } from "../lib/format";
import { NoData } from "./StatsView";

const LEVEL_TAG: Record<TimelineEvent["level"], string> = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  info: "bg-blue-50 text-blue-700 ring-blue-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  error: "bg-rose-50 text-rose-700 ring-rose-200",
};
const LEVEL_DOT: Record<TimelineEvent["level"], string> = {
  success: "bg-emerald-500", info: "bg-blue-500", warning: "bg-amber-500", error: "bg-rose-500",
};

export function TimelineView({ run }: { run: HarnessRun }) {
  const [agent, setAgent] = useState("all");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const all = run.timeline ?? [];
  if (!all.length) return <NoData what="The event timeline" />;
  const tz = run.timezone ?? "UTC";
  const phaseLabel = (k?: string) => run.phases.find((p) => p.key === k)?.label;
  const stepLabel = (p?: string, s?: string) => run.phases.find((x) => x.key === p)?.steps.find((x) => x.key === s)?.label;
  const withEvents = run.agents.filter((a) => all.some((e) => e.agentId === a.id));
  const events = [...all]
    .filter((e) => agent === "all" || e.agentId === agent)
    .filter((e) => !issuesOnly || e.level === "warning" || e.level === "error")
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">
          <option value="all">All agents</option>
          {withEvents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-slate-600">
          <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Warnings &amp; errors only
        </label>
        <span className="ml-auto text-slate-400">{events.length} events</span>
      </div>
      <ol className="relative space-y-3 border-l-2 border-slate-200 pl-5">
        {events.map((e, i) => {
          const who = agentById(run, e.agentId);
          const where = [phaseLabel(e.phaseKey), stepLabel(e.phaseKey, e.stepKey)].filter(Boolean).join(" · ");
          return (
            <li key={`${e.at}-${i}`} className="relative">
              <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${LEVEL_DOT[e.level]}`} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span>{formatShort(e.at, tz)}</span>
                {where && <><span>·</span><span>{where}</span></>}
                <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ring-1 ${LEVEL_TAG[e.level]}`}>{e.level}</span>
              </div>
              <div className="mt-0.5 text-sm text-slate-800">
                {who && <><b className="text-slate-900">{who.name}</b> — </>}{e.summary}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
