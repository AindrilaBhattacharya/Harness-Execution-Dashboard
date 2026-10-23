// The harness's own numbers, as it reported them, grouped under its headings; then what the
// input did not contain.
import type { HarnessRun } from "../model";
import { SectionTitle, SubCard } from "../components/ui";

export function StatsView({ run }: { run: HarnessRun }) {
  const metrics = run.metrics ?? [];
  const groups = [...new Set(metrics.map((m) => m.group ?? "General"))];
  return (
    <div className="space-y-4">
      {!metrics.length && <NoData what="Harness-specific numbers" />}
      {groups.map((g) => (
        <SubCard key={g}>
          <SectionTitle>{g}</SectionTitle>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
            {metrics.filter((m) => (m.group ?? "General") === g).map((m) => (
              <div key={m.label} className="rounded-lg bg-slate-50 px-3 py-2" title={m.hint}>
                <dt className="text-[11px] text-slate-500">{m.label}</dt>
                <dd className={`text-lg font-bold tabular-nums ${m.tone === "good" ? "text-emerald-600" : m.tone === "bad" ? "text-rose-600" : "text-slate-900"}`}>
                  {typeof m.value === "number" ? m.value.toLocaleString("en-US") : m.value}
                </dd>
                {m.hint && <div className="text-[10.5px] text-slate-400">{m.hint}</div>}
              </div>
            ))}
          </dl>
        </SubCard>
      ))}
      {run.missing && run.missing.length > 0 && (
        <SubCard>
          <SectionTitle>Not in this input</SectionTitle>
          <ul className="space-y-1 text-xs">
            {run.missing.map((m) => (
              <li key={m.what}><b className="text-slate-800">{m.what}</b> <span className="text-slate-500">needs {m.needs}</span></li>
            ))}
          </ul>
        </SubCard>
      )}
    </div>
  );
}

/** Shown when the run has nothing for a view. */
export function NoData({ what }: { what: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
      <b>{what}</b> is not in this input.
    </div>
  );
}
