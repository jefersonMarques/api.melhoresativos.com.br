import test from "node:test";
import assert from "node:assert/strict";
import { EventsService } from "../src/modules/events/events.service.js";

test("syncs document events and extracts income announcements", async () => {
  const events = [];
  const incomeEntries = [];
  const document = {
    id: "10",
    symbol: "CACR11",
    documentType: "income_announcement",
    title: "Rendimentos e Amortizações",
    referenceDate: "2026-05-31",
    publishedAt: "2026-06-03T12:00:00.000Z",
    source: "fundosnet_b3",
    sourceDocumentId: "1199000",
    sourceUrl: "https://fnet.example/documento",
    content: {
      rawText: "Rendimentos e Amortizações\nValor do rendimento R$ 0,95 por cota\nData de pagamento 15/06/2026\nData ex-rendimento 02/06/2026\nCotistas em 30/05/2026"
    }
  };
  const repository = {
    listRecentDocuments: async () => [{ ...document, content: undefined }],
    getDocument: async () => document,
    pool: {
      query: async (_sql, params) => {
        const row = {
          id: "1",
          symbol: params[0],
          event_type: params[1],
          title: params[2],
          event_date: params[3],
          published_at: params[4],
          reference_date: params[5],
          source: params[6],
          source_document_id: params[7],
          source_url: params[8],
          summary: params[9],
          importance: params[11],
          sentiment: params[12],
          metadata: JSON.parse(params[14]),
          created_at: "2026-06-03T12:00:00.000Z",
          updated_at: "2026-06-03T12:00:00.000Z"
        };
        events.push(row);
        return { rows: [row] };
      }
    }
  };
  const incomeService = {
    upsertIncome: async (income) => {
      incomeEntries.push(income);
      return income;
    }
  };
  const service = new EventsService({ repository, incomeService });

  const result = await service.syncFromDocuments(["CACR11"]);

  assert.equal(result.insertedOrUpdated, 1);
  assert.equal(result.incomeInsertedOrUpdated, 1);
  assert.equal(events[0].event_type, "income_announcement");
  assert.match(events[0].summary, /R\$ 0,95/);
  assert.equal(incomeEntries[0].amount, 0.95);
  assert.equal(incomeEntries[0].paymentDate, "2026-06-15");
  assert.equal(incomeEntries[0].exDate, "2026-06-02");
  assert.equal(incomeEntries[0].comDate, "2026-05-30");
});
