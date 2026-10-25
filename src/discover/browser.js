// Sources for files chosen in the page: a folder handle (re-read on every refresh, where the
// browser supports the File System Access API) or a fixed list of File objects (a folder picked
// with <input webkitdirectory>, dropped files, or one file).
import { isSkippedPath } from "./text.js";

const MAX_FILES = 50_000;

/** A folder the user granted access to; re-listed on every refresh, so the page follows it. */
export function directoryHandleSource(handle) {
  /** @type {Map<string, any>} */
  let handles = new Map();
  return {
    kind: "browser-folder",
    label: handle.name,
    name: handle.name,
    async list() {
      const files = [];
      handles = new Map();
      async function walk(dir, prefix) {
        for await (const entry of dir.values()) {
          if (files.length >= MAX_FILES) return;
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (isSkippedPath(path)) continue;
          if (entry.kind === "directory") await walk(entry, path);
          else {
            const file = await entry.getFile();
            files.push({ path, size: file.size, mtime: new Date(file.lastModified).toISOString() });
            handles.set(path, entry);
          }
        }
      }
      await walk(handle, "");
      return files;
    },
    async read(path) {
      const h = handles.get(path);
      if (!h) throw new Error(`${path}: not in ${handle.name}`);
      return (await h.getFile()).text();
    },
  };
}

/**
 * A fixed set of files. Paths come from webkitRelativePath when the files are a picked folder
 * ("root/a/b.md" → "a/b.md"), else the file name.
 * @param {File[]} fileList
 * @param {string} [label]
 */
export function fileListSource(fileList, label) {
  const rel = (f) => /** @type {any} */ (f).relativePath || f.webkitRelativePath || f.name;
  const all = [...fileList];
  const roots = new Set(all.map((f) => rel(f).split("/")[0]));
  const root = roots.size === 1 && all.some((f) => rel(f).includes("/")) ? [...roots][0] : undefined;
  const byPath = new Map();
  for (const f of all) {
    const path = root ? rel(f).slice(root.length + 1) : rel(f);
    if (path && !isSkippedPath(path) && byPath.size < MAX_FILES) byPath.set(path, f);
  }
  const name = label ?? root ?? (all.length === 1 ? all[0].name : "Chosen files");
  return {
    kind: "browser-files",
    label: name,
    name,
    async list() {
      return [...byPath].map(([path, f]) => ({ path, size: f.size, mtime: new Date(f.lastModified).toISOString() }));
    },
    async read(path) {
      const f = byPath.get(path);
      if (!f) throw new Error(`${path}: not among the chosen files`);
      return f.text();
    },
  };
}

/** Files of a dropped folder, read through the older entries API (browsers without handles). */
export async function filesFromEntries(entries) {
  const out = [];
  async function walk(entry, prefix) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (out.length >= MAX_FILES || isSkippedPath(path)) return;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(file, "relativePath", { value: path });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, path);
      }
    }
  }
  for (const e of entries) await walk(e, "");
  return out;
}
