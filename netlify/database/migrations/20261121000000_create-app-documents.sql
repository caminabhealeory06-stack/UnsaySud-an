-- Durable copies of the API's JSON data stores (users.json, stalls.json, payments.json, ...).
-- Each row holds the full contents of one store; the API hydrates its working files from
-- these rows on start-up and writes every change back before responding.
CREATE TABLE app_documents (
  name TEXT PRIMARY KEY,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
