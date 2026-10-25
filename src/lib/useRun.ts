import { useCallback, useEffect, useState } from "react";
import { discoverRun } from "../discover/discover.js";
import { validateRun } from "../discover/validate.js";
import type { HarnessRun } from "../model";
import {
  PermissionNeeded, chooseDrop, chooseFiles, chooseGitHub, forget, open, pickFile, pickFolder, savedChoice, type Choice,
} from "./harnessSource";

// Where the run comes from, first that answers:
//   1. a harness chosen in this page (a folder, a file or a GitHub link; see harnessSource.ts),
//      read in the browser by the discovery engine
//   2. the dashboard's server: /data/run.json, either written by `npm run import` or read
//      on request from HARNESS_FROM
// ?refresh=0 loads once (for screenshots and PDF exports).
const RUN_URL = "/data/run.json";
const SERVER_REFRESH_MS = 5_000;

export type LoadState =
  | { status: "loading" }
  | { status: "empty"; serverError?: string }
  | { status: "permission"; name: string; grant: () => Promise<void> }
  | { status: "error"; error: string; choice?: Choice }
  | { status: "ready"; run: HarnessRun; choice?: Choice; refreshMs: number; refreshedAt: Date; error?: string };

export interface RunActions {
  github(url: string): Promise<void>;
  folder(): Promise<boolean>; // false: no folder picker here, use an <input webkitdirectory>
  file(): Promise<boolean>; // false: no file picker here, use an <input type=file>
  files(files: File[]): Promise<void>;
  drop(dt: DataTransfer): Promise<void>;
  clear(): void;
}

async function fetchServerRun(): Promise<HarnessRun | { error: string } | null> {
  const res = await fetch(`${RUN_URL}?t=${Date.now()}`, { cache: "no-store" });
  // A missing file is a 404, or (from Vite's dev server) the app's own HTML page.
  if (res.status === 404 || !res.headers.get("content-type")?.includes("json")) return null;
  const body = await res.json();
  if (!res.ok) return { error: body?.error ?? `HTTP ${res.status}` };
  if (body?.schemaVersion !== 1) return { error: `${RUN_URL} is not a harness run (schemaVersion 1). Re-run: npm run import -- --from <harness>` };
  return body as HarnessRun;
}

/** Loads the run, re-reads it on an interval, and lets the page choose another harness. */
export function useRun(): { state: LoadState; actions: RunActions } {
  const [choice, setChoice] = useState<Choice | null>(() => savedChoice());
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [nonce, setNonce] = useState(0); // bumps to restart loading (after a permission grant)
  const once = new URLSearchParams(window.location.search).get("refresh") === "0";

  // One reading loop per choice: the next reading is scheduled only after the last finished,
  // and a loop whose choice was replaced ignores what it still had in flight.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((prev) => (prev.status === "ready" && prev.choice === (choice ?? undefined) ? prev : { status: "loading" }));

    const schedule = (ms: number) => {
      if (!stopped && ms > 0 && !once) timer = setTimeout(load, ms);
    };
    async function load() {
      let refreshMs = SERVER_REFRESH_MS;
      try {
        if (choice) {
          const opened = await open(choice);
          refreshMs = opened.refreshMs;
          const run = (await discoverRun(opened.source)) as HarnessRun;
          const errors: string[] = validateRun(run);
          if (errors.length) throw new Error(`What was read is not a valid run: ${errors.join("; ")}`);
          if (!stopped) setState({ status: "ready", run, choice, refreshMs, refreshedAt: new Date() });
        } else {
          const r = await fetchServerRun();
          if (stopped) return;
          if (r === null) setState({ status: "empty" });
          else if ("error" in r) setState((prev) => (prev.status === "ready" && !prev.choice ? { ...prev, error: r.error } : { status: "empty", serverError: r.error }));
          else setState({ status: "ready", run: r, refreshMs, refreshedAt: new Date() });
        }
      } catch (e) {
        if (stopped) return;
        if (e instanceof PermissionNeeded) {
          const grant = e.grant;
          setState({ status: "permission", name: e.name, grant: async () => { if (await grant()) setNonce((n) => n + 1); } });
          return;
        }
        const error = e instanceof Error ? e.message : String(e);
        // Keep showing the last good run on a failed refresh.
        setState((prev) => (prev.status === "ready" && prev.choice === (choice ?? undefined) ? { ...prev, error } : { status: "error", error, choice: choice ?? undefined }));
      }
      schedule(refreshMs);
    }
    void load();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [choice, nonce, once]);

  const run = useCallback(async (f: () => Promise<Choice | null>) => {
    const c = await f();
    if (c) setChoice({ ...c });
    return !!c;
  }, []);

  const actions: RunActions = {
    github: async (url) => { await run(async () => chooseGitHub(url)); },
    folder: () => run(pickFolder),
    file: () => run(pickFile),
    files: async (files) => { await run(() => chooseFiles(files)); },
    drop: async (dt) => { await run(() => chooseDrop(dt)); },
    clear: () => { forget(); setChoice(null); },
  };
  return { state, actions };
}
