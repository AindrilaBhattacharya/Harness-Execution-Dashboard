// Checks a harness run against src/model.ts before it is written, so a wrong input fails
// with a message naming the field instead of rendering a misleading dashboard.

const STATUSES = new Set(["pending", "active", "done", "blocked", "skipped", "unknown"]);
const STATES = new Set(["not_started", "running", "paused", "blocked", "finished", "unknown"]);
const LEVELS = new Set(["info", "success", "warning", "error"]);
const PROVENANCE = new Set(["observed", "derived", "inferred"]);

/** @returns {string[]} problems; empty when the run is valid */
export function validateRun(run) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  const str = (v) => typeof v === "string" && v.length > 0;

  need(run && typeof run === "object", "the run must be a JSON object");
  if (errors.length) return errors;
  need(run.schemaVersion === 1, "schemaVersion must be 1");
  need(str(run.harness?.id) && str(run.harness?.name), "harness.id and harness.name are required");
  need(str(run.project?.name), "project.name is required");
  need(str(run.importedAt), "importedAt is required (ISO date-time)");
  need(Array.isArray(run.phases) && run.phases.length > 0, "phases must be a non-empty array");
  need(Array.isArray(run.agents), "agents must be an array");
  if (errors.length) return errors;

  const agentIds = new Set();
  run.agents.forEach((a, i) => {
    need(str(a.id) && str(a.name) && str(a.role), `agents[${i}] needs id, name and role`);
    need(!agentIds.has(a.id), `agents[${i}].id "${a.id}" is used twice`);
    agentIds.add(a.id);
  });

  const phaseKeys = new Set();
  const stepKeys = new Map(); // phase key -> step keys
  run.phases.forEach((p, i) => {
    const at = `phases[${i}]`;
    need(str(p.key) && str(p.label), `${at} needs key and label`);
    need(!phaseKeys.has(p.key), `${at}.key "${p.key}" is used twice`);
    phaseKeys.add(p.key);
    need(Array.isArray(p.steps), `${at}.steps must be an array`);
    const keys = new Set();
    (p.steps ?? []).forEach((s, j) => {
      const sat = `${at}.steps[${j}]`;
      need(str(s.key) && str(s.label), `${sat} needs key and label`);
      need(!keys.has(s.key), `${sat}.key "${s.key}" is used twice in phase "${p.key}"`);
      keys.add(s.key);
      need(STATUSES.has(s.status), `${sat}.status "${s.status}" is not one of ${[...STATUSES].join(", ")}`);
      need(s.provenance === undefined || PROVENANCE.has(s.provenance), `${sat}.provenance "${s.provenance}" is not one of ${[...PROVENANCE].join(", ")}`);
      need(Array.isArray(s.agentIds), `${sat}.agentIds must be an array`);
      (s.agentIds ?? []).forEach((id) => need(agentIds.has(id), `${sat} names agent "${id}", which is not in agents`));
      need(s.gates === undefined || Array.isArray(s.gates), `${sat}.gates must be an array`);
      (s.gates ?? []).forEach((g, k) => need(str(g.label) && STATUSES.has(g.status), `${sat}.gates[${k}] needs a label and a valid status`));
    });
    stepKeys.set(p.key, keys);
  });

  const pos = run.position;
  need(pos && STATES.has(pos.state), `position.state must be one of ${[...STATES].join(", ")}`);
  if (pos?.phaseKey) need(phaseKeys.has(pos.phaseKey), `position.phaseKey "${pos.phaseKey}" is not a phase`);
  if (pos?.stepKey) need(stepKeys.get(pos.phaseKey)?.has(pos.stepKey), `position.stepKey "${pos.stepKey}" is not a step of phase "${pos.phaseKey}"`);
  if (pos?.agentId) need(agentIds.has(pos.agentId), `position.agentId "${pos.agentId}" is not in agents`);

  const epicIds = new Set();
  (run.epics ?? []).forEach((e, i) => {
    need(str(e.id) && str(e.title), `epics[${i}] needs id and title`);
    need(!epicIds.has(e.id), `epics[${i}].id "${e.id}" is used twice`);
    need(e.status === undefined || STATUSES.has(e.status), `epics[${i}].status "${e.status}" is not valid`);
    epicIds.add(e.id);
  });
  const itemIds = new Set();
  (run.workItems ?? []).forEach((w, i) => {
    const at = `workItems[${i}]`;
    need(str(w.id) && str(w.title), `${at} needs id and title`);
    need(STATUSES.has(w.status), `${at}.status "${w.status}" is not valid`);
    if (w.epicId !== undefined) need(epicIds.has(w.epicId), `${at}.epicId "${w.epicId}" is not in epics`);
    (w.acceptanceCriteria ?? []).forEach((a, k) => need(str(a.id) || str(a.text), `${at}.acceptanceCriteria[${k}] needs an id or a text`));
    (w.gates ?? []).forEach((g, k) => need(str(g.label) && STATUSES.has(g.status), `${at}.gates[${k}] needs a label and a valid status`));
    itemIds.add(w.id);
  });
  if (pos?.workItemId) need(itemIds.has(pos.workItemId), `position.workItemId "${pos.workItemId}" is not in workItems`);

  (run.timeline ?? []).forEach((e, i) => {
    need(str(e.at) && str(e.summary), `timeline[${i}] needs at and summary`);
    need(LEVELS.has(e.level), `timeline[${i}].level must be one of ${[...LEVELS].join(", ")}`);
    if (e.agentId) need(agentIds.has(e.agentId), `timeline[${i}] names agent "${e.agentId}", which is not in agents`);
  });
  const THREAD = new Set(["complete", "in_progress", "no_evidence", "broken"]);
  (run.traceability ?? []).forEach((t, i) => need(str(t.id) && THREAD.has(t.state), `traceability[${i}] needs an id and a state (${[...THREAD].join(", ")})`));
  (run.artifacts ?? []).forEach((a, i) => need(str(a.label), `artifacts[${i}] needs a label`));
  if (run.progressWeights) need(typeof run.progressWeights.steps === "number" && typeof run.progressWeights.workItems === "number", "progressWeights needs numeric steps and workItems");
  (run.metrics ?? []).forEach((m, i) => need(str(m.label) && m.value !== undefined, `metrics[${i}] needs label and value`));
  return errors;
}
