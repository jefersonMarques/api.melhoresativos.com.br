export class LogoScheduler {
  constructor({ logosService, intervalMs, enabled, maxSymbolsPerRun }) {
    this.logosService = logosService;
    this.intervalMs = intervalMs;
    this.enabled = enabled;
    this.maxSymbolsPerRun = maxSymbolsPerRun;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.enabled || this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        console.warn(`[market-data-api] Sincronização automática de logos falhou: ${error.message}`);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async run() {
    if (!this.enabled || this.running) {
      return { status: 'skipped' };
    }

    this.running = true;

    try {
      const result = await this.logosService.syncMarketLogos({
        maxSymbols: this.maxSymbolsPerRun
      });

      console.log(`[market-data-api] Logos sincronizadas automaticamente: ${result.synced}/${result.candidates} candidatos`);

      return result;
    } finally {
      this.running = false;
    }
  }
}
