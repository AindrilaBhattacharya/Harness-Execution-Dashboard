// Small shared building blocks used across the shell and the tabs.
import type { ReactNode } from "react";
import { Check, CircleDot, CircleHelp, Clock, OctagonAlert } from "lucide-react";
import type { DisplayStatus } from "../lib/derive";

const STATUS_LABEL: Record<DisplayStatus, string> = {
  completed: "completed",
  in_progress: "in progress",
  pending: "pending",
  blocked: "blocked",
  unknown: "not recorded",
};

export const STATUS_DOT: Record<DisplayStatus, string> = {
  completed: "bg-emerald-400",
  in_progress: "bg-blue-400 animate-pulse",
  pending: "bg-slate-500",
  blocked: "bg-rose-400",
  unknown: "bg-slate-400 ring-1 ring-slate-300",
};

/** Solid pill for the dark sidebar; soft pill for light surfaces. */
export function StatusPill({ status, tone = "soft", label }: { status: DisplayStatus; tone?: "solid" | "soft"; label?: string }) {
  const solid: Record<DisplayStatus, string> = {
    completed: "bg-emerald-500 text-white",
    in_progress: "bg-blue-500 text-white",
    pending: "bg-slate-600 text-slate-200",
    blocked: "bg-rose-500 text-white",
    unknown: "bg-slate-500 text-slate-100",
  };
  const soft: Record<DisplayStatus, string> = {
    completed: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    in_progress: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    pending: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    blocked: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    unknown: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  };
  const Icon = { completed: Check, in_progress: CircleDot, pending: Clock, blocked: OctagonAlert, unknown: CircleHelp }[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
        (tone === "solid" ? solid : soft)[status]
      }`}
    >
      <Icon className="h-2.5 w-2.5" strokeWidth={3} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
  );
}

export function ProgressBar({ value, className = "", color = "bg-emerald-500" }: { value: number; className?: string; color?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-200 ${className}`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Light inner card used inside tab panels. */
export function SubCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-800">{children}</h3>
      {right}
    </div>
  );
}

type BadgeTone = "slate" | "blue" | "green" | "amber" | "red" | "violet";
const BADGE: Record<BadgeTone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ children, tone = "slate", title }: { children: ReactNode; tone?: BadgeTone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

/** Monospace chip for source symbols, code symbols and file paths. */
export function Code({ children, title, wrap = false }: { children: ReactNode; title?: string; wrap?: boolean }) {
  return (
    <code
      title={title}
      className={`inline-block max-w-full rounded bg-slate-100 px-1.5 py-0.5 align-middle font-mono text-[11px] text-slate-700 ${
        wrap ? "break-all" : "truncate"
      }`}
    >
      {children}
    </code>
  );
}

export function Dot({ status }: { status: DisplayStatus }) {
  const light: Record<DisplayStatus, string> = {
    completed: "bg-emerald-500",
    in_progress: "bg-blue-500 animate-pulse",
    pending: "bg-slate-300",
    blocked: "bg-rose-500",
    unknown: "bg-slate-400",
  };
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${light[status]}`} />;
}

/** Headline number with a bar, e.g. on the Quality tab. */
export function Metric({ label, value, sub, good, bar }: { label: string; value: string; sub: string; good: boolean; bar: number }) {
  return (
    <SubCard>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold capitalize tabular-nums ${good ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
      <ProgressBar value={bar} color={good ? "bg-emerald-500" : "bg-amber-500"} className="mt-2 h-1.5" />
      <div className="mt-1 text-[11px] text-slate-500">{sub}</div>
    </SubCard>
  );
}

/** Grid of labelled counts; `good` turns a value green. */
export function Stats({ items, good }: { items: [string, number][]; good?: (label: string, v: number) => boolean }) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map(([label, v]) => (
        <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
          <dt className="text-[11px] text-slate-500">{label}</dt>
          <dd className={`text-lg font-bold tabular-nums ${good?.(label, v) ? "text-emerald-600" : "text-slate-900"}`}>{v.toLocaleString("en-US")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <span className="text-xs italic text-slate-400">{children}</span>;
}
