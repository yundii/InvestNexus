ALTER TABLE portfolio_snapshots ADD UNIQUE(account_id,id);
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 snapshot_id uuid NOT NULL UNIQUE,
 payload jsonb NOT NULL,
 published_at timestamptz,
 completed_at timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at timestamptz NOT NULL DEFAULT now(),
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,snapshot_id) REFERENCES portfolio_snapshots(account_id,id)
);
CREATE INDEX outbox_pending ON outbox_events(available_at,created_at) WHERE completed_at IS NULL;
CREATE TABLE generated_reports (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id),
 snapshot_id uuid NOT NULL UNIQUE,
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,snapshot_id) REFERENCES portfolio_snapshots(account_id,id)
);
CREATE TRIGGER report_append_only BEFORE UPDATE OR DELETE ON generated_reports FOR EACH ROW EXECUTE FUNCTION reject_mutation();
