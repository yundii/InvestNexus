import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { dailySnapshot } from "./daily-close.js";
import { pricesAsOf } from "./market.js";
import { benchmarkSymbol } from "./catalog.js";
import type { State, Snapshot, Performance } from "./types.js";
export async function closeValuation(
  c: PoolClient,
  accountId: string,
  s: State
): Promise<Snapshot> {
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
  const baselineSet = previous
    ? null
    : await pricesAsOf(c, account.inception, s.priceSet?.provider);
  const base = baselineSet?.quotes.find((q) => q.symbol === benchmarkSymbol);
  return dailySnapshot(s, account.inception, previous, base);
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
