CREATE TABLE IF NOT EXISTS market_data_asset_events (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  title TEXT NOT NULL,
  event_date DATE,
  published_at TIMESTAMPTZ,
  reference_date DATE,
  source VARCHAR(80) NOT NULL,
  source_document_id TEXT,
  source_url TEXT,
  summary TEXT,
  raw_text TEXT,
  importance VARCHAR(20),
  sentiment VARCHAR(20),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, event_type, source, source_document_id)
);

CREATE INDEX IF NOT EXISTS market_data_asset_events_symbol_event_date_idx
  ON market_data_asset_events (symbol, event_date DESC NULLS LAST, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS market_data_asset_events_type_idx
  ON market_data_asset_events (event_type);

CREATE TABLE IF NOT EXISTS market_data_asset_income (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  income_type VARCHAR(40) NOT NULL,
  amount NUMERIC(18, 8) NOT NULL,
  com_date DATE,
  ex_date DATE,
  payment_date DATE,
  reference_date DATE,
  declared_at TIMESTAMPTZ,
  source VARCHAR(80) NOT NULL,
  source_document_id TEXT,
  source_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, income_type, amount, COALESCE(payment_date, reference_date, com_date), source, COALESCE(source_document_id, ''))
);

CREATE INDEX IF NOT EXISTS market_data_asset_income_symbol_payment_idx
  ON market_data_asset_income (symbol, payment_date DESC NULLS LAST, reference_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS market_data_asset_income_type_idx
  ON market_data_asset_income (income_type);
