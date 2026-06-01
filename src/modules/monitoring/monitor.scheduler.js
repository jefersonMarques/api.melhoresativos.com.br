export class MonitorScheduler {
  constructor({ repository, quotesService, intervalMs }) {
    this.repository = repository;
    this.quotesService = quotesService;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        console.error("[market-data-api] Falha ao atualizar ativos monitorados:", error);
      });
    }, this.intervalMs);

    this.timer.unref();
  }

  async run() {
    if (this.running) {
      return;
    }

    const symbols = await this.repository.listMonitored();
    if (!symbols.length) {
      return;
    }

    this.running = true;
    try {
      const results = await this.quotesService.refreshMonitored(symbols);
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        console.warn(`[market-data-api] ${failures.length} ativo(s) falharam na atualização automática.`);
      }
    } finally {
      this.running = false;
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
