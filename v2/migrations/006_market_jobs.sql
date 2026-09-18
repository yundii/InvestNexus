CREATE TABLE market_refresh_jobs (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 requested_date date NOT NULL,
 provider text NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','COMPLETE','FAILED')),
 requested_by uuid NOT NULL REFERENCES users(id),
 error text,
 started_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_refresh_pending ON market_refresh_jobs(status,created_at);
