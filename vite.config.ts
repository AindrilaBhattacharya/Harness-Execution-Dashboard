import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

// 8789 sits next to the Forward Engineering Dashboard on 8788.
// The live harness is the COBOL harness's control plane (FastAPI, default http://127.0.0.1:8005);
// HARNESS_API overrides it.
const harnessApi = `${process.env.HARNESS_API ?? "http://127.0.0.1:8005"}/api`;

/**
 * GET /live/run[?workspace=<id>]: the dashboard's server reads the harness API, maps the run
 * (src/live/cobolHarness.ts) and returns one HarnessRun. The browser never calls the harness
 * itself, so it gets one compact document instead of the harness's multi-megabyte responses.
 */
function liveHarness(): Plugin {
  return {
    name: "live-harness",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/live/run", async (req, res) => {
        const workspace = new URL(req.url ?? "", "http://x").searchParams.get("workspace") ?? undefined;
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        try {
          const { loadLiveRun } = await server.ssrLoadModule("/src/live/cobolHarness.ts");
          res.end(JSON.stringify(await loadLiveRun(harnessApi, workspace)));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: e instanceof Error ? `${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ""}` : String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), liveHarness()],
  server: { port: 8789 },
  preview: { port: 8789 },
});
