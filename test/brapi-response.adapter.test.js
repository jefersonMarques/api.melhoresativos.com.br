import test from "node:test";
import assert from "node:assert/strict";
import { toBrapiQuote } from "../src/modules/quotes/brapi-response.adapter.js";

test("maps Yahoo quote and Fundamentus metrics to Brapi format", () => {
  const result = toBrapiQuote({
    symbol: "PETR4",
    shortName: "PETR4",
    longName: "Petrobras",
    currency: "BRL",
    regularMarketPrice: 43.44,
    regularMarketDayHigh: 43.88,
    regularMarketDayLow: 42.97,
    regularMarketChange: 0.04,
    regularMarketChangePercent: 0.09,
    fiftyTwoWeekLow: 28.86,
    fiftyTwoWeekHigh: 43.88
  }, {
    priceEarnings: 5.2,
    earningsPerShare: 8.36
  });

  assert.equal(result.regularMarketDayRange, "42.97 - 43.88");
  assert.equal(result.fiftyTwoWeekRange, "28.86 - 43.88");
  assert.equal(result.priceEarnings, 5.2);
  assert.equal(result.earningsPerShare, 8.36);
  assert.equal(result.logourl, null);
});

test("does not fabricate missing ranges", () => {
  const result = toBrapiQuote({ symbol: "PETR4" });
  assert.equal(result.regularMarketDayRange, null);
  assert.equal(result.fiftyTwoWeekRange, null);
});
