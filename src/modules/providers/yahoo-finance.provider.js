import { fetchJson } from "../../core/http.js";
import { AppError } from "../../core/errors.js";
import { calculateChange, toFiniteNumber, toIsoDateFromUnix } from "../../utils/values.js";

const SYMBOL_MAP = new Map([["IBOV", "^BVSP"]]);

export class YahooFinanceProvider {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async fetchQuote(symbol, query) {
    const yahooSymbol = SYMBOL_MAP.get(symbol) ?? `${symbol}.SA`;
    const params = this.#createParams(query);
    const url = `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?${params.toString()}`;

    const payload = await fetchJson(url, { timeoutMs: this.timeoutMs });
    const chart = payload?.chart;
    if (chart?.error || !chart?.result?.[0]) {
      throw new AppError(404, "NOT_FOUND", `Cotação não encontrada para ${symbol}`);
    }

    return this.#normalizeResult(symbol, chart.result[0], query);
  }

  #createParams(query) {
    const params = new URLSearchParams({
      interval: query.interval,
      includePrePost: "false"
    });

    if (query.dividends) {
      params.set("events", "div,splits");
    }

    if (query.startDate && query.endDate) {
      const endInclusive = new Date(`${query.endDate}T00:00:00Z`);
      endInclusive.setUTCDate(endInclusive.getUTCDate() + 1);
      params.set("period1", String(Math.floor(new Date(`${query.startDate}T00:00:00Z`).getTime() / 1000)));
      params.set("period2", String(Math.floor(endInclusive.getTime() / 1000)));
    } else if (query.range === "2d" || query.range === "7d") {
      const days = query.range === "2d" ? 2 : 7;
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - days * 24 * 60 * 60;
      params.set("period1", String(period1));
      params.set("period2", String(period2));
    } else {
      params.set("range", query.range);
    }

    return params;
  }

  #normalizeResult(symbol, result, query) {
    const meta = result.meta ?? {};
    const timestamps = result.timestamp ?? [];
    const values = result.indicators?.quote?.[0] ?? {};
    const adjustedClose = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const lastIndex = findLastValueIndex(values.close);
    const current = toFiniteNumber(meta.regularMarketPrice) ?? valueAt(values.close, lastIndex);
    const previous = toFiniteNumber(meta.chartPreviousClose) ?? toFiniteNumber(meta.previousClose);
    const calculated = calculateChange(current, previous);

    const historicalDataPrice = query.includeHistory
      ? timestamps.map((timestamp, index) => ({
          date: timestamp,
          open: valueAt(values.open, index),
          high: valueAt(values.high, index),
          low: valueAt(values.low, index),
          close: valueAt(values.close, index),
          volume: valueAt(values.volume, index),
          adjustedClose: valueAt(adjustedClose, index) ?? valueAt(values.close, index)
        })).filter((item) => item.close !== null)
      : undefined;

    return {
      symbol,
      shortName: meta.shortName ?? symbol,
      longName: meta.longName ?? meta.shortName ?? symbol,
      currency: meta.currency ?? "BRL",
      regularMarketPrice: current,
      regularMarketDayHigh: toFiniteNumber(meta.regularMarketDayHigh) ?? valueAt(values.high, lastIndex),
      regularMarketDayLow: toFiniteNumber(meta.regularMarketDayLow) ?? valueAt(values.low, lastIndex),
      regularMarketChange: toFiniteNumber(meta.regularMarketChange) ?? calculated.change,
      regularMarketChangePercent: toFiniteNumber(meta.regularMarketChangePercent) ?? calculated.percent,
      regularMarketTime: toIsoDateFromUnix(toFiniteNumber(meta.regularMarketTime)),
      marketCap: toFiniteNumber(meta.marketCap),
      regularMarketVolume: toFiniteNumber(meta.regularMarketVolume) ?? valueAt(values.volume, lastIndex),
      regularMarketPreviousClose: previous,
      regularMarketOpen: toFiniteNumber(meta.regularMarketOpen) ?? valueAt(values.open, lastIndex),
      fiftyTwoWeekLow: toFiniteNumber(meta.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: toFiniteNumber(meta.fiftyTwoWeekHigh),
      priceEarnings: toFiniteNumber(meta.trailingPE),
      earningsPerShare: toFiniteNumber(meta.epsTrailingTwelveMonths),
      historicalDataPrice,
      dividendsData: query.dividends ? normalizeDividends(result.events?.dividends) : undefined
    };
  }
}

function findLastValueIndex(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (toFiniteNumber(values[index]) !== null) {
      return index;
    }
  }
  return -1;
}

function valueAt(values = [], index) {
  return index >= 0 ? toFiniteNumber(values[index]) : null;
}

function normalizeDividends(dividends = {}) {
  return {
    cashDividends: Object.values(dividends).map((event) => ({
      paymentDate: toIsoDateFromUnix(toFiniteNumber(event.date)),
      rate: toFiniteNumber(event.amount),
      relatedTo: null,
      approvedOn: null,
      isinCode: null,
      label: "DIVIDEND"
    }))
  };
}
