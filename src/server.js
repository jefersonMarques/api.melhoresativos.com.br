import { createServer } from "node:http";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import { createConfig, loadEnvFile } from "./config/env.js";
import { createDatabasePool } from "./database/client.js";
import { runMigrations } from "./database/migrate.js";
import { AiContextService } from "./modules/ai-context/ai-context.service.js";
import { AssetsService } from "./modules/assets/assets.service.js";
import { DataQualityService } from "./modules/data-quality/data-quality.service.js";
import { DocumentsService } from "./modules/documents/documents.service.js";
import { PdfTextExtractor } from "./modules/documents/pdf-text.extractor.js";
import { EventsService } from "./modules/events/events.service.js";
import { IncomeService } from "./modules/income/income.service.js";
import { LogosService } from "./modules/logos/logos.service.js";
import { DocumentScheduler } from "./modules/monitoring/document.scheduler.js";
import { LogoScheduler } from "./modules/monitoring/logo.scheduler.js";
import { MonitorScheduler } from "./modules/monitoring/monitor.scheduler.js";
import { BrapiLogoProvider } from "./modules/providers/brapi-logo.provider.js";
import { CvmFiiProvider } from "./modules/providers/cvm-fii.provider.js";
import { BrFiisFnetDiscoveryProvider } from "./modules/providers/brfiis-fnet-discovery.provider.js";
import { FnetFiiProvider } from "./modules/providers/fnet-fii.provider.js";
import { FundamentusProvider } from "./modules/providers/fundamentus.provider.js";
import { TradingViewLogoProvider } from "./modules/providers/tradingview-logo.provider.js";
import { YahooFinanceProvider } from "./modules/providers/yahoo-finance.provider.js";
import { QuotesService } from "./modules/quotes/quotes.service.js";
import { PostgresMarketRepository } from "./modules/storage/postgres-market.repository.js";
import { ValuationService } from "./modules/valuation/valuation.service.js";

await loadEnvFile();
const config = createConfig();
const pool = createDatabasePool(config);

if (config.autoMigrate) {
  await runMigrations(pool, resolve(process.cwd(), "migrations"));
}

const repository = new PostgresMarketRepository({
  pool,
  maxSnapshotsPerSymbol: config.maxSnapshotsPerSymbol
});
await repository.initialize();

const yahooProvider = new YahooFinanceProvider({
  baseUrl: config.yahooFinanceBaseUrl,
  timeoutMs: config.requestTimeoutMs
});
const fundamentusProvider = new FundamentusProvider({
  baseUrl: config.fundamentusBaseUrl,
  timeoutMs: config.requestTimeoutMs
});
const brapiLogoProvider = new BrapiLogoProvider({
  baseUrl: process.env.BRAPI_LOGO_BASE_URL ?? "https://brapi.dev",
  token: config.brapiToken,
  timeoutMs: config.requestTimeoutMs
});
const tradingViewLogoProvider = new TradingViewLogoProvider({
  scannerBaseUrl: config.tradingViewScannerBaseUrl,
  timeoutMs: config.requestTimeoutMs
});
const logosService = new LogosService({
  repository,
  brapiLogoProvider,
  tradingViewLogoProvider,
  config
});
const cvmFiiProvider = new CvmFiiProvider({
  baseUrl: config.cvmOpenDataBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  lookbackYears: config.documentLookbackYears
});
const fnetDiscoveryProvider = new BrFiisFnetDiscoveryProvider({
  baseUrl: config.fnetDiscoveryBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  maximumDocuments: config.fnetMaximumDocuments
});
const pdfTextExtractor = new PdfTextExtractor({
  enabled: config.pdfTextExtractionEnabled,
  binary: config.pdfTextExtractorBinary
});
const fnetFiiProvider = config.fnetDiscoveryEnabled ? new FnetFiiProvider({
  baseUrl: config.fnetBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  discoveryProvider: fnetDiscoveryProvider,
  pdfTextExtractor
}) : null;
const documentsService = new DocumentsService({
  repository,
  cvmFiiProvider,
  fnetFiiProvider,
  fundamentusProvider,
  config
});
const quotesService = new QuotesService({
  repository,
  yahooProvider,
  fundamentusProvider,
  logosService,
  config
});
const eventsService = new EventsService({ repository });
const incomeService = new IncomeService({ repository });
const valuationService = new ValuationService({
  quotesService,
  incomeService,
  config
});
const assetsService = new AssetsService({
  repository,
  quotesService,
  logosService,
  documentsService,
  eventsService,
  valuationService
});
const dataQualityService = new DataQualityService({
  repository,
  quotesService,
  logosService,
  documentsService,
  eventsService,
  incomeService
});
const aiContextService = new AiContextService({
  assetsService,
  incomeService,
  eventsService,
  dataQualityService
});
const scheduler = new MonitorScheduler({
  repository,
  quotesService,
  intervalMs: config.updateIntervalMs
});
const documentScheduler = new DocumentScheduler({
  repository,
  documentsService,
  intervalMs: config.documentSyncIntervalMs,
  enabled: config.documentSyncEnabled && (config.cvmFiiEnabled || config.fnetFiiEnabled),
  maxSymbolsPerRun: config.documentMaxSymbolsPerRun
});
const logoScheduler = new LogoScheduler({
  logosService,
  intervalMs: config.logoSyncIntervalMs,
  enabled: config.logoSyncEnabled,
  maxSymbolsPerRun: config.logoSyncMaxSymbolsPerRun
});

const server = createServer(createApp({
  config,
  repository,
  quotesService,
  scheduler,
  documentsService,
  documentScheduler,
  logosService,
  assetsService,
  aiContextService,
  dataQualityService,
  eventsService,
  incomeService,
  valuationService
}));
scheduler.start();
documentScheduler.start();
logoScheduler.start();

server.listen(config.port, config.host, async () => {
  const monitoredSymbols = await repository.listMonitored();
  console.log(`[market-data-api] API disponível em http://${config.host}:${config.port}`);
  console.log(`[market-data-api] Ativos monitorados: ${monitoredSymbols.join(", ") || "nenhum"}`);
  scheduler.run().catch((error) => {
    console.warn(`[market-data-api] Primeira atualização falhou: ${error.message}`);
  });
  if (config.documentSyncEnabled && (config.cvmFiiEnabled || config.fnetFiiEnabled)) {
    documentScheduler.run().catch((error) => {
      console.warn(`[market-data-api] Primeira sincronização documental falhou: ${error.message}`);
    });
  }
  if (config.logoSyncEnabled) {
    logoScheduler.run().catch((error) => {
      console.warn(`[market-data-api] Primeira sincronização de logos falhou: ${error.message}`);
    });
  }
});

async function shutdown() {
  scheduler.stop();
  documentScheduler.stop();
  logoScheduler.stop();
  await new Promise((resolveClose) => server.close(resolveClose));
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
