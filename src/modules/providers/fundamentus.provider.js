import { fetchText } from "../../core/http.js";
import { AppError } from "../../core/errors.js";
import { escapeRegex, parseBrazilianNumber } from "../../utils/values.js";

export class FundamentusProvider {
  constructor({ baseUrl, timeoutMs }) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async fetchFundamentals(symbol) {
    const html = await this.#fetchPage(symbol);
    return normalizeFundamentals(html);
  }

  async fetchFiiIdentity(symbol) {
    const url = `${this.baseUrl}/fii_administrador.php?papel=${encodeURIComponent(symbol)}`;
    const html = await fetchText(url, { timeoutMs: this.timeoutMs });
    const cnpj = findTableValue(html, "CNPJ do Fundo");
    if (!cnpj) {
      throw new AppError(404, "NOT_FOUND", `CNPJ não encontrado para ${symbol} no provedor complementar`);
    }
    return {
      symbol,
      assetType: "fii",
      cnpj,
      fundName: null,
      sourceMetadata: { resolutionSource: "fundamentus", complementarySource: true }
    };
  }

  async fetchQuote(symbol) {
    const html = await this.#fetchPage(symbol);
    const regularMarketPrice = findMetric(html, "Cotação");
    if (regularMarketPrice === null) {
      throw new AppError(404, "NOT_FOUND", `Cotação não encontrada no Fundamentus para ${symbol}`);
    }

    return {
      quote: {
        symbol,
        shortName: symbol,
        longName: symbol,
        currency: "BRL",
        regularMarketPrice,
        regularMarketTime: new Date().toISOString(),
        source: "fundamentus"
      },
      fundamentals: normalizeFundamentals(html)
    };
  }

  async #fetchPage(symbol) {
    const url = `${this.baseUrl}/detalhes.php?papel=${encodeURIComponent(symbol)}`;
    return fetchText(url, { timeoutMs: this.timeoutMs });
  }
}

function normalizeFundamentals(html) {
  const dividendYield = findMetric(html, "Div. Yield");
  return {
    priceEarnings: findMetric(html, "P/L"),
    priceToBook: findMetric(html, "P/VP"),
    priceToEbit: findMetric(html, "P/EBIT"),
    priceToSales: findMetric(html, "PSR"),
    priceToAssets: findMetric(html, "P/Ativos"),
    priceToWorkingCapital: findMetric(html, "P/Cap. Giro"),
    priceToNetCurrentAssets: findMetric(html, "P/Ativ Circ Liq"),
    enterpriseValueToEbitda: firstMetric(html, ["EV / EBITDA", "EV/EBITDA"]),
    enterpriseValueToEbit: firstMetric(html, ["EV / EBIT", "EV/EBIT"]),
    earningsPerShare: findMetric(html, "LPA"),
    bookValuePerShare: findMetric(html, "VPA"),
    dividendYield,
    dividendYield12Months: dividendYield,
    grossMargin: findMetric(html, "Marg. Bruta"),
    ebitMargin: findMetric(html, "Marg. EBIT"),
    netMargin: findMetric(html, "Marg. Líquida"),
    ebitToAssets: findMetric(html, "EBIT / Ativo"),
    returnOnEquity: findMetric(html, "ROE"),
    returnOnInvestedCapital: findMetric(html, "ROIC"),
    currentRatio: findMetric(html, "Liquidez Corr"),
    grossDebtToEquity: findMetric(html, "Dív Br/ Patrim"),
    netDebtToEquity: findMetric(html, "Dív Líq/ Patrim"),
    netDebtToEbitda: firstMetric(html, ["Dív. Líq./EBITDA", "Dív Líq / EBITDA", "Dív Líq/ EBITDA"]),
    assetTurnover: findMetric(html, "Giro Ativos"),
    revenueGrowth: firstMetric(html, ["Cres. Rec (5a)", "Cres. Rec.5a"]),
    liquidity: firstMetric(html, ["Liquidez 2meses", "Liquidez 2 meses"]),
    netAssetValue: firstMetric(html, ["Patrim. Líq", "Patrim Líq"]),
    fetchedAt: new Date().toISOString()
  };
}

function firstMetric(html, labels) {
  for (const label of labels) {
    const value = findMetric(html, label);
    if (value !== null) return value;
  }
  return null;
}

function findMetric(html, label) {
  const safeLabel = escapeRegex(label).replace(/\\ /g, "\\s*");
  const pattern = new RegExp(
    `<span[^>]*>\\s*${safeLabel}\\s*<\\/span>[\\s\\S]{0,400}?<span[^>]*class=["'][^"']*txt[^"']*["'][^>]*>\\s*([^<]+?)\\s*<\\/span>`,
    "i"
  );
  const match = html.match(pattern);
  return match ? parseBrazilianNumber(match[1]) : null;
}

function findTableValue(html, label) {
  const safeLabel = escapeRegex(label).replace(/\ /g, "\\s*");
  const pattern = new RegExp(`${safeLabel}[\\s\\S]{0,500}?(\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2})`, "i");
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}
