export class AiContextService {
  constructor({ assetsService, incomeService, eventsService, dataQualityService }) {
    this.assetsService = assetsService;
    this.incomeService = incomeService;
    this.eventsService = eventsService;
    this.dataQualityService = dataQualityService;
  }

  async get(symbol) {
    const [profile, income, events, dataQuality] = await Promise.all([
      this.assetsService.getProfile(symbol),
      this.incomeService.summary(symbol, { years: 5 }),
      this.eventsService.listBySymbol(symbol, { limit: 10 }),
      this.dataQualityService.get(symbol)
    ]);

    return {
      symbol,
      assetType: profile.assetType,
      profile: {
        name: profile.name,
        shortName: profile.shortName,
        longName: profile.longName,
        currency: profile.currency,
        logourl: profile.logourl
      },
      quote: profile.quote,
      fundamentals: profile.fundamentals,
      valuation: profile.valuation,
      income: {
        lastTwelveMonths: income.lastTwelveMonths,
        averageAnnualIncome: income.averageAnnualIncome,
        annualTotals: income.annualTotals,
        recentPayments: income.payments.slice(0, 12)
      },
      events: {
        recent: events
      },
      documents: profile.documentsSummary,
      signals: buildSignals({ profile, events, dataQuality }),
      dataQuality,
      warnings: [
        'Contexto factual para análise. Não representa recomendação automática de compra ou venda.',
        'Valuation por fórmula deve ser usado apenas como referência inicial.'
      ],
      generatedAt: new Date().toISOString()
    };
  }

  async getMany(symbols) {
    return Promise.all(symbols.map((symbol) => this.get(symbol)));
  }
}

function buildSignals({ profile, events, dataQuality }) {
  const signals = [];
  const methods = profile.valuation?.methods ?? {};

  for (const [method, result] of Object.entries(methods)) {
    if (result?.status === 'below_reference') {
      signals.push({
        type: 'valuation_below_reference',
        severity: 'medium',
        message: `Preço atual abaixo da referência calculada pelo método ${method}.`,
        metadata: { method, marginOfSafety: result.marginOfSafety }
      });
    }
    if (result?.status === 'above_reference') {
      signals.push({
        type: 'valuation_above_reference',
        severity: 'medium',
        message: `Preço atual acima da referência calculada pelo método ${method}.`,
        metadata: { method, marginOfSafety: result.marginOfSafety }
      });
    }
  }

  if (events.some((event) => event.eventType === 'material_fact')) {
    signals.push({
      type: 'new_material_fact',
      severity: 'high',
      message: 'Existe fato relevante entre os eventos recentes.',
      metadata: {}
    });
  }

  for (const issue of dataQuality.issues) {
    signals.push({
      type: issue,
      severity: issue.startsWith('missing') ? 'low' : 'medium',
      message: `Qualidade de dados: ${issue}.`,
      metadata: {}
    });
  }

  return signals;
}
