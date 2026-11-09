// Starts the built MakeRoom Worker on a Node host such as Render.
//
// Render runs a normal Node process, so this serves the same Worker build that
// Sites hosts, inside Wrangler's local runtime (workerd) with a local D1 file.
// The demo is practice-only: no PayPal keys are set here and sign-in is off,
// so identity headers sent by a browser are ignored.
//
//   npm run build && npm run start:render
//
// Environment (set in the Render dashboard):
//   PORT                     provided by Render
//   RENDER_EXTERNAL_HOSTNAME provided by Render; used as the request origin
//   GEMINI_API_KEY           optional; enables the "Read with AI" step
//   GEMINI_MODEL             optional; defaults to gemini-2.5-flash
import { spawnSync, spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import "./sites-env.mjs";

if (!existsSync("dist/server/wrangler.json")) {
  console.error("Run `npm run build` first: dist/server/wrangler.json is missing.");
  process.exit(1);
}

// Worker variables. Wrangler reads them from .dev.vars next to the config.
const vars = { MAKEROOM_SIGNIN: "off" };
for (const name of ["GEMINI_API_KEY", "GEMINI_MODEL"]) {
  if (process.env[name]) vars[name] = process.env[name];
}
writeFileSync(
  "dist/server/.dev.vars",
  Object.entries(vars).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n",
  { mode: 0o600 },
);

// Create or update the local D1 tables (idempotent).
const migrate = spawnSync(process.execPath, ["scripts/init-local-db.mjs"], { stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const port = process.env.PORT || "10000";
const host = process.env.RENDER_EXTERNAL_HOSTNAME;
const args = [
  "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
  "dev", "--config", "dist/server/wrangler.json", "--local",
  "--persist-to", ".wrangler/state",
  "--ip", "0.0.0.0", "--port", port, "--inspector-port", "0",
  "--show-interactive-dev-session=false", "--log-level", "warn",
];
// Behind Render's proxy the Worker should see the public https origin, so the
// app's same-origin checks match what the browser sends.
if (host) args.push("--local-upstream", host, "--upstream-protocol", process.env.MAKEROOM_UPSTREAM_PROTOCOL || "https");

// X_LOCAL_EXPLORER=false keeps Wrangler's local database explorer switched off on a public host.
const child = spawn(process.execPath, args, { stdio: "inherit", env: { ...process.env, CI: "true", X_LOCAL_EXPLORER: "false" } });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
