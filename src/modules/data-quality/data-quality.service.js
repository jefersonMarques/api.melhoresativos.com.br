export class DataQualityService {
  constructor({ repository, quotesService, logosService, documentsService, eventsService, incomeService }) {
    this.repository = repository;
    this.quotesService = quotesService;
    this.logosService = logosService;
    this.documentsService = documentsService;
    this.eventsService = eventsService;
    this.incomeService = incomeService;
  }

  async get(symbol) {
    const issues = [];
    const [quote, logo, fundamentals, documents, events, income] = await Promise.all([
      this.#safe(() => this.quotesService.getQuotes([symbol], defaultQuoteQuery()), null),
      this.#safe(() => this.repository.getAssetLogo(symbol), null),
      this.#safe(() => this.quotesService.getFundamentals(symbol), null),
      this.#safe(() => this.documentsService.list(symbol, { limit: 5 }), null),
      this.#safe(() => this.eventsService.listBySymbol(symbol, { limit: 5 }), []),
      this.#safe(() => this.incomeService.list(symbol, { limit: 5 }), [])
    ]);

    const hasQuote = Boolean(quote?.results?.[0]?.regularMarketPrice);
    const hasLogo = Boolean(logo?.svgContent && logo.source !== 'default');
    const hasFundamentals = Boolean(fundamentals?.metrics || fundamentals?.priceEarnings || fundamentals?.earningsPerShare);
    const hasDocuments = Boolean(documents?.documents?.length);
    const hasEvents = Boolean(events.length);
    const hasIncomeHistory = Boolean(income.length);

    if (!hasQuote) issues.push('missing_quote');
    if (!hasLogo) issues.push(logo?.source === 'default' ? 'default_logo' : 'missing_logo');
    if (!hasFundamentals) issues.push('missing_fundamentals');
    if (!hasDocuments) issues.push('missing_documents');
    if (!hasEvents) issues.push('missing_events');
    if (!hasIncomeHistory) issues.push('missing_income_history');

    return {
      symbol,
      hasQuote,
      hasLogo,
      hasFundamentals,
      hasDocuments,
      hasEvents,
      hasIncomeHistory,
      issues,
      score: calculateScore({ hasQuote, hasLogo, hasFundamentals, hasDocuments, hasEvents, hasIncomeHistory }),
      generatedAt: new Date().toISOString()
    };
  }

  async list(symbols) {
    return Promise.all(symbols.map((symbol) => this.get(symbol)));
  }

  async #safe(action, fallback) {
    try {
      return await action();
    } catch {
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

function calculateScore(flags) {
  const values = Object.values(flags);
  const positive = values.filter(Boolean).length;
  return Math.round((positive / values.length) * 100);
}
