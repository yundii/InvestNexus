ALTER TABLE accounts ADD COLUMN inception_date date;
UPDATE accounts SET inception_date=created_at::date;
ALTER TABLE accounts ALTER COLUMN inception_date SET NOT NULL;
ALTER TABLE accounts ALTER COLUMN inception_date SET DEFAULT CURRENT_DATE;
CREATE TABLE market_batches (
 id uuid PRIMARY KEY,
 provider text NOT NULL CHECK(provider IN ('mock','alpha-vantage')),
 requested_date date NOT NULL,
 status text NOT NULL CHECK(status IN ('COMPLETE','FAILED')),
 error text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE market_prices (
 id uuid PRIMARY KEY,
 batch_id uuid NOT NULL REFERENCES market_batches(id),
 symbol text NOT NULL CHECK(symbol IN ('MSFT','AAPL','NVDA','VTI')),
 price_date date NOT NULL,
 price_cents bigint NOT NULL CHECK(price_cents>0 AND price_cents<=9007199254740991),
 provider text NOT NULL CHECK(provider IN ('mock','alpha-vantage')),
 seq bigint GENERATED ALWAYS AS IDENTITY,
 UNIQUE(batch_id,symbol,price_date)
);
CREATE INDEX prices_asof ON market_prices(provider,symbol,price_date DESC,seq DESC);
CREATE TRIGGER prices_append_only BEFORE UPDATE OR DELETE ON market_prices FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER market_batch_append_only BEFORE UPDATE OR DELETE ON market_batches FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TABLE reconciliation_runs (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 business_date date NOT NULL,
 ledger_version bigint NOT NULL CHECK(ledger_version>0),
 payload jsonb NOT NULL,
 seq bigint GENERATED ALWAYS AS IDENTITY,
 UNIQUE(account_id,id)
);
CREATE TABLE daily_valuations (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 valuation_date date NOT NULL,
 snapshot_id uuid NOT NULL UNIQUE,
 reconciliation_id uuid NOT NULL,
 ledger_version bigint NOT NULL,
 provider text NOT NULL,
 payload jsonb NOT NULL,
 UNIQUE(account_id,valuation_date),
 FOREIGN KEY(account_id,snapshot_id) REFERENCES portfolio_snapshots(account_id,id),
 FOREIGN KEY(account_id,reconciliation_id) REFERENCES reconciliation_runs(account_id,id)
);
CREATE TRIGGER daily_valuation_append_only BEFORE UPDATE OR DELETE ON daily_valuations FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER reconciliation_run_append_only BEFORE UPDATE OR DELETE ON reconciliation_runs FOR EACH ROW EXECUTE FUNCTION reject_mutation();
-- Preserve first-milestone behaviour until the mock worker refreshes the market.
INSERT INTO market_batches(id,provider,requested_date,status) VALUES('00000000-0000-4000-8000-000000000005','mock',CURRENT_DATE,'COMPLETE');
INSERT INTO market_prices(id,batch_id,symbol,price_date,price_cents,provider)
 SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000005',symbol,CURRENT_DATE,price,'mock'
 FROM (VALUES ('MSFT',41000),('AAPL',22500),('NVDA',12500),('VTI',28000)) AS prices(symbol,price);
