import { randomUUID } from "../id.js";
import { seed, command, portfolio, securities } from "../platform.js";
import { reconcileBook } from "../reconciliation.js";
import { dailySnapshot } from "../daily-close.js";
import { MockMarketDataProvider } from "../market-provider.js";
import { AppError } from "../types.js";
import type {
  State,
  Snapshot,
  Identity,
  Membership,
  Quote,
  CommandData,
} from "../types.js";
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface Report {
  id: string;
  simulation: true;
  runtime: "browser";
  accountId: string;
  date: string;
  generatedAt: string;
  snapshot: Snapshot;
  portfolio: Snapshot;
  performance: Snapshot["performance"];
  reconciliation: Snapshot["reconciliation"];
  priceSet: Snapshot["priceSet"];
  reportKind: "DAILY";
  transactions: State["trades"];
}
interface Saved {
  version: 1;
  accountId: string;
  user: Identity;
  inception: string;
  state: State;
  daily: Snapshot[];
  reports: Report[];
  jobs: { id: string; status: "COMPLETE"; date: string }[];
  requests: Record<string, { fingerprint: string; response: unknown }>;
}
export class BrowserApi {
  readonly key: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private stores?: { local: Store; session: Store },
    path = typeof location === "undefined"
      ? "/"
      : new URL(".", location.href).pathname
  ) {
    this.key = "investnexus:browser:v1:" + path;
  }
  private get local() {
    return this.stores?.local ?? globalThis.localStorage;
  }
  private get session() {
    return this.stores?.session ?? globalThis.sessionStorage;
  }
  private read(): Saved | null {
    const raw = this.local.getItem(this.key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !data.state || !Array.isArray(data.daily))
        throw Error();
      return data;
    } catch {
      throw new AppError(
        409,
        "Saved demo data cannot be read. Reset the browser demo to continue."
      );
    }
  }
  private save(data: Saved) {
    this.local.setItem(this.key, JSON.stringify(data));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("investnexus-browser-updated"));
  }
  private identity(data: Saved) {
    const accounts: Membership[] = [
      {
        id: data.accountId,
        name: "Private demo portfolio",
        roles: ["investment", "operations", "client"],
      },
    ];
    return { user: data.user, csrf: data.user.id, accounts };
  }
  private async refresh(data: Saved) {
    const provider = new MockMarketDataProvider(data.inception);
    const quotes: Quote[] = [];
    const at = new Date().toISOString();
    for (const security of securities) {
      const point = (
        await provider.getHistory(security.symbol, data.state.date)
      ).at(-1)!;
      quotes.push({
        id: randomUUID(),
        symbol: security.symbol,
        price: point.price,
        asOf: point.date,
        provider: "mock",
        fetchedAt: at,
      });
    }
    data.state.priceSet = {
      provider: "mock",
      status: quotes.every((q) => q.asOf === data.state.date)
        ? "FRESH"
        : "STALE",
      quotes,
      missing: [],
      lastRefresh: at,
      lastError: null,
    };
    data.state.prices = Object.fromEntries(
      quotes.map((q) => [q.symbol, q.price])
    );
  }
  private view(data: Saved) {
    const s = data.state,
      latest = data.reports.at(-1) ?? null;
    return {
      ...s,
      roles: ["investment", "operations", "client"],
      portfolio: portfolio(s),
      securities: securities.map((sec) => ({
        ...sec,
        ...s.priceSet!.quotes.find((q) => q.symbol === sec.symbol),
      })),
      daily: data.daily,
      performance: data.daily.at(-1)?.performance ?? null,
      dayClosed: data.daily.some((d) => d.date === s.date),
      marketJobs: data.jobs.slice(-5).reverse(),
      reportStatus: {
        pending: 0,
        dailyPending: 0,
        lastError: null,
        latest,
        latestDaily: latest,
      },
    };
  }
  async request(
    path: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<any> {
    const work = async () => {
      try {
        return await this.route(path, options);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (
          error instanceof Error &&
          ["QuotaExceededError", "SecurityError"].includes(error.name)
        )
          throw new AppError(
            503,
            "Browser storage is unavailable. Enable local storage to use this demo."
          );
        throw error;
      }
    };
    // This serializes simulation writes across tabs; it is not a PostgreSQL transaction.
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(this.key, work);
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }
  private async route(
    path: string,
    options: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    }
  ): Promise<any> {
    const url = new URL(path, "https://browser.invalid"),
      method = options.method ?? "GET";
    if (url.pathname === "/api/config")
      return { demoEnabled: true, browserSimulation: true };
    if (url.pathname === "/api/demo" && method === "POST") {
      let data = this.read();
      if (!data) {
        const s = seed();
        s.ledgerVersion = s.ledger.length;
        data = {
          version: 1,
          accountId: randomUUID(),
          user: {
            id: randomUUID(),
            email: "visitor@browser.demo",
            userName: "Browser demo visitor",
          },
          inception: s.date,
          state: s,
          daily: [],
          reports: [],
          jobs: [],
          requests: {},
        };
        await this.refresh(data);
        this.save(data);
      }
      this.session.setItem(this.key + ":session", "active");
      return this.identity(data);
    }
    if (url.pathname === "/api/demo/reset" && method === "POST") {
      this.local.removeItem(this.key);
      this.session.removeItem(this.key + ":session");
      return { reset: true };
    }
    const data = this.read();
    if (!data || this.session.getItem(this.key + ":session") !== "active")
      throw new AppError(401, "Start the browser demo to continue");
    if (url.pathname === "/api/auth/me") return this.identity(data);
    if (url.pathname === "/api/auth/logout" && method === "POST") {
      this.session.removeItem(this.key + ":session");
      return { ok: true };
    }
    if (url.searchParams.get("accountId") !== data.accountId)
      throw new AppError(403, "Account access denied");
    if (url.pathname === "/api/state" && method === "GET")
      return this.view(data);
    if (url.pathname === "/api/market" && method === "GET")
      return { market: data.state.priceSet, cache: "browser-simulation" };
    if (url.pathname === "/api/report" && method === "GET") {
      const report = data.reports.at(-1);
      if (!report)
        throw new AppError(409, "Close a daily valuation before exporting");
      return structuredClone(report);
    }
    if (url.pathname !== "/api/command" || method !== "POST")
      throw new AppError(404, "Route unavailable in browser simulation");
    const key = options.headers?.["Idempotency-Key"];
    if (!key || !/^[A-Za-z0-9_-]{16,128}$/.test(key))
      throw new AppError(400, "Valid Idempotency-Key is required");
    const input = JSON.parse(options.body ?? "{}") as {
      action: string;
      data: CommandData;
    };
    const fingerprint = JSON.stringify(input);
    const old = data.requests[key];
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new AppError(
          409,
          "Idempotency key already used for another request"
        );
      return structuredClone(old.response);
    }
    // A failed command never persists the staged state.
    const staged = structuredClone(data),
      s = staged.state;
    const closed = staged.daily.some((d) => d.date === s.date);
    if (
      closed &&
      !["advance", "resolve", "refreshMarket"].includes(input.action)
    )
      throw new AppError(
        409,
        "Business date is closed; advance to the next date"
      );
    let result: unknown;
    if (input.action === "refreshMarket") {
      await this.refresh(staged);
      const job = {
        id: randomUUID(),
        status: "COMPLETE" as const,
        date: s.date,
      };
      staged.jobs.push(job);
      result = job;
      s.events.push({
        id: randomUUID(),
        type: "MarketRefreshCompleted",
        entity: job.id,
        actor: "browser simulation",
        at: new Date().toISOString(),
      });
    } else if (input.action === "reconcileBook")
      result = reconcileBook(s, input.data);
    else if (input.action === "closeValuation") {
      const prior = staged.daily.at(-1)?.performance;
      const point = (
        await new MockMarketDataProvider(staged.inception).getHistory(
          "VTI",
          staged.inception
        )
      ).at(-1)!;
      const base: Quote = {
        id: randomUUID(),
        symbol: "VTI",
        price: point.price,
        asOf: point.date,
        provider: "mock",
        fetchedAt: new Date().toISOString(),
      };
      const snapshot = dailySnapshot(s, staged.inception, prior, base);
      staged.daily.push(structuredClone(snapshot));
      staged.reports.push({
        id: randomUUID(),
        simulation: true,
        runtime: "browser",
        accountId: staged.accountId,
        date: s.date,
        generatedAt: new Date().toISOString(),
        snapshot: structuredClone(snapshot),
        portfolio: structuredClone(snapshot),
        performance: structuredClone(snapshot.performance),
        reconciliation: structuredClone(snapshot.reconciliation),
        priceSet: structuredClone(snapshot.priceSet),
        reportKind: "DAILY",
        transactions: structuredClone(
          s.trades.filter((t) => t.status === "SETTLED")
        ),
      });
      result = snapshot;
    } else
      result = command(
        s,
        input.action,
        input.data,
        ["create", "approve", "execute"].includes(input.action)
          ? "investment"
          : "operations"
      );
    s.ledgerVersion = s.ledger.length;
    if (input.action === "advance" && s.priceSet) s.priceSet.status = "STALE";
    const response = { result: result ?? null };
    staged.requests[key] = { fingerprint, response: structuredClone(response) };
    this.save(staged);
    return structuredClone(response);
  }
}
export const browserApi = new BrowserApi();
