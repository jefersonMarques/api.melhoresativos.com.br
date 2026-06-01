import test from "node:test";
import assert from "node:assert/strict";
import { extractOfficialFiiMetrics } from "../src/modules/fundamentals/fii-official-metrics.service.js";

test("extracts structured CVM FII measures and official report risk indicators", () => {
  const result = extractOfficialFiiMetrics([
    {
      id: "cvm-1",
      source: "cvm_open_data",
      documentType: "fii_monthly_report",
      referenceDate: "2026-04-30",
      sourceUrl: "https://dados.cvm.gov.br/report",
      content: {
        rawText: JSON.stringify({ rows: [{ PATRIMONIO_LIQUIDO: "1000000,00", VALOR_PATRIMONIAL_COTA: "101,12", NUMERO_COTISTAS: "3450" }] })
      }
    },
    {
      id: "report-1",
      source: "fundosnet_b3",
      documentType: "fii_management_report",
      referenceDate: "2026-04-30",
      sourceUrl: "https://fnet/report",
      content: {
        rawText: "Carteira de CRI. LTV médio: 52,7%. Inadimplência: 8,4%. CDI: 61,0%. IPCA: 39,0%. Resultado por cota: R$ 1,10. Rendimento por cota: R$ 1,00."
      }
    }
  ]);
  assert.equal(result.metrics.netAssetValue, 1000000);
  assert.equal(result.metrics.netAssetValuePerShare, 101.12);
  assert.equal(result.metrics.shareholdersCount, 3450);
  assert.equal(result.metrics.loanToValue, 52.7);
  assert.equal(result.metrics.delinquency, 8.4);
  assert.deepEqual(result.metrics.indexerExposure, { cdi: 61, ipca: 39 });
  assert.equal(result.metrics.recurringResultCoverage, 1.1);
  assert.equal(result.metrics.fundType, "receivables");
});
