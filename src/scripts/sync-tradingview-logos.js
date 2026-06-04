import { resolve } from 'node:path';
import { createConfig, loadEnvFile } from '../config/env.js';
import { createDatabasePool } from '../database/client.js';
import { runMigrations } from '../database/migrate.js';
import { LogosService } from '../modules/logos/logos.service.js';
import { BrapiLogoProvider } from '../modules/providers/brapi-logo.provider.js';
import { TradingViewLogoProvider } from '../modules/providers/tradingview-logo.provider.js';
import { PostgresMarketRepository } from '../modules/storage/postgres-market.repository.js';
import { parseSymbols } from '../modules/quotes/quote-query.js';

await loadEnvFile();

const config = createConfig();
const pool = createDatabasePool(config);

try {
  if (config.autoMigrate) {
    await runMigrations(pool, resolve(process.cwd(), 'migrations'));
  }

  const repository = new PostgresMarketRepository({
    pool,
    maxSnapshotsPerSymbol: config.maxSnapshotsPerSymbol
  });

  const logosService = new LogosService({
    repository,
    brapiLogoProvider: new BrapiLogoProvider({
      baseUrl: config.brapiBaseUrl,
      token: config.brapiToken,
      timeoutMs: config.requestTimeoutMs
    }),
    tradingViewLogoProvider: new TradingViewLogoProvider({
      scannerBaseUrl: config.tradingViewScannerBaseUrl,
      timeoutMs: config.requestTimeoutMs
    }),
    config
  });

  const rawSymbols = process.argv.slice(2).join(',');
  const symbols = rawSymbols ? parseSymbols(rawSymbols, 5000) : await repository.listMonitored();

  if (!symbols.length) {
    console.log('[market-data-api] Nenhum ativo para sincronizar logos.');
  } else {
    const results = await logosService.syncLogos(symbols);
    for (const result of results) {
      console.log(`${result.symbol}: ${result.status} ${result.source ?? 'failed'}`);
    }
  }
} finally {
  await pool.end();
}
