import pg from "pg";
import type { PoolClient } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
export const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL."
  );
export const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
pool.on("error", (e) => console.error("PostgreSQL pool error:", e.message));
export async function transaction<T>(
  fn: (c: PoolClient) => Promise<T>,
  readOnly = false
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"
    );
    const value = await fn(c);
    await c.query("COMMIT");
    return value;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function migrate() {
  const directory = new URL("../migrations/", import.meta.url);
  // Works from src/ during tsx and dist/ after tsc.
  const files = (await readdir(directory))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73249001)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
    );
    for (const name of files) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await c.query(
        "SELECT checksum FROM schema_migrations WHERE name=$1",
        [name]
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`Migration ${name} changed after application`);
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum]
      );
    }
  });
}
