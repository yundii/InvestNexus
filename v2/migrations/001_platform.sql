CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  user_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  roles text[] NOT NULL CHECK (cardinality(roles)>0 AND roles <@ ARRAY['investment','operations','client']::text[]),
  PRIMARY KEY (user_id, account_id)
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE orders (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  symbol text NOT NULL,
  side text NOT NULL CHECK(side IN ('BUY','SELL')),
  quantity integer NOT NULL CHECK(quantity>0 AND quantity<=100000),
  filled integer NOT NULL CHECK(filled>=0 AND filled<=quantity),
  status text NOT NULL CHECK(status IN ('PENDING','APPROVED','SUBMITTED','PARTIALLY_FILLED','FILLED')),
  payload jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  UNIQUE(account_id,id)
);
CREATE INDEX orders_account ON orders(account_id,seq);
CREATE TABLE trades (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  order_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity>0),
  price_cents bigint NOT NULL CHECK(price_cents>0),
  payload jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(account_id,order_id) REFERENCES orders(account_id,id),
  UNIQUE(account_id,id)
);
CREATE TABLE settlements (
  trade_id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL CHECK(status IN ('PENDING','SETTLED','FAILED')),
  due_date date NOT NULL,
  settled_at timestamptz,
  reason text,
  FOREIGN KEY(account_id,trade_id) REFERENCES trades(account_id,id),
  CHECK ((status='SETTLED')=(settled_at IS NOT NULL))
);
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  trade_id uuid,
  type text NOT NULL CHECK(type IN ('DEPOSIT','BUY','SELL','FEE')),
  cash_cents bigint NOT NULL,
  symbol text,
  quantity integer NOT NULL,
  occurred_at timestamptz NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  FOREIGN KEY(account_id,trade_id) REFERENCES trades(account_id,id),
  UNIQUE(trade_id,type),
  CHECK ((type='DEPOSIT' AND trade_id IS NULL AND symbol IS NULL AND quantity=0 AND cash_cents>0)
      OR (type='FEE' AND trade_id IS NOT NULL AND symbol IS NULL AND quantity=0 AND cash_cents<=0)
      OR (type='BUY' AND trade_id IS NOT NULL AND symbol IS NOT NULL AND quantity>0 AND cash_cents<0)
      OR (type='SELL' AND trade_id IS NOT NULL AND symbol IS NOT NULL AND quantity<0 AND cash_cents>0))
);
CREATE UNIQUE INDEX one_opening_deposit ON ledger_entries(account_id) WHERE type='DEPOSIT';
CREATE INDEX ledger_account ON ledger_entries(account_id,seq);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  actor_id uuid REFERENCES users(id),
  payload jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE reconciliation_records (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  payload jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE portfolio_snapshots (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  payload jsonb NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE idempotency_requests (
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  user_id uuid NOT NULL REFERENCES users(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,request_key)
);
CREATE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Append-only financial/audit record cannot be changed'; END;
$$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER snapshot_append_only BEFORE UPDATE OR DELETE ON portfolio_snapshots FOR EACH ROW EXECUTE FUNCTION reject_mutation();
