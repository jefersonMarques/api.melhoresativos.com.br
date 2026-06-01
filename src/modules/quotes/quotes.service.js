import { toBrapiQuote } from "./brapi-response.adapter.js";
import { createCacheKey } from "./quote-query.js";
import { extractOfficialFiiMetrics } from "../fundamentals/fii-official-metrics.service.js";

export class QuotesService {
  constructor({ repository, yahooProvider, fundamentusProvider, config }) {
    this.repository = repository;
    this.yahooProvider = yahooProvider;
    this.fundamentusProvider = fundamentusProvider;
    this.config = config;
  }

  async getQuotes(symbols, query) {
    const startedAt = performance.now();
    const settled = await Promise.allSettled(symbols.map((symbol) => this.#getQuote(symbol, query)));
    const results = [];
    const errors = [];
    let isStale = false;

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(result.value.quote);
        isStale ||= result.value.isStale;
        return;
      }

      errors.push({
        symbol: symbols[index],
        message: result.reason instanceof Error ? result.reason.message : "Falha desconhecida na cotação"
      });
    });

    return {
      results,
      errors,
      requestedAt: new Date().toISOString(),
      took: Math.round(performance.now() - startedAt),
      isStale
    };
  }

  async getFundamentals(symbol) {
    const complementary = await this.#getFundamentals(symbol);
    const official = await this.#getOfficialFiiMetrics(symbol);
    const metrics = mergeMetrics(complementary, official?.metrics);
    const sources = [
      ...(complementary ? ["fundamentus"] : []),
      ...(official?.hasMetrics ? ["cvm_fundosnet_documents"] : [])
    ];
    return {
      symbol,
      metrics,
      source: sources.join("+") || "unavailable",
      sources,
      fetchedAt: complementary?.fetchedAt ?? new Date().toISOString(),
      officialEvidence: official?.evidence ?? [],
      officialReferenceDate: official?.referenceDate ?? null
    };
  }

  async refreshMonitored(symbols) {
    const query = {
      range: "1d",
      interval: "15m",
      startDate: null,
      endDate: null,
      dividends: false,
      modules: null,
      includeHistory: false
    };

    return Promise.allSettled(symbols.map((symbol) => this.#getQuote(symbol, query, true)));
  }

  async #getQuote(symbol, query, forceRefresh = false) {
    const key = createCacheKey(symbol, query);
    const cached = await this.repository.getCachedQuote(key);

    if (!forceRefresh && cached && isFresh(cached.fetchedAt, this.config.cacheTtlMs)) {
      return { quote: cached.quote, isStale: false };
    }

    try {
      const rawQuote = await this.yahooProvider.fetchQuote(symbol, query);
      const fundamentals = await this.#getFundamentals(symbol);
      const quote = toBrapiQuote(rawQuote, fundamentals);

      await Promise.all([
        this.repository.setCachedQuote(key, {
          quote,
          fetchedAt: new Date().toISOString()
        }),
        this.repository.addSnapshot(symbol, quote)
      ]);

      return { quote, isStale: false };
    } catch (error) {
      if (cached?.quote) {
        return { quote: cached.quote, isStale: true };
      }
      if (!query.includeHistory && this.config.fundamentusEnabled && this.fundamentusProvider?.fetchQuote) {
        try {
          const fallback = await this.fundamentusProvider.fetchQuote(symbol);
          const quote = toBrapiQuote(fallback.quote, fallback.fundamentals);
          await Promise.all([
            this.repository.setCachedQuote(key, { quote, fetchedAt: new Date().toISOString() }),
            this.repository.addSnapshot(symbol, quote)
          ]);
          return { quote, isStale: false };
        } catch {
          // O erro original da fonte principal identifica melhor a falha de consulta.
        }
      }
      throw error;
    }
  }

  async #getOfficialFiiMetrics(symbol) {
    if (!this.repository.listDocuments || !this.repository.getDocument) {
      return null;
    }
    try {
      const summaries = await this.repository.listDocuments(symbol, { limit: 12 });
      const relevant = summaries.filter((document) =>
        ["cvm_open_data", "fundosnet_b3"].includes(document.source) && document.hasContent !== false
      ).slice(0, 8);
      const documents = (await Promise.all(relevant.map((document) => this.repository.getDocument(symbol, document.id))))
        .filter(Boolean);
      const extracted = extractOfficialFiiMetrics(documents);
      return extracted.hasMetrics ? extracted : null;
    } catch (error) {
      console.warn(`[market-data-api] Métricas oficiais indisponíveis para ${symbol}: ${error.message}`);
      return null;
    }
  }

  async #getFundamentals(symbol) {
    if (!this.config.fundamentusEnabled || !this.fundamentusProvider || symbol === "IBOV") {
      return null;
    }

    const cached = await this.repository.getFundamentals(symbol);
    if (cached && isFresh(cached.fetchedAt, this.config.fundamentusTtlMs)) {
      return cached;
    }

    try {
      const fundamentals = await this.fundamentusProvider.fetchFundamentals(symbol);
      await this.repository.setFundamentals(symbol, fundamentals);
      return fundamentals;
    } catch (error) {
      console.warn(`[market-data-api] Fundamentus indisponível para ${symbol}: ${error.message}`);
      return cached ?? null;
    }
  }
}

function isFresh(timestamp, ttlMs) {
  return Date.now() - new Date(timestamp).getTime() < ttlMs;
}

function mergeMetrics(complementary, official) {
  if (!complementary && !official) return null;
  return { ...(complementary ?? {}), ...(official ?? {}) };
}
