import type {
  State,
  Order,
  Trade,
  Reconciliation,
  CommandData,
  Role,
  AuditEvent,
} from "./types.js";
import { currentBusinessDate } from "./performance.js";
import { AppError } from "./types.js";
import { randomUUID } from "./id.js";
const id = () => randomUUID();
const now = () => new Date().toISOString();
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new AppError(422, message);
}
import { securities } from "./catalog.js";
import { book, portfolio } from "./ledger.js";
export { securities, portfolio };
export function seed(date = now().slice(0, 10)): State {
  return {
    date: currentBusinessDate(date),
    orders: [],
    trades: [],
    ledger: [
      {
        id: id(),
        type: "DEPOSIT",
        cash: 10000000,
        symbol: null,
        quantity: 0,
        at: now(),
      },
    ],
    events: [],
    exceptions: [],
    snapshots: [],
    reconciliationRuns: [],
  };
}
function event(
  s: State,
  type: string,
  entity: string,
  actor: string,
  detail: Partial<AuditEvent> = {}
) {
  s.events.push({ id: id(), type, entity, actor, at: now(), ...detail });
}
function snapshot(s: State) {
  const p = portfolio(s);
  if (p.value === null) {
    event(s, "ValuationUnavailable", s.date, "system");
    return;
  }
  s.snapshots.push({
    id: id(),
    date: s.date,
    at: now(),
    ...p,
    kind: "SETTLEMENT",
    priceSet: s.priceSet,
  });
  event(s, "PortfolioSnapshotCreated", s.snapshots.at(-1)!.id, "system");
}
export function command(
  s: State,
  action: string,
  data: CommandData,
  actor: Role
) {
  const role = actor;
  const requireRole = (r: Role) => {
    if (role !== r) throw new AppError(403, `Requires ${r} role`);
  };
  if (action === "create") {
    requireRole("investment");
    check(
      typeof data.symbol === "string" &&
        securities.some((x) => x.symbol === data.symbol),
      "Unknown security"
    );
    check(data.side === "BUY" || data.side === "SELL", "Invalid side");
    check(
      typeof data.quantity === "number" &&
        Number.isSafeInteger(data.quantity) &&
        data.quantity > 0 &&
        data.quantity <= 100000,
      "Quantity must be a positive integer, maximum 100000"
    );
    check(
      data.orderType === "MARKET" || data.orderType === "LIMIT",
      "Invalid order type"
    );
    check(
      data.orderType !== "LIMIT" ||
        (typeof data.limitPrice === "number" &&
          Number.isSafeInteger(data.limitPrice) &&
          data.limitPrice > 0),
      "Limit price must be positive cents"
    );
    const o: Order = {
      id: id(),
      symbol: data.symbol,
      side: data.side,
      quantity: data.quantity,
      orderType: data.orderType,
      limitPrice: data.orderType === "LIMIT" ? data.limitPrice! : null,
      status: "PENDING",
      filled: 0,
      createdAt: now(),
    };
    s.orders.push(o);
    event(s, "OrderCreated", o.id, actor);
    return o;
  }
  if (["approve", "execute"].includes(action)) {
    requireRole("investment");
    const o = s.orders.find((x) => x.id === data.id);
    check(o, "Order not found");
    if (action === "approve") {
      check(o.status === "PENDING", "Order must be pending");
      o.status = "APPROVED";
      event(s, "OrderApproved", o.id, actor);
      return o;
    }
    check(
      ["APPROVED", "PARTIALLY_FILLED", "SUBMITTED"].includes(o.status),
      "Order cannot execute"
    );
    const price = (s.prices ??
      Object.fromEntries(securities.map((x) => [x.symbol, x.price])))[o.symbol];
    check(
      Number.isSafeInteger(price) && price > 0,
      "Execution price unavailable"
    );
    if (s.priceSet)
      check(
        s.priceSet.quotes.find((q) => q.symbol === o.symbol)?.asOf === s.date,
        "Execution quote is stale; refresh market first"
      );
    check(
      o.orderType !== "LIMIT" ||
        (o.side === "BUY" ? price <= o.limitPrice! : price >= o.limitPrice!),
      "Limit not reached"
    );
    const quantity = data.quantity ?? o.quantity - o.filled;
    check(
      Number.isSafeInteger(quantity) &&
        quantity > 0 &&
        quantity <= o.quantity - o.filled,
      "Invalid fill quantity"
    );
    if (o.status === "APPROVED") {
      o.status = "SUBMITTED";
      event(s, "OrderSubmitted", o.id, actor);
    }
    const due = new Date(s.date + "T12:00:00Z");
    do {
      due.setUTCDate(due.getUTCDate() + 1);
    } while ([0, 6].includes(due.getUTCDay()));
    const t: Trade = {
      id: id(),
      orderId: o.id,
      symbol: o.symbol,
      side: o.side,
      quantity,
      price,
      fee: 500,
      status: "PENDING",
      tradeDate: s.date,
      due: due.toISOString().slice(0, 10),
      executedAt: now(),
      broker: "Simulated broker",
    };
    s.trades.push(t);
    o.filled += quantity;
    o.status = o.filled === o.quantity ? "FILLED" : "PARTIALLY_FILLED";
    event(s, "TradeExecuted", t.id, actor, { orderId: o.id });
    return t;
  }
  requireRole("operations");
  if (action === "advance") {
    const d = new Date(s.date + "T12:00:00Z");
    do {
      d.setUTCDate(d.getUTCDate() + 1);
    } while ([0, 6].includes(d.getUTCDay()));
    s.date = d.toISOString().slice(0, 10);
    event(s, "BusinessDateAdvanced", s.date, actor);
    return;
  }
  if (action === "settle") {
    const t = s.trades.find((x) => x.id === data.id);
    check(t, "Trade not found");
    check(["PENDING", "FAILED"].includes(t.status), "Already settled");
    check(t.due <= s.date, "Settlement is not due yet");
    const p = book(s);
    const amount = t.quantity * t.price;
    const held = p.holdings.find((x) => x.symbol === t.symbol)?.quantity ?? 0;
    const reason =
      (t.side === "BUY" ? p.cash - amount - t.fee : p.cash + amount - t.fee) < 0
        ? "Insufficient cash"
        : t.side === "SELL" && held < t.quantity
        ? "Insufficient settled holdings"
        : null;
    if (reason) {
      t.status = "FAILED";
      t.reason = reason;
      event(s, "SettlementFailed", t.id, actor, { reason });
      return t;
    }
    t.status = "SETTLED";
    delete t.reason;
    t.settledAt = now();
    s.ledger.push(
      {
        id: id(),
        tradeId: t.id,
        type: t.side,
        symbol: t.symbol,
        quantity: t.side === "BUY" ? t.quantity : -t.quantity,
        cash: t.side === "BUY" ? -amount : amount,
        at: now(),
      },
      {
        id: id(),
        tradeId: t.id,
        type: "FEE",
        symbol: null,
        quantity: 0,
        cash: -t.fee,
        at: now(),
      }
    );
    event(s, "SettlementCompleted", t.id, actor);
    event(s, "LedgerUpdated", t.id, "system");
    event(s, "PositionUpdated", t.symbol, "system");
    snapshot(s);
    return t;
  }
  if (action === "reconcile") {
    check(
      typeof data.symbol === "string" &&
        securities.some((x) => x.symbol === data.symbol),
      "Unknown security"
    );
    check(
      typeof data.actual === "number" &&
        Number.isSafeInteger(data.actual) &&
        data.actual >= 0,
      "Broker quantity must be a nonnegative integer"
    );
    const expected =
      portfolio(s).positions.find((x) => x.symbol === data.symbol)?.quantity ??
      0;
    const e: Reconciliation = {
      id: id(),
      symbol: data.symbol,
      expected,
      actual: data.actual,
      difference: expected - data.actual,
      status: expected === data.actual ? "MATCHED" : "OPEN",
      at: now(),
    };
    s.exceptions.push(e);
    event(s, "ReconciliationCompleted", e.id, actor);
    return e;
  }
  if (action === "resolve") {
    const e = s.exceptions.find((x) => x.id === data.id);
    check(e && e.status === "OPEN", "Open exception not found");
    check(
      typeof data.note === "string" &&
        data.note.trim().length >= 5 &&
        data.note.length <= 1000,
      "Resolution note requires 5–1000 characters"
    );
    e.status = "RESOLVED";
    e.note = data.note.trim();
    event(s, "ReconciliationResolved", e.id, actor, { note: e.note });
    return e;
  }
  throw new AppError(400, "Unknown action");
}
