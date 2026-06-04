export function toBrapiQuote(quote, fundamentals = null, logoUrl = null) {
  const dayHigh = quote.regularMarketDayHigh ?? null;
  const dayLow = quote.regularMarketDayLow ?? null;
  const weekLow = quote.fiftyTwoWeekLow ?? null;
  const weekHigh = quote.fiftyTwoWeekHigh ?? null;

  return {
    symbol: quote.symbol,
    shortName: quote.shortName ?? quote.symbol,
    longName: quote.longName ?? quote.shortName ?? quote.symbol,
    currency: quote.currency ?? "BRL",
    source: quote.source ?? "yahoo_finance",
    regularMarketPrice: quote.regularMarketPrice ?? null,
    regularMarketDayHigh: dayHigh,
    regularMarketDayLow: dayLow,
    regularMarketDayRange: dayLow !== null && dayHigh !== null ? `${dayLow} - ${dayHigh}` : null,
    regularMarketChange: quote.regularMarketChange ?? null,
    regularMarketChangePercent: quote.regularMarketChangePercent ?? null,
    regularMarketTime: quote.regularMarketTime ?? null,
    marketCap: quote.marketCap ?? null,
    regularMarketVolume: quote.regularMarketVolume ?? null,
    regularMarketPreviousClose: quote.regularMarketPreviousClose ?? null,
    regularMarketOpen: quote.regularMarketOpen ?? null,
    fiftyTwoWeekRange: weekLow !== null && weekHigh !== null ? `${weekLow} - ${weekHigh}` : null,
    fiftyTwoWeekLow: weekLow,
    fiftyTwoWeekHigh: weekHigh,
    priceEarnings: fundamentals?.priceEarnings ?? quote.priceEarnings ?? null,
    earningsPerShare: fundamentals?.earningsPerShare ?? quote.earningsPerShare ?? null,
    logourl: logoUrl,
    ...(quote.historicalDataPrice ? { historicalDataPrice: quote.historicalDataPrice } : {}),
    ...(quote.dividendsData ? { dividendsData: quote.dividendsData } : {})
  };
}
