import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { Identity, CommandData } from "./types.js";
import { AppError } from "./types.js";
import { pool, migrate, databaseUrl, transaction } from "./database.js";
import {
  authenticate,
  login,
  register,
  createSession,
  memberships,
  revoke,
} from "./auth.js";
import {
  cachedMarket,
  invalidateMarketCache,
  closeMarketCache,
} from "./market-cache.js";
import { stateFor, execute, membership } from "./repository.js";
const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const port = Number(process.env.PORT ?? 4200);
const streams = new Map<string, Set<http.ServerResponse>>();
const loginAttempts = new Map<string, { count: number; until: number }>();
const safeUuid = (id: string | null) => {
  if (
    !id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      id
    )
  )
    throw new AppError(400, "Valid account UUID required");
  return id;
};
function verifyOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin;
  if (
    origin &&
    origin !== `http://${req.headers.host}` &&
    origin !== `https://${req.headers.host}` &&
    !(process.env.TRUSTED_ORIGINS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(origin)
  )
    throw new AppError(403, "Cross-origin request denied");
}
async function body(
  req: http.IncomingMessage
): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AppError(415, "JSON body required");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 16000)
      throw new AppError(413, "Request too large");
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new AppError(400, "Invalid JSON object");
  }
}
const cookie = (token: string, maxAge = 8 * 60 * 60) =>
  `investnexus_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${
    process.env.COOKIE_SECURE === "true" ? "; Secure" : ""
  }`;
export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'"
    );
    const json = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method !== "GET" && req.method !== "HEAD") verifyOrigin(req);
      if (url.pathname === "/api/health") {
        await pool.query("SELECT 1");
        return json(200, { status: "ok", storage: "postgresql" });
      }
      if (
        ["/api/auth/login", "/api/auth/register"].includes(url.pathname) &&
        req.method === "POST"
      ) {
        const key = req.socket.remoteAddress ?? "local";
        const t = Date.now();
        if (loginAttempts.size > 1000)
          for (const [k, v] of loginAttempts)
            if (v.until < t) loginAttempts.delete(k);
        const attempt = loginAttempts.get(key);
        if (attempt && attempt.until > t && attempt.count >= 10)
          throw new AppError(
            429,
            "Too many login attempts; retry in 15 minutes"
          );
        loginAttempts.set(key, {
          count: (attempt && attempt.until > t ? attempt.count : 0) + 1,
          until: attempt && attempt.until > t ? attempt.until : t + 900000,
        });
        const data = await body(req);
        const user = url.pathname.endsWith("register")
          ? await register(data.email, data.password, data.userName)
          : await login(data.email, data.password);
        const session = await createSession(user);
        res.setHeader("Set-Cookie", cookie(session.token));
        return json(200, {
          user,
          csrf: session.csrf,
          accounts: await memberships(user),
        });
      }
      if (url.pathname.startsWith("/api/")) {
        const auth = await authenticate(req.headers.cookie);
        const user: Identity = auth.user;
        if (url.pathname === "/api/auth/me" && req.method === "GET")
          return json(200, {
            user,
            csrf: auth.csrf,
            accounts: await memberships(user),
          });
        if (req.method !== "GET" && req.headers["x-csrf-token"] !== auth.csrf)
          throw new AppError(403, "Invalid CSRF token");
        if (url.pathname === "/api/auth/logout" && req.method === "POST") {
          await revoke(req.headers.cookie);
          res.setHeader("Set-Cookie", cookie("", 0));
          return json(200, { ok: true });
        }
        const accountId = safeUuid(url.searchParams.get("accountId"));
        if (url.pathname === "/api/state" && req.method === "GET")
          return json(200, await stateFor(user, accountId));
        if (url.pathname === "/api/market" && req.method === "GET") {
          const s = await stateFor(user, accountId);
          return json(200, await cachedMarket(s.priceSet!));
        }
        if (url.pathname === "/api/market/cache" && req.method === "POST") {
          const roles = await transaction(
            (c) => membership(c, user.id, accountId),
            true
          );
          if (!roles.includes("operations"))
            throw new AppError(403, "Requires operations role");
          return json(200, await invalidateMarketCache());
        }
        if (url.pathname === "/api/report" && req.method === "GET") {
          const s = await stateFor(user, accountId);
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="investnexus-report.json"'
          );
          const daily = url.searchParams.get("scope") === "daily";
          if (
            daily &&
            !s.reportStatus.latestDaily &&
            !s.reportStatus.dailyPending
          )
            throw new AppError(
              409,
              "Close a reconciled daily valuation before exporting a performance report"
            );
          if (daily ? s.reportStatus.dailyPending : s.reportStatus.pending)
            throw new AppError(
              409,
              "Report is being prepared by the worker. Try again shortly."
            );
          return json(
            200,
            (daily ? s.reportStatus.latestDaily : s.reportStatus.latest) ?? {
              simulation: true,
              accountId,
              date: s.date,
              portfolio: s.portfolio,
              snapshots: [],
              transactions: [],
            }
          );
        }
        if (url.pathname === "/api/command" && req.method === "POST") {
          const data = await body(req);
          if (
            typeof data.action !== "string" ||
            !data.data ||
            typeof data.data !== "object" ||
            Array.isArray(data.data)
          )
            throw new AppError(400, "Action and data object required");
          const key = req.headers["idempotency-key"];
          if (typeof key !== "string")
            throw new AppError(400, "Idempotency-Key required");
          return json(
            200,
            await execute(
              user,
              accountId,
              key,
              data.action,
              data.data as CommandData
            )
          );
        }
        if (url.pathname === "/api/events" && req.method === "GET") {
          await transaction((c) => membership(c, user.id, accountId), true);
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const group =
            streams.get(accountId) ?? new Set<http.ServerResponse>();
          streams.set(accountId, group);
          group.add(res);
          const heartbeat = setInterval(
            () => res.write(": heartbeat\n\n"),
            20000
          );
          const expiry = setTimeout(
            () => res.end(),
            Math.max(0, auth.expiresAt.getTime() - Date.now())
          );
          req.on("close", () => {
            clearInterval(heartbeat);
            clearTimeout(expiry);
            group.delete(res);
            if (!group.size) streams.delete(accountId);
          });
          return;
        }
        throw new AppError(404, "Not found");
      }
      const files: Record<string, [string, string]> = {
        "/": ["index.html", "text/html"],
        "/app.js": ["app.js", "text/javascript"],
        "/style.css": ["app.css", "text/css"],
      };
      const file = files[url.pathname];
      if (!file) throw new AppError(404, "Not found");
      res.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(publicRoot + file[0]));
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof AppError) return json(e.status, { error: e.message });
      console.error(e);
      return json(500, { error: "Internal server error" });
    }
  });
}
export async function start() {
  await migrate();
  const listener = new pg.Client({ connectionString: databaseUrl });
  await listener.connect();
  await listener.query("LISTEN account_updated");
  await listener.query("LISTEN market_updated");
  listener.on("notification", (m) => {
    if (m.channel === "market_updated") {
      for (const group of streams.values())
        for (const res of group) res.write("data: updated\n\n");
      return;
    }
    if (m.payload)
      for (const res of streams.get(m.payload) ?? [])
        res.write("data: updated\n\n");
  });
  listener.on("error", (e) => {
    console.error("Update listener failed:", e.message);
    for (const group of streams.values()) for (const res of group) res.end();
  });
  const server = createServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(`InvestNexus v2: http://localhost:${port}`)
  );
  const close = () => {
    for (const group of streams.values()) for (const res of group) res.end();
    server.close(async () => {
      await closeMarketCache();
      await listener.end();
      await pool.end();
      process.exit(0);
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await start();
