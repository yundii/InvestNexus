import type { State, Portfolio } from "./types.js";
import { securities } from "./catalog.js";
export function book(s: State) {
  let cash = 0,
    realized = 0,
    fees = 0,
    capital = 0;
  const holdings: Record<
    string,
    { symbol: string; quantity: number; cost: number }
  > = {};
  for (const e of s.ledger) {
    cash += e.cash;
    if (e.type === "DEPOSIT") capital += e.cash;
    if (e.type === "FEE") fees -= e.cash;
    if (!e.symbol) continue;
    const p = (holdings[e.symbol] ??= {
      symbol: e.symbol,
      quantity: 0,
      cost: 0,
    });
    if (e.quantity > 0) {
      p.quantity += e.quantity;
      p.cost -= e.cash;
    } else {
      const sold = -e.quantity;
      if (sold > p.quantity || p.quantity <= 0)
        throw Error("Invalid ledger inventory");
      const cost =
        sold === p.quantity ? p.cost : Math.round((p.cost * sold) / p.quantity);
      realized += e.cash - cost;
      p.cost -= cost;
      p.quantity -= sold;
    }
  }
  return {
    cash,
    realized,
    fees,
    capital,
    holdings: Object.values(holdings).filter((p) => p.quantity > 0),
  };
}
export function portfolio(
  s: State,
  prices = s.prices ??
    Object.fromEntries(securities.map((x) => [x.symbol, x.price]))
): Portfolio {
  const b = book(s);
  const missing = b.holdings
    .filter(
      (p) => !Number.isSafeInteger(prices[p.symbol]) || prices[p.symbol] <= 0
    )
    .map((p) => p.symbol);
  const positions = b.holdings.map((p) => ({
    ...p,
    averageCost: Math.round(p.cost / p.quantity),
    price: prices[p.symbol] ?? null,
    marketValue: prices[p.symbol] ? p.quantity * prices[p.symbol] : null,
  }));
  const value = missing.length
    ? null
    : b.cash + positions.reduce((n, p) => n + (p.marketValue ?? 0), 0);
  return {
    cash: b.cash,
    positions,
    value,
    realized: b.realized,
    fees: b.fees,
    capital: b.capital,
    unrealized: missing.length
      ? null
      : positions.reduce((n, p) => n + (p.marketValue ?? 0) - p.cost, 0),
    returnPct:
      value === null || !b.capital ? null : (value / b.capital - 1) * 100,
    valuationStatus: missing.length
      ? "INCOMPLETE"
      : s.priceSet?.status ?? "FRESH",
    missingPrices: missing,
  };
}
