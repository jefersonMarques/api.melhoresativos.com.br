import test from "node:test";
import assert from "node:assert/strict";
import { QuotesService } from "../src/modules/quotes/quotes.service.js";

function createRepository() {
  const data = { cache: {}, fundamentals: {}, snapshots: [] };
  return {
    getCachedQuote: async (key) => data.cache[key] ?? null,
    setCachedQuote: async (key, value) => { data.cache[key] = value; },
    addSnapshot: async (symbol, quote) => { data.snapshots.push({ symbol, quote }); },
    getFundamentals: async (symbol) => data.fundamentals[symbol] ?? null,
    setFundamentals: async (symbol, value) => { data.fundamentals[symbol] = value; },
    data
  };
}

test("uses providers once and returns cached compatible result", async () => {
  const repository = createRepository();
  let yahooCalls = 0;
  let fundamentusCalls = 0;
  const service = new QuotesService({
    repository,
    config: { cacheTtlMs: 900000, fundamentusTtlMs: 86400000, fundamentusEnabled: true },
    yahooProvider: {
      fetchQuote: async () => {
        yahooCalls += 1;
        return { symbol: "PETR4", regularMarketPrice: 40, regularMarketDayLow: 39, regularMarketDayHigh: 41 };
      }
    },
    fundamentusProvider: {
      fetchFundamentals: async () => {
        fundamentusCalls += 1;
        return { priceEarnings: 5, earningsPerShare: 8, fetchedAt: new Date().toISOString() };
      }
    }
  });
  const query = { range: "1d", interval: "1d", startDate: null, endDate: null, dividends: false, includeHistory: false };

  const first = await service.getQuotes(["PETR4"], query);
  const second = await service.getQuotes(["PETR4"], query);

  assert.equal(first.results[0].regularMarketPrice, 40);
  assert.equal(second.results[0].priceEarnings, 5);
  assert.equal(yahooCalls, 1);
  assert.equal(fundamentusCalls, 1);
  assert.equal(repository.data.snapshots.length, 1);
});

test("returns valid quotes when one requested symbol fails upstream", async () => {
  const repository = createRepository();
  const service = new QuotesService({
    repository,
    config: { cacheTtlMs: 900000, fundamentusTtlMs: 86400000, fundamentusEnabled: false },
    yahooProvider: {
      fetchQuote: async (symbol) => {
        if (symbol === "INVALID11") throw new Error("Cotação não encontrada");
        return { symbol, regularMarketPrice: 40 };
      }
    },
    fundamentusProvider: null
  });
  const query = { range: "1d", interval: "1d", startDate: null, endDate: null, dividends: false, includeHistory: false };

  const response = await service.getQuotes(["PETR4", "INVALID11"], query);

  assert.deepEqual(response.results.map((quote) => quote.symbol), ["PETR4"]);
  assert.equal(response.errors.length, 1);
  assert.equal(response.errors[0].symbol, "INVALID11");
});

test("uses Fundamentus as current-price fallback when Yahoo has no quote", async () => {
  const repository = createRepository();
  const service = new QuotesService({
    repository,
    config: { cacheTtlMs: 900000, fundamentusTtlMs: 86400000, fundamentusEnabled: true },
    yahooProvider: { fetchQuote: async () => { throw new Error("Yahoo unavailable"); } },
    fundamentusProvider: {
      fetchQuote: async (symbol) => ({
        quote: { symbol, regularMarketPrice: 88.45, source: "fundamentus" },
        fundamentals: { dividendYield: 12.3 }
      })
    }
  });
  const query = { range: "1d", interval: "1d", startDate: null, endDate: null, dividends: false, includeHistory: false };

  const response = await service.getQuotes(["CACR11"], query);

  assert.equal(response.results[0].regularMarketPrice, 88.45);
  assert.equal(response.results[0].source, "fundamentus");
  assert.equal(response.errors.length, 0);
});

test("merges official FII metrics into the fundamentals endpoint", async () => {
  const repository = createRepository();
  repository.listDocuments = async () => [{ id: "1", source: "cvm_open_data", hasContent: true }];
  repository.getDocument = async () => ({
    id: "1",
    source: "cvm_open_data",
    documentType: "fii_monthly_report",
    referenceDate: "2026-04-30",
    sourceUrl: "official",
    content: { rawText: JSON.stringify({ rows: [{ PATRIMONIO_LIQUIDO: "1000000,00", VALOR_PATRIMONIAL_COTA: "101,12" }] }) }
  });
  const service = new QuotesService({
    repository,
    config: { fundamentusTtlMs: 86400000, fundamentusEnabled: true },
    yahooProvider: {},
    fundamentusProvider: { fetchFundamentals: async () => ({ priceToBook: 0.91, fetchedAt: "2026-05-29T00:00:00.000Z" }) }
  });
  const result = await service.getFundamentals("CACR11");
  assert.equal(result.metrics.priceToBook, 0.91);
  assert.equal(result.metrics.netAssetValue, 1000000);
  assert.equal(result.metrics.netAssetValuePerShare, 101.12);
  assert.ok(result.sources.includes("cvm_fundosnet_documents"));
  assert.equal(result.officialEvidence[0].documentId, "1");
});
