import test from "node:test";
import assert from "node:assert/strict";
import { BrFiisFnetDiscoveryProvider, extractDocumentLinks } from "../src/modules/providers/brfiis-fnet-discovery.provider.js";
import { FnetFiiProvider, mapDocumentType } from "../src/modules/providers/fnet-fii.provider.js";

test("discovers public indexed FundosNet document IDs and reads document metadata", async () => {
  const pages = new Map([
    ["https://brfiis.com.br/fundos/CACR11/documentos", '<a href="/fundos/CACR11/documentos/2026-mai-18/relatorio-gerencial-1198849">Relatório</a>'],
    ["https://brfiis.com.br/fundos/CACR11/documentos/2026-mai-18/relatorio-gerencial-1198849", '<h1>Relatório Gerencial</h1><div>Categoria Relatórios</div><div>Tipo Relatório Gerencial</div><div>Referência 30/04/2026</div><div>Entrega 18/05/2026 20:59</div>']
  ]);
  const provider = new BrFiisFnetDiscoveryProvider({
    baseUrl: "https://brfiis.com.br",
    timeoutMs: 100,
    fetchTextFn: async (url) => pages.get(url)
  });
  const result = await provider.discover("CACR11");
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, "1198849");
  assert.equal(result.documents[0].referenceDate, "2026-04-30");
  assert.equal(result.documents[0].publishedAt, "2026-05-18T20:59:00-03:00");
});

test("downloads evidence only from official FundosNet URL and persists extracted PDF text", async () => {
  const provider = new FnetFiiProvider({
    baseUrl: "https://fnet.bmfbovespa.com.br/fnet/publico",
    timeoutMs: 100,
    discoveryProvider: {
      discover: async () => ({
        documents: [{ id: "1198849", title: "Relatório Gerencial", type: "Relatório Gerencial", category: "Relatórios", referenceDate: "2026-04-30", publishedAt: "2026-05-18T20:59:00-03:00", discoveryUrl: "https://brfiis.com.br/fundos/CACR11/documentos/x-1198849" }],
        failures: []
      })
    },
    fetchBufferFn: async (url) => {
      assert.equal(url, "https://fnet.bmfbovespa.com.br/fnet/publico/exibirDocumento?cvm=true&id=1198849");
      return Buffer.from("%PDF official-pdf-content");
    },
    pdfTextExtractor: { extract: async () => ({ rawText: "CACR11 Relatório Gerencial Abril 2026", extractionStatus: "extracted", extractedAt: "2026-05-29T12:00:00.000Z" }) }
  });
  const result = await provider.fetchDocuments("CACR11");
  assert.equal(result.documents[0].source, "fundosnet_b3");
  assert.equal(result.documents[0].documentType, "fii_management_report");
  assert.match(result.documents[0].content.rawText, /CACR11/);
  assert.equal(result.documents[0].metadata.discoveryOnly, true);
});

test("does not persist text content when official FundosNet response is not a PDF", async () => {
  const provider = new FnetFiiProvider({
    baseUrl: "https://fnet.bmfbovespa.com.br/fnet/publico",
    timeoutMs: 100,
    discoveryProvider: {
      discover: async () => ({
        documents: [{ id: "1198836", title: "Relatório Gerencial", type: "Relatório Gerencial", category: "Relatórios", referenceDate: "2026-04-30", publishedAt: "2026-05-18T20:59:00-03:00", discoveryUrl: "https://brfiis.com.br/fundos/CACR11/documentos/x-1198836" }],
        failures: []
      })
    },
    fetchBufferFn: async () => Buffer.from("not-a-pdf-response"),
    pdfTextExtractor: { extract: async () => { throw new Error("should not parse invalid pdf"); } }
  });
  const result = await provider.fetchDocuments("CACR11");
  assert.equal(result.documents[0].processingStatus, "failed");
  assert.match(result.documents[0].processingError, /not a valid PDF/);
  assert.equal(result.documents[0].content, undefined);
  assert.equal(result.documents[0].contentHash, null);
});

test("maps material FundosNet document categories to normalized types", () => {
  assert.equal(mapDocumentType("Fato Relevante"), "material_fact");
  assert.equal(mapDocumentType("Comunicado ao Mercado"), "market_announcement");
  assert.equal(mapDocumentType("Rendimentos e Amortizações"), "income_announcement");
  assert.equal(mapDocumentType("Relatório Gerencial"), "fii_management_report");
  assert.equal(extractDocumentLinks('<a href="/fundos/CACR11/documentos/2026-mai-18/relatorio-gerencial-1198849">x</a>', "CACR11", "https://brfiis.com.br").length, 1);
});
