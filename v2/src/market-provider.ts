import { securities, symbols } from "./catalog.js";
export interface PricePoint {
  symbol: string;
  date: string;
  price: number;
}
export interface MarketDataProvider {
  readonly name: "mock" | "alpha-vantage";
  getHistory(symbol: string, asOf: string): Promise<PricePoint[]>;
}
export function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(new Date(date + "T12:00:00Z").getTime()) &&
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date
  );
}
export function cents(value: unknown) {
  if (typeof value !== "string" || !/^\d+(\.\d{1,8})?$/.test(value))
    throw Error("Invalid provider price");
  const [whole, fraction = ""] = value.split(".");
  const digits = fraction.padEnd(3, "0");
  const amount =
    BigInt(whole) * 100n +
    BigInt(digits.slice(0, 2)) +
    (Number(digits[2]) >= 5 ? 1n : 0n);
  if (amount <= 0 || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Invalid provider price");
  return Number(amount);
}
export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock" as const;
  constructor(
    private anchor = process.env.MOCK_MARKET_START_DATE ?? "2026-09-18"
  ) {}
  async getHistory(symbol: string, asOf: string) {
    if (
      !symbols.includes(symbol) ||
      !validDate(asOf) ||
      !validDate(this.anchor)
    )
      throw Error("Invalid mock market request");
    const base = securities.find((s) => s.symbol === symbol)!.price;
    const drift: { [symbol: string]: number } = {
      MSFT: 120,
      AAPL: 60,
      NVDA: 80,
      VTI: 35,
    };
    const cursor = new Date(asOf + "T12:00:00Z");
    const history: PricePoint[] = [];
    while (history.length < 60) {
      if (![0, 6].includes(cursor.getUTCDay())) {
        const offset = Math.round(
          (cursor.getTime() - new Date(this.anchor + "T12:00:00Z").getTime()) /
            86400000
        );
        history.push({
          symbol,
          date: cursor.toISOString().slice(0, 10),
          price: Math.max(100, base + offset * drift[symbol]),
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return history.reverse();
  }
}
export function parseAlphaHistory(
  symbol: string,
  payload: unknown,
  asOf: string
): PricePoint[] {
  if (!payload || typeof payload !== "object")
    throw Error("Invalid provider response");
  const raw = payload as Record<string, unknown>;
  if (raw.Note || raw.Information)
    throw Error("Alpha Vantage quota or entitlement unavailable");
  if (raw["Error Message"]) throw Error("Alpha Vantage rejected the symbol");
  const meta = raw["Meta Data"] as Record<string, unknown> | undefined;
  if (meta?.["2. Symbol"] !== symbol) throw Error("Provider symbol mismatch");
  const series = raw["Time Series (Daily)"];
  if (!series || typeof series !== "object" || Array.isArray(series))
    throw Error("Missing daily price history");
  const points = Object.entries(series)
    .filter(([date]) => validDate(date) && date <= asOf)
    .map(([date, bar]) => {
      if (!bar || typeof bar !== "object") throw Error("Invalid daily bar");
      return {
        symbol,
        date,
        price: cents((bar as Record<string, unknown>)["4. close"]),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) throw Error("No market prices for requested date");
  return points;
}
export class AlphaVantageProvider implements MarketDataProvider {
  readonly name = "alpha-vantage" as const;
  constructor(
    private key = process.env.ALPHA_VANTAGE_API_KEY,
    private fetcher: typeof fetch = fetch
  ) {}
  async getHistory(symbol: string, asOf: string) {
    if (!this.key) throw Error("ALPHA_VANTAGE_API_KEY is required");
    if (
      !symbols.includes(symbol) ||
      !validDate(asOf) ||
      asOf > new Date().toISOString().slice(0, 10)
    )
      throw Error("Invalid live market request date");
    const url = new URL("https://www.alphavantage.co/query");
    url.search = new URLSearchParams({
      function: "TIME_SERIES_DAILY",
      symbol,
      outputsize: "compact",
      apikey: this.key,
    }).toString();
    let response: Response;
    try {
      response = await this.fetcher(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw Error("Alpha Vantage network request failed");
    }
    if (!response.ok) throw Error(`Alpha Vantage HTTP ${response.status}`);
    return parseAlphaHistory(symbol, await response.json(), asOf);
  }
}
export function providerName() {
  const name = process.env.MARKET_PROVIDER ?? "mock";
  if (name !== "mock" && name !== "alpha-vantage")
    throw Error("Invalid MARKET_PROVIDER");
  return name;
}
export function getProvider(): MarketDataProvider {
  return providerName() === "mock"
    ? new MockMarketDataProvider()
    : new AlphaVantageProvider();
}
