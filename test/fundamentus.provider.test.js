import test from "node:test";
import assert from "node:assert/strict";
import { FundamentusProvider } from "../src/modules/providers/fundamentus.provider.js";

test("extracts extended complementary indicators from Fundamentus", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const metric = (label, value) => `<span>${label}</span><span class="txt">${value}</span>`;
  global.fetch = async () => new Response([
    metric("P/L", "8,52"), metric("P/VP", "0,91"), metric("P/EBIT", "7,10"),
    metric("EV / EBITDA", "6,39"), metric("VPA", "101,12"), metric("Div. Yield", "12,30%"),
    metric("ROE", "18,40%"), metric("ROIC", "9,30%"), metric("Dív Br/ Patrim", "0,42"),
    metric("Liquidez 2 meses", "500.000,00"), metric("Cres. Rec (5a)", "6,20%")
  ].join(""), { status: 200 });
  const provider = new FundamentusProvider({ baseUrl: "https://fundamentus.test", timeoutMs: 100 });
  const metrics = await provider.fetchFundamentals("CACR11");
  assert.equal(metrics.priceEarnings, 8.52);
  assert.equal(metrics.enterpriseValueToEbitda, 6.39);
  assert.equal(metrics.bookValuePerShare, 101.12);
  assert.equal(metrics.dividendYield12Months, 12.3);
  assert.equal(metrics.returnOnInvestedCapital, 9.3);
  assert.equal(metrics.liquidity, 500000);
  assert.equal(metrics.revenueGrowth, 6.2);
});
