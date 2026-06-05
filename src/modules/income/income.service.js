export class IncomeService {
  constructor({ repository }) {
    this.repository = repository;
  }

  async list(symbol, { limit = 120 } = {}) {
    const result = await this.repository.pool.query(
      `SELECT id, symbol, income_type, amount, com_date, ex_date, payment_date,
              reference_date, declared_at, source, source_document_id, source_url,
              metadata, created_at, updated_at
       FROM market_data_asset_income
       WHERE symbol = $1
       ORDER BY COALESCE(payment_date, reference_date, com_date) DESC NULLS LAST, id DESC
       LIMIT $2`,
      [symbol, limit]
    );

    return result.rows.map(toIncome);
  }

  async listMany(symbols, { limit = 120 } = {}) {
    if (!symbols.length) return [];

    const result = await this.repository.pool.query(
      `SELECT id, symbol, income_type, amount, com_date, ex_date, payment_date,
              reference_date, declared_at, source, source_document_id, source_url,
              metadata, created_at, updated_at
       FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY symbol
           ORDER BY COALESCE(payment_date, reference_date, com_date) DESC NULLS LAST, id DESC
         ) AS position
         FROM market_data_asset_income
         WHERE symbol = ANY($1::varchar[])
       ) ranked_income
       WHERE position <= $2
       ORDER BY symbol ASC, COALESCE(payment_date, reference_date, com_date) DESC NULLS LAST`,
      [symbols, limit]
    );

    return result.rows.map(toIncome);
  }

  async summary(symbol, { years = 5 } = {}) {
    const since = new Date();
    since.setUTCFullYear(since.getUTCFullYear() - years);

    const income = await this.list(symbol, { limit: 600 });
    const filtered = income.filter((item) => {
      const date = item.paymentDate ?? item.referenceDate ?? item.comDate;
      return date && new Date(date) >= since;
    });
    const annualTotals = groupAnnualTotals(filtered);
    const totals = Object.values(annualTotals);
    const averageAnnualIncome = totals.length
      ? totals.reduce((sum, value) => sum + value, 0) / totals.length
      : null;

    return {
      symbol,
      years,
      payments: income,
      annualTotals,
      averageAnnualIncome,
      lastTwelveMonths: sumSince(income, 12)
    };
  }

  async upsertIncome(value) {
    const dedupKey = createIncomeDedupKey(value);
    const result = await this.repository.pool.query(
      `INSERT INTO market_data_asset_income (
         symbol, income_type, amount, com_date, ex_date, payment_date,
         reference_date, declared_at, source, source_document_id, source_url, dedup_key, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (symbol, dedup_key) DO UPDATE SET
         com_date = EXCLUDED.com_date,
         ex_date = EXCLUDED.ex_date,
         payment_date = EXCLUDED.payment_date,
         reference_date = EXCLUDED.reference_date,
         declared_at = EXCLUDED.declared_at,
         source_url = EXCLUDED.source_url,
         metadata = market_data_asset_income.metadata || EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id, symbol, income_type, amount, com_date, ex_date, payment_date,
                 reference_date, declared_at, source, source_document_id, source_url,
                 metadata, created_at, updated_at`,
      [
        value.symbol,
        value.incomeType,
        value.amount,
        value.comDate ?? null,
        value.exDate ?? null,
        value.paymentDate ?? null,
        value.referenceDate ?? null,
        value.declaredAt ?? null,
        value.source,
        value.sourceDocumentId ?? null,
        value.sourceUrl ?? null,
        dedupKey,
        JSON.stringify(value.metadata ?? {})
      ]
    );

    return toIncome(result.rows[0]);
  }
}

function groupAnnualTotals(income) {
  const totals = {};
  for (const item of income) {
    const date = item.paymentDate ?? item.referenceDate ?? item.comDate;
    if (!date) continue;
    const year = date.slice(0, 4);
    totals[year] = (totals[year] ?? 0) + Number(item.amount);
  }
  return totals;
}

function sumSince(income, months) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);

  return income.reduce((sum, item) => {
    const date = item.paymentDate ?? item.referenceDate ?? item.comDate;
    if (!date || new Date(date) < since) return sum;
    return sum + Number(item.amount);
  }, 0);
}

function createIncomeDedupKey(value) {
  return [
    value.incomeType,
    value.amount,
    value.paymentDate ?? value.referenceDate ?? value.comDate ?? '',
    value.source,
    value.sourceDocumentId ?? ''
  ].join(':');
}

function toIncome(row) {
  return {
    id: String(row.id),
    symbol: row.symbol,
    incomeType: row.income_type,
    amount: Number(row.amount),
    comDate: formatDate(row.com_date),
    exDate: formatDate(row.ex_date),
    paymentDate: formatDate(row.payment_date),
    referenceDate: formatDate(row.reference_date),
    declaredAt: formatDateTime(row.declared_at),
    source: row.source,
    sourceDocumentId: row.source_document_id,
    sourceUrl: row.source_url,
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
