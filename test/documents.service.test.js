import test from "node:test";
import assert from "node:assert/strict";
import { DocumentsService } from "../src/modules/documents/documents.service.js";

function createRepository() {
  const registry = new Map();
  const documents = [];
  const states = [];
  return {
    getAssetRegistry: async (symbol) => registry.get(symbol) ?? null,
    upsertAssetRegistry: async (value) => { registry.set(value.symbol, value); return value; },
    upsertDocument: async (document) => {
      const existing = documents.find((item) => item.sourceDocumentId === document.sourceDocumentId);
      if (existing) return { id: existing.id, wasInserted: false };
      const row = { ...document, id: String(documents.length + 1) };
      documents.push(row);
      return { id: row.id, wasInserted: true };
    },
    setDocumentContent: async () => {},
    setDocumentSyncState: async (symbol, source, value) => states.push({ symbol, source, value }),
    listDocumentSyncState: async () => states,
    listDocuments: async (symbol) => documents.filter((document) => document.symbol === symbol),
    listRecentDocuments: async () => documents,
    getDocument: async (_symbol, id) => documents.find((document) => document.id === id) ?? null
  };
}

test("synchronizes documents with deduplication and partial source failures", async () => {
  const repository = createRepository();
  const cvmFiiProvider = {
    fetchDocuments: async (symbol) => ({
      identity: { symbol, assetType: "fii", cnpj: "32.065.364/0001-46", resolutionStatus: "resolved" },
      documents: [{ symbol, assetType: "fii", documentType: "fii_monthly_report", title: "Informe", source: "cvm_open_data", sourceDocumentId: `${symbol}:report`, sourceUrl: "official", content: { rawText: "{}", extractionStatus: "extracted" } }],
      failures: [{ sourceUrl: "older-resource", message: "arquivo histórico indisponível" }]
    })
  };
  const service = new DocumentsService({ repository, cvmFiiProvider, config: {} });
  let result = await service.sync(["CACR11"]);
  assert.equal(result[0].status, "partial");
  assert.equal(result[0].documents.inserted, 1);
  result = await service.sync(["CACR11"]);
  assert.equal(result[0].documents.inserted, 0);
  assert.equal(result[0].documents.updated, 1);
});
