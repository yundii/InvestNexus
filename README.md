# InvestNexus — Mini Investment Management Platform

InvestNexus v2 is a runnable local MVP of the investment lifecycle: order creation and approval, simulated trade execution, settlement, ledger-derived positions, reconciliation, and client reporting.

The original React / Express dashboard remains in `client/` and `api/`. The new workflow prototype lives independently in `v2/` and requires no npm dependencies or external services.

## Quick start

Requires **Node.js 22+**.

```sh
git clone https://github.com/yundii/InvestNexus.git
cd InvestNexus/v2
npm start
```

Open **http://localhost:4100**. Run the domain tests with:

```sh
npm test
```

The simulation starts with $100,000 cash. Changes persist in `v2/data/platform.json`, which is excluded from Git. The server binds to localhost.

## Three workspaces

| Workspace | Features |
| --- | --- |
| Investment | Fixed mock quotes, market/limit orders, approval, partial fills, order lifecycle, settled holdings |
| Operations | T+1 weekday settlement, failed settlement retries, cash/security ledger, broker-position reconciliation, resolution notes, audit timeline |
| Client portal | Portfolio value, allocation, realized/unrealized P&L, settlement snapshots, transaction history, downloadable JSON report |

## Demo workflow

1. Create a **BUY 100 MSFT** market order in Investment and approve it.
2. Execute a fill of **60** shares, then the remaining **40**. The order transitions from `PARTIALLY_FILLED` to `FILLED`.
3. Switch to Operations and advance the business date. Settle both fills.
4. Holdings now show 100 MSFT shares. Cash is $58,990 and portfolio value is $99,990, reflecting two $5 execution fees.
5. Reconcile MSFT against **98** broker-reported shares. Investigate the two-share difference and resolve it with a note.
6. View the Client portal and export the report.

To demonstrate failure handling, execute a BUY 1,000 MSFT order, advance the date and attempt settlement. Insufficient cash produces a failed settlement without changing the ledger.

## Architecture

```text
Browser: Investment / Operations / Client portal
                  │ HTTP commands + SSE refresh
                  ▼
          Node.js HTTP adapter
                  │
                  ▼
     Domain commands and audit events
     Orders → Trades → Settlement
                         │
                         ▼
                  Append-only ledger
                         │ replay
                         ▼
                 Positions / Valuation
                         │
                         ▼
                 Report snapshots
                  │
                  ▼
       Atomic local JSON persistence
```

Orders and trades are separate entities. Execution does not immediately mutate holdings: successful settlement appends ledger entries, after which positions are derived by replay. Repeated settlement is rejected. Failed commands do not commit partial state.

Money is represented as integer USD cents; shares are integers. Each fill carries a $5 fee. T+1 skips weekends; exchange holidays are not modeled. Audit events are stored with the command, and server-sent events notify browsers to reload the committed state.

## Repository structure

```text
v2/
  domain/platform.js       Business commands and portfolio projections
  domain/platform.test.js Domain tests
  server.js               HTTP, SSE, and persistence adapter
  public/                 Responsive browser UI
  README.md               Chinese setup, demo, and implementation notes
api/                      Original Express / Prisma backend
client/                   Original React dashboard
```

## Validation

The domain test suite covers partial fills, settlement timing, duplicate settlement rejection, insufficient cash, sell-side inventory checks, persona validation, and reconciliation resolution. The browser workflow was checked from order creation through settlement and the client holdings report.

## MVP boundaries

This version uses **fixed mock quotes, simulated execution, single-account JSON persistence, and synchronous in-process workflows**. It does not implement PostgreSQL, RabbitMQ, Redis, background workers, or real broker connectivity.

Persona switching is a workflow UI, not authentication: the actor is supplied by the request. This is a localhost demo, not a publicly deployable financial application. Persistence supports one process; the ledger is application-level append-only, not double-entry accounting or database-enforced immutability.

The value chart shows settlement snapshots, not daily market performance. Benchmark comparisons, cash-flow-adjusted returns, TWR/IRR, multi-account isolation, and migration of legacy data are future work.

## Roadmap

- TypeScript and PostgreSQL transactions, schema migrations, and unique posting constraints.
- Trusted sessions, RBAC, account isolation, and command idempotency keys.
- Transactional outbox and RabbitMQ workers with idempotent consumers and retries.
- Isolated market-data providers, PostgreSQL price history, and Redis caches.
- React/Next.js integration, daily performance and benchmark reporting, Docker Compose.

See the [v2 guide in Chinese](v2/README.md) for the detailed demo and scope. The [original dashboard README](docs/legacy-dashboard.md) is preserved as historical documentation; its infrastructure and performance claims do not describe the v2 MVP.

[Original dashboard demo](https://www.youtube.com/watch?v=M2_N8s5u4L8)
