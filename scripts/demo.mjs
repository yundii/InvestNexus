import { spawn } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import net from "node:net";
const cwd = fileURLToPath(new URL("../v2/", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let stopping = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function launch(command, args, longRunning = false) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    detached: longRunning && process.platform !== "win32",
  });
  children.add(child);
  child.once("error", (error) => {
    if (longRunning && !stopping) {
      console.error(error.message);
      void stop(1);
    }
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (longRunning && !stopping) {
      console.error(
        `A demo process stopped (${code ?? signal}). Stopping the stack.`
      );
      void stop(1);
    }
  });
  return child;
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = launch(npm, args);
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`npm ${args.join(" ")} failed`))
    );
  });
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  // Stop consumers and API before the database.
  for (const child of [...children].reverse()) {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      sleep(5000),
    ]);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  console.log("Demo stopped. Existing database data has been preserved.");
  process.exit(code);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
async function listening(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
try {
  if (
    !existsSync(cwd + "node_modules/pg") ||
    !existsSync(cwd + "node_modules/tsx")
  )
    await run(["ci"]);
  if (!existsSync(cwd + ".env")) {
    copyFileSync(cwd + ".env.example", cwd + ".env");
    console.log("Created local .env from the example.");
  }
  process.loadEnvFile(cwd + ".env");
  const url = new URL(process.env.DATABASE_URL);
  const port = Number(process.env.PORT ?? 4200);
  if (await listening(port, "127.0.0.1"))
    throw Error(
      `Port ${port} is in use. Stop the existing API before npm run demo.`
    );
  const local =
    ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "55432";
  if (local && !(await listening(55432, "127.0.0.1")))
    launch(process.execPath, ["--import", "tsx", "scripts/local-db.ts"], true);
  const { Client } = (
    await import(new URL("../v2/node_modules/pg/lib/index.js", import.meta.url))
  ).default;
  let ready = false;
  for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 500,
    });
    try {
      await client.connect();
      await client.query("SELECT 1");
      ready = true;
    } catch {
      await sleep(500);
    } finally {
      await client.end().catch(() => {});
    }
  }
  if (!ready)
    throw Error(
      "Database did not become ready. Check DATABASE_URL and database credentials."
    );
  await run(["run", "build"]);
  await run(["run", "migrate"]);
  await run(["run", "demo:seed"]);
  launch(process.execPath, ["dist/worker.js"], true);
  launch(process.execPath, ["dist/market-worker.js"], true);
  launch(process.execPath, ["dist/server.js"], true);
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        console.log(
          `\nInvestNexus is ready: http://localhost:${port}\nDemo logins: pm / ops / client / other @investnexus.local\nPassword: use DEMO_PASSWORD from v2/.env\nPress Ctrl+C to stop the entire stack.\n`
        );
        break;
      }
      if (attempt === 59) throw Error("API did not become healthy.");
    } catch (error) {
      if (attempt === 59) throw error;
    }
    await sleep(500);
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
