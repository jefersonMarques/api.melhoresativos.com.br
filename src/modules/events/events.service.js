export class EventsService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async syncFromDocuments(symbols) {
    const documents = await this.repository.listRecentDocuments(symbols, { limit: 500 });
    const events = documents.map((document) => mapDocumentToEvent(document)).filter(Boolean);

    for (const event of events) {
      await this.upsertEvent(event);
    }

    return {
      symbols,
      discovered: documents.length,
      insertedOrUpdated: events.length
    };
  }

  async list({ symbols = [], from = null, to = null, limit = 50 } = {}) {
    const result = await this.repository.pool.query(
      `SELECT id, symbol, event_type, title, event_date, published_at, reference_date,
              source, source_document_id, source_url, summary, importance, sentiment,
              metadata, created_at, updated_at
       FROM market_data_asset_events
       WHERE ($1::varchar[] IS NULL OR symbol = ANY($1::varchar[]))
         AND ($2::date IS NULL OR COALESCE(event_date, reference_date, published_at::date) >= $2)
         AND ($3::date IS NULL OR COALESCE(event_date, reference_date, published_at::date) <= $3)
       ORDER BY COALESCE(published_at, event_date::timestamptz, reference_date::timestamptz, created_at) DESC, id DESC
       LIMIT $4`,
      [symbols.length ? symbols : null, from, to, limit]
    );

    return result.rows.map(toEvent);
  }

  async listBySymbol(symbol, filters = {}) {
    return this.list({ ...filters, symbols: [symbol] });
  }

  async upsertEvent(event) {
    const dedupKey = createEventDedupKey(event);
    const result = await this.repository.pool.query(
      `INSERT INTO market_data_asset_events (
         symbol, event_type, title, event_date, published_at, reference_date,
         source, source_document_id, source_url, summary, raw_text, importance,
         sentiment, dedup_key, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
       ON CONFLICT (symbol, dedup_key) DO UPDATE SET
         title = EXCLUDED.title,
         event_date = EXCLUDED.event_date,
         published_at = EXCLUDED.published_at,
         reference_date = EXCLUDED.reference_date,
         source_url = EXCLUDED.source_url,
         summary = EXCLUDED.summary,
         raw_text = EXCLUDED.raw_text,
         importance = EXCLUDED.importance,
         sentiment = EXCLUDED.sentiment,
         metadata = market_data_asset_events.metadata || EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id, symbol, event_type, title, event_date, published_at, reference_date,
                 source, source_document_id, source_url, summary, importance, sentiment,
                 metadata, created_at, updated_at`,
      [
        event.symbol,
        event.eventType,
        event.title,
        event.eventDate ?? null,
        event.publishedAt ?? null,
        event.referenceDate ?? null,
        event.source,
        event.sourceDocumentId ?? null,
        event.sourceUrl ?? null,
        event.summary ?? null,
        event.rawText ?? null,
        event.importance ?? 'medium',
        event.sentiment ?? 'neutral',
        dedupKey,
        JSON.stringify(event.metadata ?? {})
      ]
    );

    return toEvent(result.rows[0]);
  }
}

function mapDocumentToEvent(document) {
  const eventType = mapDocumentTypeToEventType(document.documentType);
  if (!eventType) {
    return null;
  }

  return {
    symbol: document.symbol,
    eventType,
    title: document.title,
    eventDate: document.referenceDate,
    publishedAt: document.publishedAt,
    referenceDate: document.referenceDate,
    source: document.source,
    sourceDocumentId: document.sourceDocumentId,
    sourceUrl: document.sourceUrl,
    summary: null,
    rawText: null,
    importance: inferImportance(eventType),
    sentiment: 'neutral',
    metadata: {
      sourceDocumentType: document.documentType,
      generatedFromDocument: true,
      documentId: document.id
    }
  };
}

function mapDocumentTypeToEventType(documentType) {
  const map = {
    material_fact: 'material_fact',
    market_announcement: 'market_announcement',
    income_announcement: 'income_announcement',
    subscription_issuance: 'subscription_issuance',
    shareholder_meeting: 'shareholder_meeting',
    fii_management_report: 'management_report',
    fii_monthly_report: 'report_release',
    fii_quarterly_report: 'report_release',
    fii_annual_report: 'report_release'
  };

  return map[documentType] ?? 'other';
}

function inferImportance(eventType) {
  if (eventType === 'material_fact') return 'high';
  if (['income_announcement', 'subscription_issuance', 'shareholder_meeting'].includes(eventType)) return 'medium';
  return 'low';
}

function createEventDedupKey(event) {
  return [
    event.eventType,
    event.source,
    event.sourceDocumentId ?? event.title,
    event.referenceDate ?? event.eventDate ?? event.publishedAt ?? ''
  ].join(':');
}

function toEvent(row) {
  return {
    id: String(row.id),
    symbol: row.symbol,
    eventType: row.event_type,
    title: row.title,
    eventDate: formatDate(row.event_date),
    publishedAt: formatDateTime(row.published_at),
    referenceDate: formatDate(row.reference_date),
    source: row.source,
    sourceDocumentId: row.source_document_id,
    sourceUrl: row.source_url,
    summary: row.summary,
    importance: row.importance,
    sentiment: row.sentiment,
    metadata: row.metadata,
    createdAt: formatDateTime(row.created_at),
    updatedAt: formatDateTime(row.updated_at)
  };
}

function formatDate(value) {
  return value?.toISOString?.().slice(0, 10) ?? value ?? null;
}

function formatDateTime(value) {
  return value?.toISOString?.() ?? value ?? null;
}
