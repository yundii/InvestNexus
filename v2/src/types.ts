export type Role = "investment" | "operations" | "client";
export type Side = "BUY" | "SELL";
export interface Order {
  id: string;
  symbol: string;
  side: Side;
  quantity: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  status: "PENDING" | "APPROVED" | "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED";
  filled: number;
  createdAt: string;
}
export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  status: "PENDING" | "SETTLED" | "FAILED";
  tradeDate: string;
  due: string;
  executedAt: string;
  broker: string;
  reason?: string;
  settledAt?: string;
}
export interface LedgerEntry {
  id: string;
  type: "DEPOSIT" | "BUY" | "SELL" | "FEE";
  cash: number;
  symbol: string | null;
  quantity: number;
  at: string;
  tradeId?: string;
}
export interface AuditEvent {
  id: string;
  type: string;
  entity: string;
  actor: string;
  at: string;
  orderId?: string;
  reason?: string;
  note?: string;
}
export interface Reconciliation {
  kind?: "POSITION" | "CASH";
  runId?: string;
  businessDate?: string;
  id: string;
  symbol: string;
  expected: number;
  actual: number;
  difference: number;
  status: "MATCHED" | "OPEN" | "RESOLVED";
  at: string;
  note?: string;
}
export interface Position {
  symbol: string;
  quantity: number;
  cost: number;
  averageCost: number;
  price: number | null;
  marketValue: number | null;
}
export interface Portfolio {
  cash: number;
  positions: Position[];
  value: number | null;
  realized: number;
  unrealized: number | null;
  returnPct: number | null;
  fees: number;
  capital: number;
  valuationStatus: "FRESH" | "STALE" | "INCOMPLETE";
  missingPrices: string[];
}
export interface Snapshot extends Portfolio {
  id: string;
  date: string;
  at: string;
  kind?: "SETTLEMENT" | "DAILY";
  priceSet?: PriceSet;
  performance?: Performance;
  reconciliation?: ReconciliationSummary;
}
export interface State {
  date: string;
  orders: Order[];
  trades: Trade[];
  ledger: LedgerEntry[];
  events: AuditEvent[];
  exceptions: Reconciliation[];
  snapshots: Snapshot[];
  reconciliationRuns: ReconciliationRun[];
  ledgerVersion?: number;
  prices?: Record<string, number>;
  priceSet?: PriceSet;
}
export interface CommandData {
  id?: string;
  symbol?: string;
  side?: Side;
  quantity?: number;
  orderType?: "MARKET" | "LIMIT";
  limitPrice?: number;
  actual?: number;
  cash?: number;
  asOf?: string;
  positions?: { symbol: string; quantity: number }[];
  broker?: string;
  note?: string;
}
export interface Identity {
  id: string;
  email: string;
  userName: string;
}
export interface Membership {
  id: string;
  name: string;
  roles: Role[];
}
export class AppError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface Quote {
  id: string;
  symbol: string;
  price: number;
  asOf: string;
  provider: string;
  fetchedAt: string;
}
export interface PriceSet {
  provider: string;
  status: "FRESH" | "STALE" | "INCOMPLETE";
  quotes: Quote[];
  missing: string[];
  lastRefresh: string | null;
  lastError: string | null;
}
export interface ReconciliationRun {
  id: string;
  date: string;
  ledgerVersion: number;
  broker: string;
  cash: number;
  positions: { symbol: string; quantity: number }[];
  at: string;
}
export interface ReconciliationSummary {
  runId: string;
  status: "MATCHED" | "RESOLVED_WITH_EXCEPTIONS";
  ledgerVersion: number;
  broker: string;
  exceptions: Reconciliation[];
}
export interface PerformancePoint {
  date: string;
  value: number;
  periodReturnPct: number;
  dailyReturnPct: number | null;
  cumulativeReturnPct: number;
  benchmarkPrice: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
}
export interface Performance {
  benchmark: string;
  provider: string;
  inceptionDate: string;
  baselineBenchmarkPrice: number;
  baselineBenchmarkDate: string;
  points: PerformancePoint[];
}
