CREATE TABLE IF NOT EXISTS market_data_asset_registry (
  symbol VARCHAR(20) PRIMARY KEY,
  asset_type VARCHAR(30) NOT NULL DEFAULT 'fii',
  fund_name TEXT,
  cnpj VARCHAR(18),
  cvm_code VARCHAR(50),
  b3_identifier VARCHAR(80),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  resolution_error TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS market_data_asset_registry_cnpj_idx
  ON market_data_asset_registry (cnpj);

CREATE TABLE IF NOT EXISTS market_data_documents (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  asset_type VARCHAR(30) NOT NULL DEFAULT 'fii',
  document_type VARCHAR(60) NOT NULL,
  title TEXT NOT NULL,
  reference_date DATE,
  published_at TIMESTAMPTZ,
  source VARCHAR(60) NOT NULL,
  source_document_id TEXT,
  source_url TEXT NOT NULL,
  download_url TEXT,
  mime_type VARCHAR(120),
  content_hash VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status VARCHAR(30) NOT NULL DEFAULT 'discovered',
  processing_error TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_data_documents_source_document_key UNIQUE (source, source_document_id)
);

CREATE INDEX IF NOT EXISTS market_data_documents_symbol_date_idx
  ON market_data_documents (symbol, reference_date DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS market_data_documents_source_idx
  ON market_data_documents (source, document_type);

CREATE TABLE IF NOT EXISTS market_data_document_contents (
  document_id BIGINT PRIMARY KEY REFERENCES market_data_documents(id) ON DELETE CASCADE,
  raw_text TEXT,
  extracted_at TIMESTAMPTZ,
  extraction_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  extraction_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_data_document_sync_state (
  symbol VARCHAR(20) NOT NULL,
  source VARCHAR(60) NOT NULL,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_document_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, source)
);
