// Work items (stories, tickets, modules) on a board by status: one board per epic when the
// harness plans in epics, else per group. A card opens to the work item's details.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Epic, HarnessRun, Status, WorkItem } from "../model";
import { agentById, epicStatus } from "../lib/derive";
import { Badge, Code, ProgressBar, StatusPill } from "../components/ui";

const COLUMNS: { key: string; label: string; statuses: Status[] }[] = [
  { key: "todo", label: "To do", statuses: ["pending"] },
  { key: "doing", label: "In progress", statuses: ["active"] },
  { key: "blocked", label: "Blocked", statuses: ["blocked", "unknown"] },
  { key: "done", label: "Done", statuses: ["done", "skipped"] },
];

const TONE: Record<Status, "slate" | "blue" | "green" | "red" | "amber"> = {
  pending: "slate", active: "blue", done: "green", skipped: "slate", blocked: "red", unknown: "amber",
};

interface Section { key: string; title: string; epic?: Epic; list: WorkItem[] }

export function WorkView({ run }: { run: HarnessRun }) {
  const items = run.workItems ?? [];
  const epics = run.epics ?? [];
  const noun = (run.harness.workItemLabel ?? "Work items").toLowerCase();
  const epicNoun = (run.harness.epicLabel ?? "Epics").toLowerCase();
  const outside = items.filter((w) => !epics.some((e) => e.id === w.epicId));
  const sections: Section[] = epics.length
    ? [
        ...epics.map((e) => ({ key: e.id, title: e.title, epic: e, list: items.filter((w) => w.epicId === e.id) })),
        ...(outside.length ? [{ key: "", title: `Outside the ${epicNoun}`, list: outside }] : []),
      ]
    : [...new Set(items.map((w) => w.group ?? "Ungrouped"))].map((g) => ({ key: g, title: g, list: items.filter((w) => (w.group ?? "Ungrouped") === g) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {COLUMNS.map((c) => {
          const n = items.filter((w) => c.statuses.includes(w.status)).length;
          return <Badge key={c.key} tone={TONE[c.statuses[0]]}>{n} {c.label.toLowerCase()}</Badge>;
        })}
        <span className="text-slate-400">
          · {items.length} {noun} in {epics.length ? `${epics.length} ${epicNoun}` : `${sections.length} groups`}
        </span>
      </div>
      {sections.map((s) => <Board key={s.key} run={run} section={s} showGroup={epics.length > 0} />)}
    </div>
  );
}

function Board({ run, section: { title, epic, list }, showGroup }: { run: HarnessRun; section: Section; showGroup: boolean }) {
  const done = list.filter((w) => w.status === "done" || w.status === "skipped").length;
  const verified = list.filter((w) => w.verified).length;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-start gap-3 rounded-t-xl border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {epic && <span className="font-mono text-[11px] font-bold text-blue-700">{epic.id}</span>}
            <span className="text-sm font-bold text-slate-900">{title}</span>
            {epic && <StatusPill status={epicStatus(epic, list)} label={epic.rawStatus} />}
          </div>
          {epic?.summary && <p className="mt-1 text-xs leading-relaxed text-slate-500">{epic.summary}</p>}
        </div>
        <div className="w-full sm:w-48">
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>{done}/{list.length} done{verified ? ` · ${verified} verified` : ""}</span>
            <span className="font-semibold">{list.length ? Math.round((done / list.length) * 100) : 0}%</span>
          </div>
          <ProgressBar value={list.length ? (done / list.length) * 100 : 0} className="mt-1 h-1.5" />
        </div>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((c) => {
          const inCol = list.filter((w) => c.statuses.includes(w.status));
          return (
            <div key={c.key} className="min-h-[70px] min-w-0 rounded-lg bg-slate-100/80 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {c.label} <span className="rounded-full bg-white px-1.5 text-slate-500">{inCol.length}</span>
              </div>
              <div className="space-y-2">
                {inCol.map((w) => <ItemCard key={w.id} run={run} item={w} current={run.position.workItemId === w.id} showGroup={showGroup} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ItemCard({ run, item, current, showGroup }: { run: HarnessRun; item: WorkItem; current: boolean; showGroup: boolean }) {
  const [open, setOpen] = useState(false);
  const agent = agentById(run, item.agentId);
  const acs = item.acceptanceCriteria ?? [];
  const covered = acs.filter((a) => a.covered).length;
  const tracksCoverage = acs.some((a) => a.covered !== undefined);
  const hasDetails = !!(item.description || acs.length || item.dependsOn?.length || item.gates?.length || item.note);
  return (
    <div className={`rounded-lg border bg-white p-2.5 shadow-sm ${current ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] font-bold text-blue-700">{item.id}</span>
        <Badge tone={TONE[item.status]}>{item.rawStatus ?? item.status}</Badge>
      </div>
      <div className="mt-1 text-xs font-semibold leading-snug text-slate-800">{item.title}</div>
      {(item.type || (showGroup && item.group) || acs.length > 0 || item.gates?.length) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.type && <Badge tone="violet">{item.type}</Badge>}
          {showGroup && item.group && <Badge>{item.group}</Badge>}
          {acs.length > 0 && (
            <Badge tone={tracksCoverage ? (covered === acs.length ? "green" : "amber") : "slate"}>
              {tracksCoverage ? `${covered}/${acs.length} AC covered` : `${acs.length} AC`}
            </Badge>
          )}
          {item.gates?.map((g) => <Badge key={g.label} tone={TONE[g.status]} title={g.detail}>{g.label}</Badge>)}
        </div>
      )}
      {(agent || current) && (
        <div className="mt-1.5 text-[11px] text-slate-500">
          {agent && <>{agent.name} · {agent.role}</>}
          {current && <span className="ml-1 font-semibold text-blue-700">· now</span>}
        </div>
      )}
      {hasDetails && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-blue-700"
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} /> {open ? "Hide details" : "Details"}
        </button>
      )}
      {open && <ItemDetails item={item} />}
    </div>
  );
}

function ItemDetails({ item }: { item: WorkItem }) {
  const label = "text-[10px] font-bold uppercase tracking-wider text-slate-400";
  return (
    <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-600">
      {item.description && <p>{item.description}</p>}
      {!!item.acceptanceCriteria?.length && (
        <div>
          <div className={label}>Acceptance criteria</div>
          <ul className="mt-0.5 space-y-1">
            {item.acceptanceCriteria.map((a, i) => (
              <li key={a.id ?? i} className="flex gap-1.5">
                <span
                  className={a.covered === undefined ? "text-slate-300" : a.covered ? "text-emerald-600" : "text-amber-600"}
                  title={a.covered === undefined ? "coverage not recorded" : a.covered ? "cited by a test" : "no test cites it"}
                >
                  {a.covered === undefined ? "–" : a.covered ? "✓" : "○"}
                </span>
                <span className="min-w-0">
                  {a.id && <span className="font-mono font-semibold text-slate-700">{a.id}</span>}
                  {a.id && a.text && " "}
                  {a.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!item.dependsOn?.length && (
        <div>
          <div className={label}>Depends on</div>
          <div className="mt-0.5 flex flex-wrap gap-1">{item.dependsOn.map((d) => <Code key={d}>{d}</Code>)}</div>
        </div>
      )}
      {item.gates?.map((g) => (
        <div key={g.label}>
          <div className="flex items-center gap-1.5">
            <span className={label}>{g.label}</span>
            <Badge tone={TONE[g.status]}>{g.status}</Badge>
          </div>
          {g.detail && <p className="mt-0.5 break-words">{g.detail}</p>}
        </div>
      ))}
      {item.note && <p className="break-words italic text-amber-700">{item.note}</p>}
    </div>
  );
}
