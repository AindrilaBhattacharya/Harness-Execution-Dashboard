# Harness Execution Dashboard

A dashboard for any forward-engineering harness. Every harness has **phases** and
**agents**, so this shows the same things for all of them:

- the phases in order, each with its steps, the agents who own each step, outputs and gates
- every agent: what it is doing now, the phases it works in, its steps and usage
- **where the run is**: the phase, step, agent and work item, and how long it has been there
- the work items being delivered, by epic when the harness plans in epics, each with its story
  text, acceptance criteria, dependencies and gates
- the event timeline, and a tab of the harness's own numbers

The dashboard contains no harness-specific code. It reads a harness from a local folder, a
local file or a GitHub link and works out its phases, agents and progress from what it finds
(see "How a harness is read"). A harness that wants full control writes one JSON file, a
**harness run** (`src/model.ts`), which is then shown as it is. Files are only read, never
changed or uploaded.

## Run it

Needs Node.js 18+ (the tests use Node 21+).

```bash
cd "Harness Execution Dashboard"
npm install      # first time only
npm run dev      # → http://localhost:8789
npm run build    # typecheck + production build into dist/
npm test         # discovery engine tests
```

Open the page and use **Load harness**:

- **From this computer:** choose or drop a harness's folder, or one of its files (a run file
  the harness wrote, or its state file). In browsers
  with the File System Access API (Chrome, Edge) the folder is re-read every 5 seconds and is
  remembered after a reload (one click to allow reading it again); elsewhere it is read once.
- **From GitHub:** paste a link to a public repo or folder, e.g.
  `https://github.com/org/harness/tree/main/output`. It is re-read once a minute; an unchanged
  repo costs no GitHub rate limit.

The choice is remembered in this browser. **Back to the server's run** forgets it.

`http://localhost:8789/#agents` opens a tab directly (`#execution`, `#agents`, `#work`,
`#timeline`, `#stats`); `?refresh=0` loads once, for screenshots and PDF exports.

The eight tiles at the top:

| Tile | Counts |
|---|---|
| Overall | `progressWeights.steps` × stages done + `progressWeights.workItems` × work items verified (stages done alone without weights) |
| Stages | stage steps done ÷ all stage steps (steps of a work item are not stages) |
| Gates | gates passed on stage steps |
| *Stories* verified | work items whose tests ran green; the noun is the harness's `workItemLabel` |
| Artifacts | outputs the stages produced |
| Approvals | stage gates with a recorded approval |
| Lineage | requirement threads linked to evidence and work (complete or in progress) ÷ all threads |
| Broken links | threads with no work item or a missing one |

A tile shows "—" when the harness does not record that kind of thing.

A **gate** is a check that must pass before work moves on: done (passed), blocked (failed),
pending (not checked yet, or waiting for a person) or unknown (not recorded).

## Command line and server

```bash
npm run import -- --from <folder | file | GitHub link> [--trait "Label=Value"]… [--out <file>]
```

writes `public/data/run.json`, which the page shows when nothing is loaded in the browser and
re-reads every 5 seconds. `--trait` adds what kind of harness it is (method, source,
target, …); traits show in the header and sidebar. The run is validated before it is written;
an invalid input writes nothing and names each problem.

To have the server read a harness itself, on every refresh, with no import step:

```bash
HARNESS_FROM="<folder | file | GitHub link>" npm run dev
PORT=8790 HARNESS_FROM="<…>" npx vite      # a second dashboard next to the first
```

A local folder is re-read at most every 3 seconds, a GitHub link at most once a minute.
`GITHUB_TOKEN`, when set, is used for GitHub links (required for private repos, and raises the
rate limit).

## Use it with any harness, with nothing to install

Every harness is read in the browser, so the built dashboard needs no server:

1. `npm run build` writes static files to `dist/`.
2. Put `dist/` on any static host: GitHub Pages, Netlify, Vercel or an internal web server.
3. Share the URL. Anyone can open it and load a folder from their computer or a public GitHub
   link.

A Node server is only needed for `HARNESS_FROM` and `npm run import`.

## Make a harness dashboard-ready

The dashboard follows conventions, not harnesses. The more of these a harness follows, the more
exact the dashboard is:

| To get… | The harness has… |
|---|---|
| **Agents** | markdown files in an `agents/` folder (or named `*.agent.md`) with `name:` and `description:` front matter, numbered in order (`01_x`, `02_y`) |
| **Progress** | an output folder (`output/`, `*_output/`, `reports/`, `checkpoints/`) with one subfolder per stage, named or numbered like its agent |
| **Exact status** | a `status:` field in the stage's JSON or markdown, or a `Status:` / `Verdict:` line |
| **Phases** | headings like `## Phase A — Understand` in the README that name each agent |
| **Work items** | ids like `BUG-12` in file names, or a ticket list |

For full control, the harness writes one run file (`harness-run.json`) after each stage, in the
shape described in "Describe any harness". It is then shown exactly as written, with nothing
worked out, and is the only way to get a fully exact result for any harness.

## Limits

- **Private GitHub repos** work through the server only (`HARNESS_FROM` or `npm run import`
  with `GITHUB_TOKEN` set). The page reads public repos.
- **Re-reading a local folder** as it changes needs Chrome or Edge. Other browsers read a
  chosen folder once; choose it again to refresh.
- **A harness that follows none of the conventions** still loads, but may show only "output
  present" per stage, a single phase and no work items. Such a harness should write the run
  file.

## How a harness is read

The discovery engine (`src/discover/`) runs in the browser, the server and the command line.
It knows conventions, not harnesses, and uses the first of these that the files contain:

1. **A run file** the harness wrote (`schemaVersion: 1` with `phases`, `agents` and
   `position`; see "Describe any harness"). Shown as it is.
2. **A state file** that describes itself: a JSON file whose name says so (state, status,
   progress, pipeline, dashboard, …) with an array of `stages`/`steps`, and optionally
   `phases`, `agents`/`roles`, `stories`/`tickets`/`issues`, `epics` and `gates`. Steps link
   to phases, agents and gates by the keys the file itself uses.
3. **The files themselves:**
   - **Agents** are markdown definitions with `name`/`description` front matter, in an
     `agents/` folder or named `*.agent.md`; a leading number gives the order. When several
     folders hold a copy of the roster, the fullest one leads. Agents sharing a number are
     alternatives for one stage; an agent whose description starts "Optional" does not hold
     the run up.
   - **Progress** comes from output folders (`output`, `outputs`, `*_output`, `*-output`,
     `checkpoints`, `reports`, `artifacts`, `results`): one stage per subfolder, matched to an
     agent by number (`02-…` ↔ `02_…`), by shared words, or by the agent's definition naming
     the folder. A stage's status is, in order: a `status` field in a run/meta JSON file
     (timestamped run folders and a `latest.json` pointer pick the current run), a document's
     own status (front matter `status:`, or a `Status`/`Verdict`/`Decision` row or line), the
     statuses of the documents inside it (each becomes a gate), or "output present".
   - **Phases** come from overview docs (`README.md` and similar) with headings like
     `## Phase A — Understand`, assigned by the agents or folders each section names; else from
     a `phase` field in the agent definitions; else one phase.
   - **Work items** are ids like `BUG-12` that recur across stages, or ticket lists (TOML or
     JSON entries with a `title`) with statuses from the documents that reference them.

Status words are mapped to the dashboard's six statuses by meaning (`success`, `passed`,
`approved`, `final` → done; `draft`, `in-progress`, `running` → active; `failed`, `rejected`,
`blocked` → blocked; `proposed`, `open`, `pending` → pending). The banner says which of the
three ways was used and lists what was not found. Statuses marked *inferred* are assumptions
(output exists, so the stage ran).

## Describe any harness

A harness that writes this file (named `*run*.json` or `*harness*.json`, anywhere in its
folder) is shown exactly as described. `examples/harness-run.example.json` is a complete
example. The shape, fully typed in
`src/model.ts`:

```jsonc
{
  "schemaVersion": 1,
  "harness": { "id": "…", "name": "…", "traits": [{ "label": "Source", "value": "…" }], "workItemLabel": "Stories", "epicLabel": "Epics" },
  "project": { "name": "…", "path": "…" },
  "importedAt": "2026-10-13T09:30:00Z",
  "phases": [
    { "key": "…", "label": "…", "steps": [
      { "key": "…", "label": "…", "agentIds": ["…"], "status": "pending|active|done|blocked|skipped|unknown",
        "output": "…", "optional": false, "workItemId": "…",
        "gates": [{ "label": "…", "status": "…", "approval": { "decision": "approved|rejected", "by": "…", "role": "…", "at": "…" } }] }
    ] }
  ],
  "agents": [{ "id": "…", "name": "…", "role": "…", "icon": "…", "model": "…", "usage": { "runs": 0, "tokens": 0, "costUsd": 0 } }],
  "position": { "state": "not_started|running|paused|blocked|finished|unknown",
                "phaseKey": "…", "stepKey": "…", "agentId": "…", "workItemId": "…", "summary": "…", "since": "…" },
  "epics": [{ "id": "…", "title": "…", "summary": "…", "status": "…" }],
  "workItems": [{ "id": "…", "title": "…", "status": "…", "epicId": "…", "group": "…", "type": "story", "agentId": "…", "verified": true,
                  "description": "…", "acceptanceCriteria": [{ "id": "…", "text": "…", "covered": true }],
                  "dependsOn": ["…"], "gates": [{ "label": "…", "status": "…" }], "note": "…" }],
  "progressWeights": { "steps": 0.4, "workItems": 0.6 },
  "artifacts": [{ "label": "…", "path": "…", "stepKey": "…" }],
  "traceability": [{ "id": "…", "title": "…", "state": "complete|in_progress|no_evidence|broken" }],
  "timeline": [{ "at": "…", "summary": "…", "level": "info|success|warning|error", "agentId": "…" }],
  "metrics": [{ "group": "…", "label": "…", "value": "…", "tone": "good|bad" }],
  "missing": [{ "what": "…", "needs": "…" }]
}
```

Only `schemaVersion`, `harness`, `project`, `importedAt`, `phases`, `agents` and `position`
are required. Statuses are mapped to the six above by whoever writes the file. The harness's
own word can be kept in `rawStatus`, and it is shown next to the mapped one. Derived numbers
are computed by the dashboard and never written to the file: progress, phase status and what
each agent is doing.

A harness that plans in epics lists them in `epics` and points each work item at one with
`epicId`; the Work items tab then has a board per epic. Without epics it has one per `group`.
An epic's `status` is only for a harness that records one; otherwise it comes from the epic's
work items.

Writing this file is the way to get exact statuses, the current position and work items that
the conventions above cannot see.

## Layout

```
src/model.ts             the harness run: the one shape every harness is translated into
src/lib/derive.ts        progress, phase status, agent state, current position
src/lib/useRun.ts        reads the chosen harness (or the server's run) and refreshes it
src/lib/harnessSource.ts what the page was asked to read, remembered per browser
src/discover/            the discovery engine: discover.js, text.js, github.js, browser.js, validate.js
src/components/          shell (sidebar, header, banner, KPI tiles, "now" card, tab bar), Load harness, ui kit
src/views/               Execution, Agents, Work items, Timeline, Harness stats
scripts/import.mjs       reads --from with the engine, validates, writes run.json
scripts/sources.mjs      local folders and files, and GitHub links, for the command line and server
scripts/*.test.mjs       engine tests on small made-up harnesses
examples/                a hand-written run file
```

Stack: React 19, TypeScript, Vite, Tailwind CSS, lucide-react, and `smol-toml` for ticket lists
in TOML.
