export class AssetDiagnosticsService {
  constructor({
    quotesService,
    documentsService,
    eventsService,
    incomeService,
    valuationService,
    aiContextService,
    dataQualityService,
    logosService
  }) {
    this.quotesService = quotesService;
    this.documentsService = documentsService;
    this.eventsService = eventsService;
    this.incomeService = incomeService;
    this.valuationService = valuationService;
    this.aiContextService = aiContextService;
    this.dataQualityService = dataQualityService;
    this.logosService = logosService;
  }

  async checkMany(symbols) {
    const results = [];
    for (const symbol of symbols) {
      results.push(await this.check(symbol));
    }

    return {
      checkedAt: new Date().toISOString(),
      results,
      summary: summarizeResults(results)
    };
  }

  async check(symbol) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const checks = {
      quote: await this.#checkQuote(normalizedSymbol),
      fundamentals: await this.#checkFundamentals(normalizedSymbol),
      documents: await this.#checkDocuments(normalizedSymbol),
      events: await this.#checkEvents(normalizedSymbol),
      income: await this.#checkIncome(normalizedSymbol),
      valuation: await this.#checkValuation(normalizedSymbol),
      aiContext: await this.#checkAiContext(normalizedSymbol),
      dataQuality: await this.#checkDataQuality(normalizedSymbol),
      logo: await this.#checkLogo(normalizedSymbol)
    };

    return {
      symbol: normalizedSymbol,
      status: resolveAssetStatus(checks),
      score: calculateScore(checks),
      checks
    };
  }

  async #checkQuote(symbol) {
    return this.#safeCheck('quote', async () => {
      const result = await this.quotesService.getQuotes([symbol], {});
      const quote = result.results?.[0] ?? null;
      return quote
        ? ok({ price: quote.regularMarketPrice ?? quote.price ?? null, marketTime: quote.regularMarketTime ?? quote.marketTime ?? null })
        : missing('Cotação não encontrada.');
    });
  }

  async #checkFundamentals(symbol) {
    return this.#safeCheck('fundamentals', async () => {
      const fundamentals = await this.quotesService.getFundamentals(symbol);
      const metrics = fundamentals?.metrics ?? null;
      return metrics && Object.keys(metrics).length
        ? ok({ source: fundamentals.source ?? null, metricCount: Object.keys(metrics).length })
        : warning('Fundamentos sem métricas úteis.', { source: fundamentals?.source ?? null });
    });
  }

  async #checkDocuments(symbol) {
    return this.#safeCheck('documents', async () => {
      if (!this.documentsService) return missing('Serviço de documentos indisponível.');
      const payload = await this.documentsService.list(symbol, { limit: 20 });
      const documents = Array.isArray(payload?.documents) ? payload.documents : [];
      const extracted = documents.filter((document) => document.extractionStatus === 'extracted' || document.processingStatus === 'extracted');
      const typed = documents.filter((document) => document.documentType && document.documentType !== 'other_official_document');
      return documents.length
        ? ok({ total: documents.length, extracted: extracted.length, typed: typed.length })
        : missing('Nenhum documento oficial salvo para o ativo.');
    });
  }

  async #checkEvents(symbol) {
    return this.#safeCheck('events', async () => {
      if (!this.eventsService) return missing('Serviço de eventos indisponível.');
      const events = await this.eventsService.listBySymbol(symbol, { limit: 50 });
      const typed = events.filter((event) => event.eventType && event.eventType !== 'other');
      return events.length
        ? ok({ total: events.length, typed: typed.length })
        : missing('Nenhum evento normalizado para o ativo.');
    });
  }

  async #checkIncome(symbol) {
    return this.#safeCheck('income', async () => {
      if (!this.incomeService) return missing('Serviço de proventos indisponível.');
      const income = await this.incomeService.summary(symbol, { years: 5 });
      const payments = Array.isArray(income.payments) ? income.payments : [];
      return payments.length
        ? ok({ payments: payments.length, lastTwelveMonths: income.lastTwelveMonths, annualTotals: income.annualTotals })
        : warning('Nenhum provento normalizado encontrado.', { payments: 0 });
    });
  }

  async #checkValuation(symbol) {
    return this.#safeCheck('valuation', async () => {
      if (!this.valuationService) return missing('Serviço de valuation indisponível.');
      const valuation = await this.valuationService.evaluate(symbol);
      return valuation ? ok({ methods: Object.keys(valuation).filter((key) => key !== 'symbol') }) : missing('Valuation não retornou dados.');
    });
  }

  async #checkAiContext(symbol) {
    return this.#safeCheck('aiContext', async () => {
      if (!this.aiContextService) return missing('Serviço de contexto IA indisponível.');
      const context = await this.aiContextService.get(symbol);
      const fields = Object.keys(context ?? {}).filter((key) => key !== 'symbol');
      return fields.length ? ok({ fields }) : missing('Contexto IA vazio.');
    });
  }

  async #checkDataQuality(symbol) {
    return this.#safeCheck('dataQuality', async () => {
      if (!this.dataQualityService) return missing('Serviço de qualidade indisponível.');
      const quality = await this.dataQualityService.get(symbol);
      const score = Number(quality?.score ?? 0);
      return score >= 80
        ? ok({ score })
        : warning('Score de qualidade abaixo do ideal.', { score });
    });
  }

  async #checkLogo(symbol) {
    return this.#safeCheck('logo', async () => {
      if (!this.logosService) return missing('Serviço de logos indisponível.');
      const logo = await this.logosService.getLogo(symbol);
      const hasSvg = Boolean(logo?.svgContent);
      const isGenericBrapi = logo?.source === 'brapi' && isGenericBrapiSvg(logo.svgContent);
      if (!hasSvg) return missing('Logo sem SVG persistido.');
      if (isGenericBrapi) return warning('Logo genérica da Brapi ainda está persistida.', { source: logo.source });
      return ok({ source: logo.source, sourceSymbol: logo.sourceSymbol ?? null });
    });
  }

  async #safeCheck(name, handler) {
    try {
      return await handler();
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : `Falha desconhecida em ${name}.`,
        details: {}
      };
    }
  }
}

function ok(details = {}) {
  return { status: 'ok', message: 'OK', details };
}

function warning(message, details = {}) {
  return { status: 'warning', message, details };
}

function missing(message, details = {}) {
  return { status: 'missing', message, details };
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase();
}

function resolveAssetStatus(checks) {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('missing')) return 'warning';
  if (statuses.includes('warning')) return 'warning';
  return 'ok';
}

function calculateScore(checks) {
  const weights = {
    quote: 16,
    fundamentals: 10,
    documents: 14,
    events: 12,
    income: 12,
    valuation: 10,
    aiContext: 10,
    dataQuality: 10,
    logo: 6
  };

  return Object.entries(weights).reduce((score, [key, weight]) => {
    const status = checks[key]?.status;
    if (status === 'ok') return score + weight;
    if (status === 'warning') return score + Math.floor(weight / 2);
    return score;
  }, 0);
}

function summarizeResults(results) {
  return {
    total: results.length,
    ok: results.filter((item) => item.status === 'ok').length,
    warning: results.filter((item) => item.status === 'warning').length,
    error: results.filter((item) => item.status === 'error').length,
    averageScore: results.length
      ? Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length)
      : null
  };
}

function isGenericBrapiSvg(svgContent) {
  const normalized = String(svgContent ?? '').toLowerCase();
  return normalized.includes('<title>brapi</title>')
    || normalized.includes('brapi.dev')
    || normalized.includes('logo oficial da brapi');
}
