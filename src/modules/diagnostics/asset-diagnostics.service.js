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
    const assetType = inferAssetType(normalizedSymbol);
    const checks = applyAssetTypePolicy(assetType, {
      quote: await this.#checkQuote(normalizedSymbol),
      fundamentals: await this.#checkFundamentals(normalizedSymbol),
      documents: await this.#checkDocuments(normalizedSymbol),
      events: await this.#checkEvents(normalizedSymbol),
      income: await this.#checkIncome(normalizedSymbol),
      valuation: await this.#checkValuation(normalizedSymbol),
      aiContext: await this.#checkAiContext(normalizedSymbol),
      dataQuality: await this.#checkDataQuality(normalizedSymbol),
      logo: await this.#checkLogo(normalizedSymbol)
    });

    return {
      symbol: normalizedSymbol,
      assetType,
      status: resolveAssetStatus(checks, assetType),
      score: calculateScore(checks, assetType),
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
        details: {},
        applicability: 'required'
      };
    }
  }
}

function ok(details = {}) {
  return { status: 'ok', message: 'OK', details, applicability: 'required' };
}

function warning(message, details = {}) {
  return { status: 'warning', message, details, applicability: 'required' };
}

function missing(message, details = {}) {
  return { status: 'missing', message, details, applicability: 'required' };
}

function optional(check, message) {
  if (check.status === 'ok' || check.status === 'error') return check;
  return {
    ...check,
    status: 'optional',
    message,
    applicability: 'optional'
  };
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase();
}

function inferAssetType(symbol) {
  if (/^[A-Z]{4}11$/.test(symbol)) return 'fii';
  if (/^[A-Z]{4}\d{1,2}$/.test(symbol)) return 'stock';
  return 'unknown';
}

function applyAssetTypePolicy(assetType, checks) {
  if (assetType !== 'stock') {
    return checks;
  }

  return {
    ...checks,
    documents: optional(checks.documents, 'Documentos oficiais normalizados ainda são opcionais para ações.'),
    events: optional(checks.events, 'Eventos oficiais normalizados ainda são opcionais para ações.'),
    income: optional(checks.income, 'Proventos normalizados ainda são opcionais para ações.'),
    dataQuality: checks.dataQuality.status === 'warning'
      ? {
          ...checks.dataQuality,
          message: 'Score de qualidade parcial esperado para ações sem camada documental completa.',
          nonBlocking: true
        }
      : checks.dataQuality
  };
}

function resolveAssetStatus(checks, assetType) {
  const requiredChecks = Object.values(checks).filter((check) => check.applicability !== 'optional');
  const requiredStatuses = requiredChecks.map((check) => check.status);

  if (requiredStatuses.includes('error')) return 'error';
  if (requiredStatuses.includes('missing')) return 'warning';

  if (assetType === 'stock' && hasOnlyNonBlockingWarnings(requiredChecks)) {
    return 'ok';
  }

  if (requiredStatuses.includes('warning')) return 'warning';
  return 'ok';
}

function hasOnlyNonBlockingWarnings(checks) {
  return checks.every((check) => check.status === 'ok' || (check.status === 'warning' && check.nonBlocking === true));
}

function calculateScore(checks, assetType) {
  const weights = getWeightsForAssetType(assetType);
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const rawScore = Object.entries(weights).reduce((score, [key, weight]) => {
    const check = checks[key];
    const status = check?.status;
    if (status === 'ok' || status === 'optional') return score + weight;
    if (status === 'warning') return score + Math.floor(weight / 2);
    return score;
  }, 0);

  return totalWeight ? Math.round((rawScore / totalWeight) * 100) : 0;
}

function getWeightsForAssetType(assetType) {
  if (assetType === 'stock') {
    return {
      quote: 24,
      fundamentals: 20,
      valuation: 16,
      aiContext: 14,
      dataQuality: 10,
      logo: 8,
      documents: 3,
      events: 3,
      income: 2
    };
  }

  if (assetType === 'fii') {
    return {
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
  }

  return {
    quote: 22,
    fundamentals: 18,
    valuation: 16,
    aiContext: 14,
    dataQuality: 12,
    logo: 8,
    documents: 4,
    events: 3,
    income: 3
  };
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
