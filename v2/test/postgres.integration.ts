import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import pg from "pg";
import type { Server } from "node:http";
let adminConnected = false;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const dbName = "investnexus_test_" + randomUUID().replaceAll("-", "");
let base: string, server: Server, pool: pg.Pool;
interface User {
  cookie: string;
  csrf: string;
  id: string;
  account: string;
  email: string;
}
let pm: User, ops: User, client: User, other: User;
async function request(
  path: string,
  user?: User,
  body?: unknown,
  key?: string
) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(user ? { Cookie: user.cookie, "X-CSRF-Token": user.csrf } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie"),
  };
}
async function createUser(prefix: string) {
  const email = prefix + "@integration.local";
  const r = await request("/api/auth/register", undefined, {
    email,
    password: "TestPassword-2026!",
    userName: prefix,
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.cookie!.split(";")[0],
    csrf: r.body.csrf,
    id: r.body.user.id,
    account: r.body.accounts[0].id,
    email,
  };
}
const command = (
  user: User,
  action: string,
  data = {},
  key = randomUUID(),
  account = user.account
) =>
  request(
    "/api/command?accountId=" + account,
    user,
    { action, data, actor: "operations" },
    key
  );
async function trade(user: User, quantity = 100) {
  const { refreshMarket } = await import("../src/market.js");
  const { securities } = await import("../src/catalog.js");
  await refreshMarket((await state(user)).date, { name: "mock", getHistory: async (symbol, date) => [{symbol, date, price: securities.find(s => s.symbol === symbol)!.price}] });
  const order = await command(user, "create", {
    symbol: "MSFT",
    side: "BUY",
    quantity,
    orderType: "MARKET",
  });
  assert.equal(order.status, 200);
  const id = order.body.result.id;
  assert.equal((await command(user, "approve", { id })).status, 200);
  const t = await command(user, "execute", { id });
  assert.equal(t.status, 200);
  return t.body.result;
}
const state = async (user: User, account = user.account) =>
  (await request("/api/state?accountId=" + account, user)).body;
before(async () => {
  assert.ok(
    process.env.DATABASE_URL,
    "DATABASE_URL required for PostgreSQL integration tests"
  );
  await admin.connect();
  adminConnected = true;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + dbName;
  process.env.DATABASE_URL = url.toString();
  const db = await import("../src/database.js");
  pool = db.pool;
  await db.migrate();
  await db.migrate();
  const { createServer } = await import("../src/server.js");
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = "http://127.0.0.1:" + address.port;
  pm = await createUser("pm");
  ops = await createUser("ops");
  client = await createUser("client");
  other = await createUser("other");
  await pool.query(
    "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3),($4,$2,$5)",
    [ops.id, pm.account, ["operations", "client"], client.id, ["client"]]
  );
  ops.account = pm.account;
  client.account = pm.account;
});
after(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  await (await import("../src/market-cache.js")).closeMarketCache();
  if (pool) await pool.end();
  if (adminConnected) {
    await admin.query(`DROP DATABASE ${dbName} WITH (FORCE)`);
    await admin.end();
  }
});
test("anonymous requests are blocked; cookie session survives API restart", async () => {
  assert.equal(
    (await request("/api/state?accountId=" + pm.account)).status,
    401
  );
  const me = await request("/api/auth/me", pm);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, pm.email);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const { createServer } = await import("../src/server.js");
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const a = server.address();
  assert.ok(a && typeof a !== "string");
  base = "http://127.0.0.1:" + a.port;
  assert.equal((await request("/api/auth/me", pm)).status, 200);
});
test("role and account IDs are enforced on every state, report, command, and event route", async () => {
  assert.equal(
    (
      await command(client, "create", {
        symbol: "MSFT",
        side: "BUY",
        quantity: 100,
        orderType: "MARKET",
      })
    ).status,
    403
  );
  assert.equal((await command(pm, "advance")).status, 403);
  for (const endpoint of ["state", "report", "events"])
    assert.equal(
      (await request("/api/" + endpoint + "?accountId=" + pm.account, other))
        .status,
      403
    );
  assert.equal(
    (
      await command(
        other,
        "create",
        { symbol: "MSFT", side: "BUY", quantity: 100, orderType: "MARKET" },
        randomUUID(),
        pm.account
      )
    ).status,
    403
  );
  assert.equal((await state(other)).ledger.length, 1);
});
test("mutating routes require CSRF and reject foreign origins", async () => {
  let r = await fetch(base + "/api/command?accountId=" + pm.account, {
    method: "POST",
    headers: {
      Cookie: pm.cookie,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ action: "advance", data: {} }),
  });
  assert.equal(r.status, 403);
  r = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://attacker.example",
    },
    body: JSON.stringify({ email: pm.email, password: "TestPassword-2026!" }),
  });
  assert.equal(r.status, 403);
});
test("explicitly trusted origin can authenticate", async () => {
  const previous = process.env.TRUSTED_ORIGINS;
  process.env.TRUSTED_ORIGINS = "http://localhost:3000";
  try {
    const r = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3000",
      },
      body: JSON.stringify({ email: pm.email, password: "TestPassword-2026!" }),
    });
    assert.equal(r.status, 200);
  } finally {
    if (previous === undefined) delete process.env.TRUSTED_ORIGINS;
    else process.env.TRUSTED_ORIGINS = previous;
  }
});

test("concurrent retries create one order and reject changed payload with reused key", async () => {
  const key = randomUUID(),
    data = { symbol: "MSFT", side: "BUY", quantity: 100, orderType: "MARKET" };
  const results = await Promise.all(
    Array.from({ length: 4 }, () => command(pm, "create", data, key))
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.body.result.id)).size, 1);
  const rows = await pool.query(
    "SELECT count(*) FROM orders WHERE account_id=$1",
    [pm.account]
  );
  assert.equal(rows.rows[0].count, "1");
  assert.equal(
    (await command(pm, "create", { ...data, quantity: 101 }, key)).status,
    409
  );
});
test("partial fills settle once, update ledger and persist across independent processes", async () => {
  const order = await command(pm, "create", {
    symbol: "MSFT",
    side: "BUY",
    quantity: 100,
    orderType: "MARKET",
  });
  const id = order.body.result.id;
  await command(pm, "approve", { id });
  const first = await command(pm, "execute", { id, quantity: 60 });
  assert.equal(
    (await state(pm)).orders.find((o: { id: string }) => o.id === id).status,
    "PARTIALLY_FILLED"
  );
  const second = await command(pm, "execute", { id, quantity: 40 });
  assert.equal((await state(pm)).portfolio.positions.length, 0);
  assert.equal(
    (await command(ops, "settle", { id: first.body.result.id })).status,
    422
  );
  await command(ops, "advance");
  const key = randomUUID();
  const results = await Promise.all([
    command(ops, "settle", { id: first.body.result.id }, key),
    command(ops, "settle", { id: first.body.result.id }, key),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  await command(ops, "settle", { id: second.body.result.id });
  assert.equal(
    (await command(ops, "settle", { id: first.body.result.id })).status,
    422
  );
  const s = await state(client);
  assert.equal(s.portfolio.cash, 5899000);
  assert.equal(s.portfolio.positions[0].quantity, 100);
  assert.equal(s.snapshots.length, 2);
  assert.equal(
    s.events.find((e: { type: string }) => e.type === "OrderApproved").actor,
    pm.email
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import pg from 'pg';const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query('SELECT sum(cash_cents) AS cash FROM ledger_entries WHERE account_id=$1',[process.env.TEST_ACCOUNT]);console.log(r.rows[0].cash);await c.end();",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, TEST_ACCOUNT: pm.account },
      encoding: "utf8",
    }
  );
  assert.equal(output.trim(), "5899000");
  assert.equal(
    (await request("/api/report?accountId=" + pm.account, client)).status,
    409
  );
  const { pendingReports, processReport } = await import("../src/reporting.js");
  for (const id of await pendingReports())
    assert.equal(await processReport(id), true);
  assert.equal(
    (await request("/api/report?accountId=" + pm.account, client)).body
      .portfolio.cash,
    5899000
  );
});
test("database posting uniqueness and append-only triggers protect the ledger", async () => {
  const entry = (
    await pool.query(
      "SELECT * FROM ledger_entries WHERE account_id=$1 AND type='BUY' LIMIT 1",
      [pm.account]
    )
  ).rows[0];
  await assert.rejects(
    pool.query(
      "INSERT INTO ledger_entries(id,account_id,trade_id,type,cash_cents,symbol,quantity,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        entry.account_id,
        entry.trade_id,
        entry.type,
        entry.cash_cents,
        entry.symbol,
        entry.quantity,
        entry.occurred_at,
      ]
    ),
    (e: { code: string }) => e.code === "23505"
  );
  await assert.rejects(
    pool.query("UPDATE ledger_entries SET cash_cents=0 WHERE id=$1", [
      entry.id,
    ]),
    /Append-only/
  );
  await assert.rejects(
    pool.query("DELETE FROM audit_logs WHERE account_id=$1", [pm.account]),
    /Append-only/
  );
});
test("database failure midway through settlement rolls back status, entries, audit, and snapshot", async () => {
  const t = await trade(other);
  await pool.query(
    "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3)",
    [ops.id, other.account, ["operations"]]
  );
  const before = await state(other);
  await command(ops, "advance", {}, randomUUID(), other.account);
  await pool.query(
    "CREATE FUNCTION test_fail_fee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='FEE' THEN RAISE EXCEPTION 'Injected fee failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER test_fail_fee BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION test_fail_fee();"
  );
  const key = randomUUID();
  try {
    assert.equal(
      (await command(ops, "settle", { id: t.id }, key, other.account)).status,
      500
    );
  } finally {
    await pool.query(
      "DROP TRIGGER test_fail_fee ON ledger_entries; DROP FUNCTION test_fail_fee();"
    );
  }
  const failed = await state(other);
  assert.equal(failed.ledger.length, before.ledger.length);
  assert.equal(
    failed.trades.find((x: { id: string }) => x.id === t.id).status,
    "PENDING"
  );
  assert.equal(failed.snapshots.length, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM outbox_events WHERE account_id=$1",
        [other.account]
      )
    ).rows[0].count,
    "0"
  );
  assert.ok(
    !failed.events.some(
      (e: { type: string }) => e.type === "SettlementCompleted"
    )
  );
  assert.equal(
    (await command(ops, "settle", { id: t.id }, key, other.account)).status,
    200
  );
  assert.equal((await state(other)).portfolio.cash, 5899500);
});
test("competing settlements cannot overspend account cash", async () => {
  const investor = await createUser("concurrent");
  await pool.query(
    "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3)",
    [ops.id, investor.account, ["operations"]]
  );
  const t1 = await trade(investor, 150),
    t2 = await trade(investor, 150);
  await command(ops, "advance", {}, randomUUID(), investor.account);
  const results = await Promise.all([
    command(ops, "settle", { id: t1.id }, randomUUID(), investor.account),
    command(ops, "settle", { id: t2.id }, randomUUID(), investor.account),
  ]);
  assert.ok(results.every((r) => r.status === 200));
  const s = await state(investor);
  assert.equal(
    s.trades.filter((t: { status: string }) => t.status === "SETTLED").length,
    1
  );
  assert.equal(
    s.trades.filter((t: { status: string }) => t.status === "FAILED").length,
    1
  );
  assert.equal(s.portfolio.cash, 3849500);
  assert.equal(s.ledger.length, 3);
});
test("cross-account entity IDs cannot be executed; reconciliation retains trusted actor", async () => {
  const t = (await state(other)).trades[0];
  assert.equal((await command(ops, "settle", { id: t.id })).status, 422);
  const r = await command(ops, "reconcile", { symbol: "MSFT", actual: 98 });
  assert.equal(r.body.result.difference, 2);
  assert.equal(
    (
      await command(ops, "resolve", {
        id: r.body.result.id,
        note: "Broker confirmed an outdated file",
      })
    ).status,
    200
  );
  const s = await state(client);
  assert.equal(s.exceptions[0].status, "RESOLVED");
  assert.equal(s.events.at(-1).actor, ops.email);
});

test("report outbox retries are idempotent and preserve the snapshot they were created for", async () => {
  const { pendingReports, processReport } = await import("../src/reporting.js");
  const ids = await pendingReports();
  assert.ok(ids.length > 0);
  await Promise.all(ids.map((id) => processReport(id)));
  assert.ok(
    (await Promise.all(ids.map((id) => processReport(id)))).every(
      (done) => done === false
    )
  );
  const r = await pool.query(
    "SELECT count(*) AS count,count(DISTINCT snapshot_id) AS unique_count FROM generated_reports"
  );
  assert.equal(r.rows[0].count, r.rows[0].unique_count);
  const report = (
    await request("/api/report?accountId=" + other.account, other)
  ).body;
  assert.equal(report.portfolio.cash, 5899500);
  assert.equal(report.transactions.length, 1);
});
test("database rejects a settled status without complete ledger postings", async () => {
  const t = await trade(other, 1);
  await assert.rejects(
    pool.query(
      "UPDATE settlements SET status='SETTLED',settled_at=now() WHERE trade_id=$1",
      [t.id]
    ),
    /exactly matching/
  );
  assert.equal(
    (await state(other)).trades.find((x: { id: string }) => x.id === t.id)
      .status,
    "PENDING"
  );
});

test(
  "RabbitMQ worker confirms publishing and handles duplicate deliveries",
  { skip: !process.env.RABBITMQ_URL },
  async () => {
    const investor = await createUser("rabbit");
    await pool.query(
      "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3)",
      [ops.id, investor.account, ["operations"]]
    );
    const t = await trade(investor, 10);
    await command(ops, "advance", {}, randomUUID(), investor.account);
    await command(ops, "settle", { id: t.id }, randomUUID(), investor.account);
    const queue = "investnexus.test." + randomUUID();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/worker.ts"],
      {
        cwd: process.cwd(),
        env: { ...process.env, RABBITMQ_QUEUE: queue },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let logs = "";
    child.stdout.on("data", (chunk) => (logs += chunk));
    child.stderr.on("data", (chunk) => (logs += chunk));
    const amqp = (await import("amqplib")).default;
    let connection, channel;
    try {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null)
          throw Error("RabbitMQ worker exited: " + logs);
        if ((await state(investor)).reportStatus.pending === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal((await state(investor)).reportStatus.pending, 0, logs);
      const row = (
        await pool.query(
          "SELECT id,snapshot_id FROM outbox_events WHERE account_id=$1",
          [investor.account]
        )
      ).rows[0];
      connection = await amqp.connect(process.env.RABBITMQ_URL!);
      channel = await connection.createConfirmChannel();
      for (let i = 0; i < 2; i++)
        channel.sendToQueue(
          queue,
          Buffer.from(JSON.stringify({ id: row.id })),
          { persistent: true }
        );
      await channel.waitForConfirms();
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) FROM generated_reports WHERE snapshot_id=$1",
            [row.snapshot_id]
          )
        ).rows[0].count,
        "1"
      );
    } finally {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((r) => child.once("exit", r)),
        new Promise((r) =>
          setTimeout(() => {
            child.kill("SIGKILL");
            r(null);
          }, 5000)
        ),
      ]);
      if (channel) {
        await channel.deleteQueue(queue);
        await channel.deleteQueue(queue + ".dead");
        await channel.close();
      }
      if (connection) await connection.close();
    }
  }
);

test("report failures roll back generation and respect retry backoff", async () => {
  const investor = await createUser("report-retry");
  await pool.query(
    "INSERT INTO account_memberships(user_id,account_id,roles) VALUES($1,$2,$3)",
    [ops.id, investor.account, ["operations"]]
  );
  const t = await trade(investor, 1);
  await command(ops, "advance", {}, randomUUID(), investor.account);
  await command(ops, "settle", { id: t.id }, randomUUID(), investor.account);
  const { processReport, failedReport, pendingReports } = await import(
    "../src/reporting.js"
  );
  const event = (
    await pool.query("SELECT id FROM outbox_events WHERE account_id=$1", [
      investor.account,
    ])
  ).rows[0];
  await pool.query(
    "CREATE FUNCTION test_fail_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected report failure'; END; $$; CREATE TRIGGER test_fail_report BEFORE INSERT ON generated_reports FOR EACH ROW EXECUTE FUNCTION test_fail_report();"
  );
  try {
    await assert.rejects(processReport(event.id), /Injected report failure/);
  } finally {
    await pool.query(
      "DROP TRIGGER test_fail_report ON generated_reports; DROP FUNCTION test_fail_report();"
    );
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*) FROM generated_reports WHERE account_id=$1",
        [investor.account]
      )
    ).rows[0].count,
    "0"
  );
  assert.equal((await state(investor)).portfolio.positions[0].quantity, 1);
  await failedReport(event.id, new Error("Transient renderer failure"));
  assert.ok(!(await pendingReports()).includes(event.id));
  assert.equal(await processReport(event.id), false);
  await pool.query(
    "UPDATE outbox_events SET attempts=5,available_at=now() WHERE id=$1",
    [event.id]
  );
  assert.equal(await processReport(event.id), false);
  await pool.query(
    "UPDATE outbox_events SET attempts=0,available_at=now() WHERE id=$1",
    [event.id]
  );
  assert.equal(await processReport(event.id), true);
  assert.equal(await processReport(event.id), false);
});

test("certified daily valuation freezes market prices, reconciliation and benchmark performance", async () => {
  const { refreshMarket } = await import("../src/market.js");
  const { MockMarketDataProvider } = await import("../src/market-provider.js");
  const { pendingReports, processReport } = await import("../src/reporting.js");
  const initial = await state(pm);
  for (const action of ["refreshMarket", "reconcileBook", "closeValuation"])
    assert.equal((await command(client, action)).status, 403);
  assert.equal((await request("/api/market?accountId=" + pm.account, other)).status, 403);
  assert.equal((await command(ops, "closeValuation")).status, 409);
  await refreshMarket(initial.date, new MockMarketDataProvider());
  const marked = await state(pm);
  assert.deepEqual(marked.ledger, initial.ledger);
  assert.equal(marked.portfolio.cash, initial.portfolio.cash);
  assert.equal(marked.portfolio.positions[0].quantity, 100);
  const statement = {asOf: marked.date, cash: marked.portfolio.cash, positions: [{symbol:"MSFT", quantity:98}], broker:"Integration broker"};
  assert.equal((await command(ops, "reconcileBook", statement)).status, 200);
  assert.equal((await command(ops, "closeValuation")).status, 409);
  const exceptions = (await state(pm)).exceptions.filter((e: any) => e.status === "OPEN");
  for (const e of exceptions) assert.equal((await command(ops, "resolve", {id:e.id, note:"Broker confirmed stale quantity; acknowledged difference"})).status, 200);
  // A failed refresh keeps last good prices, but blocks certification.
  await assert.rejects(refreshMarket(marked.date, {name:"mock", getHistory:async()=>{throw Error("Provider quota");}}), /quota/);
  const failed = await state(pm);
  assert.deepEqual(failed.prices, marked.prices);
  assert.equal(failed.priceSet.lastError, "Provider quota");
  assert.equal((await command(ops, "closeValuation")).status, 409);
  await refreshMarket(marked.date, new MockMarketDataProvider());
  const key = randomUUID();
  const close = await command(ops, "closeValuation", {}, key);
  assert.equal(close.status, 200, JSON.stringify(close.body));
  assert.equal(close.body.result.reconciliation.status, "RESOLVED_WITH_EXCEPTIONS");
  assert.equal((await command(ops, "closeValuation", {}, key)).body.result.id, close.body.result.id);
  assert.equal((await command(ops, "closeValuation")).status, 409);
  assert.equal((await command(pm, "create", {symbol:"MSFT",side:"BUY",quantity:1,orderType:"MARKET"})).status, 409);
  assert.equal((await request("/api/report?scope=daily&accountId="+pm.account,client)).status,409);
  for(const id of await pendingReports()) await processReport(id);
  const firstReport = await request("/api/report?scope=daily&accountId="+pm.account,client);
  assert.equal(firstReport.status,200);
  assert.deepEqual(firstReport.body.priceSet, close.body.result.priceSet);
  assert.equal(firstReport.body.performance.points.length,1);
  await command(ops,"advance");
  assert.equal((await state(pm)).priceSet.status,"STALE");
  const jobKey=randomUUID();
  const job=await command(ops,"refreshMarket",{},jobKey);
  assert.equal((await command(ops,"refreshMarket",{},jobKey)).body.result.id,job.body.result.id);
  const {processMarketJob}=await import("../src/market-worker.js");
  assert.equal(await processMarketJob(),true);
  const next=await state(pm);
  assert.equal(next.priceSet.status,"FRESH");
  assert.deepEqual(next.ledger,initial.ledger);
  assert.equal((await command(ops,"closeValuation")).status,409);
  assert.equal((await command(ops,"reconcileBook",{asOf:next.date,cash:next.portfolio.cash,positions:[{symbol:"MSFT",quantity:100}],broker:"Integration broker"})).status,200);
  const second=await command(ops,"closeValuation");
  assert.equal(second.status,200,JSON.stringify(second.body));
  const points=second.body.result.performance.points;
  assert.equal(points.length,2);
  assert.ok(points[1].dailyReturnPct !== null);
  assert.ok(Math.abs(points[1].dailyReturnPct-(points[1].value/points[0].value-1)*100)<1e-9);
  assert.ok(Math.abs(points[1].excessReturnPct-(points[1].cumulativeReturnPct-points[1].benchmarkReturnPct))<1e-9);
  for(const id of await pendingReports()) await processReport(id);
  assert.equal((await request("/api/report?scope=daily&accountId="+pm.account,client)).body.date,next.date);
  const frozen=await pool.query("SELECT payload FROM generated_reports WHERE snapshot_id=$1",[close.body.result.id]);
  assert.deepEqual(frozen.rows[0].payload,firstReport.body);
  await assert.rejects(pool.query("UPDATE daily_valuations SET provider='mock' WHERE snapshot_id=$1",[close.body.result.id]),/append.only|immutable/i);
});

test("optional Redis cache can be removed without affecting book or valuation", {skip: !process.env.REDIS_URL}, async () => {
  const before=await state(pm);
  const path="/api/market?accountId="+pm.account;
  await request(path,client);
  assert.equal((await request(path,client)).body.cache,"hit");
  assert.equal((await request("/api/market/cache?accountId="+pm.account,client,{})).status,403);
  const clear=await request("/api/market/cache?accountId="+pm.account,ops,{});
  assert.equal(clear.status,200);
  assert.ok(clear.body.removed>0);
  assert.equal((await request(path,client)).body.cache,"miss");
  const after=await state(pm);
  assert.deepEqual(after.ledger,before.ledger);
  assert.deepEqual(after.portfolio,before.portfolio);
});

test("logout revokes the server-side session and expired sessions cannot read data", async () => {
  const r = await request("/api/auth/logout", other, {});
  assert.equal(r.status, 200);
  assert.equal((await request("/api/auth/me", other)).status, 401);
  await pool.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [client.id]
  );
  assert.equal(
    (await request("/api/report?accountId=" + pm.account, client)).status,
    401
  );
});
