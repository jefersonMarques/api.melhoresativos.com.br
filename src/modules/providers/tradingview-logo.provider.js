import { fetchJson } from '../../core/http.js';

const LOGO_BASE_URL = 'https://s3-symbol-logo.tradingview.com';

export class TradingViewLogoProvider {
  constructor({ scannerBaseUrl, timeoutMs }) {
    this.scannerBaseUrl = scannerBaseUrl;
    this.timeoutMs = timeoutMs;
  }

  async fetchLogoUrl(symbol) {
    const payload = await fetchJson(`${this.scannerBaseUrl}/brazil/scan`, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columns: ['name', 'description', 'logoid', 'type', 'subtype', 'exchange'],
        filter: [
          { left: 'name', operation: 'equal', right: symbol }
        ],
        range: [0, 10]
      })
    });

    const row = (payload?.data ?? [])
      .map((item) => mapTradingViewRow(item))
      .find((item) => item.symbol === symbol && item.logoid);

    return row ? `${LOGO_BASE_URL}/${row.logoid}--big.svg` : null;
  }

  async fetchLogoRecords({ limit = 5000 } = {}) {
    const payload = await fetchJson(`${this.scannerBaseUrl}/brazil/scan`, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        columns: ['name', 'description', 'logoid', 'type', 'subtype', 'exchange'],
        range: [0, limit]
      })
    });

    return (payload?.data ?? [])
      .map((item) => mapTradingViewRow(item))
      .filter((item) => item.symbol && item.logoid)
      .map((item) => ({
        ...item,
        logoUrl: `${LOGO_BASE_URL}/${item.logoid}--big.svg`
      }));
  }
}

function mapTradingViewRow(row) {
  const [symbol, description, logoid, type, subtype, exchange] = row?.d ?? [];

  return {
    tradingViewSymbol: row?.s ?? null,
    symbol,
    description,
    logoid,
    type,
    subtype,
    exchange
  };
}
