# InvestNexus

A mini investment-management platform with Investment, Operations and Client workspaces.

```text
Investment decision → Order / partial fills → Settlement → Ledger → Positions
    → Market prices → Valuation / P&L → Reconciliation → Daily snapshot → Client report
```

React provides the workspaces. A TypeScript backend uses PostgreSQL transactions, authenticated sessions, account permissions and an outbox for asynchronous reporting. Market data supports deterministic simulation or Alpha Vantage daily closing prices. Redis and RabbitMQ are optional.

## One-command local demo

Requires Node.js 22.13+. From the repository root:

```sh
git clone https://github.com/yundii/InvestNexus.git
cd InvestNexus
npm run demo
```

The launcher installs missing dependencies, creates `v2/.env` if needed, starts local PostgreSQL when port 55432 is available, builds the UI/API, migrates and seeds the database, and starts the API plus both workers. Open [http://localhost:4200](http://localhost:4200). Press Ctrl+C to stop the stack. Existing environment settings and database records are preserved. A database already running at the configured address is reused and left running on exit.

The first launch downloads PostgreSQL binaries and dependencies. Later launches reuse them. If the API port is in use, stop that process first. To use an external database, configure `DATABASE_URL` in `v2/.env`; the launcher validates connectivity instead of starting a local database.

## Online demo

Open the public simulation at [https://yundii.github.io/InvestNexus/](https://yundii.github.io/InvestNexus/).

The GitHub Pages build runs the complete walkthrough in the browser: investment decisions, partial fills, settlement, ledger-derived positions, market prices, valuation, reconciliation, two-day performance and report export. Click **Start private demo →** to begin. Data stays in that browser's local storage, each browser profile is isolated, and **Reset browser demo** creates a clean portfolio.

GitHub Pages serves static files, so this hosted simulation does not run PostgreSQL, server authentication or background workers. Use the one-command local demo when you want to exercise those production-style components. The browser build shares the platform's domain, valuation and reconciliation logic, and its full workflow runs in CI before deployment.

## Local demo accounts

The example environment sets `DEMO_PASSWORD=LocalDemo-2026!`. Change it before first seeding if desired. Repeated seeding preserves existing passwords and account data.

| Login                    | Permissions         | Account            |
| ------------------------ | ------------------- | ------------------ |
| pm@investnexus.local     | Investment / Client | Horizon Growth     |
| ops@investnexus.local    | Operations / Client | Horizon Growth     |
| client@investnexus.local | Client (read-only)  | Horizon Growth     |
| other@investnexus.local  | Investment / Client | Independent Growth |

Registration creates an independent simulated account with $100,000 in initial cash and investment/client roles. Operations permissions require trusted provisioning. Memberships are verified server-side on every account request.

## Walkthrough

1. Open Investment workspace (local login: PM). Create and approve BUY 100 MSFT, then execute fills of 60 and 40 shares.
2. Switch to Operations console (locally, sign out and log in as Ops). Advance the business date and settle each fill. The ledger records 100 shares and $58,990 cash, including two $5 fees.
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
package.json       Root demo command
scripts/demo.mjs   Local stack launcher
.github/workflows/ CI and GitHub Pages deployment
v2/
  ui/          React workspaces, Pages entry point and styles
  src/         TypeScript API, domain logic and workers
  migrations/  PostgreSQL schema migrations
  scripts/     Build, database and operational commands
  public/      HTML entry point
  test/        Domain and integration tests
  e2e/         Backend and Pages workflow tests
```

The `v2/` directory contains the application. Dependencies are defined in `v2/package.json`; the root manifest provides shortcut commands. The UI and API are served together on port 4200.

## Validation

For the full backend, run from `v2/` with PostgreSQL available:

```sh
npm run build
npm test
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

Validate the static GitHub Pages build without a database:

```sh
npm run build:pages
npm run test:e2e:pages
```

Preview it at [http://127.0.0.1:4301/InvestNexus/](http://127.0.0.1:4301/InvestNexus/) with `npm run preview:pages`.

The browser suite uses a disposable database and starts the real API, report worker and market worker on port 4300. It creates private demo accounts, executes partial fills, settles both trades, investigates a reconciliation exception, closes two business days and downloads the client JSON report. It verifies unchanged ledger entries across market movements, benchmark history, visitor isolation and session restoration. Test databases are removed afterward.

Test the deployed Pages simulation with the same end-to-end workflow:

```sh
PLAYWRIGHT_BASE_URL=https://yundii.github.io/InvestNexus/ npm run test:e2e:pages
```

The Pages test starts isolated browser profiles and never resets another visitor's data.

Database tests also use isolated databases. The test user needs CREATEDB. Configure `RABBITMQ_URL` and `REDIS_URL` for optional service tests, otherwise those cases are explicitly skipped. The [Playwright web-server integration](https://playwright.dev/docs/test-webserver) starts the local browser-test stack automatically.

GitHub Actions supplies PostgreSQL, RabbitMQ and Redis, runs the domain, database, backend-browser and Pages-browser suites, and uploads an HTML report, failure traces/screenshots and the downloaded client report as `browser-workflow-results`. The two browser environments each execute the full workflow and visitor-isolation scenario.

## Scope

Trading and the broker are simulated. T+1 skips weekends but has no exchange-holiday calendar. Each fill costs $5. Returns assume fixed initial capital; TWR/IRR, subsequent funding flows, dividend reinvestment, splits and corporate actions are not supported. Actual-market data uses unadjusted closes and the benchmark measures price return rather than total return. A performance series cannot mix providers.

Account locks serialize financial writes. Settlement, ledger, audit, snapshots and outbox updates commit together. Integer amounts, unique postings and deferred matching constraints protect accounting consistency. Append-only database triggers protect ledger, audit, price and daily/report records. This is not double-entry accounting or tamper-proof storage against a database owner.

Authentication uses scrypt passwords, opaque eight-hour sessions, HttpOnly/SameSite cookies, CSRF and Origin checks, and server-side account roles. The service listens on localhost. Production requires HTTPS (`COOKIE_SECURE=true`), managed secrets, least-privilege database roles, backup/recovery, shared rate limiting and monitoring.
