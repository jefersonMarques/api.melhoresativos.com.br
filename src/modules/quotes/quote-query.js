import { AppError } from "../../core/errors.js";

const SUPPORTED_RANGES = new Set(["1d", "2d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]);
const SUPPORTED_INTERVALS = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"]);
const SYMBOL_PATTERN = /^[A-Z0-9]{4,12}$/;

export function normalizeSymbol(symbol) {
  const normalized = symbol.trim().toUpperCase().replace(/\.SA$/, "");
  if (normalized === "IBOV") {
    return normalized;
  }

  if (!SYMBOL_PATTERN.test(normalized)) {
    throw new AppError(400, "BAD_REQUEST", `Ticker inválido: ${symbol}`);
  }

  return normalized;
}

export function parseSymbols(value, maximum) {
  const symbols = [...new Set(value.split(",").map(normalizeSymbol))];
  if (!symbols.length) {
    throw new AppError(400, "BAD_REQUEST", "Informe ao menos um ticker");
  }
  if (symbols.length > maximum) {
    throw new AppError(400, "BAD_REQUEST", `Máximo de ${maximum} tickers por consulta`);
  }
  return symbols;
}

export function parseQuoteQuery(searchParams) {
  const range = searchParams.get("range");
  const interval = searchParams.get("interval");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (range && !SUPPORTED_RANGES.has(range)) {
    throw new AppError(400, "BAD_REQUEST", `Range não suportado: ${range}`);
  }
  if (interval && !SUPPORTED_INTERVALS.has(interval)) {
    throw new AppError(400, "BAD_REQUEST", `Interval não suportado: ${interval}`);
  }
  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new AppError(400, "BAD_REQUEST", "startDate e endDate devem ser enviados juntos");
  }
  if (startDate && (!isValidDate(startDate) || !isValidDate(endDate) || startDate > endDate)) {
    throw new AppError(400, "BAD_REQUEST", "Período de datas inválido");
  }

  return {
    range: range ?? "1d",
    interval: interval ?? "1d",
    startDate,
    endDate,
    dividends: searchParams.get("dividends") === "true",
    modules: searchParams.get("modules") ?? null,
    includeHistory: Boolean(range || startDate)
  };
}

export function createCacheKey(symbol, query) {
  return [symbol, query.range, query.interval, query.startDate ?? "", query.endDate ?? "", query.dividends].join(":");
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}
