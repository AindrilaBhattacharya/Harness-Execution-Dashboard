// Where a harness is read from, for the command line and the dev server: a local folder, a
// local file, or a GitHub repo/folder link. The browser has its own sources (src/discover/browser.js).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { githubSource, isGitHubUrl } from "../src/discover/github.js";
import { SKIP_DIRS } from "../src/discover/text.js";

const MAX_FILES = 50_000;

/** A local folder (walked on every list(), so it follows a running harness) or one file. */
export function localSource(path) {
  const root = resolve(path);
  const st = statSync(root);
  const cache = new Map(); // path → { key, text }, reused while size and mtime are unchanged
  const abs = (p) => (st.isDirectory() ? join(root, ...p.split("/")) : root);
  let meta = new Map();
  return {
    kind: "local",
    label: root,
    name: basename(root),
    async list() {
      meta = new Map();
      if (!st.isDirectory()) {
        const s = statSync(root);
        meta.set(basename(root), s);
        return [{ path: basename(root), size: s.size, mtime: s.mtime.toISOString() }];
      }
      const out = [];
      const walk = (dir, prefix) => {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (out.length >= MAX_FILES || SKIP_DIRS.has(e.name)) continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) walk(join(dir, e.name), rel);
          else if (e.isFile()) {
            try {
              const s = statSync(join(dir, e.name));
              meta.set(rel, s);
              out.push({ path: rel, size: s.size, mtime: s.mtime.toISOString() });
            } catch {
              /* vanished while listing */
            }
          }
        }
      };
      walk(root, "");
      return out;
    },
    async read(p) {
      const s = meta.get(p);
      const key = s ? `${s.size}:${s.mtimeMs}` : "";
      const hit = cache.get(p);
      if (hit && hit.key === key) return hit.text;
      const text = readFileSync(abs(p), "utf8");
      cache.set(p, { key, text });
      return text;
    },
  };
}

/** A GitHub link or a local path. GITHUB_TOKEN, when set, is used for GitHub. */
export function openSource(from, { token = process.env.GITHUB_TOKEN } = {}) {
  return isGitHubUrl(from) ? githubSource(from, { token }) : localSource(from);
}
