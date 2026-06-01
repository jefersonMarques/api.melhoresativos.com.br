import test from "node:test";
import assert from "node:assert/strict";
import { CvmFiiProvider } from "../src/modules/providers/cvm-fii.provider.js";

function createStoredZip(name, content) {
  const nameBuffer = Buffer.from(name);
  const contentBuffer = Buffer.from(content, "latin1");
  const local = Buffer.alloc(30 + nameBuffer.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(contentBuffer.length, 18);
  local.writeUInt32LE(contentBuffer.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26);
  nameBuffer.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(contentBuffer.length, 20);
  central.writeUInt32LE(contentBuffer.length, 24);
  central.writeUInt16LE(nameBuffer.length, 28);
  central.writeUInt32LE(0, 42);
  nameBuffer.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + contentBuffer.length, 16);
  return Buffer.concat([local, contentBuffer, central, end]);
}

test("extracts an official FII report and resolves identity from CVM rows", async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    const hasMonthly = String(url).includes("INF_MENSAL");
    const csv = hasMonthly
      ? "CNPJ_FUNDO;DENOMINACAO_SOCIAL;COD_NEGOCIACAO;DATA_REFERENCIA;PATRIMONIO_LIQUIDO\n32.065.364/0001-46;CARTESIA RECEBIVEIS;CACR11;2026-04-30;1000\n"
      : "CNPJ_FUNDO;COD_NEGOCIACAO;DATA_REFERENCIA\n";
    return new Response(createStoredZip("report.csv", csv), { status: 200 });
  };
  const provider = new CvmFiiProvider({ baseUrl: "https://dados.cvm.gov.br", timeoutMs: 100, lookbackYears: 1, currentYear: 2026 });
  const result = await provider.fetchDocuments("CACR11");
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].documentType, "fii_monthly_report");
  assert.equal(result.documents[0].source, "cvm_open_data");
  assert.equal(result.identity.cnpj, "32.065.364/0001-46");
  assert.match(result.documents[0].content.rawText, /CARTESIA RECEBIVEIS/);
});
