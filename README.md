# Harness Execution Dashboard

A dashboard for any forward-engineering harness. Every harness has **phases** and
**agents**, so this shows the same things for all of them:

- the phases in order, each with its steps, the agents who own each step, outputs and gates
- every agent: what it is doing now, the phases it works in, its steps and usage
- **where the run is**: the phase, step, agent and work item, and how long it has been there
- the work items being delivered, by epic when the harness plans in epics, each with its story
  text, acceptance criteria, dependencies and gates
- the event timeline, and a tab of the harness's own numbers

The dashboard contains no harness-specific code. A harness is translated into one JSON shape,
a **harness run** (`src/model.ts`), either by an importer here or by the harness itself.
Project files are only read, never changed or uploaded.

## Run it

Needs Node.js 18+ (the tests use Node 21+).

```bash
cd "Harness Execution Dashboard"
npm install      # first time only
npm run dev      # → http://localhost:8789
npm run build    # typecheck + production build into dist/
npm test         # importer tests
```

- `http://localhost:8789/#agents`: open a tab directly (`#execution`, `#agents`, `#work`, `#timeline`, `#stats`)
- `http://localhost:8789/?data=plsql-pyspark`: a sample instead of the imported run (also `cobol-java`, `custom`)

The eight tiles at the top are the Forward Engineering Dashboard's, calculated the same way:

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

The page reads `public/data/run.json` and re-reads it every 15 seconds, so re-running the
import while a harness works keeps the page current. Without an imported run it shows the
first sample. Samples are always labelled as such.

## Import a harness

```bash
npm run import -- --from <path> [--as bmad|cobol|run] [--trait "Source=PL/SQL"] [--trait "Target=PySpark"]
```

`--from` is recognised without `--as`:

| `--from` | Harness | Reader |
|---|---|---|
| A project folder with `_bmad/` or `_bmad-output/` | BMAD Method v7 | `scripts/readers/bmad.mjs` |
| The Forward Engineering Dashboard's data file (`public/data/dashboard-data.json` or `sample.json` there) | COBOL → Java harness | `scripts/readers/cobol.mjs` |
| A harness-run `.json` | Any harness that writes its own run file | validated as it is |

`--trait` adds what kind of harness it is (method, source, target, …); they show in the header
and sidebar. The run is validated before it is written; an invalid input writes nothing and
names each problem.

### BMAD

BMAD's agents (Mary, John, Sally, Winston, Amelia) and its four phases (analysis, planning,
implementation, validation) come from the BMAD-METHOD skills. Progress is read from the
project:

- **Configuration:** `_bmad/config.toml`, overridden by `_bmad/custom/config.toml` and then `config.user.toml`. It gives `output_folder` and `active_initiative`.
- **Documents:** `<type>-<slug>/<type>-<slug>.md`, for the brief, PRD, UX, architecture, spec and so on. The frontmatter `status` is `draft` or `final`.
- **Ticket tree:** `tickets.toml` files, plus each ticket's `*-plan.md`, whose `status` field moves from `draft` through `in-progress`, `in-review` and `built` to `done`, `blocked` or `dropped`.
- **Code review:** a `## Code Review` block in a ticket's plan.
- **Retrospective:** an `epic-<slug>-retrospective.md` file in the epic's folder.

BMAD does not record which agent is active. The position is worked out from these files, in
this order:

1. a blocked ticket
2. a ticket in progress
3. a ticket in review
4. a document in draft
5. the next step that has no output yet

A v6 project (`_bmad/bmm/config.yaml`) is refused with the migration command to run.

### COBOL → Java harness

The harness's own lifecycle: Understand → Design → Migrate, 13 stages, 16 gates and 11 agent
roles with model tiers. The stories the Build stage generates are work items, in build order,
not steps. Statuses the harness output did not record show as **not recorded**, never as done.
Story acceptance, verification and the traceability check follow that dashboard's own rules,
so its tiles and these agree. Re-import after running that dashboard's `npm run import`.

## Describe any harness

A harness with no reader here writes the run file itself and imports it with `--from`.
`examples/harness-run.example.json` is a complete example for a harness that has no reader.
The shape, fully typed in `src/model.ts`:

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

To support a harness's own output format directly, add a reader in `scripts/readers/` that
returns this shape, and a branch for it in `scripts/import.mjs`.

## Layout

```
src/model.ts             the harness run: the one shape every harness is translated into
src/lib/derive.ts        progress, phase status, agent state, current position
src/lib/useRun.ts        loads run.json or a sample, refreshes it
src/components/          shell (sidebar, header, banner, KPI tiles, "now" card, tab bar) and ui kit
src/views/               Execution, Agents, Work items, Timeline, Harness stats
scripts/import.mjs       detects the input, runs its reader, validates, writes run.json
scripts/readers/         bmad.mjs, cobol.mjs
scripts/validate.mjs     checks a run against the model
scripts/fixtures/        an illustrative BMAD project (PL/SQL → PySpark) used by the tests and the sample
examples/                a hand-written run file for a harness with no reader
public/data/samples/     the samples and their index
```

Stack: React 19, TypeScript, Vite, Tailwind CSS, lucide-react, and `smol-toml` for BMAD's
ticket files. The visual design is the Forward Engineering Dashboard's.
