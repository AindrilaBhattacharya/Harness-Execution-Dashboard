// The frame around every view: sidebar, header chips, data banner, KPI tiles, the "now" card
// and the tab bar. Same look as the Forward Engineering Dashboard.
import { useState, type ReactNode } from "react";
import { Braces, ChevronDown, Database, FileDown, FlaskConical, Loader2, Workflow } from "lucide-react";
import type { Agent, HarnessRun } from "../model";
import {
  AGENT_STATE, agentById, agentState, computeKpis, currentPhase, currentStep, display, overallProgress, phaseLabel, phaseProgress, phaseStatus, stageSteps,
} from "../lib/derive";
import { formatDateTime, timeAgo } from "../lib/format";
import type { SampleRef } from "../lib/useRun";
import { STATUS_DOT, StatusPill } from "./ui";

export function Sidebar({ run }: { run: HarnessRun }) {
  const [open, setOpen] = useState(false);
  const overall = overallProgress(run);
  return (
    <aside className="flex w-full flex-col gap-4 bg-[#1e2536] px-4 py-5 text-slate-200 lg:sticky lg:top-0 lg:h-screen lg:w-[290px] lg:shrink-0 lg:overflow-y-auto">
      {/* Harness identity */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/90 text-white shadow">
          <Workflow className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-bold leading-tight text-white">{run.harness.name}</div>
          {run.harness.tagline && <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{run.harness.tagline}</div>}
        </div>
      </div>

      <div className="text-xs leading-snug text-slate-300">
        Project <span className="font-semibold text-white">{run.project.name}</span>
        {run.project.path && <span className="block font-mono text-[11px] text-slate-400">{run.project.path}</span>}
      </div>

      {run.harness.traits && run.harness.traits.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          {run.harness.traits.map((t) => (
            <div key={t.label} className="contents">
              <dt className="text-slate-400">{t.label}</dt>
              <dd className="font-semibold text-white">{t.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Overall progress */}
      <div>
        <div className="mb-1 text-[11px] text-slate-400">Overall progress</div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
          <div className="h-full rounded-full bg-blue-400" style={{ width: `${overall}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          {overall}% · {run.progressWeights
            ? `Stages ${Math.round(run.progressWeights.steps * 100)}% + ${run.harness.workItemLabel ?? "Work items"} ${Math.round(run.progressWeights.workItems * 100)}%`
            : `${stageSteps(run).filter((s) => s.status === "done").length} / ${stageSteps(run).length} stages done`}
        </div>
      </div>

      {/* Phase cards: always shown on desktop, collapsible on small screens */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="no-print flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 lg:hidden"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} phases &amp; steps
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <nav className={`${open ? "flex" : "hidden"} flex-col gap-3 lg:flex print:flex`}>
        {run.phases.map((p, i) => {
          const status = phaseStatus(p);
          const prog = phaseProgress(p);
          const agents = [...new Set(p.steps.flatMap((s) => s.agentIds))].map((id) => agentById(run, id)?.name ?? id);
          const here = run.position.phaseKey === p.key;
          return (
            <div key={p.key} className={`rounded-xl border p-3 ${here ? "border-blue-500/40 bg-[#262f44]" : "border-white/5 bg-[#262e40]"}`}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate whitespace-nowrap text-[13px] font-bold text-white">P{i + 1} · {p.label}</span>
                <StatusPill status={status} tone="solid" label={phaseLabel(status)} />
              </div>
              <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-400">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-700">
                  <div className="h-full rounded-full bg-emerald-400" style={{ width: `${prog.pct}%` }} />
                </div>
                {prog.done}/{prog.total}
              </div>
              <ul className="flex flex-col gap-0.5 rounded-lg bg-black/15 p-1.5">
                {p.steps.map((s) => {
                  const current = here && run.position.stepKey === s.key;
                  return (
                    <li
                      key={s.key}
                      title={`${s.label}: ${s.rawStatus ?? s.status}`}
                      className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-xs ${current ? "bg-blue-500/20 text-white" : "text-slate-300 hover:bg-white/5"}`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[display(s.status)]}`} />
                      <span className={`font-medium ${s.optional ? "italic" : ""}`}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
              {agents.length > 0 && <div className="mt-2 text-[11px] leading-snug text-slate-400">Agents — {agents.join(" · ")}</div>}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function Chip({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <span
      title={typeof children === "string" ? children : undefined}
      className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs shadow-sm"
    >
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 truncate font-semibold text-slate-800 ${mono ? "font-mono text-[11px]" : ""}`}>{children}</span>
    </span>
  );
}

export function HeaderBar({ run, now }: { run: HarnessRun; now: Date }) {
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.project.name}-harness-run.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const btn = "no-print inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50";
  return (
    <header className="flex flex-wrap items-center gap-2">
      <Chip label="Harness">{run.harness.name}</Chip>
      <Chip label="Project">{run.project.name}</Chip>
      {run.harness.traits?.map((t) => <Chip key={t.label} label={t.label}>{t.value}</Chip>)}
      <Chip label="Times in">{run.timezone ?? "UTC"}</Chip>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        Live · updated {timeAgo(run.importedAt, now)}
      </span>
      <button onClick={() => window.print()} className={btn}><FileDown className="h-3.5 w-3.5" /> Export PDF</button>
      <button onClick={downloadJson} className={btn}><Braces className="h-3.5 w-3.5" /> JSON</button>
    </header>
  );
}

/** States plainly whether this is sample or imported data, and what the input did not contain. */
export function DataBanner({ run, samples, sampleKey, fellBackToSample, liveError }: { run: HarnessRun; samples: SampleRef[]; sampleKey?: string; fellBackToSample: boolean; liveError?: string }) {
  const [open, setOpen] = useState(false);
  const missing = run.missing ?? [];
  const switcher = (
    <span className="no-print ml-auto flex flex-wrap items-center gap-1.5">
      {samples.map((s) => (
        <a key={s.key} href={`?data=${s.key}`} className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${s.key === sampleKey ? "bg-white ring-current" : "ring-transparent hover:underline"}`}>
          {s.label}
        </a>
      ))}
      {sampleKey && <a href="./" className="font-semibold underline">{run.live ? "Live harness" : "Imported run"}</a>}
    </span>
  );
  // Shown when the live harness was tried and did not answer, so the page fell back to a file.
  const offline = liveError && (
    <div className="mt-1 text-[11px] opacity-80">Live harness not reachable ({liveError}), so this is read from a file.</div>
  );

  if (run.sample) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        <div className="flex flex-wrap items-center gap-2">
          <FlaskConical className="h-4 w-4" />
          <b>Sample data.</b>
          {fellBackToSample ? "No imported run found, so an illustrative sample is shown." : "Illustrative only."}
          {switcher}
        </div>
        {offline}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-950">
      <div className="flex flex-wrap items-center gap-2">
        {run.live ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" /> : <Database className="h-4 w-4 text-emerald-700" />}
        <b>{run.live ? "Live harness" : "Imported run"}</b>
        {run.live ? (
          <span>
            read from the harness API (<code className="font-mono">{run.live.api}</code>), workspace <code className="font-mono">{run.project.name}</code>, every 5 seconds.
          </span>
        ) : (
          <span>
            {run.project.path && <>from <code className="font-mono">{run.project.path}</code>, </>}imported {formatDateTime(run.importedAt, run.timezone ?? "UTC")}.
          </span>
        )}
        {missing.length > 0 && (
          <button onClick={() => setOpen((v) => !v)} className="no-print inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline" aria-expanded={open}>
            {missing.length} things not in this input <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
        {switcher}
      </div>
      {offline}
      {open && (
        <ul className="mt-2 grid gap-1 border-t border-emerald-200 pt-2 sm:grid-cols-2">
          {missing.map((m) => (
            <li key={m.what}><b>{m.what}</b> <span className="text-emerald-800">needs {m.needs}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tile({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" title={hint}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

/** The Forward Engineering Dashboard's eight tiles. "—" = the harness does not record that kind of thing. */
export function KpiTiles({ run }: { run: HarnessRun }) {
  const k = computeKpis(run);
  const noun = run.harness.workItemLabel ?? "Work items";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Tile label="Overall" value={`${k.overall}%`} />
      <Tile label="Stages" value={`${k.stagesDone} / ${k.stagesTotal}`} hint="Journey stages passed" />
      <Tile label="Gates" value={`${k.gatesPassed} / ${k.gatesTotal}`} hint="Hard gates passed" />
      <Tile label={`${noun} verified`} value={`${k.itemsVerified} / ${k.itemsTotal}`} hint={`Verified = tests ran green. ${k.itemsDone} done as far as the harness is concerned.`} />
      <Tile label="Artifacts" value={k.artifacts ?? "—"} />
      <Tile label="Approvals" value={k.approvals} hint="Attributed gate approvals" />
      <Tile label="Lineage" value={k.lineageTotal === undefined ? "—" : `${k.lineageLinked}/${k.lineageTotal}`} hint="Requirement threads linked to source evidence and work items" />
      <Tile label="Broken links" value={k.brokenLinks ?? "—"} tone={k.brokenLinks === undefined ? "default" : k.brokenLinks === 0 ? "good" : "bad"} />
    </div>
  );
}

const POSITION_LABEL: Record<HarnessRun["position"]["state"], string> = {
  not_started: "Not started",
  running: "Running",
  paused: "Paused",
  blocked: "Blocked",
  finished: "Finished",
  unknown: "Position not recorded",
};

/** Where the run is now: phase, step, the agent doing it, and what it is working on. */
export function NowCard({ run, now }: { run: HarnessRun; now: Date }) {
  const pos = run.position;
  const phase = currentPhase(run);
  const step = currentStep(run);
  // The agent the harness names, else everyone who owns the current step.
  const named = agentById(run, pos.agentId);
  const agents = named ? [named] : (step?.agentIds ?? []).map((id) => agentById(run, id)).filter((a) => a !== undefined);
  const item = run.workItems?.find((w) => w.id === pos.workItemId);
  const index = phase ? run.phases.indexOf(phase) + 1 : 0;
  const stepIndex = phase && step ? phase.steps.indexOf(step) + 1 : 0;
  const tone = pos.state === "blocked" ? "border-rose-200" : pos.state === "running" ? "border-blue-200" : "border-slate-200";

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-white px-5 py-3 shadow-sm ${tone}`}>
      <div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {pos.state === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />}
          {POSITION_LABEL[pos.state]}
          {pos.since && <span className="text-slate-400">· since {timeAgo(pos.since, now)}</span>}
        </div>
        <div className="mt-0.5 text-2xl font-bold text-slate-900">{phase ? `Phase ${index} — ${phase.label}` : "—"}</div>
        {step && phase && (
          <div className="mt-0.5 text-xs text-slate-500">
            Step {stepIndex}/{phase.steps.length} · <span className="font-semibold text-slate-700">{step.label}</span>
            {item && item.id !== step.key && <> · {item.id} {item.title}</>}
          </div>
        )}
      </div>
      {agents.map((a) => <AgentChip key={a.id} run={run} agent={a} />)}
      {pos.summary && <p className="min-w-[200px] flex-1 text-sm text-slate-700">{pos.summary}</p>}
    </div>
  );
}

/** Agent badge + name + state, used wherever an agent is shown on its own. */
export function AgentChip({ run, agent }: { run: HarnessRun; agent: Agent }) {
  const state = AGENT_STATE[agentState(run, agent)];
  return (
    <div className="flex items-center gap-2.5">
      <AgentAvatar agent={agent} status={state.status} />
      <div className="min-w-0">
        <div className="text-sm font-bold text-slate-900">{agent.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          {agent.role} <StatusPill status={state.status} label={state.label} />
        </div>
      </div>
    </div>
  );
}

const AVATAR_RING = {
  completed: "ring-emerald-400 bg-emerald-50 text-emerald-700",
  in_progress: "ring-blue-500 bg-blue-50 text-blue-700",
  pending: "ring-slate-200 bg-slate-50 text-slate-600",
  blocked: "ring-rose-400 bg-rose-50 text-rose-700",
  unknown: "ring-slate-300 bg-slate-50 text-slate-500",
} as const;

export function AgentAvatar({ agent, status, size = "md" }: { agent: Agent; status: keyof typeof AVATAR_RING; size?: "sm" | "md" }) {
  const initials = agent.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <span
      title={`${agent.name} · ${agent.role}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ring-2 ${AVATAR_RING[status]} ${size === "sm" ? "h-6 w-6 text-[10px]" : "h-9 w-9 text-sm"} ${status === "in_progress" ? "animate-pulse" : ""}`}
    >
      {agent.icon ?? initials}
    </span>
  );
}

export interface ViewTab {
  key: string;
  label: string;
}

export function TabBar({ tabs, active, onSelect }: { tabs: ViewTab[]; active: string; onSelect: (key: string) => void }) {
  return (
    <nav className="no-print flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          aria-current={t.key === active ? "page" : undefined}
          className={`rounded-full px-2.5 py-1 text-[13px] transition-colors ${
            t.key === active ? "bg-blue-50 font-semibold text-blue-700 ring-1 ring-blue-300" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
