# InvestNexus

A mini investment-management platform with Investment, Operations and Client workspaces.

```text
Investment decision → Order / partial fills → Settlement → Ledger → Positions
    → Market prices → Valuation / P&L → Reconciliation → Daily snapshot → Client report
```

React provides the workspaces. A TypeScript backend uses PostgreSQL transactions, authenticated sessions, account permissions and an outbox for asynchronous reporting. Market data supports deterministic simulation or Alpha Vantage daily closing prices. Redis and RabbitMQ are optional.

## Setup

Requires Node.js 22.13+ and PostgreSQL. Docker is optional.

```sh
git clone https://github.com/yundii/InvestNexus.git
cd InvestNexus/v2
npm ci
cp .env.example .env
npm run build
```

Start PostgreSQL in a separate terminal from `InvestNexus/v2`. Choose one option:

```sh
# Docker
docker compose up -d postgres

# Or a real local PostgreSQL process without Docker
npm run db:local
```

Both options use port 55432. Once PostgreSQL is running, start the application from `InvestNexus/v2`:

```sh
npm run migrate
npm run demo:seed
npm start
```

Start each worker in its own terminal, also from `InvestNexus/v2`:

```sh
# Report generation
npm run worker
```

```sh
# Scheduled and requested market-data refreshes
npm run market:worker
```

Open [http://localhost:4200](http://localhost:4200). Build before the first launch. Environment files, generated bundles and local database data are excluded from Git.

## Demo accounts

The example environment sets `DEMO_PASSWORD=LocalDemo-2026!`. Change it before first seeding if desired. Repeated seeding preserves existing passwords and account data.

| Login | Permissions | Account |
| --- | --- | --- |
| pm@investnexus.local | Investment / Client | Horizon Growth |
| ops@investnexus.local | Operations / Client | Horizon Growth |
| client@investnexus.local | Client (read-only) | Horizon Growth |
| other@investnexus.local | Investment / Client | Independent Growth |

Registration creates an independent simulated account with $100,000 in initial cash and investment/client roles. Operations permissions require trusted provisioning. Memberships are verified server-side on every account request.

## Walkthrough

1. Sign in as the PM. Create and approve BUY 100 MSFT, then execute fills of 60 and 40 shares.
2. Sign in as Operations. Advance the business date and settle each fill. The ledger records 100 shares and $58,990 cash, including two $5 fees.
3. Refresh market data and wait for COMPLETE. Prices affect valuation and P&L; cash and quantities remain ledger-derived.
4. Reconcile the full broker statement using current-date settled cash and positions JSON, such as `[{"symbol":"MSFT","quantity":98}]`. Omitted holdings are compared against zero broker shares.
5. Investigate exceptions and resolve them with notes. Resolution does not change the ledger. Reports retain differences and notes as `RESOLVED_WITH_EXCEPTIONS`.
6. Close daily valuation & publish report. Closing requires fresh prices, no refresh error and a full reconciliation matching the current ledger version. Each date closes once and blocks financial writes until the business date advances.
7. In the Client portal, view daily/cumulative returns, VTI comparisons, excess returns and certified history. Export the frozen JSON report after the report worker completes.
8. Advance, refresh, reconcile and close again to build a multi-day series.

## Market data and performance

The default `MARKET_PROVIDER=mock` supplies repeatable simulated history with a fixed anchor. It supports advancing demo dates and is labeled as simulated data.

To use your own Alpha Vantage key, update `.env` and restart the API and market worker:

```dotenv
MARKET_PROVIDER=alpha-vantage
ALPHA_VANTAGE_API_KEY=your_own_key
MARKET_POLL_SECONDS=3600
```

The adapter retrieves `TIME_SERIES_DAILY` closes for MSFT, AAPL, NVDA and VTI sequentially, subject to your quota. Failed refreshes preserve last good prices without publishing partial batches or switching providers. Future dates are rejected for actual-market requests. Earlier quotes are marked STALE and block execution and daily closing. Missing held-security prices produce an INCOMPLETE valuation with null values while preserving cash and positions. Settlement does not depend on market-data availability.

Each price records provider, price date, fetch time and batch. Queries use only prices on or before the business date. Manual refresh:

```sh
npm run market:refresh -- 2026-09-21
```

Weighted costs use integer cents. Partial sales allocate rounded proportional costs; the final sale consumes remaining cost. Realized/unrealized P&L measures price gains and losses. Fees are displayed separately and deducted from portfolio value.

Cumulative return is `(portfolio value / initial capital - 1)`. VTI price return is normalized to the available inception-date close. Excess return is the percentage-point difference. Consecutive business-day closes produce daily returns; gaps produce interval returns with a null daily return. Reports freeze prices, holdings, reconciliation evidence, performance and settled transactions. Later refreshes do not rewrite them. Formal exports use `/api/report?scope=daily`.

## Optional services

### Redis market cache

```sh
docker compose --profile cache up -d redis
```

Set `REDIS_URL=redis://127.0.0.1:56379` in `.env` and restart the API. `/api/market?accountId=...` caches quotes by immutable price IDs for 300 seconds. PostgreSQL remains the financial source of truth, and cache outages fall back to it. Operations can send a CSRF-protected `POST /api/market/cache?accountId=...` to clear this application's market cache.

### RabbitMQ reports

```sh
docker compose --profile messaging up -d
```

Set the following in `.env` and restart the report worker:

```dotenv
RABBITMQ_URL=amqp://investnexus:investnexus_local@127.0.0.1:5672
```

Without this setting, the worker polls the PostgreSQL outbox. RabbitMQ uses durable queues, persistent messages, publisher confirmations and acknowledgement after database commit. Snapshot uniqueness makes duplicate delivery safe. Failures use backoff, up to five attempts and a dead-letter queue. Restart the worker after connection loss; deployments should use a process manager.

Default queues are `investnexus.reports` and `investnexus.reports.dead`; override with `RABBITMQ_QUEUE`. After fixing failed tasks, run `npm run worker:retry`. Pending exports return 409 while posted portfolio data remains available.

## Repository

```text
v2/
  ui/          React workspaces and styles
  src/         TypeScript API, domain logic and workers
  migrations/  PostgreSQL schema migrations
  scripts/     Build, database and operational commands
  public/      HTML entry point
  test/        Domain and integration tests
.github/workflows/  Continuous integration
```

The `v2/` directory contains the application. It has one dependency manifest and serves the UI and API together on port 4200.

## Validation

From `v2/`:

```sh
npm run build
npm test
npm run test:integration
```

Integration tests create and remove isolated databases; the test user needs CREATEDB. Configure `RABBITMQ_URL` and `REDIS_URL` for optional service tests, otherwise those tests are explicitly skipped. GitHub Actions supplies PostgreSQL, RabbitMQ and Redis.

Tests cover partial fills, exact-once posting, concurrent requests and settlements, rollback on database failures, sessions/CSRF/account isolation, immutable daily valuations, reconciliation gates, refresh failures, frozen reports, benchmark calculations, report retries and cache invalidation.

## Scope

Trading and the broker are simulated. T+1 skips weekends but has no exchange-holiday calendar. Each fill costs $5. Returns assume fixed initial capital; TWR/IRR, subsequent funding flows, dividend reinvestment, splits and corporate actions are not supported. Actual-market data uses unadjusted closes and the benchmark measures price return rather than total return. A performance series cannot mix providers.

Account locks serialize financial writes. Settlement, ledger, audit, snapshots and outbox updates commit together. Integer amounts, unique postings and deferred matching constraints protect accounting consistency. Append-only database triggers protect ledger, audit, price and daily/report records. This is not double-entry accounting or tamper-proof storage against a database owner.

Authentication uses scrypt passwords, opaque eight-hour sessions, HttpOnly/SameSite cookies, CSRF and Origin checks, and server-side account roles. The service listens on localhost. Production requires HTTPS (`COOKIE_SECURE=true`), managed secrets, least-privilege database roles, backup/recovery, shared rate limiting and monitoring.
