// What the page has been asked to read, remembered per browser, and how to open it.
//
//   github   a GitHub repo/folder link (localStorage), re-read once a minute
//   folder   a folder handle (IndexedDB) where the browser supports the File System Access API,
//            re-read every few seconds; reading it again after a reload needs one click
//   file     one file: its handle (re-read) or, without handles, its text (IndexedDB)
//   snapshot files picked or dropped without handles; kept for this tab only
// Nothing chosen: the dashboard's own server run (/data/run.json) is shown.
import { directoryHandleSource, fileListSource, filesFromEntries } from "../discover/browser.js";
import { githubSource, parseGitHubUrl } from "../discover/github.js";

export type Choice =
  | { kind: "github"; url: string }
  | { kind: "folder"; name: string }
  | { kind: "file"; name: string }
  | { kind: "snapshot"; name: string };

export interface Source {
  kind: string;
  label: string;
  name: string;
  list(): Promise<{ path: string; size?: number; mtime?: string }[]>;
  read(path: string): Promise<string>;
}

export class PermissionNeeded extends Error {
  constructor(public name: string, public grant: () => Promise<boolean>) {
    super(`Reading ${name} again needs your permission.`);
  }
}

const KEY = "harness-dashboard.source";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const w = window as Any;

export const canPickFolder = typeof w.showDirectoryPicker === "function";
export const canPickFile = typeof w.showOpenFilePicker === "function";

export function savedChoice(): Choice | null {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return c && typeof c.kind === "string" && c.kind !== "snapshot" ? c : null;
  } catch {
    return null;
  }
}

function remember(c: Choice | null) {
  try {
    if (c && c.kind !== "snapshot") localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the choice lasts for this tab */
  }
}

// ---- IndexedDB, for folder/file handles and file text -------------------------------------
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("harness-dashboard", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction("kv", mode).objectStore("kv"));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}
const idbGet = <T>(k: string) => idb<T>("readonly", (s) => s.get(k)).catch(() => undefined);
const idbSet = (k: string, v: unknown) => idb("readwrite", (s) => s.put(v, k)).catch(() => undefined);

// ---- choosing ------------------------------------------------------------------------------
let snapshot: Source | undefined; // files without handles, this tab only
const githubCache = new Map<string, Source>(); // keeps ETag and file caches between refreshes

export function chooseGitHub(url: string): Choice {
  if (!parseGitHubUrl(url)) throw new Error("That is not a GitHub repo or folder link. It should look like https://github.com/<owner>/<repo>/tree/<branch>/<folder>.");
  const c: Choice = { kind: "github", url: url.trim() };
  remember(c);
  return c;
}

/** Opens the folder picker; null when this browser has none (use a webkitdirectory input). */
export async function pickFolder(): Promise<Choice | null> {
  if (!canPickFolder) return null;
  const handle = await w.showDirectoryPicker({ mode: "read" });
  await idbSet("folder", handle);
  const c: Choice = { kind: "folder", name: handle.name };
  remember(c);
  return c;
}

/** Opens the file picker; null when this browser has none (use a plain file input). */
export async function pickFile(): Promise<Choice | null> {
  if (!canPickFile) return null;
  const [handle] = await w.showOpenFilePicker({ multiple: false });
  await idbSet("file", { handle });
  const c: Choice = { kind: "file", name: handle.name };
  remember(c);
  return c;
}

/** Files from an <input>: one file is kept (its text) across reloads; a folder for this tab only. */
export async function chooseFiles(files: File[]): Promise<Choice> {
  if (!files.length) throw new Error("No files were chosen.");
  if (files.length === 1 && !files[0].webkitRelativePath) {
    await idbSet("file", { name: files[0].name, text: await files[0].text() });
    const c: Choice = { kind: "file", name: files[0].name };
    remember(c);
    return c;
  }
  snapshot = fileListSource(files) as Source;
  const c: Choice = { kind: "snapshot", name: snapshot.name };
  remember(null);
  return c;
}

/** A drop: a folder or file handle where supported, else the dropped files. */
export async function chooseDrop(dt: DataTransfer): Promise<Choice> {
  const items = [...dt.items].filter((i) => i.kind === "file");
  const first = items[0] as Any;
  if (items.length === 1 && typeof first?.getAsFileSystemHandle === "function") {
    const handle = await first.getAsFileSystemHandle();
    if (handle?.kind === "directory") {
      await idbSet("folder", handle);
      const c: Choice = { kind: "folder", name: handle.name };
      remember(c);
      return c;
    }
    if (handle?.kind === "file") {
      await idbSet("file", { handle });
      const c: Choice = { kind: "file", name: handle.name };
      remember(c);
      return c;
    }
  }
  const entries = items.map((i) => (i as Any).webkitGetAsEntry?.()).filter(Boolean);
  if (entries.some((e: Any) => e.isDirectory)) {
    snapshot = fileListSource(await filesFromEntries(entries)) as Source;
    remember(null);
    return { kind: "snapshot", name: snapshot.name };
  }
  return chooseFiles([...dt.files]);
}

export function forget() {
  snapshot = undefined;
  remember(null);
}

// ---- opening -------------------------------------------------------------------------------
async function permitted(handle: Any, name: string) {
  if ((await handle.queryPermission?.({ mode: "read" })) === "granted" || !handle.queryPermission) return;
  throw new PermissionNeeded(name, async () => (await handle.requestPermission({ mode: "read" })) === "granted");
}

/** The source for a choice, and how often to re-read it (0 = it cannot change). */
export async function open(c: Choice): Promise<{ source: Source; refreshMs: number }> {
  if (c.kind === "github") {
    let s = githubCache.get(c.url);
    if (!s) githubCache.set(c.url, (s = githubSource(c.url) as Source));
    return { source: s, refreshMs: 60_000 };
  }
  if (c.kind === "snapshot") {
    if (!snapshot) throw new Error("The chosen files are no longer available; choose them again.");
    return { source: snapshot, refreshMs: 0 };
  }
  if (c.kind === "folder") {
    const handle = await idbGet<Any>("folder");
    if (!handle) throw new Error(`The folder ${c.name} is no longer remembered; choose it again.`);
    await permitted(handle, c.name);
    return { source: directoryHandleSource(handle) as Source, refreshMs: 5_000 };
  }
  const stored = await idbGet<{ handle?: Any; name?: string; text?: string }>("file");
  if (stored?.handle) {
    await permitted(stored.handle, c.name);
    const handle = stored.handle;
    const source: Source = {
      kind: "browser-files",
      label: handle.name,
      name: handle.name,
      list: async () => {
        const f = await handle.getFile();
        return [{ path: f.name, size: f.size, mtime: new Date(f.lastModified).toISOString() }];
      },
      read: async () => (await handle.getFile()).text(),
    };
    return { source, refreshMs: 5_000 };
  }
  if (stored?.text !== undefined) return { source: fileListSource([new File([stored.text], stored.name ?? c.name)]) as Source, refreshMs: 0 };
  throw new Error(`The file ${c.name} is no longer remembered; choose it again.`);
}
