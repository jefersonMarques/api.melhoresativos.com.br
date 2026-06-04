import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function parseEnvContent(content) {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export async function loadEnvFile(path = resolve(process.cwd(), ".env")) {
  try {
    parseEnvContent(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function numberValue(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanValue(key, fallback) {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === "true";
}

function listValue(key, fallback = []) {
  const value = process.env[key];
  return value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : fallback;
}

export function createConfig() {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? "0.0.0.0",
    port: numberValue("PORT", 3333),
    databaseUrl: process.env.DATABASE_URL ?? "postgresql://investment:InvestmentLocal_2026_Strong@localhost:5432/investment_agent",
    databaseSsl: booleanValue("DATABASE_SSL", false),
    databasePoolMax: numberValue("DATABASE_POOL_MAX", 10),
    autoMigrate: booleanValue("AUTO_MIGRATE", true),
    cacheTtlMs: numberValue("CACHE_TTL_MINUTES", 15) * 60_000,
    fundamentusTtlMs: numberValue("FUNDAMENTUS_TTL_HOURS", 24) * 60 * 60_000,
    logoTtlMs: numberValue("LOGO_TTL_DAYS", 30) * 24 * 60 * 60_000,
    updateIntervalMs: numberValue("UPDATE_INTERVAL_MINUTES", 15) * 60_000,
    maxSnapshotsPerSymbol: numberValue("MAX_SNAPSHOTS_PER_SYMBOL", 10_000),
    yahooFinanceBaseUrl: process.env.YAHOO_FINANCE_BASE_URL ?? "https://query1.finance.yahoo.com",
    fundamentusBaseUrl: process.env.FUNDAMENTUS_BASE_URL ?? "https://www.fundamentus.com.br",
    fundamentusEnabled: booleanValue("FUNDAMENTUS_ENABLED", true),
    brapiBaseUrl: process.env.BRAPI_BASE_URL ?? "https://brapi.dev",
    brapiToken: process.env.BRAPI_TOKEN ?? "",
    tradingViewScannerBaseUrl: process.env.TRADINGVIEW_SCANNER_BASE_URL ?? "https://scanner.tradingview.com",
    cvmFiiEnabled: booleanValue("CVM_FII_ENABLED", true),
    cvmOpenDataBaseUrl: process.env.CVM_OPEN_DATA_BASE_URL ?? "https://dados.cvm.gov.br",
    fnetFiiEnabled: booleanValue("FNET_FII_ENABLED", true),
    fnetBaseUrl: process.env.FNET_BASE_URL ?? "https://fnet.bmfbovespa.com.br/fnet/publico",
    fnetDiscoveryEnabled: booleanValue("FNET_DISCOVERY_ENABLED", true),
    fnetDiscoveryBaseUrl: process.env.FNET_DISCOVERY_BASE_URL ?? "https://brfiis.com.br",
    fnetMaximumDocuments: numberValue("FNET_MAX_DOCUMENTS_PER_SYMBOL", 40),
    pdfTextExtractionEnabled: booleanValue("PDF_TEXT_EXTRACTION_ENABLED", true),
    pdfTextExtractorBinary: process.env.PDF_TEXT_EXTRACTOR_BINARY ?? "pdftotext",
    documentSyncEnabled: booleanValue("DOCUMENT_SYNC_ENABLED", false),
    documentSyncIntervalMs: numberValue("DOCUMENT_SYNC_INTERVAL_HOURS", 6) * 60 * 60_000,
    documentLookbackYears: numberValue("DOCUMENT_LOOKBACK_YEARS", 2),
    documentMaxSymbolsPerRun: numberValue("DOCUMENT_MAX_SYMBOLS_PER_RUN", 20),
    documentMaxResults: numberValue("DOCUMENT_MAX_RESULTS", 100),
    requestTimeoutMs: numberValue("REQUEST_TIMEOUT_MS", 12_000),
    maxTickers: numberValue("MAX_TICKERS_PER_REQUEST", 20),
    rateLimitWindowMs: numberValue("RATE_LIMIT_WINDOW_MINUTES", 1) * 60_000,
    rateLimitMaxRequests: numberValue("RATE_LIMIT_MAX_REQUESTS", 120),
    corsOrigins: listValue("CORS_ORIGINS", ["http://localhost:5173", "http://localhost:3000"])
  };
}
