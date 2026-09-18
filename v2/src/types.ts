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
  price: number;
  marketValue: number;
}
export interface Portfolio {
  cash: number;
  positions: Position[];
  value: number;
  realized: number;
  unrealized: number;
  returnPct: number;
}
export interface Snapshot extends Portfolio {
  id: string;
  date: string;
  at: string;
}
export interface State {
  date: string;
  orders: Order[];
  trades: Trade[];
  ledger: LedgerEntry[];
  events: AuditEvent[];
  exceptions: Reconciliation[];
  snapshots: Snapshot[];
}
export interface CommandData {
  id?: string;
  symbol?: string;
  side?: Side;
  quantity?: number;
  orderType?: "MARKET" | "LIMIT";
  limitPrice?: number;
  actual?: number;
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
