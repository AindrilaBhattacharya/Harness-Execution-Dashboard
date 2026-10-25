import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

/**
 * HARNESS_FROM=<folder | file | GitHub link>: GET /data/run.json reads that harness with the
 * discovery engine on request, so the page follows it without `npm run import`. A local folder
 * is re-read at most every 3 seconds; a GitHub link at most once a minute (GITHUB_TOKEN, when
 * set, is used for private repos). Without HARNESS_FROM, public/data/run.json is served as is.
 */
function harnessFrom(from: string): Plugin {
  return {
    name: "harness-from",
    configureServer(server: ViteDevServer) {
      // Loaded at run time, not bundled into the config.
      const mod = (p: string) => import(/* @vite-ignore */ new URL(p, import.meta.url).href);
      let source: { kind: string } | undefined;
      let last: { at: number; body: string; status: number } | undefined;
      let pending: Promise<{ body: string; status: number }> | undefined;
      const refresh = async () => {
        try {
          const [{ openSource }, { discoverRun }, { validateRun }] = await Promise.all([
            mod("./scripts/sources.mjs"), mod("./src/discover/discover.js"), mod("./src/discover/validate.js"),
          ]);
          source ??= openSource(from);
          const run = await discoverRun(source);
          const errors: string[] = validateRun(run);
          if (errors.length) throw new Error(`The run is not valid: ${errors.join("; ")}`);
          return { body: JSON.stringify(run), status: 200 };
        } catch (e) {
          return { body: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), status: 502 };
        }
      };
      server.middlewares.use("/data/run.json", async (_req, res) => {
        const maxAge = source?.kind === "github" ? 60_000 : 3_000;
        if (!last || Date.now() - last.at > maxAge) {
          pending ??= refresh().finally(() => (pending = undefined));
          const r = await pending;
          last = { ...r, at: Date.now() };
        }
        res.statusCode = last.status;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(last.body);
      });
    },
  };
}

const from = process.env.HARNESS_FROM;
const port = Number(process.env.PORT ?? 8789);

export default defineConfig({
  plugins: [react(), ...(from ? [harnessFrom(from)] : [])],
  server: { port, strictPort: !!process.env.PORT },
  preview: { port },
});
