# InvestNexus — Mini Investment Management Platform

InvestNexus v2 models the investment lifecycle: decisions and orders → simulated execution → settlement → ledger-derived holdings → market prices → valuation / P&L → reconciliation → daily snapshots → client performance reports.

**Milestone 2 is implemented:** dated market data, ledger-derived valuation, realized/unrealized P&L, full cash/position reconciliation, immutable daily closes, and client performance versus VTI. These run on the TypeScript/PostgreSQL backend with account roles and transactional report outbox. The original dashboard remains in `api/` and `client/`.

For the complete setup instructions and walkthrough, see the [English v2 guide](v2/README.md).

## Quick start

Requires **Node.js 22.13+** and PostgreSQL. Docker is optional.

```sh
git clone https://github.com/yundii/InvestNexus.git
cd InvestNexus/v2
npm ci
cp .env.example .env
npm run build
```

Start PostgreSQL in a separate terminal, choosing **one** option:

```sh
# Docker
cd v2
docker compose up -d postgres

# Or a real local PostgreSQL process provided by the dev dependency
cd v2
npm run db:local
```

With PostgreSQL running:

```sh
cd v2
npm run migrate
npm run demo:seed
npm start
```

In another terminal, start the report worker:

```sh
cd v2
npm run worker
```

Start the market worker in another terminal:

```sh
cd v2
npm run market:worker
```

Open **http://localhost:4200**. The example environment provisions demo users with password **`LocalDemo-2026!`**. These are local simulation accounts only.

| Login | Account | Permissions |
| --- | --- | --- |
| `pm@investnexus.local` | Horizon Growth | Investment + client reporting |
| `ops@investnexus.local` | Horizon Growth | Operations + client reporting |
| `client@investnexus.local` | Horizon Growth | Read-only client portal |
| `other@investnexus.local` | Independent Growth | Investment + client reporting on a separate account |

Self-registration creates a separate simulated account with investment/client roles. Operations permissions are provisioned by a trusted database administrator or the local demo seed script; a browser cannot grant itself roles.

## Demo

1. Sign in as the PM, create and approve a **BUY 100 MSFT** market order.
2. Execute a fill of **60** shares, then the remaining **40**. Observe `PARTIALLY_FILLED` → `FILLED`.
3. Sign out and sign in as Operations. Advance the business date and settle both fills.
4. Operations refreshes market data and waits for COMPLETE. Cash and share quantities remain ledger-derived; market prices change valuation and P&L.
5. Submit the full broker statement with current cash, business date and positions. Try 98 MSFT shares to create a 2-share exception, then resolve it with an investigation note. The report retains acknowledged exceptions.
6. Close valuation & publish after fresh prices and current-ledger reconciliation. Each date closes once and blocks further financial writes until advancing the date.
7. The client views daily/cumulative performance, VTI price returns, excess returns and certified history, then downloads the frozen JSON report after the report worker completes.
8. Advance, refresh prices, reconcile and close again to create a multi-day performance series.

Market data defaults to a repeatable **mock** provider. To fetch actual daily closing prices, set `MARKET_PROVIDER=alpha-vantage` and your own `ALPHA_VANTAGE_API_KEY`, then restart the API and market worker. Failed refreshes preserve last good prices; stale or missing prices block certification. No real API credentials are included. The MVP uses weekday dates, unadjusted close prices, fixed initial capital and a price-return benchmark; it does not yet handle exchange holidays, cash-flow-adjusted performance, dividends or corporate actions. See [the detailed milestone guide](v2/README.md) for assumptions and optional Redis cache setup.

## Architecture

```text
Shared React UI: Investment / Operations / Client
                         │ HTTP + HttpOnly session + CSRF
                         ▼
                TypeScript modular backend
                Orders → Trades → Settlement
                         │ account lock + transaction
                         ▼
                     PostgreSQL
           Ledger / Audit / Snapshots / Outbox
                │ replay                   │
                ▼                          ▼
       Holdings / Valuation         Background report worker
                               PostgreSQL polling or RabbitMQ
                                           │ idempotent consumption
                                           ▼
                                    Generated reports

PostgreSQL NOTIFY → authenticated account-scoped SSE → UI refresh
```

- **Order ≠ trade:** one order supports multiple fills, approval, and market/limit validation.
- **Ledger is the financial source:** integer USD cents and integer shares; holdings and weighted cost are derived by replay. Each fill incurs a $5 fee.
- **Transactional settlement:** an account row lock serializes competing writes; settlement, ledger, audit, snapshot, and outbox commit together.
- **Idempotency:** account-scoped request keys save the original response; reuse with changed payload or identity is rejected. Posting uniqueness and deferred database constraints require exactly matching security/fee entries for a settled trade.
- **Append-only records:** database triggers reject modification of ledger entries, audit logs, snapshots, and generated reports through normal DML.
- **Trusted access:** opaque server-side sessions, password hashing, CSRF protection, membership checks on state/report/command/event routes, and role checks on every mutation. Audit records identify the authenticated actor.
- **Async reports:** workers process immutable settlement snapshots. Duplicate delivery is safe. RabbitMQ mode uses durable queues, persistent messages, publisher confirms, bounded retries, and a dead-letter queue.

## React integration

The workspaces live in `client/src/platform/Platform.jsx`. The v2 build bundles this same component for the backend's local UI. The original React app also exposes it at **`/platform`**, with its development proxy forwarding `/api` to port 4200:

```sh
cd client
npm ci
npm start
# http://localhost:3000/platform
```

The legacy dashboard still uses its original port-8000 API and MySQL credentials. V2 sessions are separate. An explicit user importer preserves legacy bcrypt passwords; legacy positions are not automatically converted into financial postings. See the [setup and migration guide](v2/README.md).

## Optional RabbitMQ

```sh
cd v2
docker compose --profile messaging up -d
```

Set `RABBITMQ_URL` in `.env` using the example's commented value and restart `npm run worker`. Without that variable, the worker consumes the PostgreSQL outbox directly. Both modes generate the same reports.

## Verification

```sh
cd v2
npm run build
npm test
npm run test:integration
```

Integration tests create and clean up an isolated PostgreSQL database. The test user therefore needs `CREATEDB`; the application itself does not need it.

Tests exercise partial fills, exact-once posting, duplicate/concurrent requests, overspending prevention, injected database failure and full rollback, session restoration/revocation/expiry, CSRF, role/account isolation, report idempotency, and legacy-password compatibility. With `RABBITMQ_URL`, the suite also launches a worker against a real broker and tests duplicate delivery. With `REDIS_URL`, the suite verifies cache invalidation without changing the book. Tests also cover refresh failures, immutable daily valuations, reconciliation gates, frozen reports, and benchmark returns. GitHub Actions supplies PostgreSQL, RabbitMQ and Redis services.

## Scope

This is a **local simulation**, not real trading. Prices default to deterministic mock history with an optional Alpha Vantage daily provider; T+1 skips weekends but not exchange holidays. Certified returns are based on opening capital and daily snapshots with VTI price history, without TWR/IRR. Price-only realized P&L and execution fees are shown separately.

Redis is an optional disposable market-data cache; PostgreSQL remains the financial source of truth. PostgreSQL replaces local JSON persistence; the old JSON file is retained locally and is not automatically imported. Database triggers provide application-level protection, not tamper-proof storage against a database owner. Production work still requires HTTPS/secure cookies, managed secrets, least-privilege database roles, backup/recovery, distributed rate limiting, and operational monitoring.

[Detailed setup guide](v2/README.md) · [Original dashboard documentation](docs/legacy-dashboard.md) · [Original demo video](https://www.youtube.com/watch?v=M2_N8s5u4L8)
