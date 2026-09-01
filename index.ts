import app from "./src/server.ts";
import { getDb } from "./src/db.ts";
import { startScheduler } from "./src/scheduler.ts";

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || "0.0.0.0";

// Ensure DB init
getDb();

// Start cron/interval scheduler (Phase 4) — non-blocking
startScheduler().catch((e) => console.warn(`[scheduler] failed to start: ${e}`));

console.log(`[fusioneer] starting server on ${hostname}:${port}`);
console.log(`[fusioneer] allow_repos=${process.env.FUSIONEER_ALLOW_REPOS || "(all)"} db=${process.env.FUSIONEER_DB || (process.env.NODE_ENV === "production" ? "/data/fusioneer.db" : "data/fusioneer.db")}`);

export default {
  port,
  hostname,
  fetch: app.fetch,
};
