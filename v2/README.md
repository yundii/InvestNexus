# InvestNexus v2 — Milestone 2

Market Data → Valuation / P&L → Full Reconciliation → Daily Snapshot → Client Performance Report, built on PostgreSQL transactions, authenticated sessions and account permissions.

## Local setup

Requires Node.js 22.13+. Run all commands from `v2/` unless stated otherwise.

```sh
npm ci
cp .env.example .env
npm run build
```

Start PostgreSQL in a separate terminal. Choose one option; both use port 55432:

```sh
# Docker
docker compose up -d postgres

# Or run a real local PostgreSQL process without Docker
npm run db:local
```

Once PostgreSQL is running:

```sh
npm run migrate
npm run demo:seed
npm start
```

Start the report worker in another terminal:

```sh
npm run worker
```

Start the market-data worker in another terminal:

```sh
npm run market:worker
```

Open [http://localhost:4200](http://localhost:4200). Build before the first launch. Generated files (`public/app.js`, `public/app.css`, `dist/`), environment files and local database data are excluded from Git.

## Demo accounts

The example environment sets `DEMO_PASSWORD=LocalDemo-2026!`. Set your preferred password before the first seed. Repeated seeding preserves existing passwords and account data.

| Login | Workspaces | Account |
| --- | --- | --- |
| pm@investnexus.local | Investment / Client | Horizon Growth |
| ops@investnexus.local | Operations / Client | Horizon Growth |
| client@investnexus.local | Client (read-only) | Horizon Growth |
| other@investnexus.local | Investment / Client | Independent Growth |

Self-registration creates an independent simulated investment account with $100,000 in initial cash and investment/client permissions. It does not grant Operations permissions. Roles come from PostgreSQL account memberships; request fields such as actor, persona or accountId cannot grant access.

## Milestone 2 walkthrough

1. As the PM, create and approve BUY 100 MSFT, then execute partial fills of 60 and 40 shares.
2. As Operations, advance the business date and settle each fill. The ledger records 100 shares and $58,990 cash. Market-price changes do not alter cash or share quantities.
3. Click Refresh market data and wait for COMPLETE. The market worker retrieves dated prices and history for all four supported securities. To refresh a date manually, run `npm run market:refresh -- 2026-09-21`.
4. Submit a full broker statement with the current business date, settled cash and positions JSON, for example `[{"symbol":"MSFT","quantity":98}]`. Cash and positions produce separate matches or exceptions. Omitted holdings are compared with zero broker shares.
5. Investigate each exception and resolve it with a note. Resolution does not modify the ledger. Reports retain the original differences and notes and label the certification `RESOLVED_WITH_EXCEPTIONS`.
6. With FRESH prices, no refresh error and a full reconciliation matching the current ledger version, click Close daily valuation & publish report. A date closes once. Financial writes are then blocked until the business date advances.
7. In the Client portal, view cumulative returns, consecutive-business-day returns, VTI price returns and excess returns. Once the report worker completes, export the daily report as JSON. Advance, refresh, reconcile and close again to build a multi-day performance series.

## Market data, valuation and return calculations

The default `MARKET_PROVIDER=mock` uses a fixed anchor and repeatable simulated price history. It supports advancing demo dates and is explicitly labeled as simulated data. It is not a live feed.

To use your own Alpha Vantage API key:

```dotenv
MARKET_PROVIDER=alpha-vantage
ALPHA_VANTAGE_API_KEY=your_own_key
MARKET_POLL_SECONDS=3600
```

Restart the API and market worker. The adapter uses `TIME_SERIES_DAILY` closing prices and fetches MSFT, AAPL, NVDA and VTI sequentially, subject to your API quota. Network, quota or format failures never publish a partial batch or silently switch to mock prices. Live refreshes reject future business dates. Prices from an earlier date are marked STALE and block execution and daily closing. The MVP skips weekends but has no exchange-holiday calendar, so holiday dates also block closing when current-date quotes are unavailable.

Every quote records its provider, price date, fetch time and batch. Historical queries use only prices on or before the business date. Missing held-security prices produce an INCOMPLETE valuation with null values while preserving ledger cash and positions. Settlement does not depend on the market-data service.

Weighted costs use integer cents. Partial sales allocate cost proportionally with rounding; the final sale consumes the remaining cost. Realized and unrealized P&L measure price gains and losses. Fees are displayed separately and deducted from portfolio value. Cumulative return is `(portfolio value / initial capital - 1)`. VTI returns are normalized to the available closing price at account inception. Excess return is the difference in percentage points. Consecutive business-day closes produce a daily return; gaps produce an interval return with a null daily return.

Cash-flow-adjusted TWR, dividend reinvestment, splits and other corporate actions are not supported. The live adapter uses unadjusted closing prices, and the benchmark measures price return rather than total return. A performance series cannot mix providers.

Daily closes, quote batches, prices and reports are protected by append-only database triggers. Reports freeze prices, holdings, reconciliation evidence, the performance series and settled transactions. Later refreshes do not rewrite historical reports. Settlement snapshots remain available, but formal client exports use `/api/report?scope=daily` and require a daily close.

## Optional Redis market cache

```sh
docker compose --profile cache up -d redis
```

Set `REDIS_URL=redis://127.0.0.1:56379` in `.env` and restart the API. `GET /api/market?accountId=...` caches quotes using immutable price IDs with a 300-second TTL. If Redis is unavailable, PostgreSQL supplies the data. Cash, quantities, ledger entries and daily closes never depend on Redis. Operations can send a CSRF-protected `POST /api/market/cache?accountId=...` to remove this application's market cache without clearing the entire Redis database.

## Implemented guarantees

- Integer cents and whole shares; separate orders and trades; market/limit orders and partial fills.
- Account row locks serialize financial writes and prevent concurrent over-execution or overspending at settlement.
- Order, trade and settlement updates, ledger/audit additions, snapshots and outbox events commit in one PostgreSQL transaction.
- Account-scoped idempotency keys return the original result for the same user and payload; a changed user or payload returns 409.
- Unique trade postings and deferred constraints require complete, matching cash/security/quantity entries for settled trades.
- Append-only ledger, audit, snapshot and report triggers; positions derived by replaying the ledger.
- HttpOnly / SameSite=Strict session cookies; hashed tokens stored server-side; eight-hour expiration and immediate logout revocation.
- scrypt passwords with support for imported legacy bcrypt hashes; registration passwords of 12–128 characters.
- CSRF and Origin checks; account-membership checks on read, write, SSE, report and market routes.
- Audit records with authenticated email and user foreign keys; account-specific SSE updates through PostgreSQL NOTIFY across API processes.

## Reports and RabbitMQ

Without a broker configuration, `npm run worker` consumes the PostgreSQL outbox directly. Settlement remains synchronous and transactional; report generation runs independently in the background.

```sh
docker compose --profile messaging up -d
```

Add to `.env`:

```dotenv
RABBITMQ_URL=amqp://investnexus:investnexus_local@127.0.0.1:5672
```

Restart the report worker. RabbitMQ mode uses durable queues, persistent messages and publisher confirmations. Events are committed to the database outbox before publication. Consumers create reports idempotently using the unique snapshot key and acknowledge only after commit. Failures use backoff, up to five processing attempts and a dead-letter queue. A lost connection exits the worker; restarting resumes processing. Use a process manager for deployment.

The default queue is `investnexus.reports`; the dead-letter queue is `investnexus.reports.dead`. Set `RABBITMQ_QUEUE` to isolate deployment queues. After investigating and fixing failed tasks:

```sh
npm run worker:retry
```

This requeues unfinished tasks that exhausted retries. Exports return 409 while reports are pending, and the UI displays processing status. Posted portfolio data remains available.

## Original React application

```sh
cd ../client
npm ci
npm start
```

Open [http://localhost:3000/platform](http://localhost:3000/platform). The shared component lives in `client/src/platform/`. The development proxy forwards to the v2 API on port 4200; `.env.example` sets `TRUSTED_ORIGINS=http://localhost:3000`. Original dashboard pages still connect to the legacy API on port 8000. Data is not migrated automatically. Production integration requires a same-origin reverse proxy forwarding `/api` to v2.

## Legacy user migration

The explicit importer preserves bcrypt hashes without reading or generating plaintext passwords. With the original MySQL service running and `api/.env` configured:

```sh
cd ../api
npm ci
node scripts/export-users.js /private/tmp/investnexus-legacy-users.json
cd ../v2
npm run legacy:import -- /private/tmp/investnexus-legacy-users.json
```

The export contains identities and credential hashes. Keep it private and remove it securely when finished. The exporter creates it with mode 0600 and refuses to overwrite an existing file. Import is transactional and idempotent by legacy user ID. An email already present in v2 rejects the entire import to prevent incorrect identity linking. Imported users receive independent simulated accounts with investment/client permissions.

Legacy purchasedStock records lack complete order and settlement provenance, so legacy holdings are not imported or converted into fabricated ledger history. Local JSON prototype files are also retained without automatic import.

## Validation

```sh
npm run build
npm test
npm run test:integration
```

Integration tests create randomly named isolated databases and remove them afterward. They do not use demo-account data. The test database user needs CREATEDB; the production application should not have this permission. Set `RABBITMQ_URL` for real broker publication, consumption and duplicate-delivery tests, and `REDIS_URL` for cache integration tests. Unconfigured optional services are explicitly skipped.

TypeScript/shared React builds, the original React build, domain tests and real PostgreSQL integration tests have passed locally. GitHub Actions supplies PostgreSQL, RabbitMQ and Redis and validates all 27 tests. RabbitMQ and Redis were not configured locally; those tests ran in CI.

## Scope and deployment

The broker is simulated. Market data defaults to mock history, with optional actual daily prices using your own API key. T+1 skips weekends but not exchange holidays; each fill costs $5. Returns use initial capital and certified daily closes, including consecutive-business-day returns and VTI comparisons. TWR/IRR is not supported. Realized price P&L and fees are displayed separately.

Redis stores only rebuildable market data. The database uses relational tables, foreign keys and constraints, with some domain details in JSONB payloads. The ledger is not double-entry accounting. A database owner can alter triggers; this is not tamper-proof audit storage.

The service listens on localhost. Production deployment requires HTTPS (`COOKIE_SECURE=true`), private database/queue credentials, least-privilege database roles, backup/recovery, shared rate limiting and monitoring. Current login rate limiting is local to one API process.
