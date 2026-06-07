export class EventsService {
  constructor({ repository, incomeService = null }) {
    this.repository = repository;
    this.incomeService = incomeService;
  }

  async syncFromDocuments(symbols) {
    const summaries = await this.repository.listRecentDocuments(symbols, { limit: 500 });
    const documents = await Promise.all(summaries.map((document) => this.#loadDocumentDetail(document)));
    const events = documents.map((document) => mapDocumentToEvent(document)).filter(Boolean);
    const incomeEntries = documents.flatMap((document) => extractIncomeFromDocument(document));

    for (const event of events) {
      await this.upsertEvent(event);
    }

    if (this.incomeService) {
      for (const income of incomeEntries) {
        await this.incomeService.upsertIncome(income);
      }
    }

    return {
      symbols,
      discovered: summaries.length,
      insertedOrUpdated: events.length,
      incomeInsertedOrUpdated: this.incomeService ? incomeEntries.length : 0
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
         event_type = EXCLUDED.event_type,
         title = EXCLUDED.title,
         event_date = EXCLUDED.event_date,
         published_at = EXCLUDED.published_at,
         reference_date = EXCLUDED.reference_date,
         source_document_id = EXCLUDED.source_document_id,
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

  async #loadDocumentDetail(document) {
    if (!this.repository.getDocument) {
      return document;
    }

    return await this.repository.getDocument(document.symbol, document.id) ?? document;
  }
}

function mapDocumentToEvent(document) {
  const eventType = mapDocumentTypeToEventType(document.documentType);
  if (!eventType) {
    return null;
  }

  const rawText = getDocumentRawText(document);
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
    summary: createEventSummary(document, rawText),
    rawText: rawText ? truncateText(rawText, 20_000) : null,
    importance: inferImportance(eventType),
    sentiment: 'neutral',
    metadata: {
      sourceDocumentType: document.documentType,
      generatedFromDocument: true,
      documentId: document.id,
      hasExtractedContent: Boolean(rawText)
    }
  };
}

function extractIncomeFromDocument(document) {
  const rawText = getDocumentRawText(document);

  if (document.source === 'cvm_open_data') {
    return extractIncomeFromStructuredReport(document, rawText);
  }

  if (document.documentType !== 'income_announcement') {
    return [];
  }

  const amount = findIncomeAmount(rawText);
  if (!amount) {
    return [];
  }

  return [createIncomeEntry({
    document,
    amount,
    incomeType: inferIncomeType(document, rawText),
    comDate: findDateByLabels(rawText, ['data-base', 'data base', 'data com', 'com direito', 'posição', 'posicao', 'cotistas em']),
    exDate: findDateByLabels(rawText, ['data ex', 'ex-rendimento', 'ex rendimento', 'ex-dividendo', 'ex dividendo', 'a partir de']),
    paymentDate: findDateByLabels(rawText, ['pagamento', 'data do pagamento', 'data de pagamento']),
    referenceDate: findReferencePeriod(rawText) ?? document.referenceDate,
    extractionMethod: 'document_text_pattern'
  })];
}

function extractIncomeFromStructuredReport(document, rawText) {
  const rows = parseStructuredRows(rawText);
  return rows.map((row, index) => {
    const amount = findRowIncomeAmount(row);
    if (!amount) return null;

    return createIncomeEntry({
      document,
      amount,
      incomeType: findRowIncomeType(row),
      comDate: findRowDate(row, ['COM', 'DATA_BASE', 'POSICAO', 'POSIÇÃO', 'COTISTA']),
      exDate: findRowDate(row, ['EX']),
      paymentDate: findRowDate(row, ['PAGAMENTO', 'PAGTO', 'PAG']),
      referenceDate: findRowDate(row, ['REFERENCIA', 'REFERÊNCIA', 'COMPETENCIA', 'COMPETÊNCIA']) ?? document.referenceDate,
      rowIndex: index,
      extractionMethod: 'cvm_structured_report'
    });
  }).filter(Boolean);
}

function createIncomeEntry({ document, amount, incomeType, comDate, exDate, paymentDate, referenceDate, rowIndex = null, extractionMethod }) {
  return {
    symbol: document.symbol,
    incomeType,
    amount,
    comDate: comDate ?? null,
    exDate: exDate ?? null,
    paymentDate: paymentDate ?? null,
    referenceDate: referenceDate ?? document.referenceDate,
    declaredAt: document.publishedAt,
    source: document.source,
    sourceDocumentId: rowIndex === null ? document.sourceDocumentId : `${document.sourceDocumentId}:row:${rowIndex}`,
    sourceUrl: document.sourceUrl,
    metadata: {
      sourceDocumentType: document.documentType,
      documentId: document.id,
      extractionMethod
    }
  };
}

function parseStructuredRows(rawText) {
  if (!rawText) return [];
  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed?.rows) ? parsed.rows : [];
  } catch {
    return [];
  }
}

function findRowIncomeAmount(row) {
  const entries = Object.entries(row ?? {});
  const preferred = entries.find(([key, value]) => {
    const name = normalizeKey(key);
    return isIncomeAmountKey(name) && parseFlexibleNumber(value) !== null;
  });

  if (preferred) {
    return parseFlexibleNumber(preferred[1]);
  }

  return null;
}

function isIncomeAmountKey(name) {
  const hasIncomeWord = ['REND', 'PROVENT', 'DISTRIB', 'DIVID', 'AMORT'].some((token) => name.includes(token));
  const hasAmountWord = ['VALOR', 'VL', 'COTA', 'QUOTA', 'UNIDADE'].some((token) => name.includes(token));
  return hasIncomeWord && hasAmountWord;
}

function findRowIncomeType(row) {
  const text = Object.entries(row ?? {}).map(([key, value]) => `${key} ${value}`).join(' ').toLowerCase();
  return text.includes('amortiza') ? 'amortization' : 'dividend';
}

function findRowDate(row, tokens) {
  const entry = Object.entries(row ?? {}).find(([key, value]) => {
    const name = normalizeKey(key);
    return tokens.some((token) => name.includes(normalizeKey(token))) && parseAnyDate(value);
  });
  return entry ? parseAnyDate(entry[1]) : null;
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
  if (event.source && event.sourceDocumentId) {
    return [event.source, event.sourceDocumentId].join(':');
  }

  return [
    event.eventType,
    event.source ?? '',
    event.title,
    event.referenceDate ?? event.eventDate ?? event.publishedAt ?? ''
  ].join(':');
}

function createEventSummary(document, rawText) {
  if (!rawText) {
    return `${document.title} sincronizado a partir de ${document.source}.`;
  }

  const text = normalizeText(rawText);
  if (document.documentType === 'income_announcement') {
    const amount = findIncomeAmount(text);
    const paymentDate = findDateByLabels(text, ['pagamento', 'data do pagamento', 'data de pagamento']);
    const parts = [document.title];
    if (amount) parts.push(`valor por cota R$ ${formatDecimal(amount)}`);
    if (paymentDate) parts.push(`pagamento em ${paymentDate}`);
    return parts.join(' — ');
  }

  return truncateText(firstUsefulLines(text).join(' '), 600) || `${document.title} sincronizado a partir de ${document.source}.`;
}

function getDocumentRawText(document) {
  return document.content?.rawText ?? document.rawText ?? null;
}

function firstUsefulLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 20 && !line.startsWith('{') && !line.startsWith('['))
    .slice(0, 3);
}

function findIncomeAmount(text) {
  if (!text) return null;
  const patterns = [
    /R\$\s*([0-9]+(?:\.[0-9]{3})*,[0-9]{2,8})\s*(?:por\s+cota|por\s+quota|\/\s*cota)/i,
    /(?:valor\s+(?:do\s+)?(?:rendimento|provento|amortizacao|amortização))[\s\S]{0,180}?(?:R\$\s*)?([0-9]+(?:\.[0-9]{3})*,[0-9]{2,8})/i,
    /(?:rendimento|provento|amortizacao|amortização)[\s\S]{0,180}?([0-9]+,[0-9]{2,8})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? parseBrazilianNumber(match[1]) : null;
    if (value) return value;
  }

  return null;
}

function findDateByLabels(text, labels) {
  if (!text) return null;
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegex(label)}[\\s\\S]{0,180}?(\\d{2}\\/\\d{2}\\/\\d{4})`, 'i');
    const match = text.match(pattern);
    if (match) return parseBrazilianDate(match[1]);
  }
  return null;
}

function findReferencePeriod(text) {
  if (!text) return null;
  const normalized = normalizeText(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const patterns = [
    /periodo\s+de\s+referencia[\s\S]{0,140}?([a-z]+)\s*\/\s*(\d{4})/i,
    /periodo\s+de\s+referencia[\s\S]{0,140}?([a-z]+)\s+de\s+(\d{4})/i,
    /competencia[\s\S]{0,140}?([a-z]+)\s*\/\s*(\d{4})/i,
    /referencia[\s\S]{0,140}?([a-z]+)\s*\/\s*(\d{4})/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const month = monthNumber(match[1]);
    if (month) return `${match[2]}-${month}-01`;
  }

  return null;
}

function inferIncomeType(document, text) {
  const content = String(text ?? '').toLowerCase();
  if (/valor\s+do\s+rendimento[\s\S]{0,120}?(?:r\$\s*)?[0-9]+,[0-9]{2,8}/i.test(content)) return 'dividend';
  if (/valor\s+(?:da\s+)?amortiza[\s\S]{0,120}?(?:r\$\s*)?[0-9]+,[0-9]{2,8}/i.test(content)) return 'amortization';
  const value = `${document.title} ${content}`.toLowerCase();
  return value.includes('amortiza') && !value.includes('rendimento') ? 'amortization' : 'dividend';
}

function parseBrazilianNumber(value) {
  if (!value) return null;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseFlexibleNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 && number < 1_000 ? number : null;
}

function parseAnyDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const br = parseBrazilianDate(raw);
  if (br) return br;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function parseBrazilianDate(value) {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function monthNumber(value) {
  const months = {
    janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
    julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
  };
  return months[String(value ?? '').toLowerCase()] ?? null;
}

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, '_')
    .toUpperCase();
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value, maximumLength) {
  const text = String(value ?? '').trim();
  return text.length > maximumLength ? `${text.slice(0, maximumLength - 1)}…` : text;
}

function formatDecimal(value) {
  return Number(value).toFixed(8).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
