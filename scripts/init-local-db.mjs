import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const built = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
mkdirSync(".sites-runtime", { recursive: true });
writeFileSync(".sites-runtime/local-db.json", JSON.stringify({
  name: "makeroom-local-db", compatibility_date: built.compatibility_date,
  d1_databases: built.d1_databases.map((binding) => ({ ...binding, migrations_dir: resolve("drizzle") })),
}));
const result = spawnSync(process.execPath, [
  "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
  "d1", "migrations", "apply", "DB", "--local", "--config", ".sites-runtime/local-db.json",
  "--persist-to", resolve(".wrangler/state"),
], { stdio: "inherit", env: { ...process.env, CI: "true" } });
process.exit(result.status ?? 1);
