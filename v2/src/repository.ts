import type { PoolClient } from "pg";
import type { State, Role, Identity, CommandData } from "./types.js";
import { AppError } from "./types.js";
import { transaction } from "./database.js";
import { command, portfolio, securities } from "./platform.js";
import { createHash, randomUUID } from "node:crypto";
export async function membership(
  c: PoolClient,
  userId: string,
  accountId: string
): Promise<Role[]> {
  const r = await c.query(
    "SELECT roles FROM account_memberships WHERE user_id=$1 AND account_id=$2",
    [userId, accountId]
  );
  if (!r.rowCount) throw new AppError(403, "Account access denied");
  return r.rows[0].roles;
}
export async function load(c: PoolClient, accountId: string): Promise<State> {
  const date = await c.query(
    "SELECT to_char(business_date,'YYYY-MM-DD') AS date FROM accounts WHERE id=$1",
    [accountId]
  );
  if (!date.rowCount) throw new AppError(404, "Account not found");
  const rows = async (table: string) =>
    (
      await c.query(
        `SELECT payload FROM ${table} WHERE account_id=$1 ORDER BY seq`,
        [accountId]
      )
    ).rows.map((r) => r.payload);
  const ledger = (
    await c.query(
      "SELECT id,trade_id,type,cash_cents,symbol,quantity,occurred_at FROM ledger_entries WHERE account_id=$1 ORDER BY seq",
      [accountId]
    )
  ).rows.map((e) => ({
    id: e.id,
    ...(e.trade_id ? { tradeId: e.trade_id } : {}),
    type: e.type,
    cash: Number(e.cash_cents),
    symbol: e.symbol,
    quantity: e.quantity,
    at: e.occurred_at.toISOString(),
  }));
  return {
    date: date.rows[0].date,
    orders: await rows("orders"),
    trades: await rows("trades"),
    ledger,
    events: await rows("audit_logs"),
    exceptions: await rows("reconciliation_records"),
    snapshots: await rows("portfolio_snapshots"),
  };
}
export async function stateFor(user: Identity, accountId: string) {
  return transaction(async (c) => {
    const roles = await membership(c, user.id, accountId);
    const s = await load(c, accountId);
    const reports = await c.query(
      "SELECT r.payload FROM generated_reports r JOIN portfolio_snapshots s ON s.id=r.snapshot_id WHERE r.account_id=$1 ORDER BY s.seq DESC LIMIT 1",
      [accountId]
    );
    const queued = await c.query(
      "SELECT count(*) AS count,max(last_error) AS error FROM outbox_events WHERE account_id=$1 AND completed_at IS NULL",
      [accountId]
    );
    return {
      ...s,
      roles,
      portfolio: portfolio(s),
      securities,
      reportStatus: {
        pending: Number(queued.rows[0].count),
        lastError: queued.rows[0].error,
        latest: reports.rows[0]?.payload ?? null,
      },
    };
  }, true);
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export async function execute(
  user: Identity,
  accountId: string,
  key: string,
  action: string,
  data: CommandData
) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key))
    throw new AppError(400, "Valid Idempotency-Key is required");
  const role: Role = ["create", "approve", "execute"].includes(action)
    ? "investment"
    : "operations";
  const fingerprint = createHash("sha256")
    .update(canonical({ action, data }))
    .digest("hex");
  return transaction(async (c) => {
    const roles = await membership(c, user.id, accountId);
    if (!roles.includes(role)) throw new AppError(403, `Requires ${role} role`);
    // Serializes all financial writes for this account, including competing fills/settlements.
    await c.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
      accountId,
    ]);
    const existing = await c.query(
      "SELECT * FROM idempotency_requests WHERE account_id=$1 AND request_key=$2",
      [accountId, key]
    );
    if (existing.rowCount) {
      const r = existing.rows[0];
      if (r.user_id !== user.id || r.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "Idempotency key already used for another request"
        );
      return r.response;
    }
    const s = await load(c, accountId);
    const before = structuredClone(s);
    const result = command(s, action, data, role);
    await c.query("UPDATE accounts SET business_date=$2 WHERE id=$1", [
      accountId,
      s.date,
    ]);
    for (const o of s.orders) {
      const old = before.orders.find((x) => x.id === o.id);
      if (JSON.stringify(old) === JSON.stringify(o)) continue;
      await c.query(
        `INSERT INTO orders(id,account_id,symbol,side,quantity,filled,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET filled=EXCLUDED.filled,status=EXCLUDED.status,payload=EXCLUDED.payload`,
        [o.id, accountId, o.symbol, o.side, o.quantity, o.filled, o.status, o]
      );
    }
    for (const t of s.trades) {
      const old = before.trades.find((x) => x.id === t.id);
      if (JSON.stringify(old) === JSON.stringify(t)) continue;
      await c.query(
        "INSERT INTO trades(id,account_id,order_id,quantity,price_cents,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
        [t.id, accountId, t.orderId, t.quantity, t.price, t]
      );
      await c.query(
        `INSERT INTO settlements(trade_id,account_id,status,due_date,settled_at,reason) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(trade_id) DO UPDATE SET status=EXCLUDED.status,settled_at=EXCLUDED.settled_at,reason=EXCLUDED.reason`,
        [
          t.id,
          accountId,
          t.status,
          t.due,
          t.settledAt ?? null,
          t.reason ?? null,
        ]
      );
    }
    for (const e of s.ledger.slice(before.ledger.length))
      await c.query(
        "INSERT INTO ledger_entries(id,account_id,trade_id,type,cash_cents,symbol,quantity,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          e.id,
          accountId,
          e.tradeId ?? null,
          e.type,
          e.cash,
          e.symbol,
          e.quantity,
          e.at,
        ]
      );
    for (const e of s.exceptions) {
      const old = before.exceptions.find((x) => x.id === e.id);
      if (JSON.stringify(old) === JSON.stringify(e)) continue;
      await c.query(
        "INSERT INTO reconciliation_records(id,account_id,payload) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",
        [e.id, accountId, e]
      );
    }
    for (const e of s.events.slice(before.events.length)) {
      const actor = e.actor === "system" ? null : user.id;
      e.actor = e.actor === "system" ? "system" : user.email;
      await c.query(
        "INSERT INTO audit_logs(id,account_id,actor_id,payload) VALUES($1,$2,$3,$4)",
        [e.id, accountId, actor, e]
      );
    }
    for (const snapshot of s.snapshots.slice(before.snapshots.length)) {
      await c.query(
        "INSERT INTO portfolio_snapshots(id,account_id,payload) VALUES($1,$2,$3)",
        [snapshot.id, accountId, snapshot]
      );
      await c.query(
        "INSERT INTO outbox_events(id,account_id,snapshot_id,payload) VALUES($1,$2,$3,$4)",
        [
          randomUUID(),
          accountId,
          snapshot.id,
          {
            simulation: true,
            accountId,
            snapshot,
            transactions: s.trades.filter((t) => t.status === "SETTLED"),
          },
        ]
      );
    }
    const response = { result: result ?? null };
    await c.query(
      "INSERT INTO idempotency_requests(account_id,request_key,user_id,fingerprint,response) VALUES($1,$2,$3,$4,$5)",
      [accountId, key, user.id, fingerprint, response]
    );
    // NOTIFY is delivered only after COMMIT and reaches every API process.
    await c.query("SELECT pg_notify('account_updated',$1)", [accountId]);
    return response;
  });
}
