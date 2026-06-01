CREATE TABLE IF NOT EXISTS market_data_monitored_assets (
  symbol VARCHAR(20) PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_data_quote_cache (
  cache_key TEXT PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  quote JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_data_quote_cache_symbol_idx
  ON market_data_quote_cache (symbol);

CREATE INDEX IF NOT EXISTS market_data_quote_cache_fetched_at_idx
  ON market_data_quote_cache (fetched_at DESC);

CREATE TABLE IF NOT EXISTS market_data_fundamentals (
  symbol VARCHAR(20) PRIMARY KEY,
  metrics JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_data_quote_snapshots (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  regular_market_price NUMERIC(18, 6),
  regular_market_change NUMERIC(18, 6),
  regular_market_change_percent NUMERIC(12, 6),
  regular_market_volume BIGINT,
  market_time TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(50) NOT NULL DEFAULT 'yahoo-finance',
  CONSTRAINT market_data_quote_snapshots_symbol_market_time_price_key
    UNIQUE (symbol, market_time, regular_market_price)
);

CREATE INDEX IF NOT EXISTS market_data_quote_snapshots_symbol_time_idx
  ON market_data_quote_snapshots (symbol, market_time DESC);
