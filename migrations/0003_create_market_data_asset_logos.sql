CREATE TABLE IF NOT EXISTS market_data_asset_logos (
  symbol VARCHAR(20) PRIMARY KEY,
  logo_url TEXT,
  svg_content TEXT NOT NULL,
  source VARCHAR(40) NOT NULL,
  source_symbol TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_data_asset_logos_source_idx
  ON market_data_asset_logos (source);

CREATE INDEX IF NOT EXISTS market_data_asset_logos_checked_at_idx
  ON market_data_asset_logos (checked_at DESC);
