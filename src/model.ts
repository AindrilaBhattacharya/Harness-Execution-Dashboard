// What any forward-engineering harness looks like to this dashboard: its phases (made of
// steps), its agents, and where the run is now. A harness either writes this shape itself
// (see README "Describe any harness") or the discovery engine (src/discover/) works it out
// from the harness's files. The dashboard has no harness-specific code.
//
// Derived values (phase progress, which agents are working) are computed in src/lib/derive.ts,
// never stored, so they cannot disagree with the records.

/** Status of a step, gate or work item, mapped from the harness's own word by the importer. */
export type Status = "pending" | "active" | "done" | "blocked" | "skipped" | "unknown";

/**
 * Where a status came from:
 *   observed – recorded by the harness
 *   derived  – worked out from files the harness produced
 *   inferred – assumed so other facts make sense (e.g. a step must have run for its output to exist)
 */
export type Provenance = "observed" | "derived" | "inferred";

export interface HarnessRun {
  schemaVersion: 1;
  harness: {
    id: string;
    name: string;
    tagline?: string;
    /** What kind of harness this is, shown as chips: method, source, target, … */
    traits?: { label: string; value: string }[];
    /** The harness's plural name for its work items, e.g. "Stories" or "Tickets". */
    workItemLabel?: string;
    /** The harness's plural name for its epics, e.g. "Epics" or "Features". */
    epicLabel?: string;
  };
  project: { name: string; path?: string };
  importedAt: string;
  /** Illustrative data; always labelled as such. */
  sample?: boolean;
  /** How this run was obtained, when the discovery engine produced it. */
  discovery?: Discovery;
  timezone?: string;
  phases: Phase[];
  agents: Agent[];
  position: Position;
  /** Units of delivery (stories, tickets), when the harness has them. */
  workItems?: WorkItem[];
  /** What the harness plans its work items under (epics), when it has them. */
  epics?: Epic[];
  timeline?: TimelineEvent[];
  /**
   * Overall progress = steps · (stage steps done) + workItems · (work items verified), as
   * shares of 1. Without it, overall progress is the share of stage steps done.
   */
  progressWeights?: { steps: number; workItems: number };
  /** What the stages produced: documents, code, reports. */
  artifacts?: Artifact[];
  /** Requirements followed from source evidence to tested code, with the state of each thread. */
  traceability?: TraceThread[];
  /** Harness-specific numbers, shown as they are. */
  metrics?: Metric[];
  /** What the input did not contain, and what would provide it. */
  missing?: { what: string; needs: string }[];
}

export interface Phase {
  key: string;
  label: string;
  summary?: string;
  steps: Step[];
}

/** One unit of a phase: a stage, a workflow, a skill run. */
export interface Step {
  key: string;
  label: string;
  description?: string;
  /** Agents who do this step. */
  agentIds: string[];
  status: Status;
  rawStatus?: string; // the harness's own word, when it differs
  provenance?: Provenance;
  note?: string;
  /** What the step produces, e.g. "PRD" or a file path. */
  output?: string;
  optional?: boolean;
  startedAt?: string;
  finishedAt?: string;
  /** Set when this step is the work on one work item (a story in a build phase), not a stage. */
  workItemId?: string;
  gates?: Gate[];
}

/** A check that must pass before work moves on. */
export interface Gate {
  label: string;
  status: Status;
  detail?: string;
  approval?: { decision: "approved" | "rejected"; by: string; role?: string; at?: string };
}

export interface Artifact {
  label: string;
  path?: string;
  stepKey?: string;
}

/**
 * complete    – every layer linked and every work item on it done
 * in_progress – partly linked, or a work item on it is not done yet
 * no_evidence – linked to work, but cites no source evidence
 * broken      – no work item, or points at one that does not exist
 */
export interface TraceThread {
  id: string;
  title?: string;
  state: "complete" | "in_progress" | "no_evidence" | "broken";
}

export interface Agent {
  id: string;
  name: string; // "Mary", "Codegen"
  role: string; // "Business Analyst", "Implementation"
  description?: string;
  /** A short emoji or letter shown on the agent's badge. */
  icon?: string;
  model?: string;
  usage?: { runs?: number; tokens?: number; costUsd?: number };
}

export interface Position {
  state: "not_started" | "running" | "paused" | "blocked" | "finished" | "unknown";
  phaseKey?: string;
  stepKey?: string;
  agentId?: string;
  workItemId?: string;
  /** One sentence on what is happening now. */
  summary?: string;
  since?: string;
}

export interface Epic {
  id: string;
  title: string;
  /** What finishing it achieves. */
  summary?: string;
  /** Only when the harness records one; otherwise the dashboard derives it from the epic's work items. */
  status?: Status;
  rawStatus?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  status: Status;
  rawStatus?: string;
  epicId?: string;
  /** Another grouping (wave, bounded context); the board groups by it when there are no epics. */
  group?: string;
  /** "story", "bug", "spike", … */
  type?: string;
  agentId?: string;
  /** Its tests ran green, not merely done. */
  verified?: boolean;
  /** The story text: who wants what, and why. */
  description?: string;
  /** `covered`: a test cites it; left out when the harness does not record that. */
  acceptanceCriteria?: { id?: string; text?: string; covered?: boolean }[];
  /** Work item or epic ids it waits for. */
  dependsOn?: string[];
  gates?: Gate[];
  note?: string;
}

export interface TimelineEvent {
  at: string;
  summary: string;
  level: "info" | "success" | "warning" | "error";
  agentId?: string;
  phaseKey?: string;
  stepKey?: string;
}

export interface Metric {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "bad";
  /** Heading the metric is shown under, e.g. "Source" or "Target". */
  group?: string;
}

/**
 * run-file   – the harness wrote this run itself
 * state-file – read from a state file the harness keeps (stages, phases, roles, stories…)
 * files      – worked out from the harness's agent definitions and output folders
 */
export interface Discovery {
  method: "run-file" | "state-file" | "files";
  /** The folder, file or GitHub link that was read. */
  source: string;
  /** The run or state file, relative to the source. */
  file?: string;
  readAt: string;
  notes?: string[];
}
