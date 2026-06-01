import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_LOCK_ID = 289416320;

export async function runMigrations(pool, migrationsPath) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_data_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const entries = (await readdir(migrationsPath))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    for (const filename of entries) {
      const applied = await client.query(
        "SELECT 1 FROM market_data_schema_migrations WHERE filename = $1",
        [filename]
      );
      if (applied.rowCount) {
        continue;
      }

      const sql = await readFile(join(migrationsPath, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO market_data_schema_migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`[market-data-api] Migration aplicada: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
