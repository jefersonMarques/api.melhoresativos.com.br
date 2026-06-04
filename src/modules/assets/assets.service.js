export class AssetsService {
  constructor({ repository, quotesService, logosService, documentsService, eventsService, valuationService }) {
    this.repository = repository;
    this.quotesService = quotesService;
    this.logosService = logosService;
    this.documentsService = documentsService;
    this.eventsService = eventsService;
    this.valuationService = valuationService;
  }

  async getProfile(symbol) {
    const [quoteResponse, fundamentals, logoUrl, identity, documents, events, valuation] = await Promise.all([
      this.#safe(() => this.quotesService.getQuotes([symbol], defaultQuoteQuery()), null),
      this.#safe(() => this.quotesService.getFundamentals(symbol), null),
      this.#safe(() => this.logosService.getLogoUrl(symbol), null),
      this.#safe(() => this.repository.getAssetRegistry(symbol), null),
      this.#safe(() => this.documentsService.list(symbol, { limit: 5 }), null),
      this.#safe(() => this.eventsService.listBySymbol(symbol, { limit: 10 }), []),
      this.#safe(() => this.valuationService.evaluate(symbol), null)
    ]);
    const quote = quoteResponse?.results?.[0] ?? null;

    return {
      symbol,
      assetType: inferAssetType(symbol, identity),
      name: identity?.fundName ?? quote?.longName ?? quote?.shortName ?? symbol,
      shortName: quote?.shortName ?? symbol,
      longName: quote?.longName ?? identity?.fundName ?? quote?.shortName ?? symbol,
      currency: quote?.currency ?? 'BRL',
      logourl: logoUrl,
      quote,
      fundamentals,
      identity,
      documentsSummary: summarizeDocuments(documents),
      eventsSummary: summarizeEvents(events),
      valuation,
      generatedAt: new Date().toISOString()
    };
  }

  async #safe(action, fallback) {
    try {
      return await action();
    } catch (error) {
      return fallback;
    }
  }
}

function defaultQuoteQuery() {
  return {
    range: '1d',
    interval: '1d',
    startDate: null,
    endDate: null,
    dividends: false,
    modules: null,
    includeHistory: false
  };
}

function inferAssetType(symbol, identity) {
  if (identity?.assetType) return identity.assetType;
  if (/11$/.test(symbol)) return 'fii';
  return 'stock';
}

function summarizeDocuments(documents) {
  const list = documents?.documents ?? [];
  return {
    totalRecent: list.length,
    syncState: documents?.syncState ?? [],
    recent: list.slice(0, 5).map((document) => ({
      id: document.id,
      documentType: document.documentType,
      title: document.title,
      referenceDate: document.referenceDate,
      publishedAt: document.publishedAt,
      source: document.source,
      hasContent: document.hasContent
    }))
  };
}

function summarizeEvents(events) {
  return {
    totalRecent: events.length,
    recent: events.slice(0, 10)
  };
}
