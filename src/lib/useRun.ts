import { useCallback, useEffect, useState } from "react";
import type { HarnessRun } from "../model";

// Where the run comes from, first that answers:
//   1. the live harness, read by the dashboard's server (/live/run, see vite.config.ts)
//   2. run.json, written by `npm run import` from a harness's output
//   3. the first sample
// ?data=<name> shows public/data/samples/<name>.json; ?source=file skips the live harness;
// ?workspace=<id> picks a workspace on the live harness; ?refresh=0 loads once (for screenshots
// and PDF exports).
const RUN_URL = "/data/run.json";
const sampleUrl = (name: string) => `/data/samples/${encodeURIComponent(name)}.json`;

export interface SampleRef {
  key: string;
  label: string;
}

export type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; run: HarnessRun; samples: SampleRef[]; sampleKey?: string; fellBackToSample: boolean; liveError?: string };

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  // A missing file is a 404, or (from Vite's dev server) the app's own HTML page.
  if (res.status === 404 || !res.headers.get("content-type")?.includes("json")) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
  return (await res.json()) as T;
}

async function fetchLive(workspace?: string): Promise<HarnessRun> {
  const res = await fetch(`/live/run${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ""}`, { cache: "no-store" });
  if (!res.headers.get("content-type")?.includes("json")) throw new Error("this server has no live harness connection");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as HarnessRun;
}

async function fetchRun(url: string): Promise<HarnessRun | null> {
  const run = await fetchJson<HarnessRun>(url);
  if (run && run.schemaVersion !== 1) throw new Error(`${url} is not a harness run (schemaVersion 1). Re-import it with: npm run import`);
  return run;
}

/** Loads the run and re-reads it on an interval, so the page follows a harness that is running. */
export function useRun() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const params = new URLSearchParams(window.location.search);
  const refreshMs = params.get("refresh") === "0" ? 0 : 5_000;
  const wanted = params.get("data") ?? undefined;
  const fileOnly = params.get("source") === "file";
  const workspace = params.get("workspace") ?? undefined;

  const load = useCallback(async () => {
    try {
      const samples = (await fetchJson<SampleRef[]>("/data/samples/index.json")) ?? [];
      let liveError: string | undefined;
      if (!wanted && !fileOnly) {
        try {
          const run = await fetchLive(workspace);
          setState({ status: "ready", run, samples, fellBackToSample: false });
          return;
        } catch (e) {
          liveError = e instanceof Error ? e.message : String(e);
        }
      }
      let sampleKey = wanted;
      let run = wanted ? await fetchRun(sampleUrl(wanted)) : await fetchRun(RUN_URL);
      let fellBackToSample = false;
      if (!run && !wanted && samples.length) {
        sampleKey = samples[0].key;
        run = await fetchRun(sampleUrl(sampleKey));
        fellBackToSample = true;
      }
      if (!run) throw new Error(wanted ? `No sample named "${wanted}".` : "No harness run found. Start the harness, or run: npm run import -- --from <project>");
      setState({ status: "ready", run, samples, sampleKey, fellBackToSample, liveError });
    } catch (e) {
      // Keep showing the last good run on a failed refresh.
      setState((prev) => (prev.status === "ready" ? prev : { status: "error", error: String(e) }));
    }
  }, [wanted, fileOnly, workspace]);

  useEffect(() => {
    void load();
    if (refreshMs <= 0) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);

  return state;
}
