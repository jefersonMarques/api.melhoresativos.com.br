import { resolve } from "node:path";
import { createConfig, loadEnvFile } from "../src/config/env.js";
import { createDatabasePool } from "../src/database/client.js";
import { runMigrations } from "../src/database/migrate.js";

await loadEnvFile();
const config = createConfig();
const pool = createDatabasePool(config);

try {
  await runMigrations(pool, resolve(process.cwd(), "migrations"));
  console.log("[market-data-api] Banco atualizado com sucesso.");
} finally {
  await pool.end();
}
