import test from "node:test";
import assert from "node:assert/strict";
import { parseQuoteQuery, parseSymbols } from "../src/modules/quotes/quote-query.js";

test("normalizes Brazilian symbols and removes duplicates", () => {
  assert.deepEqual(parseSymbols("petr4,PETR4.SA,kncr11", 20), ["PETR4", "KNCR11"]);
});

test("accepts Brapi historical query parameters", () => {
  const query = parseQuoteQuery(new URLSearchParams("range=1mo&interval=1d&dividends=true"));
  assert.equal(query.range, "1mo");
  assert.equal(query.interval, "1d");
  assert.equal(query.dividends, true);
  assert.equal(query.includeHistory, true);
});

test("rejects incomplete date range", () => {
  assert.throws(
    () => parseQuoteQuery(new URLSearchParams("startDate=2026-01-01")),
    /startDate e endDate/
  );
});
