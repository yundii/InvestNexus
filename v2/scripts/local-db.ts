import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
mkdirSync("data", { recursive: true });
const directory = "data/postgres";
const db = new EmbeddedPostgres({
  databaseDir: directory,
  user: "investnexus",
  password: "investnexus_local",
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: () => {},
  onError: console.error,
});
if (!existsSync(directory + "/PG_VERSION")) await db.initialise();
await db.start();
const client = db.getPgClient();
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='investnexus'"))
    .rowCount
)
  await client.query("CREATE DATABASE investnexus");
await client.end();
console.log(
  "Local PostgreSQL running on 127.0.0.1:55432. Ctrl+C stops it; data is retained."
);
const stop = async () => {
  await db.stop();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
setInterval(() => {}, 60000);
