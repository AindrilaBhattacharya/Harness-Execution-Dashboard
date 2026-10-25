// Reads a GitHub repo or folder as if it were a local folder.
//
//   https://github.com/<owner>/<repo>                     the default branch, whole repo
//   https://github.com/<owner>/<repo>/tree/<ref>/<path>   one folder at a branch, tag or commit
//   https://github.com/<owner>/<repo>/blob/<ref>/<path>   one file
//
// One API call lists the tree (re-validated with its ETag, so an unchanged repo costs no rate
// limit); file contents come from raw.githubusercontent.com, cached by blob SHA. Works in the
// browser for public repos and in Node; a token (GITHUB_TOKEN) is needed for private ones.

/** @returns {{ owner: string, repo: string, kind: "tree"|"blob"|null, rest: string[] } | null} */
export function parseGitHubUrl(input) {
  const m = (input ?? "").trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(tree|blob)\/([^?#\s]+?))?\/?(?:[?#].*)?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2], kind: m[3] ? /** @type {"tree"|"blob"} */ (m[3].toLowerCase()) : null, rest: m[4] ? m[4].split("/").filter(Boolean).map(decodeURIComponent) : [] };
}

export const isGitHubUrl = (s) => parseGitHubUrl(s) !== null;

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

/**
 * @param {string} url
 * @param {{ token?: string, fetch?: typeof fetch }} [opts]
 */
export function githubSource(url, opts = {}) {
  const u = parseGitHubUrl(url);
  if (!u) throw new Error(`${url} is not a GitHub repo or folder link (https://github.com/<owner>/<repo>[/tree/<branch>/<folder>])`);
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const headers = { Accept: "application/vnd.github+json", ...(opts.token && { Authorization: `Bearer ${opts.token}` }) };
  const api = (p) => `https://api.github.com/repos/${u.owner}/${u.repo}${p}`;

  /** @type {{ ref: string, prefix: string, files: { path: string, size?: number, sha?: string }[], etag?: string, truncated: boolean } | undefined} */
  let tree;
  const blobs = new Map(); // sha → text

  async function failure(res, what) {
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      return new Error(`GitHub rate limit reached${opts.token ? "" : " (60 requests an hour without a token; set GITHUB_TOKEN)"}${reset ? `, resets at ${new Date(reset).toLocaleTimeString()}` : ""}.`);
    }
    if (res.status === 404) return new Error(`${what}: not found on GitHub${opts.token ? "" : ", or the repo is private (set GITHUB_TOKEN)"}.`);
    if (res.status === 401) return new Error("GitHub rejected the token (401).");
    return new Error(`${what}: GitHub answered ${res.status} ${res.statusText}`);
  }

  async function fetchTree(ref, etag) {
    return f(api(`/git/trees/${encodePath(ref)}?recursive=1`), { headers: { ...headers, ...(etag && { "If-None-Match": etag }) }, cache: "no-store" });
  }

  /** Splits <ref>/<path> (a ref may itself contain slashes) by trying the longest-first ref. */
  async function resolveTree() {
    if (!u.rest.length) {
      const res = await f(api(""), { headers, cache: "no-store" });
      if (!res.ok) throw await failure(res, `${u.owner}/${u.repo}`);
      const ref = (await res.json()).default_branch;
      return { ref, prefix: "", res: await fetchTree(ref) };
    }
    for (let i = 1; i <= u.rest.length; i++) {
      const ref = u.rest.slice(0, i).join("/");
      const res = await fetchTree(ref);
      if (res.ok) return { ref, prefix: u.rest.slice(i).join("/"), res };
      if (res.status !== 404 && res.status !== 422) throw await failure(res, `${u.owner}/${u.repo}@${ref}`);
    }
    throw new Error(`${url}: no branch, tag or commit of ${u.owner}/${u.repo} matches this link.`);
  }

  const source = {
    kind: "github",
    get label() {
      return `github.com/${u.owner}/${u.repo}${tree ? `/${u.kind === "blob" ? "blob" : "tree"}/${tree.ref}${tree.prefix ? `/${tree.prefix}` : ""}` : ""}`;
    },
    get name() {
      return (tree?.prefix || u.rest.slice(1).join("/") || u.repo).split("/").pop() || u.repo;
    },
    get truncated() {
      return tree?.truncated ?? false;
    },
    async list() {
      let res;
      if (tree) {
        res = await fetchTree(tree.ref, tree.etag);
        if (res.status === 304) return tree.files;
        if (!res.ok) throw await failure(res, source.label);
      } else {
        const r = await resolveTree();
        tree = { ref: r.ref, prefix: r.prefix, files: [], truncated: false };
        res = r.res;
        if (!res.ok) throw await failure(res, source.label);
      }
      const body = await res.json();
      const prefix = tree.prefix;
      const isFile = u.kind === "blob";
      tree.etag = res.headers.get("etag") ?? undefined;
      tree.truncated = !!body.truncated;
      tree.files = (body.tree ?? [])
        .filter((e) => e.type === "blob" && (isFile ? e.path === prefix : !prefix || e.path.startsWith(`${prefix}/`)))
        .map((e) => ({ path: isFile ? e.path.split("/").pop() : prefix ? e.path.slice(prefix.length + 1) : e.path, size: e.size, sha: e.sha, full: e.path }));
      if (isFile && !tree.files.length) throw new Error(`${url}: file not found at ${tree.ref}.`);
      return tree.files;
    },
    async read(path) {
      if (!tree) await source.list();
      const entry = tree.files.find((e) => e.path === path);
      if (!entry) throw new Error(`${path}: not in ${source.label}`);
      if (entry.sha && blobs.has(entry.sha)) return blobs.get(entry.sha);
      const res = opts.token
        ? await f(api(`/contents/${encodePath(entry.full)}?ref=${encodeURIComponent(tree.ref)}`), { headers: { ...headers, Accept: "application/vnd.github.raw" } })
        : await f(`https://raw.githubusercontent.com/${u.owner}/${u.repo}/${encodePath(tree.ref)}/${encodePath(entry.full)}`);
      if (!res.ok) throw await failure(res, path);
      const text = await res.text();
      if (entry.sha) blobs.set(entry.sha, text);
      return text;
    },
  };
  return source;
}
