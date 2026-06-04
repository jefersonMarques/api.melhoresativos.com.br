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

  const tradingViewLogoProvider = new TradingViewLogoProvider({
    scannerBaseUrl: config.tradingViewScannerBaseUrl,
    timeoutMs: config.requestTimeoutMs
  });

  const logosService = new LogosService({
    repository,
    brapiLogoProvider: new BrapiLogoProvider({
      baseUrl: config.brapiBaseUrl,
      token: config.brapiToken,
      timeoutMs: config.requestTimeoutMs
    }),
    tradingViewLogoProvider,
    config
  });

  const rawSymbols = process.argv.slice(2).join(',');
  const symbols = rawSymbols ? parseSymbols(rawSymbols, 5000) : await discoverTradingViewSymbols(tradingViewLogoProvider);

  if (!symbols.length) {
    console.log('[market-data-api] Nenhum ativo para sincronizar logos.');
  } else {
    console.log(`[market-data-api] Sincronizando logos de ${symbols.length} ativos.`);
    const results = await logosService.syncLogos(symbols);
    const counters = countBySource(results);

    for (const result of results) {
      console.log(`${result.symbol}: ${result.status} ${result.source ?? 'failed'}`);
    }

    console.log('[market-data-api] Resultado:', counters);
  }
} finally {
  await pool.end();
}

async function discoverTradingViewSymbols(tradingViewLogoProvider) {
  const records = await tradingViewLogoProvider.fetchLogoRecords({ limit: 5000 });
  return [...new Set(records.map((record) => record.symbol).filter(Boolean))];
}

function countBySource(results) {
  return results.reduce((accumulator, result) => {
    const key = result.source ?? 'failed';
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}
