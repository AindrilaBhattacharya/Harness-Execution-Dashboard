// Choosing which harness the page reads: a local folder or file (picked or dropped) or a
// GitHub repo/folder link. The choice is remembered in this browser (see lib/harnessSource.ts).
import { useRef, useState, type ReactNode } from "react";
import { FileJson, FolderOpen, Github, Loader2, Upload, X } from "lucide-react";
import type { RunActions } from "../lib/useRun";
import { canPickFolder } from "../lib/harnessSource";

const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function LoadHarness({ actions, onDone, onClose, intro }: { actions: RunActions; onDone?: () => void; onClose?: () => void; intro?: ReactNode }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const attempt = async (what: string, f: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await f();
      onDone?.();
    } catch (e) {
      if (!isAbort(e)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const btn = "inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50";

  return (
    <div
      className={`rounded-2xl border bg-white p-5 shadow-sm transition-colors ${over ? "border-blue-400 bg-blue-50/40" : "border-slate-200"}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void attempt("drop", () => actions.drop(e.dataTransfer)); }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900">Load a harness</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {intro ?? "Choose a harness's folder, one of its files, or a link to it on GitHub. The dashboard finds its phases, agents and progress, and keeps reading it while it runs."}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-dashed border-slate-300 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Upload className="h-4 w-4 text-slate-500" /> From this computer</div>
          <p className="mt-1 text-xs text-slate-500">Drop a folder or file here, or choose one. Files stay on this computer.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn} disabled={!!busy} onClick={() => void attempt("folder", async () => { if (!(await actions.folder())) folderInput.current?.click(); })}>
              {busy === "folder" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} Choose folder
            </button>
            <button className={btn} disabled={!!busy} onClick={() => void attempt("file", async () => { if (!(await actions.file())) fileInput.current?.click(); })}>
              {busy === "file" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />} Choose file
            </button>
          </div>
          {!canPickFolder && <p className="mt-2 text-[11px] text-slate-400">This browser reads a chosen folder once; choose it again to refresh.</p>}
          {busy === "drop" && <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…</p>}
          <input
            ref={folderInput} type="file" multiple className="hidden"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void attempt("folder", () => actions.files(fs)); }}
          />
          <input
            ref={fileInput} type="file" className="hidden"
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ""; if (fs.length) void attempt("file", () => actions.files(fs)); }}
          />
        </div>

        <form
          className="rounded-xl border border-slate-200 p-4"
          onSubmit={(e) => { e.preventDefault(); if (url.trim()) void attempt("github", () => actions.github(url)); }}
        >
          <label htmlFor="gh-url" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Github className="h-4 w-4 text-slate-500" /> From GitHub</label>
          <p className="mt-1 text-xs text-slate-500">A public repo or folder, e.g. <code className="font-mono">https://github.com/org/harness/tree/main/output</code></p>
          <div className="mt-3 flex gap-2">
            <input
              id="gh-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button type="submit" className={btn} disabled={!!busy || !url.trim()}>
              {busy === "github" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Load
            </button>
          </div>
        </form>
      </div>

      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
    </div>
  );
}
