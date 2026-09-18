CREATE TABLE legacy_user_mappings (
 legacy_id integer PRIMARY KEY,
 user_id uuid NOT NULL UNIQUE REFERENCES users(id),
 imported_at timestamptz NOT NULL DEFAULT now()
);
