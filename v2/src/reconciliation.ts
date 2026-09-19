import { randomUUID } from "./id.js";
import { book } from "./ledger.js";
import { symbols } from "./catalog.js";
import { AppError } from "./types.js";
import type {
  State,
  CommandData,
  Reconciliation,
  ReconciliationRun,
  ReconciliationSummary,
} from "./types.js";
export function reconcileBook(s: State, data: CommandData) {
  if (
    data.asOf !== s.date ||
    !Number.isSafeInteger(data.cash) ||
    data.cash! < 0 ||
    !Array.isArray(data.positions) ||
    data.positions.length > symbols.length ||
    typeof data.broker !== "string" ||
    !data.broker.trim() ||
    data.broker.length > 80
  )
    throw new AppError(
      422,
      "Broker statement requires current business date, cash cents, broker name and positions"
    );
  const seen = new Set<string>();
  for (const p of data.positions) {
    if (
      !p ||
      typeof p.symbol !== "string" ||
      !symbols.includes(p.symbol) ||
      seen.has(p.symbol) ||
      !Number.isSafeInteger(p.quantity) ||
      p.quantity < 0
    )
      throw new AppError(422, "Invalid or duplicate broker position");
    seen.add(p.symbol);
  }
  const b = book(s);
  const run: ReconciliationRun = {
    id: randomUUID(),
    date: s.date,
    ledgerVersion: s.ledgerVersion!,
    broker: data.broker.trim(),
    cash: data.cash!,
    positions: data.positions.map((p) => ({ ...p })),
    at: new Date().toISOString(),
  };
  const record = (
    kind: "CASH" | "POSITION",
    symbol: string,
    expected: number,
    actual: number
  ) => {
    const e: Reconciliation = {
      id: randomUUID(),
      runId: run.id,
      kind,
      symbol,
      expected,
      actual,
      difference: expected - actual,
      status: expected === actual ? "MATCHED" : "OPEN",
      businessDate: s.date,
      at: run.at,
    };
    s.exceptions.push(e);
  };
  record("CASH", "USD", b.cash, run.cash);
  for (const symbol of new Set([...b.holdings.map((p) => p.symbol), ...seen]))
    record(
      "POSITION",
      symbol,
      b.holdings.find((p) => p.symbol === symbol)?.quantity ?? 0,
      run.positions.find((p) => p.symbol === symbol)?.quantity ?? 0
    );
  s.reconciliationRuns.push(run);
  s.events.push({
    id: randomUUID(),
    type: "BookReconciled",
    entity: run.id,
    actor: "operations",
    at: run.at,
  });
  return run;
}
export function certifiedReconciliation(s: State): ReconciliationSummary {
  const run = s.reconciliationRuns.at(-1);
  if (!run || run.date !== s.date || run.ledgerVersion !== s.ledgerVersion)
    throw new AppError(
      409,
      "Reconcile the current cash and positions before closing valuation"
    );
  const exceptions = s.exceptions.filter((e) => e.runId === run.id);
  if (exceptions.some((e) => e.status === "OPEN"))
    throw new AppError(
      409,
      "Resolve open reconciliation exceptions before closing valuation"
    );
  return {
    runId: run.id,
    status: exceptions.some((e) => e.status === "RESOLVED")
      ? "RESOLVED_WITH_EXCEPTIONS"
      : "MATCHED",
    ledgerVersion: run.ledgerVersion,
    broker: run.broker,
    exceptions,
  };
}
