#!/usr/bin/env node
// Reads a harness and writes public/data/run.json (src/model.ts HarnessRun).
//
//   npm run import -- --from <folder | file | GitHub link> [--trait "Label=Value"]… [--out <file>]
//
// --from is read by the discovery engine (src/discover/): a run file the harness wrote is used
// as it is; otherwise phases, agents and progress are worked out from the harness's files.
// GITHUB_TOKEN, when set, is used for GitHub links (needed for private repos).
// Files are only read. The result is validated before anything is written.
import { writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverRun } from "../src/discover/discover.js";
import { openSource } from "./sources.mjs";
import { validateRun } from "../src/discover/validate.js";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const opts = { traits: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--from", "--out", "--trait"].includes(a) && argv[i + 1] !== undefined) {
      const v = argv[++i];
      if (a === "--trait") {
        const eq = v.indexOf("=");
        if (eq < 1) throw new Error(`--trait "${v}" must look like "Label=Value"`);
        opts.traits.push({ label: v.slice(0, eq), value: v.slice(eq + 1) });
      } else opts[a.slice(2)] = v;
    } else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  if (!opts.from) throw new Error("Usage: npm run import -- --from <folder | file | GitHub link> [--trait \"Label=Value\"] [--out <file>]");
  return opts;
}

/** Reads --from and returns a validated run. */
export async function importRun(opts) {
  const run = await discoverRun(openSource(opts.from), { traits: opts.traits });
  const errors = validateRun(run);
  if (errors.length) throw new Error(`The run is not valid, nothing written:\n  - ${errors.join("\n  - ")}`);
  return run;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const run = await importRun(opts);
  const out = resolve(appRoot, opts.out ?? "public/data/run.json");
  writeFileSync(out, JSON.stringify(run, null, 2) + "\n");
  const steps = run.phases.flatMap((p) => p.steps);
  const how = { "run-file": `the run file ${run.discovery?.file}`, "state-file": `the state file ${run.discovery?.file}`, files: "its files" }[run.discovery?.method] ?? "the run file";
  console.log(`Read ${run.harness.name} (${run.project.name}) from ${how} → ${relative(appRoot, out)}`);
  console.log(`  ${run.phases.length} phases · ${steps.length} steps · ${run.agents.length} agents · ${run.workItems?.length ?? 0} work items`);
  console.log(`  now: ${run.position.state}${run.position.summary ? ` · ${run.position.summary}` : ""}`);
  for (const m of run.missing ?? []) console.log(`  not found: ${m.what} (needs ${m.needs})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
