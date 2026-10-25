// Text helpers for the discovery engine: front matter, status words, names and tokens.
// Nothing here knows about any particular harness; it reads conventions shared by many.

/** Folders never worth reading: dependencies, caches, build output, version control. */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", ".venv", "venv", "__pycache__", "dist", "build", "target",
  ".next", ".nuxt", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".mvn", ".gradle", ".idea",
  ".vscode", "site-packages", "coverage", ".cache", ".turbo", "vendor", "bower_components",
]);

export const isSkippedPath = (path) => path.split("/").some((seg) => SKIP_DIRS.has(seg));

export const basename = (path) => path.slice(path.lastIndexOf("/") + 1);
export const dirname = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const stem = (name) => basename(name).replace(/\.[^.]+$/, "").replace(/\.(agent|prompt|chatmode)$/i, "");
export const extname = (path) => (basename(path).match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();

/** A folder name that is a run timestamp, e.g. 2026-07-29T16.05.30.018Z or 20260729-160530. */
export const TIMESTAMP_DIR = /^\d{4}-?\d{2}-?\d{2}(?:[T_ -]?\d{2}[.:-]?\d{2}(?:[.:-]?\d{2}(?:[.,]\d+)?)?Z?)?$/;

/** A run-folder name → ISO time, when it reads as one. */
export function timestampOf(name) {
  const m = name.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T_ -]?(\d{2})[.:-]?(\d{2})(?:[.:-]?(\d{2})(?:[.,](\d+))?)?)?Z?$/);
  if (!m) return undefined;
  const [, y, mo, d, h = "00", mi = "00", s = "00", ms] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${ms ? `.${ms.slice(0, 3).padEnd(3, "0")}` : ""}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const STOPWORDS = new Set([
  "agent", "agents", "the", "and", "for", "with", "from", "into", "md", "json", "yaml", "yml", "toml",
  "output", "outputs", "file", "files", "run", "runs", "step", "stage", "phase", "persona", "prompt",
]);

/** Meaningful lowercase words of a name: "02_root-cause-analyst" → ["root", "cause", "analyst"]. */
export function tokens(s) {
  return (s ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t));
}

/** The order number a name starts with: "01_architect" → 1, "04b-fixer" → 4, "agent-07-ship" → 7. */
export function leadingNumber(s) {
  const m = basename(s ?? "").match(/^(?:agent[-_ ]?)?(\d{1,3})(?:[a-z](?=[\s._-]))?(?=[\s._-]|$)/i);
  return m ? Number(m[1]) : undefined;
}

/** "02_root-cause-analyst.agent.md" → "Root cause analyst". */
export function humanize(s) {
  const words = stem(s ?? "")
    .replace(/^(?:agent[-_ ]?)?\d{1,3}[a-z]?(?=[\s._-])[\s._-]*/i, "")
    .replace(/[\s._-]+agent$/i, "")
    .replace(/[_\s-]+/g, " ")
    .trim();
  if (!words) return stem(s ?? "");
  return words === words.toUpperCase() && /[A-Z]{2}/.test(words) ? words : words[0].toUpperCase() + words.slice(1);
}

export const slug = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";

/** First sentence of a text, skipping one that only says where something sits ("Second agent in the …"). */
export function firstSentence(text, max = 140) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  // a sentence ends at . ! ? followed by a space, so "artifact.json" or "e.g." mid-word stays in
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(`*[])/);
  const positional = /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|last|next|optional|\w+th)\b[^.]*\b(?:agent|stage|step)\b/i;
  const pick = (sentences.length > 1 && positional.test(sentences[0]) ? sentences[1] : sentences[0]).trim();
  return pick.length <= max ? pick : `${pick.slice(0, pick.lastIndexOf(" ", max - 1))}…`;
}

/**
 * YAML front matter between --- lines: scalars, quoted strings, folded/literal blocks, inline
 * [a, b] lists and "- item" lists. Enough for agent definitions and document metadata.
 * @returns {{ data: Record<string, unknown>, body: string }}
 */
export function frontMatter(text) {
  const src = (text ?? "").replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!m) return { data: {}, body: src };
  const data = {};
  const lines = m[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    let v = raw.trim();
    if (/^[>|][+-]?$/.test(v)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i].trim());
      data[key] = v.startsWith(">") ? block.join(" ").replace(/\s+/g, " ").trim() : block.join("\n").trim();
    } else if (v === "") {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) list.push(unquote(lines[++i].replace(/^\s*-\s+/, "")));
      data[key] = list.length ? list : "";
    } else if (/^\[.*\]$/.test(v)) {
      data[key] = v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
    } else data[key] = unquote(v);
  }
  return { data, body: src.slice(m[0].length) };
}

function unquote(v) {
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
  return v.replace(/\s+#.*$/, "");
}

/** First markdown heading of a body. */
export function firstHeading(body) {
  const m = (body ?? "").match(/^#{1,3}\s+(.+?)\s*#*\s*$/m);
  return m ? cleanInline(m[1]) : undefined;
}

/** Markdown inline marks, links and leading emoji removed. */
export const cleanInline = (s) =>
  (s ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w])[*_](?=\S)(.+?)(?<=\S)[*_](?=[^\w]|$)/g, "$1$2")
    .replace(/[`~]|\*/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim();

const STATUS_KEYS = /^(?:status|state|verdict|decision|result|outcome)$/i;

/**
 * The status a markdown document states about itself: front matter `status:`, a table row
 * `| **Status** | Approved |`, or a line `Status: Approved`. Only the first lines are searched.
 */
export function documentStatus(text) {
  const { data, body } = frontMatter(text);
  for (const [k, v] of Object.entries(data)) if (STATUS_KEYS.test(k) && typeof v === "string" && v) return { raw: v, from: "front matter" };
  const lines = body.split("\n").slice(0, 80);
  for (const line of lines) {
    const row = line.match(/^\s*\|\s*\**\s*(status|state|verdict|decision|result|outcome)\s*\**\s*\|\s*(.+?)\s*\|/i);
    if (row) return { raw: statusWord(row[2]), from: "table" };
    const kv = line.match(/^\s*(?:[-*]\s+)?\**(status|verdict|decision|outcome)\**\s*:\**\s*(.+)$/i);
    if (kv) return { raw: statusWord(kv[2]), from: "line" };
  }
  return undefined;
}

/** The leading status word(s) of a cell: "`Approved` (by J. Doe)" → "Approved". */
const statusWord = (cell) => cleanInline(cell).match(/^[A-Za-z][A-Za-z_ -]{0,38}[A-Za-z]|^[A-Za-z]/)?.[0]?.trim() ?? cleanInline(cell);

/**
 * Maps a harness's own status word to one of the dashboard's six statuses.
 * @returns {"pending"|"active"|"done"|"blocked"|"skipped"|"unknown"}
 */
export function mapStatus(raw) {
  if (raw === true) return "done";
  if (raw === false) return "blocked";
  if (typeof raw !== "string" || !raw.trim()) return "unknown";
  const w = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(pending|todo|to_do|open|new|proposed|queued|planned|ready|not_started|not_run|waiting|backlog|scheduled|idle)$/.test(w)) return "pending";
  if (/^(skipped|skip|dropped|n\/a|na|not_applicable|deferred|wontfix|won't_fix|ignored|superseded)$/.test(w)) return "skipped";
  if (/^(unknown|not_recorded|inconclusive|unclear|none)$/.test(w)) return "unknown";
  if (/fail|error|reject|block|vulnerab|broken|refus|denied|crash|abort|cancel|timed_out|timeout/.test(w)) return "blocked";
  if (/^(no|not|zero|without)_/.test(w)) return "done";
  if (/progress|running|started|working|review|draft|building|built|implementing|wip|partial|active|ongoing/.test(w)) return "active";
  if (/^(done|ok|green|final|closed|shipped|released|published|merged)$|pass|success|succeed|complet|approv|accept|clear|fix|resolv|verif|preserv|compil/.test(w)) return "done";
  return "unknown";
}

/** Numbers under a document's stats-like keys, one level deep: { group → [label, value][] }. */
export function statsOf(doc) {
  const out = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return out;
  for (const [k, v] of Object.entries(doc)) {
    if (!/^(stats|statistics|summary|counts|metrics|totals|quality)$/i.test(k) || !v || typeof v !== "object") continue;
    for (const [label, n] of Object.entries(v)) {
      if (typeof n === "number") out.push([label.replace(/_/g, " "), n]);
      else if (n && typeof n === "object" && !Array.isArray(n))
        for (const [sub, m] of Object.entries(n)) if (typeof m === "number") out.push([`${label.replace(/_/g, " ")} · ${sub.replace(/_/g, " ").toLowerCase()}`, m]);
    }
  }
  return out;
}

/** The first ISO-looking time under common timestamp keys. */
export function timeOf(doc) {
  if (!doc || typeof doc !== "object") return undefined;
  for (const k of ["finished_at", "finishedAt", "completed_at", "completedAt", "generated_at", "generatedAt", "updated_at", "updatedAt", "timestamp", "created_at", "createdAt", "at", "date"]) {
    const v = doc[k];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  }
  return undefined;
}
