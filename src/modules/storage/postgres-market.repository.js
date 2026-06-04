export class PostgresMarketRepository {
  constructor({ pool, maxSnapshotsPerSymbol }) {
    this.pool = pool;
    this.maxSnapshotsPerSymbol = maxSnapshotsPerSymbol;
  }

  async initialize() {
    await this.ping();
  }

  async ping() {
    await this.pool.query("SELECT 1");
  }

  async getCachedQuote(key) {
    const result = await this.pool.query(
      `SELECT quote, fetched_at
       FROM market_data_quote_cache
       WHERE cache_key = $1`,
      [key]
    );
    const row = result.rows[0];
    return row ? { quote: row.quote, fetchedAt: row.fetched_at.toISOString() } : null;
  }

  async setCachedQuote(key, value) {
    const symbol = key.split(":", 1)[0];
    await this.pool.query(
      `INSERT INTO market_data_quote_cache (cache_key, symbol, quote, fetched_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (cache_key) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         quote = EXCLUDED.quote,
         fetched_at = EXCLUDED.fetched_at,
         updated_at = NOW()`,
      [key, symbol, JSON.stringify(value.quote), value.fetchedAt]
    );
  }

  async invalidateCachedQuotes(symbols) {
    if (!symbols.length) {
      return 0;
    }

    const result = await this.pool.query(
      `DELETE FROM market_data_quote_cache
       WHERE symbol = ANY($1::varchar[])`,
      [symbols]
    );

    return result.rowCount;
  }

  async getFundamentals(symbol) {
    const result = await this.pool.query(
      `SELECT metrics, fetched_at
       FROM market_data_fundamentals
       WHERE symbol = $1`,
      [symbol]
    );
    const row = result.rows[0];
    return row ? { ...row.metrics, fetchedAt: row.fetched_at.toISOString() } : null;
  }

  async setFundamentals(symbol, value) {
    const fetchedAt = value.fetchedAt ?? new Date().toISOString();
    await this.pool.query(
      `INSERT INTO market_data_fundamentals (symbol, metrics, fetched_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (symbol) DO UPDATE SET
         metrics = EXCLUDED.metrics,
         fetched_at = EXCLUDED.fetched_at,
         updated_at = NOW()`,
      [symbol, JSON.stringify(value), fetchedAt]
    );
  }

  async listMonitored() {
    const result = await this.pool.query(
      "SELECT symbol FROM market_data_monitored_assets ORDER BY symbol ASC"
    );
    return result.rows.map((row) => row.symbol);
  }

  async addMonitored(symbols) {
    if (symbols.length) {
      await this.pool.query(
        `INSERT INTO market_data_monitored_assets (symbol)
         SELECT UNNEST($1::varchar[])
         ON CONFLICT (symbol) DO UPDATE SET updated_at = NOW()`,
        [symbols]
      );
    }
    return this.listMonitored();
  }

  async replaceMonitored(symbols) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM market_data_monitored_assets");
      if (symbols.length) {
        await client.query(
          `INSERT INTO market_data_monitored_assets (symbol)
           SELECT UNNEST($1::varchar[])
           ON CONFLICT (symbol) DO UPDATE SET updated_at = NOW()`,
          [symbols]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.listMonitored();
  }

  async removeMonitored(symbol) {
    await this.pool.query(
      "DELETE FROM market_data_monitored_assets WHERE symbol = $1",
      [symbol]
    );
    return this.listMonitored();
  }

  async addSnapshot(symbol, quote) {
    const marketTime = quote.regularMarketTime ?? new Date().toISOString();
    await this.pool.query(
      `INSERT INTO market_data_quote_snapshots (
         symbol,
         regular_market_price,
         regular_market_change,
         regular_market_change_percent,
         regular_market_volume,
         market_time,
         source
       ) VALUES ($1, $2, $3, $4, $5, $6, 'yahoo-finance')
       ON CONFLICT (symbol, market_time, regular_market_price) DO NOTHING`,
      [
        symbol,
        quote.regularMarketPrice,
        quote.regularMarketChange,
        quote.regularMarketChangePercent,
        quote.regularMarketVolume,
        marketTime
      ]
    );

    await this.pool.query(
      `DELETE FROM market_data_quote_snapshots
       WHERE id IN (
         SELECT id
         FROM market_data_quote_snapshots
         WHERE symbol = $1
         ORDER BY market_time DESC, id DESC
         OFFSET $2
       )`,
      [symbol, this.maxSnapshotsPerSymbol]
    );
  }

  async getSnapshots(symbol, limit) {
    const results = await this.getSnapshotsBySymbols([symbol], limit);
    return results[0]?.snapshots ?? [];
  }

  async getSnapshotsBySymbols(symbols, limit) {
    if (symbols.length === 0) {
      return [];
    }

    const result = await this.pool.query(
      `SELECT
         symbol,
         regular_market_price,
         regular_market_change,
         regular_market_change_percent,
         regular_market_volume,
         market_time,
         collected_at,
         source
       FROM (
         SELECT
           symbol,
           regular_market_price,
           regular_market_change,
           regular_market_change_percent,
           regular_market_volume,
           market_time,
           collected_at,
           source,
           id,
           ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY market_time DESC, id DESC) AS position
         FROM market_data_quote_snapshots
         WHERE symbol = ANY($1::varchar[])
       ) AS ranked_snapshots
       WHERE position <= $2
       ORDER BY symbol ASC, market_time ASC, id ASC`,
      [symbols, limit]
    );

    const snapshotsBySymbol = new Map(symbols.map((symbol) => [symbol, []]));
    for (const row of result.rows) {
      snapshotsBySymbol.get(row.symbol)?.push(toSnapshot(row));
    }

    return symbols.map((symbol) => ({
      symbol,
      snapshots: snapshotsBySymbol.get(symbol) ?? []
    }));
  }

  async getAssetRegistry(symbol) {
    const result = await this.pool.query(
      `SELECT symbol, asset_type, fund_name, cnpj, cvm_code, b3_identifier,
              source_metadata, resolution_status, resolution_error, resolved_at
       FROM market_data_asset_registry WHERE symbol = $1`,
      [symbol]
    );
    return result.rows[0] ? toAssetRegistry(result.rows[0]) : null;
  }

  async upsertAssetRegistry(value) {
    const result = await this.pool.query(
      `INSERT INTO market_data_asset_registry (
         symbol, asset_type, fund_name, cnpj, cvm_code, b3_identifier,
         source_metadata, resolution_status, resolution_error, resolved_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
       ON CONFLICT (symbol) DO UPDATE SET
         asset_type = EXCLUDED.asset_type,
         fund_name = COALESCE(EXCLUDED.fund_name, market_data_asset_registry.fund_name),
         cnpj = COALESCE(EXCLUDED.cnpj, market_data_asset_registry.cnpj),
         cvm_code = COALESCE(EXCLUDED.cvm_code, market_data_asset_registry.cvm_code),
         b3_identifier = COALESCE(EXCLUDED.b3_identifier, market_data_asset_registry.b3_identifier),
         source_metadata = market_data_asset_registry.source_metadata || EXCLUDED.source_metadata,
         resolution_status = EXCLUDED.resolution_status,
         resolution_error = EXCLUDED.resolution_error,
         resolved_at = COALESCE(EXCLUDED.resolved_at, market_data_asset_registry.resolved_at),
         updated_at = NOW()
       RETURNING symbol, asset_type, fund_name, cnpj, cvm_code, b3_identifier,
                 source_metadata, resolution_status, resolution_error, resolved_at`,
      [
        value.symbol, value.assetType ?? "fii", value.fundName ?? null, value.cnpj ?? null,
        value.cvmCode ?? null, value.b3Identifier ?? null, JSON.stringify(value.sourceMetadata ?? {}),
        value.resolutionStatus ?? "pending", value.resolutionError ?? null, value.resolvedAt ?? null
      ]
    );
    return toAssetRegistry(result.rows[0]);
  }

  async getAssetLogo(symbol) {
    const result = await this.pool.query(
      `SELECT symbol, logo_url, svg_content, source, source_symbol, source_metadata, checked_at
       FROM market_data_asset_logos
       WHERE symbol = $1`,
      [symbol]
    );
    return result.rows[0] ? toAssetLogo(result.rows[0]) : null;
  }

  async setAssetLogo(value) {
    const result = await this.pool.query(
      `INSERT INTO market_data_asset_logos (
         symbol, logo_url, svg_content, source, source_symbol, source_metadata, checked_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
       ON CONFLICT (symbol) DO UPDATE SET
         logo_url = EXCLUDED.logo_url,
         svg_content = EXCLUDED.svg_content,
         source = EXCLUDED.source,
         source_symbol = EXCLUDED.source_symbol,
         source_metadata = EXCLUDED.source_metadata,
         checked_at = EXCLUDED.checked_at,
         updated_at = NOW()
       RETURNING symbol, logo_url, svg_content, source, source_symbol, source_metadata, checked_at`,
      [
        value.symbol,
        value.logoUrl ?? null,
        value.svgContent,
        value.source,
        value.sourceSymbol ?? null,
        JSON.stringify(value.sourceMetadata ?? {})
      ]
    );
    return toAssetLogo(result.rows[0]);
  }

  async listAssetLogos() {
    const result = await this.pool.query(
      `SELECT symbol, logo_url, svg_content, source, source_symbol, source_metadata, checked_at
       FROM market_data_asset_logos
       ORDER BY symbol ASC`
    );
    return result.rows.map(toAssetLogo);
  }

  async upsertDocument(document) {
    const result = await this.pool.query(
      `INSERT INTO market_data_documents (
         symbol, asset_type, document_type, title, reference_date, published_at, source,
         source_document_id, source_url, download_url, mime_type, content_hash, metadata,
         processing_status, processing_error
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
       ON CONFLICT (source, source_document_id) DO UPDATE SET
         symbol = EXCLUDED.symbol,
         title = EXCLUDED.title,
         reference_date = EXCLUDED.reference_date,
         published_at = EXCLUDED.published_at,
         source_url = EXCLUDED.source_url,
         download_url = EXCLUDED.download_url,
         mime_type = EXCLUDED.mime_type,
         content_hash = EXCLUDED.content_hash,
         metadata = EXCLUDED.metadata,
         processing_status = EXCLUDED.processing_status,
         processing_error = EXCLUDED.processing_error,
         updated_at = NOW()
       RETURNING id, (xmax = 0) AS was_inserted`,
      [
        document.symbol, document.assetType, document.documentType, document.title,
        document.referenceDate ?? null, document.publishedAt ?? null, document.source,
        document.sourceDocumentId, document.sourceUrl, document.downloadUrl ?? null,
        document.mimeType ?? null, document.contentHash ?? null, JSON.stringify(document.metadata ?? {}),
        document.processingStatus ?? "discovered", document.processingError ?? null
      ]
    );
    return { id: String(result.rows[0].id), wasInserted: result.rows[0].was_inserted };
  }

  async setDocumentContent(documentId, content) {
    await this.pool.query(
      `INSERT INTO market_data_document_contents (
         document_id, raw_text, extracted_at, extraction_status, extraction_error
       ) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (document_id) DO UPDATE SET
         raw_text = EXCLUDED.raw_text,
         extracted_at = EXCLUDED.extracted_at,
         extraction_status = EXCLUDED.extraction_status,
         extraction_error = EXCLUDED.extraction_error,
         updated_at = NOW()`,
      [documentId, content.rawText ?? null, content.extractedAt ?? null, content.extractionStatus, content.extractionError ?? null]
    );
  }

  async setDocumentSyncState(symbol, source, value) {
    await this.pool.query(
      `INSERT INTO market_data_document_sync_state (
         symbol, source, last_checked_at, last_success_at, last_document_at, last_error
       ) VALUES ($1, $2, NOW(), $3, $4, $5)
       ON CONFLICT (symbol, source) DO UPDATE SET
         last_checked_at = NOW(),
         last_success_at = CASE WHEN $3 IS NULL THEN market_data_document_sync_state.last_success_at ELSE $3 END,
         last_document_at = COALESCE($4, market_data_document_sync_state.last_document_at),
         last_error = $5,
         updated_at = NOW()`,
      [symbol, source, value.success ? new Date().toISOString() : null, value.lastDocumentAt ?? null, value.error ?? null]
    );
  }

  async listDocumentSyncState(symbol) {
    const result = await this.pool.query(
      `SELECT source, last_checked_at, last_success_at, last_document_at, last_error
       FROM market_data_document_sync_state WHERE symbol = $1 ORDER BY source`,
      [symbol]
    );
    return result.rows.map(toSyncState);
  }

  async listDocuments(symbol, { type = null, source = null, limit = 20, since = null } = {}) {
    const result = await this.pool.query(
      `SELECT d.*, (c.document_id IS NOT NULL) AS has_content, c.extraction_status
       FROM market_data_documents d
       LEFT JOIN market_data_document_contents c ON c.document_id = d.id
       WHERE d.symbol = $1
         AND ($2::varchar IS NULL OR d.document_type = $2)
         AND ($3::varchar IS NULL OR d.source = $3)
         AND ($4::date IS NULL OR COALESCE(d.reference_date, d.discovered_at::date) >= $4)
       ORDER BY COALESCE(d.reference_date, d.discovered_at::date) DESC, d.id DESC
       LIMIT $5`,
      [symbol, type, source, since, limit]
    );
    return result.rows.map(toDocumentSummary);
  }

  async listRecentDocuments(symbols, { limit = 20, since = null } = {}) {
    if (!symbols.length) return [];
    const result = await this.pool.query(
      `SELECT d.*, (c.document_id IS NOT NULL) AS has_content, c.extraction_status
       FROM market_data_documents d
       LEFT JOIN market_data_document_contents c ON c.document_id = d.id
       WHERE d.symbol = ANY($1::varchar[])
         AND ($2::date IS NULL OR COALESCE(d.reference_date, d.discovered_at::date) >= $2)
       ORDER BY COALESCE(d.reference_date, d.discovered_at::date) DESC, d.id DESC
       LIMIT $3`,
      [symbols, since, limit]
    );
    return result.rows.map(toDocumentSummary);
  }

  async getDocument(symbol, id) {
    const result = await this.pool.query(
      `SELECT d.*, c.raw_text, c.extracted_at, c.extraction_status, c.extraction_error
       FROM market_data_documents d
       LEFT JOIN market_data_document_contents c ON c.document_id = d.id
       WHERE d.symbol = $1 AND d.id = $2`,
      [symbol, id]
    );
    return result.rows[0] ? toDocumentDetail(result.rows[0]) : null;
  }
}

function toSnapshot(row) {
  return {
    symbol: row.symbol,
    regularMarketPrice: toNumber(row.regular_market_price),
    regularMarketChange: toNumber(row.regular_market_change),
    regularMarketChangePercent: toNumber(row.regular_market_change_percent),
    regularMarketVolume: toNumber(row.regular_market_volume),
    marketTime: row.market_time.toISOString(),
    collectedAt: row.collected_at.toISOString(),
    source: row.source
  };
}

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function toAssetLogo(row) {
  return {
    symbol: row.symbol,
    logoUrl: row.logo_url,
    svgContent: row.svg_content,
    source: row.source,
    sourceSymbol: row.source_symbol,
    sourceMetadata: row.source_metadata,
    checkedAt: row.checked_at?.toISOString?.() ?? row.checked_at ?? null
  };
}

function toAssetRegistry(row) {
  return {
    symbol: row.symbol,
    assetType: row.asset_type,
    fundName: row.fund_name,
    cnpj: row.cnpj,
    cvmCode: row.cvm_code,
    b3Identifier: row.b3_identifier,
    sourceMetadata: row.source_metadata,
    resolutionStatus: row.resolution_status,
    resolutionError: row.resolution_error,
    resolvedAt: row.resolved_at?.toISOString?.() ?? row.resolved_at ?? null
  };
}

function toDocumentSummary(row) {
  return {
    id: String(row.id),
    symbol: row.symbol,
    assetType: row.asset_type,
    documentType: row.document_type,
    title: row.title,
    referenceDate: row.reference_date?.toISOString?.().slice(0, 10) ?? row.reference_date ?? null,
    publishedAt: row.published_at?.toISOString?.() ?? row.published_at ?? null,
    source: row.source,
    sourceDocumentId: row.source_document_id,
    sourceUrl: row.source_url,
    downloadUrl: row.download_url,
    mimeType: row.mime_type,
    metadata: row.metadata,
    processingStatus: row.processing_status,
    processingError: row.processing_error,
    hasContent: row.has_content,
    extractionStatus: row.extraction_status ?? null
  };
}

function toDocumentDetail(row) {
  return {
    ...toDocumentSummary({ ...row, has_content: Boolean(row.raw_text) }),
    content: {
      rawText: row.raw_text ?? null,
      extractedAt: row.extracted_at?.toISOString?.() ?? row.extracted_at ?? null,
      extractionStatus: row.extraction_status ?? "pending",
      extractionError: row.extraction_error ?? null
    }
  };
}

function toSyncState(row) {
  return {
    source: row.source,
    lastCheckedAt: row.last_checked_at?.toISOString?.() ?? row.last_checked_at ?? null,
    lastSuccessAt: row.last_success_at?.toISOString?.() ?? row.last_success_at ?? null,
    lastDocumentAt: row.last_document_at?.toISOString?.() ?? row.last_document_at ?? null,
    lastError: row.last_error
  };
}
