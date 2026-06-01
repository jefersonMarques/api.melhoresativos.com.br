export class DocumentScheduler {
  constructor({ repository, documentsService, intervalMs, enabled = false, maxSymbolsPerRun = 20 }) {
    this.repository = repository;
    this.documentsService = documentsService;
    this.intervalMs = intervalMs;
    this.enabled = enabled;
    this.maxSymbolsPerRun = maxSymbolsPerRun;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch((error) => console.error("[market-data-api] Falha ao sincronizar documentos:", error));
    }, this.intervalMs);
    this.timer.unref();
  }

  async run(symbols = null) {
    if (this.running) return [];
    const monitored = symbols ?? await this.repository.listMonitored();
    const candidates = monitored.filter(isLikelyFii).slice(0, this.maxSymbolsPerRun);
    if (!candidates.length) return [];
    this.running = true;
    try {
      return await this.documentsService.sync(candidates);
    } finally {
      this.running = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function isLikelyFii(symbol) {
  return /11$/.test(symbol);
}
