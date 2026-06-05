export class ValuationService {
  constructor({ quotesService, incomeService, config }) {
    this.quotesService = quotesService;
    this.incomeService = incomeService;
    this.config = config;
  }

  async evaluate(symbol) {
    const quote = await this.#getQuote(symbol);
    const incomeSummary = await this.incomeService.summary(symbol, {
      years: this.config.bazinLookbackYears
    });
    const fundamentals = await this.quotesService.getFundamentals(symbol);
    const assetType = inferAssetType(symbol, fundamentals);
    const methods = assetType === 'fii'
      ? this.#evaluateFii({ quote, incomeSummary, fundamentals })
      : this.#evaluateStock({ quote, incomeSummary, fundamentals });

    return {
      symbol,
      assetType,
      currentPrice: quote?.regularMarketPrice ?? null,
      methods,
      warnings: [
        'Valuation por fórmula é referência factual, não recomendação de compra ou venda.'
      ],
      generatedAt: new Date().toISOString()
    };
  }

  #evaluateStock({ quote, incomeSummary, fundamentals }) {
    return {
      bazin: calculateBazin({
        currentPrice: quote?.regularMarketPrice,
        averageAnnualIncome: incomeSummary.averageAnnualIncome,
        requiredYield: this.config.bazinRequiredYield
      }),
      graham: calculateGraham({
        currentPrice: quote?.regularMarketPrice,
        earningsPerShare: fundamentals?.metrics?.earningsPerShare ?? fundamentals?.earningsPerShare,
        bookValuePerShare: fundamentals?.metrics?.bookValuePerShare ?? fundamentals?.bookValuePerShare
      })
    };
  }

  #evaluateFii({ quote, incomeSummary, fundamentals }) {
    return {
      incomeYieldCeiling: calculateBazin({
        currentPrice: quote?.regularMarketPrice,
        averageAnnualIncome: incomeSummary.averageAnnualIncome,
        requiredYield: this.config.fiiRequiredYield
      }),
      pvpReference: calculatePvpReference({
        currentPrice: quote?.regularMarketPrice,
        bookValuePerShare: fundamentals?.metrics?.bookValuePerShare ?? fundamentals?.bookValuePerShare,
        pvp: fundamentals?.metrics?.priceToBook ?? fundamentals?.priceToBook
      })
    };
  }

  async #getQuote(symbol) {
    const response = await this.quotesService.getQuotes([symbol], {
      range: '1d',
      interval: '1d',
      startDate: null,
      endDate: null,
      dividends: false,
      modules: null,
      includeHistory: false
    });

    return response.results[0] ?? null;
  }
}

function calculateBazin({ currentPrice, averageAnnualIncome, requiredYield }) {
  if (!averageAnnualIncome || averageAnnualIncome <= 0 || !requiredYield || requiredYield <= 0) {
    return {
      fairPrice: null,
      requiredYield,
      averageAnnualIncome: averageAnnualIncome ?? null,
      currentPrice: currentPrice ?? null,
      marginOfSafety: null,
      status: 'not_applicable',
      warnings: ['Histórico de proventos insuficiente para calcular preço-teto.']
    };
  }

  const fairPrice = averageAnnualIncome / requiredYield;
  return {
    fairPrice,
    requiredYield,
    averageAnnualIncome,
    currentPrice: currentPrice ?? null,
    marginOfSafety: currentPrice ? (fairPrice - currentPrice) / fairPrice : null,
    status: classifyPrice(currentPrice, fairPrice),
    warnings: ['Método depende de proventos recorrentes e consistentes.']
  };
}

function calculateGraham({ currentPrice, earningsPerShare, bookValuePerShare }) {
  if (!earningsPerShare || !bookValuePerShare || earningsPerShare <= 0 || bookValuePerShare <= 0) {
    return {
      fairPrice: null,
      earningsPerShare: earningsPerShare ?? null,
      bookValuePerShare: bookValuePerShare ?? null,
      currentPrice: currentPrice ?? null,
      marginOfSafety: null,
      status: 'not_applicable',
      warnings: ['LPA ou VPA inválido para aplicação da fórmula de Graham.']
    };
  }

  const fairPrice = Math.sqrt(22.5 * earningsPerShare * bookValuePerShare);
  return {
    fairPrice,
    earningsPerShare,
    bookValuePerShare,
    currentPrice: currentPrice ?? null,
    marginOfSafety: currentPrice ? (fairPrice - currentPrice) / fairPrice : null,
    status: classifyPrice(currentPrice, fairPrice),
    warnings: ['Pode distorcer empresas cíclicas, bancos e lucros não recorrentes.']
  };
}

function calculatePvpReference({ currentPrice, bookValuePerShare, pvp }) {
  const referencePrice = bookValuePerShare && bookValuePerShare > 0
    ? bookValuePerShare
    : currentPrice && pvp && pvp > 0
      ? currentPrice / pvp
      : null;

  return {
    fairPrice: referencePrice,
    bookValuePerShare: bookValuePerShare ?? null,
    currentPrice: currentPrice ?? null,
    pvp: pvp ?? null,
    marginOfSafety: currentPrice && referencePrice ? (referencePrice - currentPrice) / referencePrice : null,
    status: referencePrice ? classifyPrice(currentPrice, referencePrice) : 'not_applicable',
    warnings: ['Referência por P/VP deve considerar qualidade dos imóveis, gestão, vacância e risco de crédito.']
  };
}

function classifyPrice(currentPrice, fairPrice) {
  if (!currentPrice || !fairPrice) return 'unknown';
  const ratio = currentPrice / fairPrice;
  if (ratio <= 0.9) return 'below_reference';
  if (ratio >= 1.1) return 'above_reference';
  return 'near_reference';
}

function inferAssetType(symbol, fundamentals) {
  if (/11$/.test(symbol)) return 'fii';
  return fundamentals?.assetType ?? 'stock';
}
