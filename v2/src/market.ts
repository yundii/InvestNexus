import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { transaction } from "./database.js";
import { getProvider, providerName, validDate } from "./market-provider.js";
import type { MarketDataProvider, PricePoint } from "./market-provider.js";
import type { PriceSet, Quote } from "./types.js";
import { symbols } from "./catalog.js";
export async function pricesAsOf(
  c: PoolClient,
  date: string,
  provider = providerName()
): Promise<PriceSet> {
  const records = await c.query(
    `SELECT DISTINCT ON(p.symbol) p.id,p.symbol,p.price_cents,to_char(p.price_date,'YYYY-MM-DD') AS date,p.provider,b.created_at FROM market_prices p JOIN market_batches b ON b.id=p.batch_id WHERE p.provider=$1 AND p.price_date<=$2 AND b.status='COMPLETE' ORDER BY p.symbol,p.price_date DESC,p.seq DESC`,
    [provider, date]
  );
  const quotes: Quote[] = records.rows.map((q) => ({
    id: q.id,
    symbol: q.symbol,
    price: Number(q.price_cents),
    asOf: q.date,
    provider: q.provider,
    fetchedAt: q.created_at.toISOString(),
  }));
  const missing = symbols.filter(
    (symbol) => !quotes.some((q) => q.symbol === symbol)
  );
  const latest = (
    await c.query(
      "SELECT status,error,created_at FROM market_batches WHERE provider=$1 AND requested_date=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
      [provider, date]
    )
  ).rows[0];
  return {
    provider,
    status: missing.length
      ? "INCOMPLETE"
      : quotes.some((q) => q.asOf !== date)
      ? "STALE"
      : "FRESH",
    quotes,
    missing,
    lastRefresh: latest?.created_at.toISOString() ?? null,
    lastError: latest?.status === "FAILED" ? latest.error : null,
  };
}
export function priceMap(set: PriceSet) {
  return Object.fromEntries(set.quotes.map((q) => [q.symbol, q.price]));
}
export async function refreshMarket(
  date: string,
  provider: MarketDataProvider = getProvider()
) {
  if (!validDate(date)) throw Error("Invalid market date");
  const id = randomUUID();
  const history: PricePoint[] = [];
  try {
    for (const symbol of symbols) {
      const points = await provider.getHistory(symbol, date);
      if (!points.length) throw Error("Provider returned empty history");
      const dates = new Set<string>();
      for (const point of points) {
        if (
          point.symbol !== symbol ||
          !validDate(point.date) ||
          point.date > date ||
          !Number.isSafeInteger(point.price) ||
          point.price <= 0 ||
          dates.has(point.date)
        )
          throw Error("Invalid provider history");
        dates.add(point.date);
      }
      history.push(...points);
    }
    return await transaction(async (c) => {
      await c.query(
        "INSERT INTO market_batches(id,provider,requested_date,status) VALUES($1,$2,$3,'COMPLETE')",
        [id, provider.name, date]
      );
      for (const p of history)
        await c.query(
          "INSERT INTO market_prices(id,batch_id,symbol,price_date,price_cents,provider) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), id, p.symbol, p.date, p.price, provider.name]
        );
      await c.query("SELECT pg_notify('market_updated',$1)", [date]);
      return { id, provider: provider.name, date, points: history.length };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Market update failed";
    await transaction((c) =>
      c.query(
        "INSERT INTO market_batches(id,provider,requested_date,status,error) VALUES($1,$2,$3,'FAILED',$4)",
        [id, provider.name, date, message]
      )
    );
    throw Error(message);
  }
}
