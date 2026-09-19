# InvestNexus design decisions

This document records the financial semantics and operational behavior behind the concise project overview in the [README](../README.md).

## Transaction and ledger integrity

Settlement is the boundary at which a fill affects the portfolio. Order creation, approval, and execution do not change settled cash or holdings. A settlement transaction locks the account, validates available cash or shares, posts the security, cash, and fee entries, changes the trade status, records an audit event, and persists the resulting snapshot atomically.

Financial amounts use integer cents. Each fill costs $5. Weighted cost uses proportional integer allocation for partial sales; the final sale consumes the remaining cost so rounding cannot strand basis. Realized and unrealized P&L measure price movement, while fees remain visible and reduce portfolio value.

The database enforces unique postings and deferred matching constraints. Ledger, audit, price, daily snapshot, and report records are append-only. Corrections should be expressed through new business events rather than edits to history. This is a strong single-entry investment ledger, not yet a general double-entry accounting system.

Account-level locks serialize financial writes. Idempotency keys make command retries safe and reject reuse with a different payload. A failure in the middle of settlement rolls back status, ledger, audit, and snapshot changes together.

## Market-data semantics

The default `MARKET_PROVIDER=mock` produces repeatable simulated history from a fixed anchor. Alpha Vantage support retrieves `TIME_SERIES_DAILY` closes for MSFT, AAPL, NVDA, and VTI subject to the account's quota.

Every price records its provider, market date, fetch time, and batch. Queries select prices on or before the business date and never use future observations. A batch is published only when every required symbol succeeds, so refresh failures preserve the last complete set instead of mixing old and new data.

An earlier quote is `STALE` and blocks order execution and daily close. A missing held-security price produces an `INCOMPLETE` valuation with null market totals while preserving ledger-derived positions and cash. Settlement does not depend on current market data.

Manual refresh:

```sh
npm run market:refresh -- 2026-09-21
```

## Performance and daily close

Cumulative portfolio return is `portfolio value / initial capital - 1`. VTI price return is normalized to the available inception-date close, and excess return is the percentage-point difference between portfolio and benchmark returns.

Consecutive business-date closes produce a daily return. A gap produces an interval return and leaves daily return null rather than labeling a multi-day movement as one day. A performance series cannot mix market-data providers.

A daily close requires:

- A weekday business date
- A fresh, complete market-price batch with no refresh error
- A complete valuation for every held security
- A full reconciliation against the current ledger version
- No unresolved reconciliation exceptions
- No existing close for the same business date

The close freezes holdings, cash, prices, reconciliation evidence, performance, and settled transactions. Later price refreshes or exception updates cannot rewrite the published report.

## Reconciliation

Reconciliation compares the complete internal settled book with a broker statement for the same date. It includes cash, every internal holding, and any unexpected broker position. Omitted broker holdings are treated as zero rather than ignored.

An exception may be resolved with a required note, but resolution never changes the ledger. The certified report keeps the original difference and note and labels the outcome `RESOLVED_WITH_EXCEPTIONS`. Any later ledger change invalidates the certification and requires a new reconciliation.

## Reporting and asynchronous delivery

Daily close and report publication use a transactional outbox. The close and its outbox message commit in the same PostgreSQL transaction, eliminating the gap between financial state and async notification.

Without RabbitMQ, the report worker polls PostgreSQL. With RabbitMQ configured, the system uses durable queues, persistent messages, publisher confirmations, and acknowledgement only after the database commit. Snapshot uniqueness makes duplicate delivery safe. Failures use backoff, allow five attempts, and then move to a dead-letter queue.

```dotenv
RABBITMQ_URL=amqp://investnexus:investnexus_local@127.0.0.1:5672
```

Start RabbitMQ locally with `docker compose --profile messaging up -d`. Retry repaired jobs with `npm run worker:retry`. Queue names default to `investnexus.reports` and `investnexus.reports.dead` and can be changed with `RABBITMQ_QUEUE`.

## Redis cache

Redis is an optional read-through cache for market responses. Cache keys reference immutable price IDs and expire after 300 seconds. PostgreSQL remains authoritative, and Redis outages fall back to database reads without affecting settlement, reconciliation, or closing.

Start Redis with `docker compose --profile cache up -d` and set:

```dotenv
REDIS_URL=redis://127.0.0.1:56379
```

Operations can clear this application's market cache through the CSRF-protected `/api/market/cache` endpoint.

## Authentication and authorization

Passwords use scrypt. Sessions are opaque, server-side records with an eight-hour lifetime and HttpOnly/SameSite cookies. Mutating requests require CSRF tokens and accepted origins. Every account request verifies server-side membership and role permissions.

The public GitHub Pages demo has no server authentication. It gives each browser profile an isolated simulation in local storage and uses session storage for sign-in state. The browser runtime is clearly labeled and makes no real trades.

A production deployment requires HTTPS, `COOKIE_SECURE=true`, managed secrets, least-privilege database roles, shared rate limiting, monitoring, and tested backup and recovery.

## Local services and configuration

The one-command launcher uses an embedded local PostgreSQL instance on port 55432 when no configured database is available. Existing environment settings and records are preserved. An external database can be selected through `DATABASE_URL` in `v2/.env`.

The API serves the React application and REST routes on port 4200. The report and market workers run separately. `/api/health` verifies database connectivity. Network binding defaults to `127.0.0.1`; container hosting should explicitly set `HOST=0.0.0.0`.

Demo registration creates an independent simulated account with $100,000 initial cash and investment/client roles. Operations access requires trusted provisioning. Public server demo mode is opt-in, capacity-limited, and intended only for dedicated simulation databases.

## Known boundaries

- T+1 settlement skips weekends but does not yet use an exchange-holiday calendar.
- Returns assume fixed initial capital; external funding flows, TWR, and IRR are not implemented.
- Market returns use unadjusted closes and the benchmark represents price return rather than total return.
- Dividends, reinvestment, splits, symbol changes, and other corporate actions are not modeled.
- Append-only database rules protect application integrity but cannot prevent a database owner from tampering.
- The ledger is not yet a full double-entry general ledger.
