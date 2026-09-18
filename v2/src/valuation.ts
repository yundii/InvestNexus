import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { portfolio } from "./ledger.js";
import { certifiedReconciliation } from "./reconciliation.js";
import { pricesAsOf } from "./market.js";
import { benchmarkSymbol } from "./catalog.js";
import { performancePoint } from "./performance.js";
import { AppError } from "./types.js";
import type { State, Snapshot, Performance } from "./types.js";
export async function closeValuation(
  c: PoolClient,
  accountId: string,
  s: State
): Promise<Snapshot> {
  if ([0, 6].includes(new Date(s.date + "T12:00:00Z").getUTCDay()))
    throw new AppError(409, "Close valuation on a weekday");
  if (s.priceSet?.status !== "FRESH" || s.priceSet.lastError)
    throw new AppError(
      409,
      "Fresh complete market data required; refresh prices before closing"
    );
  const p = portfolio(s);
  if (p.value === null)
    throw new AppError(409, "Held-security price is missing");
  const reconciliation = certifiedReconciliation(s);
  const account = (
    await c.query(
      "SELECT to_char(inception_date,'YYYY-MM-DD') AS inception FROM accounts WHERE id=$1",
      [accountId]
    )
  ).rows[0];
  const previousRows = (
    await c.query(
      "SELECT payload FROM daily_valuations WHERE account_id=$1 ORDER BY valuation_date",
      [accountId]
    )
  ).rows;
  const previous = previousRows.at(-1)?.payload.performance as
    | Performance
    | undefined;
  if (previous && previous.provider !== s.priceSet.provider)
    throw new AppError(
      409,
      "Cannot mix market providers within the same performance series"
    );
  if (previous && previous.points.at(-1)!.date >= s.date)
    throw new AppError(409, "Daily valuation already closed");
  const baselineSet = previous
    ? null
    : await pricesAsOf(c, account.inception, s.priceSet.provider);
  const base = baselineSet?.quotes.find((q) => q.symbol === benchmarkSymbol);
  if (!previous && !base)
    throw new AppError(409, "Benchmark inception price unavailable");
  const benchmark = s.priceSet.quotes.find(
    (q) => q.symbol === benchmarkSymbol
  )!;
  const baselineBenchmarkPrice =
    previous?.baselineBenchmarkPrice ?? base!.price;
  const performance: Performance = {
    benchmark: benchmarkSymbol,
    provider: s.priceSet.provider,
    inceptionDate: account.inception,
    baselineBenchmarkPrice,
    baselineBenchmarkDate: previous?.baselineBenchmarkDate ?? base!.asOf,
    points: [
      ...(previous?.points ?? []),
      performancePoint(
        s.date,
        p.value,
        p.capital,
        benchmark.price,
        baselineBenchmarkPrice,
        previous?.points.at(-1),
        account.inception
      ),
    ],
  };
  const snapshot: Snapshot = {
    id: randomUUID(),
    date: s.date,
    at: new Date().toISOString(),
    ...p,
    kind: "DAILY",
    priceSet: s.priceSet,
    performance,
    reconciliation,
  };
  s.snapshots.push(snapshot);
  s.events.push({
    id: randomUUID(),
    type: "PortfolioValuationClosed",
    entity: snapshot.id,
    actor: "operations",
    at: snapshot.at,
  });
  return snapshot;
}
export async function persistDaily(
  c: PoolClient,
  accountId: string,
  snapshot: Snapshot
) {
  await c.query(
    "INSERT INTO daily_valuations(id,account_id,valuation_date,snapshot_id,reconciliation_id,ledger_version,provider,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      accountId,
      snapshot.date,
      snapshot.id,
      snapshot.reconciliation!.runId,
      snapshot.reconciliation!.ledgerVersion,
      snapshot.priceSet!.provider,
      snapshot,
    ]
  );
}
