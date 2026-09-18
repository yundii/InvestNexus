import pg from "pg";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const rootUrl = process.env.DATABASE_URL;
if (!rootUrl) throw Error("DATABASE_URL required for browser tests");
const admin = new pg.Client({ connectionString: rootUrl });
const name = "investnexus_e2e_" + randomUUID().replaceAll("-", "");
await admin.connect();
await admin.query(`CREATE DATABASE ${name}`);
const url = new URL(rootUrl);
url.pathname = "/" + name;
process.env.DATABASE_URL = url.toString();
process.env.PORT = "4300";
process.env.HOST = "127.0.0.1";
process.env.COOKIE_SECURE = "false";
process.env.DEMO_MODE = "true";
process.env.MARKET_PROVIDER = "mock";
const { currentBusinessDate } = await import("../src/performance.js");
process.env.MOCK_MARKET_START_DATE = currentBusinessDate();
process.env.MARKET_POLL_SECONDS = "3600";
delete process.env.RABBITMQ_URL;
delete process.env.REDIS_URL;
const { migrate, pool } = await import("../src/database.js");
const children: ReturnType<typeof spawn>[] = [];
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve())
    );
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
  await pool.end();
  await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
  process.exit(code);
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
try {
  await migrate();
  for (const script of ["server", "worker", "market-worker"]) {
    const child = spawn(process.execPath, [`dist/${script}.js`], {
      env: process.env,
      stdio: "inherit",
    });
    children.push(child);
    child.once("error", () => void close(1));
    child.once("exit", () => {
      if (!closing) void close(1);
    });
  }
} catch (error) {
  console.error(error);
  await close(1);
}
