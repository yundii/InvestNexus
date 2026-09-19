import { randomUUID } from "./id.js";
import { portfolio } from "./ledger.js";
import { certifiedReconciliation } from "./reconciliation.js";
import { benchmarkSymbol } from "./catalog.js";
import { performancePoint } from "./performance.js";
import { AppError } from "./types.js";
import type { State, Snapshot, Performance, Quote } from "./types.js";
export function dailySnapshot(
  s: State,
  inception: string,
  previous?: Performance,
  base?: Quote
): Snapshot {
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
  if (previous && previous.provider !== s.priceSet!.provider)
    throw new AppError(
      409,
      "Cannot mix market providers within the same performance series"
    );
  if (previous && previous.points.at(-1)!.date >= s.date)
    throw new AppError(409, "Daily valuation already closed");
  if (!previous && !base)
    throw new AppError(409, "Benchmark inception price unavailable");
  const benchmark = s.priceSet!.quotes.find(
    (q) => q.symbol === benchmarkSymbol
  )!;
  const baselineBenchmarkPrice =
    previous?.baselineBenchmarkPrice ?? base!.price;
  const performance: Performance = {
    benchmark: benchmarkSymbol,
    provider: s.priceSet!.provider,
    inceptionDate: inception,
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
        inception
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
