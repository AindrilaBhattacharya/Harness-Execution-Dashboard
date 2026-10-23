#!/usr/bin/env node
// Turn a harness's output into public/data/run.json (src/model.ts HarnessRun).
//
//   npm run import -- --from <path> [--as bmad|cobol|run] [--trait "Source=PL/SQL"]… [--out <file>] [--sample]
//
// --from is detected when --as is not given:
//   a folder with _bmad/ or _bmad-output/          → BMAD project      (scripts/readers/bmad.mjs)
//   a Forward Engineering Dashboard data file      → COBOL → Java      (scripts/readers/cobol.mjs)
//   a harness-run JSON (schemaVersion 1 + phases)  → any harness, as written by the harness itself
// Project files are only read. The result is validated before anything is written.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBmadProject, readBmadProject } from "./readers/bmad.mjs";
import { fromCobolDashboard, isCobolDashboardData } from "./readers/cobol.mjs";
import { validateRun } from "./validate.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const opts = { traits: [], sample: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sample") opts.sample = true;
    else if (["--from", "--as", "--out", "--trait"].includes(a) && argv[i + 1] !== undefined) {
      const v = argv[++i];
      if (a === "--trait") {
        const eq = v.indexOf("=");
        if (eq < 1) throw new Error(`--trait "${v}" must look like "Label=Value"`);
        opts.traits.push({ label: v.slice(0, eq), value: v.slice(eq + 1) });
      } else opts[a.slice(2)] = v;
    } else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  if (!opts.from) throw new Error("Usage: npm run import -- --from <project folder or JSON file> [--as bmad|cobol|run]");
  return opts;
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error(`${p}: not valid JSON (${e.message})`);
  }
};

/** Read --from with the matching reader; returns a run (not yet validated). */
export function importRun(opts) {
  const from = resolve(opts.from);
  if (!existsSync(from)) throw new Error(`${from}: not found`);
  const dir = statSync(from).isDirectory();
  const doc = dir ? undefined : readJson(from);
  const kind = opts.as ?? (dir ? (isBmadProject(from) ? "bmad" : undefined) : isCobolDashboardData(doc) ? "cobol" : doc?.phases ? "run" : undefined);

  let run;
  if (kind === "bmad") {
    if (!dir) throw new Error(`${from}: --as bmad needs the project folder`);
    run = readBmadProject(from, { traits: opts.traits });
  } else if (kind === "cobol") {
    if (!isCobolDashboardData(doc)) throw new Error(`${from}: not a Forward Engineering Dashboard data file (meta, stages, stories)`);
    run = fromCobolDashboard(doc);
    run.harness.traits = [...run.harness.traits.filter((t) => !opts.traits.some((o) => o.label === t.label)), ...opts.traits];
  } else if (kind === "run") {
    run = { importedAt: new Date().toISOString(), ...doc };
    if (opts.traits.length) run.harness = { ...run.harness, traits: [...(run.harness?.traits ?? []), ...opts.traits] };
  } else {
    throw new Error(
      `${from}: no supported harness output found. Expected a BMAD project folder (_bmad/ or _bmad-output/), ` +
        "a Forward Engineering Dashboard data file (.json), or a harness-run .json (see README, \"Describe any harness\").",
    );
  }
  if (opts.sample) run.sample = true;
  return run;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const run = importRun(opts);
  const errors = validateRun(run);
  if (errors.length) throw new Error(`The run is not valid, nothing written:\n  - ${errors.join("\n  - ")}`);
  const out = resolve(appRoot, opts.out ?? "public/data/run.json");
  writeFileSync(out, JSON.stringify(run, null, 2) + "\n");
  const steps = run.phases.flatMap((p) => p.steps);
  console.log(`Imported ${run.harness.name} · ${run.project.name} → ${relative(appRoot, out)}`);
  console.log(`  ${run.phases.length} phases · ${steps.length} steps · ${run.agents.length} agents · ${run.workItems?.length ?? 0} work items`);
  console.log(`  now: ${run.position.state}${run.position.phaseKey ? ` · ${run.position.phaseKey}/${run.position.stepKey}` : ""}${run.position.summary ? ` · ${run.position.summary}` : ""}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
