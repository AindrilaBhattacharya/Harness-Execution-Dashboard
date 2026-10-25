import { useEffect, useState, type ReactNode } from "react";
import { Activity, BarChart3, Bot, FolderLock, Layers, Workflow, type LucideIcon } from "lucide-react";
import type { HarnessRun } from "./model";
import { LoadHarness } from "./components/LoadHarness";
import { DataBanner, HeaderBar, KpiTiles, NowCard, Sidebar, TabBar } from "./components/Shell";
import { Card } from "./components/ui";
import { useRun } from "./lib/useRun";
import { AgentsView } from "./views/AgentsView";
import { ExecutionView } from "./views/ExecutionView";
import { StatsView } from "./views/StatsView";
import { TimelineView } from "./views/TimelineView";
import { WorkView } from "./views/WorkView";

interface View {
  key: string;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  render: (run: HarnessRun) => ReactNode;
  shown?: (run: HarnessRun) => boolean;
}

const VIEWS: View[] = [
  { key: "execution", label: "Execution", icon: Workflow, render: (r) => <ExecutionView run={r} />,
    title: "Execution — every phase, step by step",
    subtitle: "Who owns each step, what it produces, its gate, and the step the run is on now." },
  { key: "agents", label: "Agents", icon: Bot, render: (r) => <AgentsView run={r} />,
    title: "Agents — who is working, and where",
    subtitle: "What each agent is doing now, the phases it works in, and its steps." },
  { key: "work", label: "Work items", icon: Layers, render: (r) => <WorkView run={r} />, shown: (r) => !!r.workItems?.length,
    title: "Work items — the units being delivered",
    subtitle: "Stories, tickets or modules by status, grouped as the harness groups them." },
  { key: "timeline", label: "Timeline", icon: Activity, render: (r) => <TimelineView run={r} />,
    title: "Timeline — what happened, newest first",
    subtitle: "Events the harness recorded, by agent." },
  { key: "stats", label: "Harness stats", icon: BarChart3, render: (r) => <StatsView run={r} />,
    title: "Harness stats — this harness's own numbers",
    subtitle: "Reported by the harness or found in its files, grouped under their headings." },
];

/** Active view lives in the URL hash (#agents) so views can be linked and survive refresh. */
function useHashView(): [string, (key: string) => void] {
  const read = () => window.location.hash.slice(1) || VIEWS[0].key;
  const [view, setView] = useState(read);
  useEffect(() => {
    const onHash = () => setView(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [view, (key) => { window.location.hash = key; }];
}

/** Re-renders every 10s so "updated Xs ago" keeps ticking. */
function useNow(intervalMs = 10_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export default function App() {
  const { state, actions } = useRun();
  const [active, setActive] = useHashView();
  const [loading, setLoading] = useState(false);
  const now = useNow();

  if (state.status === "loading") return <Message>Reading the harness…</Message>;
  if (state.status === "permission")
    return (
      <Message>
        <div className="max-w-md space-y-3 text-center">
          <FolderLock className="mx-auto h-8 w-8 text-slate-400" />
          <p>The dashboard reads <b>{state.name}</b> from this computer. Your browser asks again after a reload.</p>
          <div className="flex justify-center gap-2">
            <button onClick={() => void state.grant()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Allow reading {state.name}</button>
            <button onClick={actions.clear} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Choose another</button>
          </div>
        </div>
      </Message>
    );
  if (state.status === "empty" || state.status === "error")
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10">
        <h1 className="text-xl font-bold text-slate-900">Harness Execution Dashboard</h1>
        {state.status === "error" && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
            Could not read the harness: {state.error}
            {state.choice && <button onClick={actions.clear} className="ml-2 font-semibold underline">Forget it</button>}
          </p>
        )}
        {state.status === "empty" && state.serverError && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">The server could not read its harness: {state.serverError}</p>
        )}
        <LoadHarness actions={actions} intro="No harness is loaded yet. Choose a harness's folder, one of its files, or a link to it on GitHub. The dashboard finds its phases, agents and progress, and keeps reading it while it runs." />
      </div>
    );

  const { run } = state;
  const views = VIEWS.filter((v) => !v.shown || v.shown(run));
  const view = views.find((v) => v.key === active) ?? views[0];
  const Icon = view.icon;

  return (
    <div className="min-h-screen lg:flex">
      <Sidebar run={run} />
      <main className="min-w-0 flex-1 space-y-4 px-4 py-5 lg:px-6">
        <HeaderBar run={run} now={now} live={state.refreshMs > 0} onLoad={() => setLoading((v) => !v)} />
        {loading && <LoadHarness actions={actions} onDone={() => setLoading(false)} onClose={() => setLoading(false)} />}
        <DataBanner run={run} choice={state.choice} refreshMs={state.refreshMs} error={state.error} onLoad={() => setLoading(true)} onClear={actions.clear} />
        <KpiTiles run={run} />
        <NowCard run={run} now={now} />
        <TabBar tabs={views} active={view.key} onSelect={setActive} />
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Icon className="h-5 w-5 text-blue-600" />
            {view.title}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{view.subtitle}</p>
          <div className="mt-4">{view.render(run)}</div>
        </Card>
      </main>
    </div>
  );
}

function Message({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-6 text-sm text-slate-600">{children}</div>;
}
